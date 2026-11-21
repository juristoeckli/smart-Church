import type { PoolClient } from "pg";

// Serialize ancestry checks and parent updates at a location without blocking foreign-key checks.
export async function lockGroupHierarchy(client: Pick<PoolClient, "query">, locationId: string) {
  const result = await client.query("SELECT id FROM departments WHERE id=$1 FOR NO KEY UPDATE", [locationId]);
  return result.rowCount === 1;
}

export async function isSafeGroupParent(client: Pick<PoolClient, "query">, locationId: string, groupId: string, parentId: string) {
  const result = await client.query<{ allowed: boolean }>(`WITH RECURSIVE ancestors(id,parent_group_id) AS (
    SELECT id,parent_group_id FROM church_groups WHERE department_id=$1 AND id=$3
    UNION
    SELECT parent.id,parent.parent_group_id FROM church_groups parent
      JOIN ancestors child ON child.parent_group_id=parent.id WHERE parent.department_id=$1
    )
    SELECT bool_or(parent_group_id IS NULL) AND NOT bool_or(id=$2) AS allowed FROM ancestors`,
    [locationId, groupId, parentId]);
  return result.rows[0]?.allowed === true;
}
