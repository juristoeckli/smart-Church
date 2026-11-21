import type { PoolClient } from "pg";

export const DIGEST_TITLE = "Community Feed digest";
const DIGEST_BODY = "New posts are available in Community Feed. Sign in to Smart Church to read the posts you can access.";

export async function queueDueCommunityDigests(client: PoolClient, departmentId: string) {
  await client.query(
    `WITH due AS MATERIALIZED (
       SELECT preference.user_id,preference.digest_window_start,preference.digest_weekday,department.time_zone
       FROM community_post_notification_preferences preference
       JOIN departments department ON department.id=preference.department_id
       WHERE preference.department_id=$1 AND preference.digest_next_at<=now()
       ORDER BY preference.digest_next_at,preference.user_id
       LIMIT 1000 FOR UPDATE OF preference SKIP LOCKED
     ), advanced AS (
       UPDATE community_post_notification_preferences preference
       SET digest_next_at=community_feed_next_digest(due.digest_weekday,due.time_zone,now()), digest_window_start=now()
       FROM due WHERE preference.department_id=$1 AND preference.user_id=due.user_id
       RETURNING preference.user_id,due.digest_window_start
     )
     INSERT INTO module_notifications(id,department_id,recipient_user_id,kind,title,body,in_app_enabled,email_enabled)
     SELECT gen_random_uuid(),$1,advanced.user_id,'community_feed',$2,$3,false,true
     FROM advanced
     JOIN department_memberships membership ON membership.department_id=$1 AND membership.user_id=advanced.user_id
     JOIN app_users account ON account.id=advanced.user_id AND account.is_enabled AND account.email IS NOT NULL
     JOIN module_notification_preferences consent ON consent.department_id=$1 AND consent.user_id=advanced.user_id AND consent.email_notifications_enabled
     WHERE EXISTS (
       SELECT 1 FROM community_posts post
       WHERE post.department_id=$1 AND post.author_user_id<>advanced.user_id
         AND COALESCE(post.publish_at,post.created_at)>GREATEST(advanced.digest_window_start,now()-interval '8 days')
         AND COALESCE(post.publish_at,post.created_at)<=now()
         AND post.expired_at IS NULL AND (post.expires_at IS NULL OR post.expires_at>now())
         AND NOT EXISTS (SELECT 1 FROM community_post_hidden hidden WHERE hidden.post_id=post.id AND hidden.user_id=advanced.user_id)
         AND (post.group_id IS NULL OR post.visibility='location' OR membership.role='site_admin' OR EXISTS (
           SELECT 1 FROM group_members member WHERE member.group_id=post.group_id
             AND member.contact_id=membership.contact_id AND member.status='active'
         ))
     )`, [departmentId, DIGEST_TITLE, DIGEST_BODY],
  );
}
