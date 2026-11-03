-- Fix a wrong payment method on a finished sale (e.g. a card or bank payment that
-- was rung up as cash). Admin or manager only. Every change is written to a log
-- (who, when, from, to, note) so nothing is changed silently.
--
-- Only Cash / Card / Bank can be swapped between each other. Later Pay is NOT
-- allowed in either direction, because it carries a customer and a credit balance.
--
-- The card fee (2.5%) is worked out from the payment method when reports are
-- shown, so changing the method automatically fixes the profit too.

create table if not exists public.payment_method_changes (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null,
  invoice_no text not null,
  old_method text not null,
  new_method text not null,
  note text,
  changed_by uuid references public.users(id) on delete set null,
  changed_by_name text,
  changed_at timestamptz not null default now()
);

create index if not exists payment_method_changes_txn_idx on public.payment_method_changes(transaction_id);
create index if not exists payment_method_changes_at_idx  on public.payment_method_changes(changed_at);

alter table public.payment_method_changes enable row level security;

-- Anyone logged in can READ the log; rows are only written by the function below.
create policy "Authenticated can read payment_method_changes"
  on public.payment_method_changes for select to authenticated using (true);


create or replace function public.change_payment_method(
  p_transaction_id uuid,
  p_new_method text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_name text;
  txn record;
begin
  select role, full_name into caller_role, caller_name
  from public.users where id = auth.uid();

  if caller_role is null or caller_role not in ('admin', 'manager') then
    raise exception 'Only an admin or manager can change a payment method.';
  end if;

  if p_new_method not in ('cash', 'card', 'bank') then
    raise exception 'Payment method must be cash, card or bank.';
  end if;

  select * into txn from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'Sale not found.';
  end if;
  if txn.status <> 'completed' then
    raise exception 'Only a completed sale can be changed.';
  end if;
  if txn.payment_method not in ('cash', 'card', 'bank') then
    raise exception 'A Later Pay sale cannot be changed here.';
  end if;
  if txn.payment_method = p_new_method then
    raise exception 'This sale is already paid by %.', p_new_method;
  end if;

  update public.transactions
  set payment_method = p_new_method,
      -- Card and bank are always the exact total. Cash keeps what the customer handed over.
      amount_paid = case when p_new_method = 'cash' then greatest(amount_paid, total) else total end,
      balance     = case when p_new_method = 'cash' then greatest(greatest(amount_paid, total) - total, 0) else 0 end
  where id = p_transaction_id;

  -- Keep the other records that copy the method in step
  update public.loyal_purchases set payment_method = p_new_method where invoice_no = txn.invoice_no;
  update public.free_gifts      set payment_method = p_new_method where transaction_id = p_transaction_id;

  insert into public.payment_method_changes
    (transaction_id, invoice_no, old_method, new_method, note, changed_by, changed_by_name)
  values
    (txn.id, txn.invoice_no, txn.payment_method, p_new_method,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), coalesce(caller_name, 'Staff'));
end;
$$;

grant execute on function public.change_payment_method(uuid, text, text) to authenticated;
