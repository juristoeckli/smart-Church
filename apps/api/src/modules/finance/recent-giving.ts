export type RecentGift = {
  transactionId: string;
  donorId: string;
  donorName: string;
  date: string;
  receiptNumber: string;
  amountCents: string;
  isReversal: boolean;
  wasReversed: boolean;
};

export type RecentGiving = {
  from: string;
  through: string;
  currency: string;
  creditCents: string;
  reductionCents: string;
  netCents: string;
  recent: RecentGift[];
  largest: RecentGift[];
};

export const recentGivingSql = `
  WITH site AS (
    SELECT location.id,(now() AT TIME ZONE COALESCE(zone.name,'UTC'))::date AS today,
      COALESCE(settings.currency_code,'CHF') AS currency
    FROM departments location LEFT JOIN pg_timezone_names zone ON zone.name=location.time_zone
    LEFT JOIN finance_settings settings ON settings.department_id=location.id WHERE location.id=$1
  ), giving AS (
    SELECT t.id AS "transactionId",d.id AS "donorId",d.display_name AS "donorName",
      t.booking_date AS booking_day,t.receipt_number AS "receiptNumber",t.reverses_transaction_id IS NOT NULL AS "isReversal",
      EXISTS (
        SELECT 1 FROM finance_transactions reversal
        WHERE reversal.department_id=site.id AND reversal.reverses_transaction_id=t.id
          AND reversal.status='posted' AND reversal.booking_date<=site.today
      ) AS "wasReversed",
      sum(l.credit_cents-l.debit_cents) AS amount
    FROM site JOIN finance_transactions t ON t.department_id=site.id AND t.status='posted'
      AND t.booking_date BETWEEN site.today-30 AND site.today
    JOIN finance_transaction_lines l ON l.department_id=t.department_id AND l.transaction_id=t.id
    JOIN finance_accounts a ON a.department_id=l.department_id AND a.id=l.account_id AND a.account_type='income'
    JOIN finance_donors d ON d.department_id=l.department_id AND d.id=l.donor_id
    GROUP BY site.id,site.today,t.id,t.booking_date,t.receipt_number,t.reverses_transaction_id,d.id,d.display_name
    HAVING sum(l.credit_cents-l.debit_cents)<>0
  ), labeled AS (
    SELECT "transactionId","donorId","donorName",to_char(booking_day,'YYYY-MM-DD') AS date,"receiptNumber",
      amount::text AS "amountCents","isReversal","wasReversed",amount
    FROM giving
  )
  SELECT to_char(today-30,'YYYY-MM-DD') AS "from",to_char(today,'YYYY-MM-DD') AS "through",currency,
    COALESCE((SELECT sum(amount) FROM giving WHERE amount>0),0)::text AS "creditCents",
    COALESCE((SELECT sum(-amount) FROM giving WHERE amount<0),0)::text AS "reductionCents",
    COALESCE((SELECT sum(amount) FROM giving),0)::text AS "netCents",
    COALESCE((
      SELECT jsonb_agg(to_jsonb(r)-'amount' ORDER BY date DESC,"transactionId","donorId")
      FROM (SELECT * FROM labeled ORDER BY date DESC,"transactionId","donorId" LIMIT 8) r
    ),'[]') AS recent,
    COALESCE((
      SELECT jsonb_agg(to_jsonb(r)-'amount' ORDER BY amount DESC,date DESC,"transactionId","donorId")
      FROM (SELECT * FROM labeled WHERE amount>0 AND NOT "wasReversed"
            ORDER BY amount DESC,date DESC,"transactionId","donorId" LIMIT 8) r
    ),'[]') AS largest
  FROM site
`;
