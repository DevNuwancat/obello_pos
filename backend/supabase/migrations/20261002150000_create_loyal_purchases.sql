-- Loyal Customer Records: what each registered customer bought, one row per item.
-- Written at checkout when the "Customer Book" toggle is on (Cash / Card / Bank).
-- It keeps its own copy of the details because transactions are purged after
-- 4 months. Each purchase record is deleted automatically after 1 year; the
-- customer (pay_later_customers) and all newer records stay.

create table if not exists public.loyal_purchases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.pay_later_customers(id),
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  sku text,
  image_url text,
  qty integer not null default 1,
  unit_price numeric not null default 0,
  line_total numeric not null default 0,
  discount_label text,
  payment_method text,
  invoice_no text,
  cashier_id uuid,
  purchased_at timestamptz not null default now()
);

create index if not exists loyal_purchases_purchased_at_idx on public.loyal_purchases(purchased_at);
create index if not exists loyal_purchases_customer_idx on public.loyal_purchases(customer_id);

alter table public.loyal_purchases enable row level security;

create policy "Authenticated users can manage loyal_purchases"
  on public.loyal_purchases for all
  to authenticated
  using (true)
  with check (true);

-- Retention: each purchase record older than 1 year is removed (nightly).
create or replace function public.cleanup_old_loyal_purchases()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.loyal_purchases
  where purchased_at < now() - interval '1 year';
$$;

select cron.schedule(
  'cleanup-old-loyal-purchases',
  '30 3 * * *',
  $$select public.cleanup_old_loyal_purchases();$$
);
