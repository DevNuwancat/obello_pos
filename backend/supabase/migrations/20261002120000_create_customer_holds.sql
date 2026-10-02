-- Customer Holds: items a customer asked us to set aside.
-- Stock is deducted from products when the hold is created (done by the app),
-- NOT recorded as a sale. A sale (transactions row) is only created when the
-- customer collects the items. Remaining qty of an item =
--   qty_held - qty_sold - qty_cancelled
-- A hold is "temporary" while any item has remaining qty > 0, otherwise "completed".

create table if not exists public.customer_holds (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.pay_later_customers(id) on delete cascade,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_hold_items (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references public.customer_holds(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  sku text,
  image_url text,
  unit_price numeric not null default 0,
  selling_price numeric not null default 0,
  discount_label text,
  qty_held integer not null default 1,
  qty_sold integer not null default 0,
  qty_cancelled integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists customer_holds_customer_idx on public.customer_holds(customer_id);
create index if not exists customer_hold_items_hold_idx on public.customer_hold_items(hold_id);

alter table public.customer_holds enable row level security;
alter table public.customer_hold_items enable row level security;

create policy "Authenticated users can manage customer_holds"
  on public.customer_holds for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can manage customer_hold_items"
  on public.customer_hold_items for all
  to authenticated
  using (true)
  with check (true);
