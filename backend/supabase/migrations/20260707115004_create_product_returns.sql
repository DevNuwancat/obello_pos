-- Return Bin: items a customer brought back, sitting here until staff
-- either restocks them (adds back to products.stock) or discards them.
-- Details are copied from the original sale (invoice, image, sold date) so
-- the entry still displays correctly even if the source transaction is
-- later purged by the 4-month retention job.

create table if not exists public.product_returns (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  transaction_id uuid references public.transactions(id) on delete set null,
  invoice_no text,
  product_name text not null,
  sku text,
  image_url text,
  qty integer not null default 1,
  sold_at timestamptz,
  returned_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists product_returns_returned_at_idx on public.product_returns(returned_at);

alter table public.product_returns enable row level security;

create policy "Authenticated users can manage product_returns"
  on public.product_returns for all
  to authenticated
  using (true)
  with check (true);

-- Retention: anything still sitting in the bin after 2 months gets purged
-- automatically (same daily schedule as the transaction cleanup job).
create or replace function public.cleanup_old_returns()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.product_returns
  where returned_at < now() - interval '2 months';
$$;

select cron.schedule(
  'cleanup-old-returns',
  '15 3 * * *',
  $$select public.cleanup_old_returns();$$
);
