-- Size groups (e.g. "UK Size") and their options (e.g. S, M, L),
-- plus which main category types each size group applies to.

create table if not exists public.size_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.size_options (
  id uuid primary key default gen_random_uuid(),
  size_group_id uuid not null references public.size_groups(id) on delete cascade,
  value text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.category_size_links (
  id uuid primary key default gen_random_uuid(),
  category_type text not null,
  size_group_id uuid not null references public.size_groups(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (category_type, size_group_id)
);

create index if not exists size_options_size_group_id_idx on public.size_options(size_group_id);
create index if not exists category_size_links_category_type_idx on public.category_size_links(category_type);

alter table public.size_groups enable row level security;
alter table public.size_options enable row level security;
alter table public.category_size_links enable row level security;

-- Match the app's existing pattern: any logged-in (authenticated) user can
-- fully manage these tables from the client, same as categories/products.
create policy "Authenticated users can manage size_groups"
  on public.size_groups for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can manage size_options"
  on public.size_options for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can manage category_size_links"
  on public.category_size_links for all
  to authenticated
  using (true)
  with check (true);
