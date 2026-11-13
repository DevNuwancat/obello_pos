-- Free Gifts: every full "minimum amount" in a bill earns ONE gift.
--
--   minimum Rs. 5,000  →  Rs.  5,000 = 1 gift
--                         Rs. 10,000 = 2 gifts
--                         Rs. 15,000 = 3 gifts   (and 9,999 is still just 1)
--
-- gifts earned = floor(bill total / minimum amount)
--
-- Before, a bill could only have ONE row in free_gifts (transaction_id was unique).
-- Now a bill can have several rows — one row per gift — up to the number it earned.

-- 1. Let one bill have many gift rows (keep a normal index so lookups stay fast)
alter table public.free_gifts drop constraint if exists free_gifts_transaction_id_key;
create index if not exists free_gifts_transaction_idx on public.free_gifts(transaction_id);


-- 2. give_free_gift: add ONE gift to a bill, as long as the bill still has gifts left to give.
--    (Same name and inputs as before, so the screens keep working. For 2 gifts, call it twice.)
create or replace function public.give_free_gift(
  p_transaction_id uuid,
  p_product_id uuid,
  p_release_now boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_name text;
  min_amt numeric;
  earned int;
  already int;
  txn record;
  prod record;
  cust_name text;
  new_id uuid;
begin
  select role, full_name into caller_role, caller_name
  from public.users where id = auth.uid();
  if caller_role is null then
    raise exception 'Not allowed.';
  end if;

  select min_amount into min_amt from public.free_gift_settings where id = 1;

  -- Lock the bill so two gifts can't be added at the same moment
  select * into txn from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'Bill not found.';
  end if;
  if txn.status <> 'completed' then
    raise exception 'A cancelled bill cannot get a gift.';
  end if;

  earned := floor(txn.total / min_amt);
  if earned < 1 then
    raise exception 'This bill is below the Rs. % needed for a free gift.', min_amt;
  end if;

  select count(*) into already from public.free_gifts where transaction_id = p_transaction_id;
  if already >= earned then
    raise exception 'This bill has already received all % of its free gift(s).', earned;
  end if;

  -- Cashiers can only add a gift to a bill they just made (last 15 minutes).
  -- Giving a gift to an older bill is for admin / manager.
  if caller_role not in ('admin', 'manager') and txn.created_at < now() - interval '15 minutes' then
    raise exception 'Only an admin or manager can add a gift to an older bill.';
  end if;

  if not exists (select 1 from public.free_gift_items where product_id = p_product_id) then
    raise exception 'This item is not on the free gift list.';
  end if;

  select * into prod from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Gift item not found.';
  end if;
  if prod.stock < 1 then
    raise exception '% is out of stock.', prod.name;
  end if;

  if txn.customer_id is not null then
    select name into cust_name from public.pay_later_customers where id = txn.customer_id;
  end if;

  update public.products set stock = stock - 1 where id = p_product_id;

  insert into public.free_gifts (
    transaction_id, invoice_no, product_id, product_name, sku, image_url, qty, cost,
    bill_total, payment_method, customer_id, customer_name, status,
    given_by, given_by_name, released_at, released_by_name
  ) values (
    txn.id, txn.invoice_no, prod.id, prod.name, prod.sku, prod.image_url, 1, coalesce(prod.cost_price, 0),
    txn.total, txn.payment_method, txn.customer_id, cust_name,
    case when p_release_now then 'released' else 'pending' end,
    auth.uid(), coalesce(caller_name, 'Staff'),
    case when p_release_now then now() else null end,
    case when p_release_now then coalesce(caller_name, 'Staff') else null end
  )
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.give_free_gift(uuid, uuid, boolean) to authenticated;


-- 3. void_sale: a cancelled bill may now have SEVERAL gifts.
--    Every gift not handed over yet goes back to stock and its row is removed.
--    Gifts already handed over stay (their cost still shows, stock stays out).
create or replace function public.void_sale(p_transaction_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_name text;
  txn record;
  gift record;
  reason text := btrim(coalesce(p_reason, ''));
begin
  select role, full_name into caller_role, caller_name
  from public.users where id = auth.uid();

  if caller_role is null or caller_role not in ('admin', 'manager') then
    raise exception 'Only an admin or manager can cancel a sale.';
  end if;

  if char_length(reason) < 3 then
    raise exception 'Please give a reason for cancelling this sale.';
  end if;

  select * into txn from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'Sale not found.';
  end if;
  if txn.status = 'void' then
    raise exception 'This sale is already cancelled.';
  end if;

  update public.products p
  set stock = p.stock + i.qty
  from public.transaction_items i
  where i.transaction_id = p_transaction_id
    and i.product_id = p.id
    and i.qty > 0;

  -- Free gifts not handed over yet → back to stock, gift records removed
  for gift in
    select * from public.free_gifts
    where transaction_id = p_transaction_id and status = 'pending'
    for update
  loop
    if gift.product_id is not null then
      update public.products set stock = stock + gift.qty where id = gift.product_id;
    end if;
    delete from public.free_gifts where id = gift.id;
  end loop;

  delete from public.loyal_purchases where invoice_no = txn.invoice_no;

  update public.transactions
  set status = 'void',
      voided_at = now(),
      voided_by = auth.uid(),
      voided_by_name = coalesce(caller_name, 'Admin'),
      void_reason = reason
  where id = p_transaction_id;
end;
$$;
