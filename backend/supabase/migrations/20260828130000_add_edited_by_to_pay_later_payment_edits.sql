-- Records WHO made a payment correction, not just what changed.
-- Nullable + "set null on delete" so an edit log entry is never lost just
-- because the staff account that made it gets removed later.
alter table public.pay_later_payment_edits
  add column if not exists edited_by uuid references public.users(id) on delete set null;
