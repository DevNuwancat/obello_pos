-- Credit Loan: money the shop lends to a Pay Later customer.
-- A loan is NOT a sale (no transactions row, no stock change), so it lives in its
-- own table. It adds to the customer's balance just like a Pay Later bill does,
-- and repayments (pay_later_payments) reduce the combined balance.

create table if not exists public.pay_later_loans (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.pay_later_customers(id),
  amount numeric not null check (amount > 0),
  note text,
  given_by uuid references public.users(id) on delete set null,
  given_at timestamptz not null default now()
);

create index if not exists pay_later_loans_customer_idx on public.pay_later_loans(customer_id);
create index if not exists pay_later_loans_given_at_idx on public.pay_later_loans(given_at);

alter table public.pay_later_loans enable row level security;

create policy "Authenticated users can manage pay_later_loans"
  on public.pay_later_loans for all
  to authenticated
  using (true)
  with check (true);

-- Balance view: same columns and order as before, total_owed now also counts loans,
-- and two new columns (total_loaned, last_loan_at) are added at the END.
create or replace view public.pay_later_balances as
 select c.id,
    c.name,
    c.id_number,
    c.phone,
    c.address,
    c.created_at,
    c.updated_at,
    coalesce(billed.total_billed, 0::numeric) as total_billed,
    coalesce(paid.total_paid, 0::numeric) as total_paid,
    coalesce(billed.total_billed, 0::numeric) + coalesce(loans.total_loaned, 0::numeric) - coalesce(paid.total_paid, 0::numeric) as total_owed,
    billed.last_bill_at,
    paid.last_payment_at,
    coalesce(loans.total_loaned, 0::numeric) as total_loaned,
    loans.last_loan_at
   from pay_later_customers c
     left join ( select transactions.customer_id,
            sum(transactions.total) as total_billed,
            max(transactions.created_at) as last_bill_at
           from transactions
          where transactions.payment_method = 'later_pay'::text and transactions.status = 'completed'::text
          group by transactions.customer_id) billed on billed.customer_id = c.id
     left join ( select pay_later_payments.customer_id,
            sum(pay_later_payments.amount) as total_paid,
            max(pay_later_payments.paid_at) as last_payment_at
           from pay_later_payments
          group by pay_later_payments.customer_id) paid on paid.customer_id = c.id
     left join ( select pay_later_loans.customer_id,
            sum(pay_later_loans.amount) as total_loaned,
            max(pay_later_loans.given_at) as last_loan_at
           from pay_later_loans
          group by pay_later_loans.customer_id) loans on loans.customer_id = c.id;
