import type { PoolClient } from "pg";

export async function fieldActivationBlocker(client: PoolClient, departmentId: string, fieldId: string, fieldKey: string) {
  const views = await client.query(
    `SELECT 1 FROM people_record_saved_views view WHERE view.department_id=$1 AND (
       view.criteria->>'field'=$2 OR (view.criteria->'columns') ? ('custom:'||$2) OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(view.criteria->'filters')='array'
           THEN view.criteria->'filters' ELSE '[]'::jsonb END) item WHERE item->>'field'=$2
       )
     ) LIMIT 1`,
    [departmentId, fieldKey],
  );
  if (views.rowCount) return "A saved People view uses this field. Update that view before deactivating it.";
  const tables = await client.query<{ designer: boolean; catalog: boolean }>(
    "SELECT to_regclass('public.saved_designer_reports') IS NOT NULL AS designer,to_regclass('public.saved_report_definitions') IS NOT NULL AS catalog",
  );
  if (tables.rows[0]?.designer) {
    const field = "custom_" + fieldId.replace(/-/g, "");
    const designer = await client.query(
      `SELECT 1 FROM saved_designer_reports report
        WHERE report.department_id=$1 AND report.definition->>'dataset'='people' AND (
          (report.definition->'columns') ? $2 OR report.definition->>'sortBy'=$2
          OR report.definition->>'groupBy'=$2 OR (report.definition->'groupBy') ? $2
          OR report.definition->>'pivotBy'=$2 OR (report.definition->'pivotBy') ? $2
          OR report.definition->'aggregate'->>'field'=$2 OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(report.definition->'filters')='array'
              THEN report.definition->'filters' ELSE '[]'::jsonb END) item WHERE item->>'field'=$2
          )
        ) LIMIT 1`,
      [departmentId, field],
    );
    if (designer.rowCount) return "A saved Designer report uses this field. Update that report before deactivating it.";
  }
  if (fieldKey === "first_contact_date" && tables.rows[0]?.catalog) {
    const catalog = await client.query(
      "SELECT 1 FROM saved_report_definitions WHERE department_id=$1 AND report_key='people-first-contact-trend' LIMIT 1",
      [departmentId],
    );
    if (catalog.rowCount) return "A saved First contacts by month report uses this field. Remove that saved report before deactivating it.";
  }
  return null;
}
