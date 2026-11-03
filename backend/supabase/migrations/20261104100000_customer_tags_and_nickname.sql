-- Customer tags ("location categories") and nicknames.
--
--   customer_tags       : the tags themselves, e.g. "Provincial Council", "Pradeshiya Sabha".
--   customer_tag_links  : which customer has which tag (one customer can have several tags).
--   pay_later_customers.nickname : an optional short name people use for the customer.
--
-- Tags are created and assigned in the Customer Book and then show up (and can be
-- filtered / searched) in Pay Later, Loyal Customers, Customer Holds and the Cart's
-- customer picker. Pay Later uses them to add up the outstanding debt per tag.

alter table public.pay_later_customers
  add column if not exists nickname text;

create table if not exists public.customer_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) > 0),
  color text not null default '#8b5cf6',
  created_at timestamptz not null default now()
);

-- Same tag name twice (even in different letter case) is not allowed
create unique index if not exists customer_tags_name_unique on public.customer_tags (lower(btrim(name)));

create table if not exists public.customer_tag_links (
  customer_id uuid not null references public.pay_later_customers(id) on delete cascade,
  tag_id uuid not null references public.customer_tags(id) on delete cascade,
  primary key (customer_id, tag_id)
);

create index if not exists customer_tag_links_tag_idx on public.customer_tag_links(tag_id);

alter table public.customer_tags enable row level security;
alter table public.customer_tag_links enable row level security;

create policy "Authenticated users can manage customer_tags"
  on public.customer_tags for all to authenticated using (true) with check (true);

create policy "Authenticated users can manage customer_tag_links"
  on public.customer_tag_links for all to authenticated using (true) with check (true);

-- Balance view: same columns as before, nickname added at the END.
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
    loans.last_loan_at,
    c.whatsapp,
    c.nickname
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
