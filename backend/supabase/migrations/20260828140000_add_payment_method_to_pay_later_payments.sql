-- How a Pay Later payment was actually received (cash/card/bank), and who
-- took it. Needed so a Pay Later payment can show up correctly in the Today
-- Business report — same Payment badge + Cashier name as a normal sale.
alter table public.pay_later_payments
  add column if not exists payment_method text not null default 'cash'
    check (payment_method in ('cash', 'card', 'bank'));

alter table public.pay_later_payments
  add column if not exists received_by uuid references public.users(id) on delete set null;
