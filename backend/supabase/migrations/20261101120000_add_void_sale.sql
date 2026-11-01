-- Cancel (void) a sale that was added by mistake.
--
-- Rules:
--   * Only an ADMIN can do it (checked here in the database, not just in the UI).
--   * A reason is required.
--   * The sale row is NEVER deleted. It stays with status = 'void' plus who /
--     when / why, so there is always a record. Today Business shows it as
--     "Cancelled" and leaves it out of Sales / Cost / Profit.
--   * The sold quantity goes back into each product's stock.
--   * Customer Book (loyal_purchases) rows for that invoice are removed.
--   * Pay Later balances already count only status = 'completed', so a
--     cancelled Later Pay sale drops out of what the customer owes by itself.

-- 1) Columns that remember who cancelled it, when, and why.
--    voided_by has no foreign key on purpose: transactions already links to
--    users once (cashier), and a second link would make the
--    `users(full_name)` join in Today Business ambiguous. The name is saved
--    as text so the record still reads correctly if the user is deleted later.
alter table public.transactions
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid,
  add column if not exists voided_by_name text,
  add column if not exists void_reason text;

-- 2) Make sure 'void' is an allowed status (drops any old status check, adds a new one).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.transactions drop constraint %I', c.conname);
  end loop;

  alter table public.transactions
    add constraint transactions_status_check
    check (status in ('completed', 'refunded', 'void'));
end $$;

-- 3) The function the app calls: select public.void_sale('<sale id>', 'reason');
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
  reason text := btrim(coalesce(p_reason, ''));
begin
  -- Admin only
  select role, full_name into caller_role, caller_name
  from public.users where id = auth.uid();

  if caller_role is distinct from 'admin' then
    raise exception 'Only an admin can cancel a sale.';
  end if;

  -- A reason is required
  if char_length(reason) < 3 then
    raise exception 'Please give a reason for cancelling this sale.';
  end if;

  -- Lock the sale so two admins can't cancel it twice at the same moment
  select * into txn from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'Sale not found.';
  end if;
  if txn.status = 'void' then
    raise exception 'This sale is already cancelled.';
  end if;

  -- Put the stock back (items already returned have qty = 0, so they add nothing)
  update public.products p
  set stock = p.stock + i.qty
  from public.transaction_items i
  where i.transaction_id = p_transaction_id
    and i.product_id = p.id
    and i.qty > 0;

  -- Remove the Customer Book records made for this invoice
  delete from public.loyal_purchases where invoice_no = txn.invoice_no;

  -- Mark the sale as cancelled (the row stays, for the record)
  update public.transactions
  set status = 'void',
      voided_at = now(),
      voided_by = auth.uid(),
      voided_by_name = coalesce(caller_name, 'Admin'),
      void_reason = reason
  where id = p_transaction_id;
end;
$$;

-- Only logged-in users can call it (and the function itself rejects non-admins)
revoke all on function public.void_sale(uuid, text) from public;
grant execute on function public.void_sale(uuid, text) to authenticated;
