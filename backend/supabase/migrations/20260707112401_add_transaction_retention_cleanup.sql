-- Data retention: keep 4 months of sales history, then auto-delete older
-- transactions every day. Later Pay bills are exempt while the customer
-- still owes money — only their fully-settled bills age out — so unpaid
-- debt is never silently erased.

create extension if not exists pg_cron;

create or replace function public.cleanup_old_transactions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - interval '4 months';
  deletable_ids uuid[];
begin
  select array_agg(t.id) into deletable_ids
  from public.transactions t
  where t.created_at < cutoff
    and (
      t.payment_method <> 'later_pay'
      or t.customer_id is null
      or exists (
        select 1 from public.pay_later_balances b
        where b.id = t.customer_id and b.total_owed <= 0
      )
    );

  if deletable_ids is null then
    return;
  end if;

  delete from public.transaction_items where transaction_id = any(deletable_ids);
  delete from public.transactions where id = any(deletable_ids);
end;
$$;

select cron.schedule(
  'cleanup-old-transactions',
  '0 3 * * *',
  $$select public.cleanup_old_transactions();$$
);
