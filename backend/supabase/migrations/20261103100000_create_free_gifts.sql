-- Free Gifts: a bill of Rs. X or more earns ONE free gift.
--
--   free_gift_settings : one row, holds the minimum bill amount.
--   free_gift_items    : which stock products may be given as gifts.
--   free_gifts         : one row per gift given (max one per bill). It keeps its
--                        own copy of the details (name, cost, bill total, ...)
--                        because transactions are purged after 4 months.
--
-- A gift reduces stock and counts as a COST in the reports (cost_price is saved
-- on the row at the moment the gift is given). It is NOT a sale, so it never
-- adds to Sales totals.

-- ── Minimum bill amount (a single row, id is always 1) ──
create table if not exists public.free_gift_settings (
  id int primary key default 1 check (id = 1),
  min_amount numeric not null default 5000 check (min_amount > 0),
  updated_at timestamptz not null default now()
);
insert into public.free_gift_settings (id, min_amount) values (1, 5000)
on conflict (id) do nothing;

-- ── Products allowed as gifts ──
create table if not exists public.free_gift_items (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id) on delete cascade,
  added_by uuid references public.users(id) on delete set null,
  added_at timestamptz not null default now()
);

-- ── Gifts given ──
create table if not exists public.free_gifts (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique,          -- one gift per bill
  invoice_no text not null,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  sku text,
  image_url text,
  qty int not null default 1,
  cost numeric not null default 0,              -- what the gift cost the shop
  bill_total numeric not null default 0,
  payment_method text,
  customer_id uuid references public.pay_later_customers(id) on delete set null,
  customer_name text,                           -- only when the bill had a name
  status text not null default 'pending' check (status in ('pending', 'released')),
  given_by uuid references public.users(id) on delete set null,
  given_by_name text,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by_name text,
  released_unpaid boolean not null default false,   -- handed over while the customer still owed money
  release_note text
);

create index if not exists free_gifts_created_at_idx on public.free_gifts(created_at);
create index if not exists free_gifts_customer_idx   on public.free_gifts(customer_id);

alter table public.free_gift_settings enable row level security;
alter table public.free_gift_items    enable row level security;
alter table public.free_gifts         enable row level security;

-- Everyone logged in can READ (the cashier needs the gift list and the amount).
create policy "Authenticated can read free_gift_settings"
  on public.free_gift_settings for select to authenticated using (true);
create policy "Authenticated can read free_gift_items"
  on public.free_gift_items for select to authenticated using (true);
create policy "Authenticated can read free_gifts"
  on public.free_gifts for select to authenticated using (true);

-- Only admin / manager may CHANGE the amount and the gift list.
-- (Gift rows themselves are only written by the functions below.)
create policy "Admin or manager can change free_gift_settings"
  on public.free_gift_settings for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'manager')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'manager')));

create policy "Admin or manager can change free_gift_items"
  on public.free_gift_items for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'manager')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'manager')));


-- ── give_free_gift: attach ONE gift to a bill ──
-- Used at checkout (cashier) and later from the Free Gifts page (admin / manager,
-- for Pay Later bills that earned a gift but did not take it yet).
-- Does everything in one go, so it either fully happens or not at all:
--   checks the bill is big enough, no gift yet, gift is on the list, in stock;
--   takes 1 off the stock; saves the gift with its cost.
-- p_release_now = true  → handed over right away (cash / card / bank)
--               = false → stays "pending" until someone releases it (Pay Later)
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
  if txn.total < min_amt then
    raise exception 'This bill is below the Rs. % needed for a free gift.', min_amt;
  end if;
  if exists (select 1 from public.free_gifts where transaction_id = p_transaction_id) then
    raise exception 'This bill already has a free gift.';
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


-- ── release_free_gift: hand a pending gift to the customer ──
-- Works whether or not the customer has paid. If they still owe money, the gift is
-- marked "released unpaid" so it can be seen later. Admin / manager only.
create or replace function public.release_free_gift(p_gift_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_name text;
  g record;
  owed numeric := 0;
begin
  select role, full_name into caller_role, caller_name
  from public.users where id = auth.uid();
  if caller_role is null or caller_role not in ('admin', 'manager') then
    raise exception 'Only an admin or manager can release a gift.';
  end if;

  select * into g from public.free_gifts where id = p_gift_id for update;
  if not found then
    raise exception 'Gift not found.';
  end if;
  if g.status = 'released' then
    raise exception 'This gift is already released.';
  end if;

  if g.customer_id is not null then
    select coalesce(total_owed, 0) into owed from public.pay_later_balances where id = g.customer_id;
  end if;

  update public.free_gifts
  set status = 'released',
      released_at = now(),
      released_by_name = coalesce(caller_name, 'Staff'),
      released_unpaid = coalesce(owed, 0) > 0,
      release_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_gift_id;
end;
$$;

grant execute on function public.release_free_gift(uuid, text) to authenticated;


-- ── void_sale: also take the gift back when a bill is cancelled ──
-- Same as before, plus: a pending gift goes back to stock and its row is removed.
-- A gift that was already handed over cannot come back — the row is kept (so its
-- cost still shows) and the stock stays out.
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

  -- Free gift not handed over yet → back to stock, gift record removed
  select * into gift from public.free_gifts where transaction_id = p_transaction_id for update;
  if found and gift.status = 'pending' then
    if gift.product_id is not null then
      update public.products set stock = stock + gift.qty where id = gift.product_id;
    end if;
    delete from public.free_gifts where id = gift.id;
  end if;

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
