-- WhatsApp number for Pay Later / Customer Book customers.
-- Optional: many customers use the same number for calls and WhatsApp,
-- and the forms offer a "same as mobile" shortcut that copies it across.

alter table public.pay_later_customers
  add column if not exists whatsapp text;

-- Same balance view as before, with the new column added at the END
-- (a view can only grow at the end, otherwise the existing columns would shift).
create or replace view public.pay_later_balances as
 select c.id,
    c.name,
    c.id_number,
    c.phone,
    c.address,
    c.created_at,
    c.updated_at,
    coalesce(billed.total_billed, 0::numeric) as total_billed,
    coalesce(paid.total_paid, 0::numeric) as total_paid,
    coalesce(billed.total_billed, 0::numeric) + coalesce(loans.total_loaned, 0::numeric) - coalesce(paid.total_paid, 0::numeric) as total_owed,
    billed.last_bill_at,
    paid.last_payment_at,
    coalesce(loans.total_loaned, 0::numeric) as total_loaned,
    loans.last_loan_at,
    c.whatsapp
   from pay_later_customers c
     left join ( select transactions.customer_id,
            sum(transactions.total) as total_billed,
            max(transactions.created_at) as last_bill_at
           from transactions
          where transactions.payment_method = 'later_pay'::text and transactions.status = 'completed'::text
          group by transactions.customer_id) billed on billed.customer_id = c.id
     left join ( select pay_later_payments.customer_id,
            sum(pay_later_payments.amount) as total_paid,
            max(pay_later_payments.paid_at) as last_payment_at
           from pay_later_payments
          group by pay_later_payments.customer_id) paid on paid.customer_id = c.id
     left join ( select pay_later_loans.customer_id,
            sum(pay_later_loans.amount) as total_loaned,
            max(pay_later_loans.given_at) as last_loan_at
           from pay_later_loans
          group by pay_later_loans.customer_id) loans on loans.customer_id = c.id;
