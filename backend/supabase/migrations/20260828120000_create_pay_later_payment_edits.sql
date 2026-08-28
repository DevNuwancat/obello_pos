-- Tracks manual corrections made to Pay Later payments (amount changed + why),
-- so the Payment History list can show "Rs. X → Rs. Y - reason" for anyone who edited it.
create table if not exists public.pay_later_payment_edits (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.pay_later_payments(id) on delete cascade,
  old_amount numeric not null,
  new_amount numeric not null,
  reason text not null,
  edited_at timestamptz not null default now()
);

create index if not exists pay_later_payment_edits_payment_id_idx
  on public.pay_later_payment_edits(payment_id);

-- This app has no per-user auth layer — every other pay_later_* table is open
-- to the anon key the same way, so this new table matches that pattern.
alter table public.pay_later_payment_edits disable row level security;
