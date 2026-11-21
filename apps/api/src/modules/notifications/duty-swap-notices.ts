import type { PoolClient } from "pg";

type SwapNoticeState = "pending" | "accepted" | "declined" | "cancelled";

const copy: Record<SwapNoticeState, [string, string]> = {
  pending: ["Service swap request", "You have an incoming service swap request. Sign in to review it in Services & events."],
  accepted: ["Service swap accepted", "Your service swap request was accepted. Sign in to review your assignments."],
  declined: ["Service swap declined", "Your service swap request was declined. Sign in to review your assignments."],
  cancelled: ["Service swap cancelled", "A service swap request sent to you was cancelled. Sign in to review your assignments."],
};

export async function recordDutySwapNotice(client: Pick<PoolClient, "query">, departmentId: string, eventId: string,
  swapId: string, contactId: string, actorId: string, state: SwapNoticeState) {
  const { rows: [storage] } = await client.query<{ ready: boolean }>(
    `SELECT to_regclass('public.module_notification_preferences') IS NOT NULL AND EXISTS (
       SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.module_notifications')
         AND attname='swap_notice_state' AND NOT attisdropped
     ) AS ready`,
  );
  if (!storage.ready) return;
  const [title, body] = copy[state];
  await client.query(
    `INSERT INTO module_notifications (id,department_id,recipient_user_id,sender_user_id,kind,title,body,
                                       related_event_id,related_swap_id,swap_notice_state)
       SELECT gen_random_uuid(), member.department_id, member.user_id, $5, 'service_request', $6, $7, $2, $3, $8
         FROM department_memberships member
         JOIN contacts person ON person.id=member.contact_id AND person.department_id=member.department_id AND person.archived_at IS NULL
         JOIN app_users account ON account.id=member.user_id AND account.is_enabled AND NOT account.is_service_user
         LEFT JOIN module_notification_preferences pref ON pref.department_id=member.department_id AND pref.user_id=member.user_id
        WHERE member.department_id=$1 AND person.id=$4 AND member.user_id<>$5 AND COALESCE(pref.service_requests_enabled,true)`,
    [departmentId, eventId, swapId, contactId, actorId, title, body, state],
  );
}
