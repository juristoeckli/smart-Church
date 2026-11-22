export const monthlyRecordedFactsSql = `
  WITH event_facts AS (
    SELECT date_trunc('month',event_date)::date AS month, recorded_facts AS facts
    FROM service_events
    WHERE department_id=$1 AND cancelled_at IS NULL AND recorded_facts IS NOT NULL
      AND event_date BETWEEN $2::date AND $3::date
  ), builtin AS (
    SELECT month, id, label, unit, raw
    FROM event_facts f CROSS JOIN LATERAL (VALUES
      ('visitors','Visitors','',f.facts->>'visitors'),
      ('firstTimeVisitors','First-time visitors','',f.facts->>'firstTimeVisitors'),
      ('collection','Collection',f.facts->'collection'->>'currency',f.facts->'collection'->>'amount')
    ) fact(id,label,unit,raw)
    WHERE CASE WHEN id='collection'
      THEN unit ~ '^[A-Z]{3}$' AND raw ~ '^(0|[1-9][0-9]{0,8})([.][0-9]{1,3})?$'
      ELSE raw ~ '^(0|[1-9][0-9]{0,8})$' END
  ), custom AS (
    SELECT f.month,d.id,d.label,d.kind,d.unit,d.archived_at,data.value
    FROM event_facts f CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(f.facts->'custom')='object' THEN f.facts->'custom' ELSE '{}'::jsonb END
    ) entry(key,raw)
    JOIN service_event_fact_definitions d ON d.department_id=$1 AND d.id::text=entry.key
    CROSS JOIN LATERAL (SELECT entry.raw #>> '{}' AS value) data
    WHERE jsonb_typeof(entry.raw)='string'
      AND CASE WHEN d.kind='number' THEN data.value ~ '^-?(0|[1-9][0-9]{0,8})([.][0-9]{1,3})?$'
        WHEN d.kind='select' THEN char_length(data.value) BETWEEN 1 AND 80 AND btrim(data.value)<>''
        ELSE false END
  ), totals AS (
    SELECT month,id,label,'Recorded'::text AS source,NULL::text AS choice,unit,SUM(raw::numeric)::text AS total,
      count(*)::int AS samples
    FROM builtin GROUP BY month,id,label,unit
    UNION ALL
    SELECT month,id::text,label,CASE WHEN archived_at IS NULL THEN 'Custom' ELSE 'Archived custom' END,NULL,unit,
      SUM(value::numeric)::text,count(*)::int
    FROM custom WHERE kind='number' GROUP BY month,id,label,archived_at,unit
    UNION ALL
    SELECT month,id::text,label,CASE WHEN archived_at IS NULL THEN 'Custom' ELSE 'Archived custom' END,value,'',
      count(*)::text,count(*)::int
    FROM custom WHERE kind='select' GROUP BY month,id,label,archived_at,value
  )
  SELECT to_char(month,'YYYY-MM') AS month,label,source,choice,unit,total,samples
  FROM totals ORDER BY month,source,lower(label),id,unit,choice LIMIT 5001
`;
