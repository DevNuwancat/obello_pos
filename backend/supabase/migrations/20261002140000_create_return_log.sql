-- Return log: a permanent record of every item that was brought back, written
-- when the return is added to the Return Bin. The bin itself (product_returns)
-- deletes rows once they're restocked or discarded, so Today Business reads
-- this table to show "how many items / how much Rs. was returned that day".
-- amount = what the customer paid for those units (line_total / qty × returned qty).

create table if not exists public.return_log (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  transaction_id uuid references public.transactions(id) on delete set null,
  invoice_no text,
  product_name text not null,
  sku text,
  qty integer not null default 1,
  amount numeric not null default 0,
  returned_at timestamptz not null default now()
);

create index if not exists return_log_returned_at_idx on public.return_log(returned_at);

alter table public.return_log enable row level security;

create policy "Authenticated users can manage return_log"
  on public.return_log for all
  to authenticated
  using (true)
  with check (true);
