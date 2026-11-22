// These SQL expressions are selected by callers. Search terms are always bound parameters.
export function personTagMatch(term: string, canManage: string) {
  return `(${term} <> '' AND EXISTS (
    SELECT 1 FROM people_record_fields tag
    JOIN people_record_values assignment
      ON assignment.field_id=tag.id AND assignment.department_id=tag.department_id AND assignment.contact_id=c.id
    WHERE tag.department_id=c.department_id AND tag.active AND tag.field_type='boolean'
      AND NOT tag.required AND tag.field_key ~ '^tag_[a-z0-9_]+$'
      AND (${canManage}::boolean OR tag.visibility='private_people') AND assignment.value='true'::jsonb
      AND (lower(btrim(tag.label))=lower(${term}) OR substring(tag.field_key FROM 5)=lower(${term}))
  ))`;
}
