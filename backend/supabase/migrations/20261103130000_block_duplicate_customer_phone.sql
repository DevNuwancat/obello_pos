-- No two customers may share a mobile number.
--
-- People type the same number in different ways: "077 123 4567", "0771234567",
-- "+94 77 123 4567". So we compare only the LAST 9 DIGITS (the part that stays
-- the same) after removing spaces, dashes and the + sign.
--
-- A trigger (a rule the database runs by itself) checks every new customer and
-- every change of a mobile number. It does NOT touch customers that already
-- exist, so old duplicates (if any) keep working - they just can't be created again.

create or replace function public.normalize_phone(p text)
returns text
language sql
immutable
as $$
  select case
    when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) < 9 then null
    else right(regexp_replace(p, '\D', '', 'g'), 9)
  end
$$;

create or replace function public.block_duplicate_customer_phone()
returns trigger
language plpgsql
as $$
declare
  existing_name text;
begin
  if public.normalize_phone(new.phone) is null then
    return new;
  end if;

  select name into existing_name
  from public.pay_later_customers
  where public.normalize_phone(phone) = public.normalize_phone(new.phone)
    and id <> new.id
  limit 1;

  if found then
    raise exception 'A customer with this mobile number already exists: %', existing_name;
  end if;

  return new;
end;
$$;

drop trigger if exists block_duplicate_customer_phone on public.pay_later_customers;
create trigger block_duplicate_customer_phone
  before insert or update of phone on public.pay_later_customers
  for each row execute function public.block_duplicate_customer_phone();
