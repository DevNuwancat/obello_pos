-- Owners (e.g. "Obello", code "O") — same shape as suppliers: a name + a
-- short code used in the product SKU. Replaces the hardcoded OWNERS list
-- that used to live inline in AddClothModal.vue / EditProductModal.vue.

create table if not exists public.owners (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.owners enable row level security;

create policy "Authenticated users can manage owners"
  on public.owners for all
  to authenticated
  using (true)
  with check (true);

-- Carry over the owners that were previously hardcoded, so existing
-- SKU codes (O / S / A) keep working.
insert into public.owners (name, code) values
  ('Obello', 'O'),
  ('Shashika', 'S'),
  ('Admin', 'A')
on conflict (name) do nothing;
