-- Managers can cancel a sale too (admin + manager). Cashiers still cannot.
-- Same function as before; only the role check changed.

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
  -- Admin or manager only
  select role, full_name into caller_role, caller_name
  from public.users where id = auth.uid();

  if caller_role is null or caller_role not in ('admin', 'manager') then
    raise exception 'Only an admin or manager can cancel a sale.';
  end if;

  -- A reason is required
  if char_length(reason) < 3 then
    raise exception 'Please give a reason for cancelling this sale.';
  end if;

  -- Lock the sale so it can't be cancelled twice at the same moment
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
