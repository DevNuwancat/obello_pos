-- Size groups were originally linked to a main category type (e.g. "Clothing
-- & Accessories" as a whole). We're switching this to link per sub-category
-- instead (e.g. just "Oversize T-Shirt"), so different sub-categories under
-- the same main type can have different sizes.

alter table public.category_size_links drop constraint if exists category_size_links_category_type_size_group_id_key;
drop index if exists category_size_links_category_type_idx;

alter table public.category_size_links drop column if exists category_type;

alter table public.category_size_links
  add column category_id uuid references public.categories(id) on delete cascade;

-- Existing rows (linked to a main type, not a specific sub-category) no
-- longer make sense under the new model — clear them out.
delete from public.category_size_links where category_id is null;

alter table public.category_size_links alter column category_id set not null;

create index if not exists category_size_links_category_id_idx on public.category_size_links(category_id);

alter table public.category_size_links
  add constraint category_size_links_category_id_size_group_id_key unique (category_id, size_group_id);
