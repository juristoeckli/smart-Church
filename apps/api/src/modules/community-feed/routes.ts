import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { DIGEST_TITLE, queueDueCommunityDigests } from "./digests.js";

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = context;
  let scheduledMentionTimer: ReturnType<typeof setInterval> | undefined;
  let scheduledMentionJobRunning = false;
  let scheduledExpiryJobRunning = false;
  let scheduledDigestJobRunning = false;
  context.replication.register({
    schemaVersion: "13",
    inspect: async (departmentId) => {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["The Community Feed database is unavailable."], recordCount: 0 };
      const result = await pool.query<{ posts: string; likes: string; comments: string; commentMentions: string; lifecycleAudit: string; attachments: string; links: string; notifications: string; reports: string; preferences: string }>(
        `SELECT (SELECT count(*) FROM community_posts WHERE department_id=$1)::text AS posts,
                (SELECT count(*) FROM community_post_likes WHERE post_id IN (SELECT id FROM community_posts WHERE department_id=$1))::text AS likes,
                (SELECT count(*) FROM community_post_comments WHERE post_id IN (SELECT id FROM community_posts WHERE department_id=$1))::text AS comments,
                (SELECT count(*) FROM community_comment_mentions WHERE department_id=$1)::text AS "commentMentions",
                (SELECT count(*) FROM community_post_lifecycle_audit WHERE department_id=$1)::text AS "lifecycleAudit",
                (SELECT count(*) FROM community_post_attachments WHERE department_id=$1)::text AS attachments,
                (SELECT count(*) FROM community_post_links WHERE department_id=$1)::text AS links,
                (SELECT count(*) FROM community_post_notifications WHERE department_id=$1)::text AS notifications,
                (SELECT count(*) FROM community_post_reports WHERE department_id=$1)::text AS reports,
                (SELECT count(*) FROM community_post_notification_preferences WHERE department_id=$1)::text AS preferences`, [departmentId],
      );
      return { ready: true, blockers: [], recordCount: Number(result.rows[0].posts) + Number(result.rows[0].likes) + Number(result.rows[0].comments) + Number(result.rows[0].commentMentions) + Number(result.rows[0].lifecycleAudit) + Number(result.rows[0].attachments) + Number(result.rows[0].links) + Number(result.rows[0].notifications) + Number(result.rows[0].reports) + Number(result.rows[0].preferences) };
    },
    exportSnapshot: async (client: PoolClient, departmentId) => {
      const posts = await client.query("SELECT * FROM community_posts WHERE department_id=$1 ORDER BY id", [departmentId]);
      const likes = await client.query("SELECT * FROM community_post_likes WHERE post_id IN (SELECT id FROM community_posts WHERE department_id=$1) ORDER BY post_id,user_id", [departmentId]);
      const comments = await client.query("SELECT * FROM community_post_comments WHERE post_id IN (SELECT id FROM community_posts WHERE department_id=$1) ORDER BY id", [departmentId]);
      const commentMentions = await client.query("SELECT * FROM community_comment_mentions WHERE department_id=$1 ORDER BY comment_id,contact_id", [departmentId]);
      const lifecycleAudit = await client.query("SELECT * FROM community_post_lifecycle_audit WHERE department_id=$1 ORDER BY created_at,id", [departmentId]);
      const attachments = await client.query("SELECT id,post_id,department_id,uploaded_by,filename,content_type,encode(content,'base64') AS data,created_at FROM community_post_attachments WHERE department_id=$1 ORDER BY id", [departmentId]);
      const links = await client.query("SELECT * FROM community_post_links WHERE department_id=$1 ORDER BY post_id,link_type,entity_id", [departmentId]);
      const notifications = await client.query("SELECT * FROM community_post_notifications WHERE department_id=$1 ORDER BY id", [departmentId]);
      const reports = await client.query("SELECT * FROM community_post_reports WHERE department_id=$1 ORDER BY id", [departmentId]);
      const preferences = await client.query("SELECT * FROM community_post_notification_preferences WHERE department_id=$1 ORDER BY user_id", [departmentId]);
      return { version: 13, posts: posts.rows, likes: likes.rows, comments: comments.rows, commentMentions: commentMentions.rows, lifecycleAudit: lifecycleAudit.rows, attachments: attachments.rows, links: links.rows, notifications: notifications.rows, reports: reports.rows, preferences: preferences.rows };
    },
    restoreSnapshot: async (client: PoolClient, departmentId, input, restoreContext) => {
      if (!input || typeof input !== "object" || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].includes(Number((input as { version?: unknown }).version)) || !Array.isArray((input as { posts?: unknown }).posts) || !Array.isArray((input as { likes?: unknown }).likes) || !Array.isArray((input as { comments?: unknown }).comments)) throw new Error("The Community Feed snapshot is invalid.");
      const snapshot = input as { posts: Array<Record<string, unknown>>; likes: Array<Record<string, unknown>>; comments: Array<Record<string, unknown>>; commentMentions?: Array<Record<string, unknown>>; lifecycleAudit?: Array<Record<string, unknown>>; attachments?: Array<Record<string, unknown>>; links?: Array<Record<string, unknown>>; notifications?: Array<Record<string, unknown>>; reports?: Array<Record<string, unknown>>; preferences?: Array<Record<string, unknown>> };
      await client.query("DELETE FROM community_post_reports WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM community_post_notification_preferences WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM community_post_notifications WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM community_post_likes WHERE post_id IN (SELECT id FROM community_posts WHERE department_id=$1)", [departmentId]);
      await client.query("DELETE FROM community_post_comments WHERE post_id IN (SELECT id FROM community_posts WHERE department_id=$1)", [departmentId]);
      await client.query("DELETE FROM community_post_attachments WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM community_post_links WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM community_posts WHERE department_id=$1", [departmentId]);
      for (const post of snapshot.posts) await client.query("INSERT INTO community_posts(id,department_id,author_user_id,title,body,created_at,updated_at,publish_at,comments_enabled,group_id,visibility,mentions_notified_at,expires_at,expired_at,body_format) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)", [post.id, departmentId, restoreContext.userIdMap.get(String(post.author_user_id)) ?? post.author_user_id, post.title, post.body, post.created_at, post.updated_at, post.publish_at ?? null, post.comments_enabled ?? true, post.group_id ?? null, post.visibility ?? "location", post.mentions_notified_at ?? null, post.expires_at ?? null, post.expired_at ?? null, post.body_format ?? "plain"]);
      for (const like of snapshot.likes) await client.query("INSERT INTO community_post_likes(post_id,user_id,created_at,reaction_type) VALUES($1,$2,$3,$4)", [like.post_id, restoreContext.userIdMap.get(String(like.user_id)) ?? like.user_id, like.created_at, like.reaction_type ?? "like"]);
      for (const comment of snapshot.comments) await client.query("INSERT INTO community_post_comments(id,post_id,author_user_id,body,created_at) VALUES($1,$2,$3,$4,$5)", [comment.id, comment.post_id, restoreContext.userIdMap.get(String(comment.author_user_id)) ?? comment.author_user_id, comment.body, comment.created_at]);
      const commentMentions = snapshot.commentMentions ?? [];
      for (const mention of commentMentions) await client.query("INSERT INTO community_comment_mentions(department_id,post_id,comment_id,contact_id,created_at) VALUES($1,$2,$3,$4,$5)", [departmentId, mention.post_id, mention.comment_id, mention.contact_id, mention.created_at]);
      for (const audit of snapshot.lifecycleAudit ?? []) await client.query("INSERT INTO community_post_lifecycle_audit(id,department_id,post_id,actor_user_id,action,details,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [audit.id, departmentId, audit.post_id, audit.actor_user_id == null ? null : restoreContext.userIdMap.get(String(audit.actor_user_id)) ?? audit.actor_user_id, audit.action, JSON.stringify(audit.details ?? {}), audit.created_at]);
      const attachments = snapshot.attachments ?? [];
      const links = snapshot.links ?? [];
      for (const file of attachments) await client.query("INSERT INTO community_post_attachments(id,post_id,department_id,uploaded_by,filename,content_type,content,created_at) VALUES($1,$2,$3,$4,$5,$6,decode($7,'base64'),$8)", [file.id, file.post_id, departmentId, restoreContext.userIdMap.get(String(file.uploaded_by)) ?? file.uploaded_by, file.filename, file.content_type, file.data, file.created_at]);
      for (const link of links) await client.query("INSERT INTO community_post_links(post_id,department_id,link_type,entity_id,label,created_at) VALUES($1,$2,$3,$4,$5,$6)", [link.post_id, departmentId, link.link_type, link.entity_id, link.label, link.created_at]);
      const notifications = snapshot.notifications ?? [];
      for (const notification of notifications) await client.query("INSERT INTO community_post_notifications(id,department_id,post_id,recipient_user_id,actor_user_id,kind,comment_id,in_app_enabled,email_enabled,created_at,read_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [notification.id, departmentId, notification.post_id, restoreContext.userIdMap.get(String(notification.recipient_user_id)) ?? notification.recipient_user_id, notification.actor_user_id == null ? null : restoreContext.userIdMap.get(String(notification.actor_user_id)) ?? notification.actor_user_id, notification.kind, notification.comment_id ?? null, notification.in_app_enabled ?? true, notification.email_enabled ?? true, notification.created_at, notification.read_at ?? null]);
      const reports = snapshot.reports ?? [];
      for (const report of reports) await client.query("INSERT INTO community_post_reports(id,department_id,post_id,reporter_user_id,reason,details,status,reviewed_by,reviewed_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [report.id, departmentId, report.post_id, restoreContext.userIdMap.get(String(report.reporter_user_id)) ?? report.reporter_user_id, report.reason, report.details ?? "", report.status ?? "open", report.reviewed_by == null ? null : restoreContext.userIdMap.get(String(report.reviewed_by)) ?? report.reviewed_by, report.reviewed_at ?? null, report.created_at]);
      const preferences = snapshot.preferences ?? [];
      for (const preference of preferences) await client.query("INSERT INTO community_post_notification_preferences(department_id,user_id,notify_posts,notify_reactions,notify_comments,notify_email_posts,notify_email_reactions,notify_email_comments,updated_at,digest_weekday,digest_next_at,digest_window_start) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [departmentId, restoreContext.userIdMap.get(String(preference.user_id)) ?? preference.user_id, preference.notify_posts ?? true, preference.notify_reactions ?? true, preference.notify_comments ?? true, preference.notify_email_posts ?? true, preference.notify_email_reactions ?? true, preference.notify_email_comments ?? true, preference.updated_at ?? new Date(), preference.digest_weekday ?? null, preference.digest_next_at ?? null, preference.digest_window_start ?? null]);
      const lifecycleAudit = snapshot.lifecycleAudit ?? [];
      return { recordCount: snapshot.posts.length + snapshot.likes.length + snapshot.comments.length + commentMentions.length + lifecycleAudit.length + attachments.length + links.length + notifications.length + reports.length + preferences.length };
    },
    verifySnapshot: async (client: PoolClient, departmentId, input, restoreContext) => {
      if (!input || typeof input !== "object" || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].includes(Number((input as { version?: unknown }).version))) return { ready: false, blockers: ["No verified Community Feed snapshot is available."] };
      const snapshot = input as { posts?: Array<Record<string, unknown>>; likes?: Array<Record<string, unknown>>; comments?: Array<Record<string, unknown>>; commentMentions?: Array<Record<string, unknown>>; lifecycleAudit?: Array<Record<string, unknown>>; attachments?: Array<Record<string, unknown>>; links?: Array<Record<string, unknown>>; notifications?: Array<Record<string, unknown>>; reports?: Array<Record<string, unknown>>; preferences?: Array<Record<string, unknown>> };
      const actualPosts = (await client.query("SELECT * FROM community_posts WHERE department_id=$1 ORDER BY id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualLikes = (await client.query("SELECT * FROM community_post_likes WHERE post_id IN (SELECT id FROM community_posts WHERE department_id=$1) ORDER BY post_id,user_id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualComments = (await client.query("SELECT * FROM community_post_comments WHERE post_id IN (SELECT id FROM community_posts WHERE department_id=$1) ORDER BY id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualCommentMentions = (await client.query("SELECT * FROM community_comment_mentions WHERE department_id=$1 ORDER BY comment_id,contact_id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualLifecycleAudit = (await client.query("SELECT * FROM community_post_lifecycle_audit WHERE department_id=$1 ORDER BY created_at,id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualAttachments = (await client.query("SELECT id,post_id,department_id,uploaded_by,filename,content_type,encode(content,'base64') AS data,created_at FROM community_post_attachments WHERE department_id=$1 ORDER BY id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualLinks = (await client.query("SELECT * FROM community_post_links WHERE department_id=$1 ORDER BY post_id,link_type,entity_id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualNotifications = (await client.query("SELECT * FROM community_post_notifications WHERE department_id=$1 ORDER BY id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualReports = (await client.query("SELECT * FROM community_post_reports WHERE department_id=$1 ORDER BY id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualPreferences = (await client.query("SELECT * FROM community_post_notification_preferences WHERE department_id=$1 ORDER BY user_id", [departmentId])).rows as Array<Record<string, unknown>>;
      const mapping = restoreContext?.userIdMap ?? new Map<string, string>();
      if (Number((input as { version?: unknown }).version) < 3) {
        for (const post of snapshot.posts ?? []) { post.publish_at ??= null; post.comments_enabled ??= true; post.group_id ??= null; post.visibility ??= "location"; }
      }
      if (Number((input as { version?: unknown }).version) < 2) {
        for (const like of snapshot.likes ?? []) like.reaction_type ??= "like";
      }
      if (Number((input as { version?: unknown }).version) < 8) {
        for (const notification of snapshot.notifications ?? []) { notification.in_app_enabled ??= true; notification.email_enabled ??= true; }
        for (const preference of snapshot.preferences ?? []) { preference.notify_email_posts ??= true; preference.notify_email_reactions ??= true; preference.notify_email_comments ??= true; }
      }
      if (Number((input as { version?: unknown }).version) < 9) {
        for (const post of snapshot.posts ?? []) post.mentions_notified_at ??= null;
      }
      const snapshotVersion = Number((input as { version?: unknown }).version);
      if (snapshotVersion < 11) {
        for (const post of snapshot.posts ?? []) { post.expires_at ??= null; post.expired_at ??= null; }
      }
      if (snapshotVersion < 12) {
        for (const post of snapshot.posts ?? []) post.body_format ??= "plain";
      }
      if (snapshotVersion < 13) {
        for (const preference of snapshot.preferences ?? []) {
          preference.digest_weekday ??= null;
          preference.digest_next_at ??= null;
          preference.digest_window_start ??= null;
        }
      }
      const compare = (name: string, source: Array<Record<string, unknown>>, actual: Array<Record<string, unknown>>, userColumns: string[]) => {
        if (source.length !== actual.length) return `${name} row count differs.`;
        const expectedRows = source.map((row) => {
          const copy = { ...row };
          if (typeof copy.department_id === "string") copy.department_id = departmentId;
          for (const key of userColumns) if (typeof copy[key] === "string") copy[key] = mapping.get(String(copy[key])) ?? copy[key];
          return canonical(copy);
        }).sort();
        const actualRows = actual.map(canonical).sort();
        return expectedRows.some((row, index) => row !== actualRows[index]) ? `${name} content differs.` : null;
      };
      const blockers = [
        compare("Posts", snapshot.posts ?? [], actualPosts, ["author_user_id"]),
        compare("Likes", snapshot.likes ?? [], actualLikes, ["user_id"]),
        compare("Comments", snapshot.comments ?? [], actualComments, ["author_user_id"]),
        ...(snapshotVersion >= 10 ? [compare("Comment mentions", snapshot.commentMentions ?? [], actualCommentMentions, [])] : []),
        ...(snapshotVersion >= 11 ? [compare("Post lifecycle audit", snapshot.lifecycleAudit ?? [], actualLifecycleAudit, ["actor_user_id"])] : []),
        ...(snapshotVersion >= 4 ? [compare("Attachments", snapshot.attachments ?? [], actualAttachments, ["uploaded_by"]), compare("Links", snapshot.links ?? [], actualLinks, [])] : []),
        ...(snapshotVersion >= 5 ? [compare("Notifications", snapshot.notifications ?? [], actualNotifications, ["recipient_user_id", "actor_user_id"])] : []),
        ...(snapshotVersion >= 6 ? [compare("Reports", snapshot.reports ?? [], actualReports, ["reporter_user_id", "reviewed_by"])] : []),
        ...(snapshotVersion >= 7 ? [compare("Notification preferences", snapshot.preferences ?? [], actualPreferences, ["user_id"])] : []),
      ].filter((message): message is string => Boolean(message));
      return { ready: blockers.length === 0, blockers };
    },
  });
  const unavailable = (reply: { code: (status: number) => { send: (body: object) => unknown } }) => reply.code(503).send({ error: "The community feed is unavailable." });
  const groupAccess = (postAlias: string, userParameter: number, adminParameter: number) => `(${postAlias}.group_id IS NULL OR ${postAlias}.visibility='location' OR ${postAlias}.author_user_id=$${userParameter} OR $${adminParameter} OR EXISTS (
    SELECT 1 FROM department_memberships access_membership
    JOIN group_members access_group_member ON access_group_member.contact_id=access_membership.contact_id
    WHERE access_membership.user_id=$${userParameter} AND access_membership.department_id=${postAlias}.department_id
      AND access_group_member.group_id=${postAlias}.group_id AND access_group_member.status='active'
  ))`;

  async function createFeedNotifications(postId: string, departmentId: string, actorId: string, kind: "post" | "reaction" | "comment", commentId: string | null = null) {
    if (!pool) return;
    const created = await pool.query<{ id: string }>(
      `WITH post AS (
         SELECT id,department_id,author_user_id,group_id,visibility FROM community_posts
         WHERE id=$1 AND department_id=$2 AND expired_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND (publish_at IS NULL OR publish_at<=now())
       ), recipients AS (
         SELECT post.author_user_id AS user_id FROM post
         UNION
         SELECT membership.user_id FROM post
           JOIN department_memberships membership ON membership.department_id=post.department_id
           LEFT JOIN group_members group_member ON group_member.contact_id=membership.contact_id AND group_member.group_id=post.group_id AND group_member.status='active'
           LEFT JOIN community_post_subscriptions subscription ON subscription.department_id=post.department_id AND subscription.group_id=post.group_id AND subscription.user_id=membership.user_id
          WHERE post.group_id IS NOT NULL AND (
            (post.visibility='members' AND group_member.group_id IS NOT NULL) OR
            (post.visibility='location' AND subscription.user_id IS NOT NULL)
          )
       )
       INSERT INTO community_post_notifications(id,department_id,post_id,recipient_user_id,actor_user_id,kind,comment_id,in_app_enabled,email_enabled)
         SELECT gen_random_uuid(),post.department_id,post.id,recipients.user_id,$3,$4,$5,
                CASE $4 WHEN 'post' THEN COALESCE(preference.notify_posts,true) WHEN 'reaction' THEN COALESCE(preference.notify_reactions,true) WHEN 'comment' THEN COALESCE(preference.notify_comments,true) ELSE false END,
                CASE $4 WHEN 'post' THEN COALESCE(preference.notify_email_posts,true) WHEN 'reaction' THEN COALESCE(preference.notify_email_reactions,true) WHEN 'comment' THEN COALESCE(preference.notify_email_comments,true) ELSE false END
         FROM post JOIN recipients ON TRUE
         LEFT JOIN community_post_notification_preferences preference
           ON preference.department_id=post.department_id AND preference.user_id=recipients.user_id
         LEFT JOIN module_notification_preferences email_preference
           ON email_preference.department_id=post.department_id AND email_preference.user_id=recipients.user_id
        WHERE recipients.user_id<>$3 AND (
          CASE $4 WHEN 'post' THEN COALESCE(preference.notify_posts,true) WHEN 'reaction' THEN COALESCE(preference.notify_reactions,true) WHEN 'comment' THEN COALESCE(preference.notify_comments,true) ELSE false END
          OR (COALESCE(email_preference.email_notifications_enabled,false) AND CASE $4 WHEN 'post' THEN COALESCE(preference.notify_email_posts,true) WHEN 'reaction' THEN COALESCE(preference.notify_email_reactions,true) WHEN 'comment' THEN COALESCE(preference.notify_email_comments,true) ELSE false END)
        )
       ON CONFLICT DO NOTHING
       RETURNING id`, [postId, departmentId, actorId, kind, commentId],
    );
    // Notifications is a required module and owns email consent, suppression, delivery
    // retries, and provider status. Keep this email copy deliberately generic so a
    // delayed email cannot expose a post after the recipient loses group access.
    if (created.rowCount) {
      try {
        await pool.query(
          `INSERT INTO module_notifications(id,department_id,recipient_user_id,kind,title,body,in_app_enabled,email_enabled)
           SELECT notification.id,notification.department_id,notification.recipient_user_id,'community_feed',
                  CASE notification.kind
                    WHEN 'post' THEN 'New community post'
                    WHEN 'reaction' THEN 'New reaction to a community post'
                    ELSE 'New comment on a community post'
                  END,
                  'You have a new Community Feed notification. Open Smart Church to review it.',
                  notification.in_app_enabled,notification.email_enabled
             FROM community_post_notifications notification
            WHERE notification.id=ANY($1::uuid[])
           ON CONFLICT (id) DO NOTHING`,
          [created.rows.map((row) => row.id)],
        );
      } catch (error) {
        // In-app feed delivery must remain available if optional notification storage
        // is temporarily unavailable. The email pipeline will resume for new actions.
        app.log.warn({ err: error }, "Could not enqueue Community Feed email notifications.");
      }
    }
  }

  async function createMentionNotifications(postId: string, departmentId: string, actorId: string, contactIds: string[], client?: PoolClient) {
    const queryable = client ?? pool;
    if (!queryable || contactIds.length === 0) return;
    await queryable.query(
      `WITH post AS (
         SELECT id,department_id,group_id,visibility FROM community_posts
          WHERE id=$1 AND department_id=$2 AND expired_at IS NULL AND (expires_at IS NULL OR expires_at>now())
       ), recipients AS (
         SELECT DISTINCT membership.user_id
           FROM unnest($3::uuid[]) mentioned(contact_id)
           JOIN contacts contact ON contact.id=mentioned.contact_id AND contact.department_id=$2 AND contact.status='member'
           JOIN department_memberships membership ON membership.contact_id=contact.id AND membership.department_id=$2
           JOIN post ON TRUE
          WHERE post.group_id IS NULL OR post.visibility='location' OR EXISTS (
            SELECT 1 FROM group_members group_member
             WHERE group_member.group_id=post.group_id AND group_member.contact_id=contact.id AND group_member.status='active'
          )
       )
       INSERT INTO community_post_notifications(id,department_id,post_id,recipient_user_id,actor_user_id,kind,in_app_enabled,email_enabled)
       SELECT gen_random_uuid(),post.department_id,post.id,recipient.user_id,$4,'mention',true,false
         FROM post JOIN recipients recipient ON recipient.user_id<>$4
       ON CONFLICT DO NOTHING`,
      [postId, departmentId, contactIds, actorId],
    );
  }

  async function createCommentMentionNotifications(postId: string, commentId: string, departmentId: string, actorId: string, contactIds: string[], body: string) {
    if (!pool || !contactIds.length) return;
    await pool.query(
      `WITH post AS (
         SELECT id,department_id,group_id,visibility FROM community_posts
          WHERE id=$1 AND department_id=$2 AND expired_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND comments_enabled=TRUE AND (publish_at IS NULL OR publish_at<=now())
       ), mentioned AS (
         SELECT DISTINCT contact.id AS contact_id
           FROM unnest($3::uuid[]) requested(contact_id)
           JOIN contacts contact ON contact.id=requested.contact_id AND contact.department_id=$2 AND contact.status='member'
           JOIN post ON TRUE
          WHERE position('@'||trim(contact.first_name||' '||contact.last_name) IN $6)>0
            AND (post.visibility<>'members' OR EXISTS (
            SELECT 1 FROM group_members group_member
             WHERE group_member.group_id=post.group_id AND group_member.contact_id=contact.id AND group_member.status='active'
          ))
       ), saved AS (
         INSERT INTO community_comment_mentions(department_id,post_id,comment_id,contact_id)
         SELECT $2,$1,$4,mentioned.contact_id FROM mentioned
         ON CONFLICT(department_id,comment_id,contact_id) DO NOTHING
         RETURNING contact_id
       )
       INSERT INTO community_post_notifications(id,department_id,post_id,recipient_user_id,actor_user_id,kind,comment_id,in_app_enabled,email_enabled)
       SELECT gen_random_uuid(),post.department_id,post.id,membership.user_id,$5,'mention',$4,true,false
         FROM post JOIN mentioned ON TRUE
         JOIN department_memberships membership ON membership.department_id=post.department_id AND membership.contact_id=mentioned.contact_id
        WHERE membership.user_id<>$5
          AND (post.visibility<>'members' OR EXISTS (
            SELECT 1 FROM group_members group_member
             WHERE group_member.group_id=post.group_id AND group_member.contact_id=mentioned.contact_id AND group_member.status='active'
          ))
       ON CONFLICT DO NOTHING`,
      [postId, departmentId, contactIds, commentId, actorId, body],
    );
  }

  async function runScheduledMentionNotifications() {
    if (!pool || !isDatabaseReady() || !context.activation.isEnabled() || scheduledMentionJobRunning) return;
    scheduledMentionJobRunning = true;
    try {
      let cursor: { publishAt: string; id: string } | null = null;
      while (true) {
        const due: { rows: Array<{ id: string; department_id: string; author_user_id: string; publishAt: string }> } = await pool.query<{ id: string; department_id: string; author_user_id: string; publishAt: string }>(
          `SELECT post.id,post.department_id,post.author_user_id,post.publish_at::text AS "publishAt"
             FROM community_posts post
            WHERE post.publish_at IS NOT NULL AND post.publish_at<=now() AND post.mentions_notified_at IS NULL AND post.expired_at IS NULL AND (post.expires_at IS NULL OR post.expires_at>now())
              AND EXISTS (SELECT 1 FROM community_post_mentions mention WHERE mention.department_id=post.department_id AND mention.post_id=post.id)
              AND ($1::timestamptz IS NULL OR (post.publish_at,post.id)>($1::timestamptz,$2::uuid))
            ORDER BY post.publish_at,post.id LIMIT 100`,
          [cursor?.publishAt ?? null, cursor?.id ?? null],
        );
        if (!due.rows.length) break;
        for (const candidate of due.rows) {
          cursor = { publishAt: candidate.publishAt, id: candidate.id };
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            if (!await context.lockDepartmentForWrite(client, candidate.department_id)) { await client.query("ROLLBACK"); continue; }
            const locked = await client.query<{ id: string; department_id: string; author_user_id: string }>(
              `SELECT id,department_id,author_user_id FROM community_posts
                WHERE id=$1 AND publish_at IS NOT NULL AND publish_at<=now() AND mentions_notified_at IS NULL AND expired_at IS NULL AND (expires_at IS NULL OR expires_at>now())
                FOR UPDATE SKIP LOCKED`, [candidate.id],
            );
            if (!locked.rowCount) { await client.query("ROLLBACK"); continue; }
            const post = locked.rows[0]!;
            const mentions = await client.query<{ contact_id: string }>(
              "SELECT contact_id::text FROM community_post_mentions WHERE department_id=$1 AND post_id=$2 ORDER BY contact_id",
              [post.department_id, post.id],
            );
            await createMentionNotifications(post.id, post.department_id, post.author_user_id, mentions.rows.map((mention) => mention.contact_id), client);
            await client.query("UPDATE community_posts SET mentions_notified_at=now() WHERE id=$1 AND department_id=$2", [post.id, post.department_id]);
            await client.query("COMMIT");
            realtime.publish("module:community-feed:changed", post.department_id, { postId: post.id, action: "published" });
          } catch (error) {
            await client.query("ROLLBACK").catch(() => undefined);
            app.log.error({ err: error, postId: candidate.id }, "Could not deliver scheduled Community Feed mention notifications.");
          } finally {
            client.release();
          }
        }
        if (due.rows.length < 100) break;
      }
    } catch (error) {
      app.log.error({ err: error }, "Could not process scheduled Community Feed mention notifications.");
    } finally {
      scheduledMentionJobRunning = false;
    }
  }

  async function runScheduledPostExpirations() {
    if (!pool || !isDatabaseReady() || !context.activation.isEnabled() || scheduledExpiryJobRunning) return;
    scheduledExpiryJobRunning = true;
    try {
      while (true) {
        const due = await pool.query<{ id: string; department_id: string; expires_at: Date | string }>(
          `SELECT id,department_id,expires_at FROM community_posts
            WHERE expires_at IS NOT NULL AND expires_at<=now() AND expired_at IS NULL
            ORDER BY expires_at,id LIMIT 100`,
        );
        if (!due.rowCount) break;
        let expiredCount = 0;
        for (const candidate of due.rows) {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            if (!await context.lockDepartmentForWrite(client, candidate.department_id)) { await client.query("ROLLBACK"); continue; }
            const locked = await client.query<{ id: string; expires_at: Date | string }>(
              `SELECT id,expires_at FROM community_posts
                WHERE id=$1 AND department_id=$2 AND expires_at<=now() AND expired_at IS NULL
                FOR UPDATE SKIP LOCKED`, [candidate.id, candidate.department_id],
            );
            if (!locked.rowCount) { await client.query("ROLLBACK"); continue; }
            const expired = await client.query<{ expired_at: Date | string }>(
              "UPDATE community_posts SET expired_at=now(),updated_at=now() WHERE id=$1 AND department_id=$2 AND expired_at IS NULL RETURNING expired_at",
              [candidate.id, candidate.department_id],
            );
            if (!expired.rowCount) { await client.query("ROLLBACK"); continue; }
            await client.query(
              `INSERT INTO community_post_lifecycle_audit(id,department_id,post_id,action,details)
               VALUES($1,$2,$3,'expired',$4::jsonb)`,
              [randomUUID(), candidate.department_id, candidate.id, JSON.stringify({ expiresAt: new Date(locked.rows[0]!.expires_at).toISOString() })],
            );
            await client.query("COMMIT");
            expiredCount += 1;
            realtime.publish("module:community-feed:changed", candidate.department_id, { postId: candidate.id, action: "expired" });
          } catch (error) {
            await client.query("ROLLBACK").catch(() => undefined);
            app.log.error({ err: error, postId: candidate.id }, "Could not expire a Community Feed post.");
          } finally { client.release(); }
        }
        if (due.rows.length < 100 || expiredCount === 0) break;
      }
    } catch (error) {
      app.log.error({ err: error }, "Could not process Community Feed post expirations.");
    } finally { scheduledExpiryJobRunning = false; }
  }

  async function runScheduledDigests() {
    if (!pool || !isDatabaseReady() || !context.activation.isEnabled() || scheduledDigestJobRunning) return;
    scheduledDigestJobRunning = true;
    try {
      const due = await pool.query<{ department_id: string }>(
        "SELECT DISTINCT department_id FROM community_post_notification_preferences WHERE digest_next_at<=now()",
      );
      for (const { department_id: departmentId } of due.rows) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          if (await context.lockDepartmentForWrite(client, departmentId)) await queueDueCommunityDigests(client, departmentId);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          app.log.error({ err: error, departmentId }, "Could not queue Community Feed email digests.");
        } finally { client.release(); }
      }
    } catch (error) {
      app.log.error({ err: error }, "Could not check scheduled Community Feed email digests.");
    } finally { scheduledDigestJobRunning = false; }
  }

  app.addHook("onReady", async () => {
    if (!pool || !isDatabaseReady()) return;
    await Promise.all([runScheduledMentionNotifications(), runScheduledPostExpirations(), runScheduledDigests()]);
    scheduledMentionTimer = setInterval(() => {
      void Promise.all([runScheduledMentionNotifications(), runScheduledPostExpirations(), runScheduledDigests()]);
    }, 60_000);
    scheduledMentionTimer.unref?.();
  });
  app.addHook("onClose", async () => { if (scheduledMentionTimer) clearInterval(scheduledMentionTimer); });

  app.get("/api/modules/community-feed/digest-preferences", async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query<{ digest_weekday: number | null }>(
      "SELECT digest_weekday FROM community_post_notification_preferences WHERE department_id=$1 AND user_id=$2",
      [departmentId, request.authenticatedUser!.id],
    );
    return { weekday: result.rows[0]?.digest_weekday ?? null };
  });

  app.get("/api/modules/community-feed/email-history", async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query(
      `SELECT notification.id, CASE WHEN notification.title=$3 AND NOT notification.in_app_enabled THEN 'digest' ELSE 'alert' END AS kind,
              delivery.status, delivery.created_at AS "queuedAt", delivery.updated_at AS "updatedAt"
         FROM module_notifications notification
         JOIN module_notification_email_deliveries delivery ON delivery.notification_id=notification.id
        WHERE notification.department_id=$1 AND notification.recipient_user_id=$2 AND notification.kind='community_feed'
        ORDER BY notification.created_at DESC,notification.id DESC LIMIT 30`,
      [departmentId, request.authenticatedUser!.id, DIGEST_TITLE],
    );
    return reply.header("Cache-Control", "private, no-store").send(result.rows);
  });

  app.put<{ Body: { weekday: number | null } }>("/api/modules/community-feed/digest-preferences", {
    schema: { body: { type: "object", additionalProperties: false, required: ["weekday"], properties: { weekday: { anyOf: [{ type: "integer", minimum: 1, maximum: 7 }, { type: "null" }] } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const weekday = request.body.weekday;
    const userId = request.authenticatedUser!.id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      await client.query(
        `INSERT INTO community_post_notification_preferences AS preference(department_id,user_id,digest_weekday,digest_next_at,digest_window_start)
         SELECT id,$2,$3::smallint,community_feed_next_digest($3,time_zone,now()),CASE WHEN $3 IS NOT NULL THEN now() END
         FROM departments WHERE id=$1
         ON CONFLICT (department_id,user_id) DO UPDATE SET digest_weekday=EXCLUDED.digest_weekday,
           digest_next_at=CASE WHEN preference.digest_weekday IS NOT DISTINCT FROM EXCLUDED.digest_weekday THEN preference.digest_next_at ELSE EXCLUDED.digest_next_at END,
           digest_window_start=CASE WHEN EXCLUDED.digest_weekday IS NULL THEN NULL ELSE COALESCE(preference.digest_window_start,EXCLUDED.digest_window_start) END,
           updated_at=now()`, [departmentId, userId, weekday],
      );
      if (weekday === null) {
        await client.query(
          `UPDATE module_notifications SET email_enabled=false WHERE department_id=$1 AND recipient_user_id=$2
             AND kind='community_feed' AND title=$3 AND NOT in_app_enabled AND email_enabled`,
          [departmentId, userId, DIGEST_TITLE],
        );
      }
      await client.query("COMMIT");
      return { weekday };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  });

  app.get("/api/modules/community-feed/notification-preferences", async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query<{ notify_posts: boolean; notify_reactions: boolean; notify_comments: boolean; notify_email_posts: boolean; notify_email_reactions: boolean; notify_email_comments: boolean }>(
      "SELECT notify_posts,notify_reactions,notify_comments,notify_email_posts,notify_email_reactions,notify_email_comments FROM community_post_notification_preferences WHERE department_id=$1 AND user_id=$2",
      [departmentId, request.authenticatedUser!.id],
    );
    const preferences = result.rows[0];
    return { posts: preferences?.notify_posts ?? true, reactions: preferences?.notify_reactions ?? true, comments: preferences?.notify_comments ?? true, emailPosts: preferences?.notify_email_posts ?? true, emailReactions: preferences?.notify_email_reactions ?? true, emailComments: preferences?.notify_email_comments ?? true };
  });

  app.put<{ Body: { posts: boolean; reactions: boolean; comments: boolean; emailPosts?: boolean; emailReactions?: boolean; emailComments?: boolean } }>("/api/modules/community-feed/notification-preferences", {
    schema: { body: { type: "object", additionalProperties: false, required: ["posts", "reactions", "comments"], properties: { posts: { type: "boolean" }, reactions: { type: "boolean" }, comments: { type: "boolean" }, emailPosts: { type: "boolean" }, emailReactions: { type: "boolean" }, emailComments: { type: "boolean" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const current = await pool.query<{ notify_email_posts: boolean; notify_email_reactions: boolean; notify_email_comments: boolean }>(
      "SELECT notify_email_posts,notify_email_reactions,notify_email_comments FROM community_post_notification_preferences WHERE department_id=$1 AND user_id=$2",
      [departmentId, request.authenticatedUser!.id],
    );
    const emailPosts = request.body.emailPosts ?? current.rows[0]?.notify_email_posts ?? true;
    const emailReactions = request.body.emailReactions ?? current.rows[0]?.notify_email_reactions ?? true;
    const emailComments = request.body.emailComments ?? current.rows[0]?.notify_email_comments ?? true;
    await pool.query(
      `INSERT INTO community_post_notification_preferences(department_id,user_id,notify_posts,notify_reactions,notify_comments,notify_email_posts,notify_email_reactions,notify_email_comments)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(department_id,user_id) DO UPDATE SET notify_posts=EXCLUDED.notify_posts,notify_reactions=EXCLUDED.notify_reactions,
         notify_comments=EXCLUDED.notify_comments,notify_email_posts=EXCLUDED.notify_email_posts,notify_email_reactions=EXCLUDED.notify_email_reactions,
         notify_email_comments=EXCLUDED.notify_email_comments,updated_at=now()`,
      [departmentId, request.authenticatedUser!.id, request.body.posts, request.body.reactions, request.body.comments, emailPosts, emailReactions, emailComments],
    );
    return { posts: request.body.posts, reactions: request.body.reactions, comments: request.body.comments, emailPosts, emailReactions, emailComments };
  });

  app.get("/api/modules/community-feed/notifications", async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const userId = request.authenticatedUser!.id;
    const result = await pool.query(
      `SELECT notification.id,notification.post_id AS "postId",notification.kind,notification.created_at AS "createdAt",notification.read_at AS "readAt",
              actor.display_name AS "actorName",post.title AS "postTitle",
              CASE notification.kind WHEN 'post' THEN 'posted an update' WHEN 'reaction' THEN 'reacted to your post' WHEN 'mention' THEN CASE WHEN notification.comment_id IS NULL THEN 'mentioned you in a post' ELSE 'mentioned you in a comment' END ELSE 'commented on a post' END AS summary
         FROM community_post_notifications notification
         JOIN community_posts post ON post.id=notification.post_id AND post.department_id=notification.department_id
         LEFT JOIN app_users actor ON actor.id=notification.actor_user_id
        WHERE notification.department_id=$1 AND notification.recipient_user_id=$2 AND notification.in_app_enabled=true AND post.expired_at IS NULL AND (post.expires_at IS NULL OR post.expires_at>now())
          AND (post.publish_at IS NULL OR post.publish_at<=now()) AND ${groupAccess("post", 2, 3)}
        ORDER BY notification.created_at DESC LIMIT 50`,
      [departmentId, userId, request.activeDepartmentRole === "site_admin"],
    );
    return { items: result.rows, unreadCount: result.rows.filter((row) => !row.readAt).length };
  });

  app.post<{ Params: { id: string } }>("/api/modules/community-feed/notifications/:id/read", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    await pool.query("UPDATE community_post_notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND department_id=$2 AND recipient_user_id=$3 AND in_app_enabled=true", [request.params.id, departmentId, request.authenticatedUser!.id]);
    return { read: true };
  });

  app.post("/api/modules/community-feed/notifications/read-all", async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    await pool.query("UPDATE community_post_notifications SET read_at=now() WHERE department_id=$1 AND recipient_user_id=$2 AND in_app_enabled=true AND read_at IS NULL", [departmentId, request.authenticatedUser!.id]);
    return { read: true };
  });

  app.get("/api/modules/community-feed/groups", async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query(
      `SELECT DISTINCT church_group.id,church_group.name,(subscription.group_id IS NOT NULL) AS "isSubscribed"
         FROM church_groups church_group
         LEFT JOIN department_memberships member_access ON member_access.department_id=church_group.department_id AND member_access.user_id=$2
         LEFT JOIN group_members group_access ON group_access.group_id=church_group.id AND group_access.contact_id=member_access.contact_id AND group_access.status='active'
         LEFT JOIN community_post_subscriptions subscription ON subscription.group_id=church_group.id AND subscription.department_id=church_group.department_id AND subscription.user_id=$2
        WHERE church_group.department_id=$1 AND church_group.status='active' AND ($3 OR group_access.group_id IS NOT NULL)
        ORDER BY church_group.name`,
      [departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
    );
    return result.rows;
  });

  app.post<{ Params: { groupId: string } }>("/api/modules/community-feed/groups/:groupId/subscription", {
    schema: { params: { type: "object", required: ["groupId"], properties: { groupId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const membership = await pool.query(
      `SELECT 1 FROM church_groups church_group WHERE church_group.id=$1 AND church_group.department_id=$2 AND church_group.status='active' AND ($4 OR EXISTS (
        SELECT 1 FROM department_memberships member_access JOIN group_members group_access ON group_access.contact_id=member_access.contact_id
         WHERE member_access.department_id=$2 AND member_access.user_id=$3 AND group_access.group_id=church_group.id AND group_access.status='active'
      ))`,
      [request.params.groupId, departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
    );
    if (!membership.rowCount) return reply.code(403).send({ error: "You can follow only a group you belong to." });
    await pool.query("INSERT INTO community_post_subscriptions(user_id,department_id,group_id) VALUES($1,$2,$3) ON CONFLICT(user_id,group_id) DO NOTHING", [request.authenticatedUser!.id, departmentId, request.params.groupId]);
    return { subscribed: true };
  });

  app.delete<{ Params: { groupId: string } }>("/api/modules/community-feed/groups/:groupId/subscription", {
    schema: { params: { type: "object", required: ["groupId"], properties: { groupId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    await pool.query("DELETE FROM community_post_subscriptions WHERE user_id=$1 AND department_id=$2 AND group_id=$3", [request.authenticatedUser!.id, departmentId, request.params.groupId]);
    return { subscribed: false };
  });

  app.get("/api/modules/community-feed/home-posts", async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const { rows } = await pool.query(
      `SELECT post.id,post.title,COALESCE(post.publish_at,post.created_at) AS "publishedAt",linked_group.name AS "groupName"
         FROM community_posts post
         LEFT JOIN church_groups linked_group ON linked_group.id=post.group_id AND linked_group.department_id=post.department_id
        WHERE post.department_id=$1 AND post.expired_at IS NULL AND (post.expires_at IS NULL OR post.expires_at>now())
          AND COALESCE(post.publish_at,post.created_at)<=now() AND ${groupAccess("post", 2, 3)}
          AND NOT EXISTS (SELECT 1 FROM community_post_hidden hidden_row WHERE hidden_row.post_id=post.id AND hidden_row.user_id=$2)
        ORDER BY COALESCE(post.publish_at,post.created_at) DESC,post.id DESC LIMIT 5`,
      [departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
    );
    return reply.header("Cache-Control", "private, no-store").send({ posts: rows });
  });

  app.get<{ Querystring: { scope?: "all" | "mine" | "groups" | "following" | "hidden" | "expired"; groupId?: string; postId?: string; q?: string } }>("/api/modules/community-feed/posts", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: { scope: { type: "string", enum: ["all", "mine", "groups", "following", "hidden", "expired"] }, groupId: { type: "string", format: "uuid" }, postId: { type: "string", format: "uuid" }, q: { type: "string", maxLength: 100 } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const currentUserId = request.authenticatedUser!.id;
    const canReviewReports = request.activeDepartmentRole === "site_admin" || (request.activeDepartmentModulePermissions?.["community-feed"] ?? []).includes("moderate");
    if (request.query.scope === "expired" && !canReviewReports) return reply.code(403).send({ error: "Community Feed moderator access is required to review expired posts." });
    const wikiSchema = await pool.query<{ present: boolean }>("SELECT to_regclass('public.wiki_pages') IS NOT NULL AS present");
    const canReadRestrictedWiki = request.activeDepartmentRole === "site_admin" || (request.activeDepartmentModulePermissions?.wiki ?? []).includes("manage");
    const visibleLinks = wikiSchema.rows[0]?.present
      ? `COALESCE((SELECT json_agg(json_build_object('type',link.link_type,'id',link.entity_id,'label',link.label) ORDER BY link.created_at,link.link_type)
          FROM community_post_links link LEFT JOIN wiki_pages wiki_page
            ON link.link_type='wiki' AND wiki_page.id=link.entity_id AND wiki_page.department_id=post.department_id
         WHERE link.post_id=post.id AND link.department_id=post.department_id
           AND (link.link_type<>'wiki' OR (wiki_page.id IS NOT NULL AND wiki_page.status='active' AND (
             $8::boolean OR wiki_page.audience='location' OR (wiki_page.audience='group' AND EXISTS (
               SELECT 1 FROM group_members wiki_member JOIN department_memberships wiki_membership ON wiki_membership.contact_id=wiki_member.contact_id AND wiki_membership.department_id=post.department_id
                WHERE wiki_member.group_id=wiki_page.audience_group_id AND wiki_member.status='active' AND wiki_membership.user_id=$2
             ))
           )))), '[]'::json)`
      : `COALESCE((SELECT json_agg(json_build_object('type',link.link_type,'id',link.entity_id,'label',link.label) ORDER BY link.created_at,link.link_type) FROM community_post_links link WHERE link.post_id=post.id AND link.department_id=post.department_id AND link.link_type<>'wiki'), '[]'::json)`;
    const result = await pool.query(
      `SELECT post.id,post.title,post.body,post.body_format AS "bodyFormat",post.created_at AS "createdAt",post.author_user_id AS "authorId",author.display_name AS "authorName",
              (SELECT count(*)::int FROM community_post_likes like_row WHERE like_row.post_id=post.id AND like_row.reaction_type='like') AS "likeCount",
              EXISTS (SELECT 1 FROM community_post_likes like_row WHERE like_row.post_id=post.id AND like_row.user_id=$2 AND like_row.reaction_type='like') AS "likedByMe",
              (SELECT reaction_type FROM community_post_likes like_row WHERE like_row.post_id=post.id AND like_row.user_id=$2) AS "myReaction",
              COALESCE((SELECT json_object_agg(reaction_type,reaction_count) FROM (SELECT reaction_type,count(*)::int AS reaction_count FROM community_post_likes WHERE post_id=post.id GROUP BY reaction_type) reaction_rows), '{}'::json) AS reactions,
              post.publish_at AS "publishAt",post.expires_at AS "expiresAt",post.expired_at AS "expiredAt",post.comments_enabled AS "commentsEnabled",post.group_id AS "groupId",post.visibility,
              linked_group.name AS "groupName",
              COALESCE((SELECT json_agg(json_build_object('id',attachment.id,'filename',attachment.filename,'contentType',attachment.content_type,'url','/api/modules/community-feed/attachments/'||attachment.id) ORDER BY attachment.created_at,attachment.id) FROM community_post_attachments attachment WHERE attachment.post_id=post.id AND attachment.department_id=post.department_id), '[]'::json) AS attachments,
              ${visibleLinks} AS links,
              (post.author_user_id=$2 OR $3) AS "canDelete",
              COALESCE((SELECT json_agg(json_build_object(
                'id',comment.id,'body',comment.body,'authorId',comment.author_user_id,
                'authorName',comment_author.display_name,'createdAt',comment.created_at
              ) ORDER BY comment.created_at,comment.id)
                FROM community_post_comments comment JOIN app_users comment_author ON comment_author.id=comment.author_user_id
               WHERE comment.post_id=post.id), '[]'::json) AS comments
         FROM community_posts post JOIN app_users author ON author.id=post.author_user_id
         LEFT JOIN church_groups linked_group ON linked_group.id=post.group_id AND linked_group.department_id=post.department_id
        WHERE post.department_id=$1 AND (COALESCE($4,'all')='expired' AND post.expired_at IS NOT NULL OR COALESCE($4,'all')<>'expired' AND post.expired_at IS NULL AND (post.expires_at IS NULL OR post.expires_at>now()))
          AND (post.publish_at IS NULL OR post.publish_at<=now() OR post.author_user_id=$2 OR $3)
          AND ${groupAccess("post", 2, 3)}
          AND (COALESCE($4,'all')<>'mine' OR post.author_user_id=$2)
          AND (COALESCE($4,'all')<>'groups' OR post.group_id IS NOT NULL)
          AND (COALESCE($4,'all')<>'following' OR EXISTS (SELECT 1 FROM community_post_subscriptions subscription WHERE subscription.user_id=$2 AND subscription.department_id=$1 AND subscription.group_id=post.group_id))
          AND ($5::uuid IS NULL OR post.group_id=$5)
          AND (CASE WHEN $4='hidden' THEN EXISTS (SELECT 1 FROM community_post_hidden hidden_row WHERE hidden_row.post_id=post.id AND hidden_row.user_id=$2) WHEN $4='expired' THEN TRUE ELSE NOT EXISTS (SELECT 1 FROM community_post_hidden hidden_row WHERE hidden_row.post_id=post.id AND hidden_row.user_id=$2) END)
          AND ($7::text IS NULL OR post.id=$6::uuid OR strpos(lower(post.title),lower($7))>0 OR strpos(lower(post.body),lower($7))>0)
        ORDER BY (post.id=$6::uuid) DESC NULLS LAST,COALESCE(post.publish_at,post.created_at) DESC,post.id DESC LIMIT 100`,
      [departmentId, currentUserId, request.activeDepartmentRole === "site_admin", request.query.scope ?? "all", request.query.groupId ?? null, request.query.postId ?? null, request.query.q?.trim() || null, ...(wikiSchema.rows[0]?.present ? [canReadRestrictedWiki] : [])],
    );
    return result.rows;
  });

  app.get<{ Querystring: { type: "person" | "group" | "wiki" | "song"; q?: string } }>("/api/modules/community-feed/entities", {
    schema: { querystring: { type: "object", additionalProperties: false, required: ["type"], properties: { type: { type: "string", enum: ["person", "group", "wiki", "song"] }, q: { type: "string", maxLength: 80 } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const term = `%${(request.query.q ?? "").trim().replace(/[%_\\]/g, "\\$&")}%`;
    const peoplePermissions = request.activeDepartmentPermissions ?? [];
    if (request.query.type === "person" && request.activeDepartmentRole !== "site_admin" && !peoplePermissions.includes("people_view_private") && !peoplePermissions.includes("people_manage")) return reply.code(403).send({ error: "Private People access is required to search people for Community Feed mentions." });
    const isWikiManager = request.activeDepartmentRole === "site_admin" || (request.activeDepartmentModulePermissions?.wiki ?? []).includes("manage");
    if (request.query.type === "wiki") {
      try {
        return (await pool.query(
          `SELECT page.id,page.title AS label FROM wiki_pages page
            WHERE page.department_id=$1 AND page.status='active' AND page.title ILIKE $2
              AND ($3::boolean OR page.audience='location' OR (page.audience='group' AND EXISTS (
                SELECT 1 FROM group_members member JOIN department_memberships membership ON membership.contact_id=member.contact_id AND membership.department_id=page.department_id
                 WHERE member.group_id=page.audience_group_id AND member.status='active' AND membership.user_id=$4
              )))
            ORDER BY page.title LIMIT 12`, [departmentId, term, isWikiManager, request.authenticatedUser!.id],
        )).rows;
      } catch { return []; }
    }
    const queries = {
      person: `SELECT id, trim(first_name||' '||last_name) AS label FROM contacts WHERE department_id=$1 AND status='member' AND (first_name ILIKE $2 OR last_name ILIKE $2) ORDER BY last_name,first_name LIMIT 12`,
      group: `SELECT id,name AS label FROM church_groups WHERE department_id=$1 AND status='active' AND name ILIKE $2 ORDER BY name LIMIT 12`,
      song: `SELECT id,title AS label FROM worship_songs WHERE department_id=$1 AND active=TRUE AND title ILIKE $2 ORDER BY title LIMIT 12`,
    };
    try { return (await pool.query(queries[request.query.type], [departmentId, term])).rows; }
    catch (error) {
      if (request.query.type === "song") return [];
      throw error;
    }
  });

  app.post<{ Params: { postId: string }; Body: { type: "person" | "group" | "wiki" | "song"; entityId: string } }>("/api/modules/community-feed/posts/:postId/links", {
    schema: { params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["type", "entityId"], properties: { type: { type: "string", enum: ["person", "group", "wiki", "song"] }, entityId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const lookups = {
      person: "SELECT trim(first_name||' '||last_name) AS label FROM contacts WHERE id=$1 AND department_id=$2 AND status='member'",
      group: "SELECT name AS label FROM church_groups WHERE id=$1 AND department_id=$2 AND status='active'",
      song: "SELECT title AS label FROM worship_songs WHERE id=$1 AND department_id=$2 AND active=TRUE",
    };
    const isWikiManager = request.activeDepartmentRole === "site_admin" || (request.activeDepartmentModulePermissions?.wiki ?? []).includes("manage");
    const lookup = request.body.type === "wiki"
      ? `SELECT page.title AS label FROM wiki_pages page WHERE page.id=$1 AND page.department_id=$2 AND page.status='active'
          AND ($3::boolean OR page.audience='location' OR (page.audience='group' AND EXISTS (
            SELECT 1 FROM group_members member JOIN department_memberships membership ON membership.contact_id=member.contact_id AND membership.department_id=page.department_id
             WHERE member.group_id=page.audience_group_id AND member.status='active' AND membership.user_id=$4
          )))`
      : lookups[request.body.type as "person" | "group" | "song"];
    const lookupParams = request.body.type === "wiki" ? [request.body.entityId, departmentId, isWikiManager, request.authenticatedUser!.id] : [request.body.entityId, departmentId];
    const entity = await pool.query<{ label: string }>(lookup, lookupParams);
    if (!entity.rowCount) return reply.code(404).send({ error: "Choose an active item from this location." });
    const result = await pool.query(
      `INSERT INTO community_post_links(post_id,department_id,link_type,entity_id,label)
       SELECT post.id,$2,$3,$4,$5 FROM community_posts post WHERE post.id=$1 AND post.department_id=$2 AND (post.author_user_id=$6 OR $7)
       ON CONFLICT(post_id,link_type,entity_id) DO NOTHING RETURNING post_id`,
      [request.params.postId, departmentId, request.body.type, request.body.entityId, entity.rows[0].label, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "This post could not be found or you cannot edit it." });
    return reply.code(201).send({ type: request.body.type, id: request.body.entityId, label: entity.rows[0].label });
  });

  app.post<{ Params: { postId: string }; Body: { filename: string; contentType: string; data: string } }>("/api/modules/community-feed/posts/:postId/attachments", {
    bodyLimit: 1_500_000,
    schema: { params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["filename", "contentType", "data"], properties: { filename: { type: "string", minLength: 1, maxLength: 180 }, contentType: { type: "string", enum: ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "text/plain"] }, data: { type: "string", maxLength: 1_400_000 } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const safeName = request.body.filename.replace(/[\\/\u0000-\u001f]/g, "_").trim().slice(0, 180) || "attachment";
    const data = request.body.data.replace(/^data:[^;,]+;base64,/, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) return reply.code(400).send({ error: "The attachment data is invalid." });
    const bytes = Buffer.from(data, "base64");
    if (!bytes.length || bytes.length > 1_048_576) return reply.code(413).send({ error: "Attachments must be 1 MiB or smaller." });
    const type = request.body.contentType;
    const signatures: Record<string, boolean> = {
      "image/jpeg": bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
      "image/png": bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      "image/gif": bytes.subarray(0, 3).toString("ascii") === "GIF",
      "image/webp": bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP",
      "application/pdf": bytes.subarray(0, 5).toString("ascii") === "%PDF-",
      "text/plain": !bytes.includes(0),
    };
    if (!signatures[type]) return reply.code(400).send({ error: "The file contents do not match an allowed file type." });
    const canAttach = await pool.query(
      `SELECT 1 FROM community_posts post WHERE post.id=$1 AND post.department_id=$2 AND post.expired_at IS NULL AND (post.expires_at IS NULL OR post.expires_at>now()) AND (post.author_user_id=$3 OR $4)`,
      [request.params.postId, departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
    );
    if (!canAttach.rowCount) return reply.code(404).send({ error: "This post could not be found or you cannot edit it." });
    const count = await pool.query("SELECT count(*)::int AS count FROM community_post_attachments WHERE department_id=$1 AND post_id=$2", [departmentId, request.params.postId]);
    if (count.rows[0].count >= 5) return reply.code(400).send({ error: "A post can have up to five attachments." });
    const id = randomUUID();
    await pool.query("INSERT INTO community_post_attachments(id,post_id,department_id,uploaded_by,filename,content_type,content) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, request.params.postId, departmentId, request.authenticatedUser!.id, safeName, type, bytes]);
    return reply.code(201).send({ id, filename: safeName, contentType: type, url: `/api/modules/community-feed/attachments/${id}` });
  });

  app.get<{ Params: { attachmentId: string } }>("/api/modules/community-feed/attachments/:attachmentId", {
    schema: { params: { type: "object", required: ["attachmentId"], properties: { attachmentId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query<{ content: Buffer; content_type: string; filename: string }>(
      `SELECT attachment.content,attachment.content_type,attachment.filename FROM community_post_attachments attachment JOIN community_posts post ON post.id=attachment.post_id
       WHERE attachment.id=$1 AND attachment.department_id=$2 AND post.expired_at IS NULL AND (post.expires_at IS NULL OR post.expires_at>now()) AND (post.publish_at IS NULL OR post.publish_at<=now() OR post.author_user_id=$3 OR $4) AND ${groupAccess("post", 3, 4)}`,
      [request.params.attachmentId, departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Attachment not found." });
    reply.header("content-type", result.rows[0].content_type).header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(result.rows[0].filename)}`).header("x-content-type-options", "nosniff").header("cache-control", "private, no-store");
    return reply.send(result.rows[0].content);
  });

  app.post<{ Params: { postId: string } }>("/api/modules/community-feed/posts/:postId/hide", {
    schema: { params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query(
      `INSERT INTO community_post_hidden(post_id,user_id)
       SELECT post.id,$3 FROM community_posts post WHERE post.id=$1 AND post.department_id=$2 AND ${groupAccess("post", 3, 4)}
       ON CONFLICT(post_id,user_id) DO UPDATE SET hidden_at=now() RETURNING post_id`,
      [request.params.postId, departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "This post could not be found." });
    return { hidden: true };
  });

  app.delete<{ Params: { postId: string } }>("/api/modules/community-feed/posts/:postId/hide", {
    schema: { params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    await pool.query(
      `DELETE FROM community_post_hidden hidden_row USING community_posts post
        WHERE hidden_row.post_id=post.id AND hidden_row.post_id=$1 AND post.department_id=$2 AND hidden_row.user_id=$3`,
      [request.params.postId, departmentId, request.authenticatedUser!.id],
    );
    return { hidden: false };
  });

  app.post<{ Params: { postId: string }; Body: { reason: "spam" | "inappropriate" | "harmful" | "other"; details?: string } }>("/api/modules/community-feed/posts/:postId/reports", {
    schema: {
      params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["reason"], properties: { reason: { type: "string", enum: ["spam", "inappropriate", "harmful", "other"] }, details: { type: "string", maxLength: 500 } } },
    },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query(
      `INSERT INTO community_post_reports(id,department_id,post_id,reporter_user_id,reason,details)
       SELECT $1,post.department_id,post.id,$3,$5,$6 FROM community_posts post
        WHERE post.id=$2 AND post.department_id=$4 AND post.author_user_id<>$3
          AND (post.publish_at IS NULL OR post.publish_at<=now()) AND ${groupAccess("post", 3, 7)}
       ON CONFLICT(post_id,reporter_user_id) DO NOTHING RETURNING id`,
      [randomUUID(), request.params.postId, request.authenticatedUser!.id, departmentId, request.body.reason, request.body.details?.trim() ?? "", request.activeDepartmentRole === "site_admin"],
    );
    if (!result.rowCount) return reply.code(409).send({ error: "This post cannot be reported again." });
    realtime.publish("module:community-feed:changed", departmentId, { postId: request.params.postId, action: "reported" });
    return reply.code(201).send({ submitted: true });
  });

  app.get<{ Querystring: { status?: "open" | "dismissed" | "actioned" } }>("/api/modules/community-feed/reports", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: { status: { type: "string", enum: ["open", "dismissed", "actioned"] } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    if (request.activeDepartmentRole !== "site_admin" && !(request.activeDepartmentModulePermissions?.["community-feed"] ?? []).includes("moderate")) return reply.code(403).send({ error: "Community Feed moderator access is required to review post reports." });
    const result = await pool.query(
      `SELECT report.id,report.post_id AS "postId",post.title,post.body,post.author_user_id AS "authorId",author.display_name AS "authorName",
              report.reporter_user_id AS "reporterId",reporter.display_name AS "reporterName",report.reason,report.details,report.status,
              report.created_at AS "createdAt",report.reviewed_at AS "reviewedAt"
         FROM community_post_reports report JOIN community_posts post ON post.id=report.post_id AND post.department_id=report.department_id
         JOIN app_users author ON author.id=post.author_user_id JOIN app_users reporter ON reporter.id=report.reporter_user_id
        WHERE report.department_id=$1 AND ($2::text IS NULL OR report.status=$2)
          AND ${groupAccess("post", 3, 4)}
        ORDER BY (report.status='open') DESC,report.created_at DESC LIMIT 300`,
      [departmentId, request.query.status ?? null, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
    );
    return result.rows;
  });

  app.patch<{ Params: { reportId: string }; Body: { status: "dismissed" | "actioned" } }>("/api/modules/community-feed/reports/:reportId", {
    schema: {
      params: { type: "object", required: ["reportId"], properties: { reportId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["dismissed", "actioned"] } } },
    },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    if (request.activeDepartmentRole !== "site_admin" && !(request.activeDepartmentModulePermissions?.["community-feed"] ?? []).includes("moderate")) return reply.code(403).send({ error: "Community Feed moderator access is required to review post reports." });
    const result = await pool.query(
      `UPDATE community_post_reports report SET status=$3,reviewed_by=$4,reviewed_at=now()
         FROM community_posts post
        WHERE report.id=$1 AND report.department_id=$2 AND post.id=report.post_id AND post.department_id=report.department_id
          AND ${groupAccess("post", 5, 6)}
        RETURNING report.post_id`,
      [request.params.reportId, departmentId, request.body.status, request.authenticatedUser!.id, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Post report not found." });
    realtime.publish("module:community-feed:changed", departmentId, { postId: result.rows[0].post_id, action: "report-reviewed" });
    return { reviewed: true, status: request.body.status };
  });

  app.post<{ Body: { title?: string; body: string; bodyFormat?: "plain" | "formatted"; mentions?: string[]; publishAt?: string | null; expiresAt?: string | null; commentsEnabled?: boolean; groupId?: string | null; visibility?: "location" | "members" } }>("/api/modules/community-feed/posts", {
    schema: { body: { type: "object", additionalProperties: false, required: ["body"], properties: { title: { type: "string", maxLength: 120 }, body: { type: "string", minLength: 1, maxLength: 4000 }, bodyFormat: { type: "string", enum: ["plain", "formatted"] }, mentions: { type: "array", uniqueItems: true, maxItems: 20, items: { type: "string", format: "uuid" } }, publishAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] }, expiresAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] }, commentsEnabled: { type: "boolean" }, groupId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] }, visibility: { type: "string", enum: ["location", "members"] } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const body = request.body.body.trim();
    if (!body) return reply.code(400).send({ error: "Write something before publishing." });
    const publishAt = request.body.publishAt ? new Date(request.body.publishAt) : null;
    if (publishAt && !Number.isFinite(publishAt.getTime())) return reply.code(400).send({ error: "Choose a valid publication date and time." });
    const expiresAt = request.body.expiresAt ? new Date(request.body.expiresAt) : null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Math.max(Date.now(), publishAt?.getTime() ?? 0))) return reply.code(400).send({ error: "Choose an expiry time after publication." });
    const groupId = request.body.groupId ?? null;
    const visibility = request.body.visibility ?? "location";
    const mentionIds = request.body.mentions ?? [];
    if (mentionIds.length) {
      const peoplePermissions = request.activeDepartmentPermissions ?? [];
      if (request.activeDepartmentRole !== "site_admin" && !peoplePermissions.includes("people_view_private") && !peoplePermissions.includes("people_manage")) return reply.code(403).send({ error: "Private People access is required to mention people in Community Feed posts." });
      const mentionedPeople = await pool.query<{ id: string; label: string }>("SELECT id,trim(first_name||' '||last_name) AS label FROM contacts WHERE department_id=$1 AND status='member' AND id=ANY($2::uuid[])", [departmentId, mentionIds]);
      if (mentionedPeople.rowCount !== mentionIds.length || mentionedPeople.rows.some((person) => !body.includes(`@${person.label}`))) return reply.code(400).send({ error: "Choose active location members and include each selected name in the post text." });
    }
    if (visibility === "members" && !groupId) return reply.code(400).send({ error: "Member-only posts need a group." });
    if (groupId) {
      const access = await pool.query(
        `SELECT 1 FROM church_groups church_group
         WHERE church_group.id=$1 AND church_group.department_id=$2 AND church_group.status='active' AND ($4 OR EXISTS (
           SELECT 1 FROM department_memberships membership JOIN group_members group_member ON group_member.contact_id=membership.contact_id
            WHERE membership.user_id=$3 AND membership.department_id=$2 AND group_member.group_id=church_group.id AND group_member.status='active'
         ))`,
        [groupId, departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
      );
      if (!access.rowCount) return reply.code(403).send({ error: "Choose a group you belong to." });
    }
    const result = await pool.query(
      `INSERT INTO community_posts (id,department_id,author_user_id,title,body,publish_at,expires_at,comments_enabled,group_id,visibility,body_format)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id,title,body,body_format AS "bodyFormat",created_at AS "createdAt",author_user_id AS "authorId",publish_at AS "publishAt",expires_at AS "expiresAt",comments_enabled AS "commentsEnabled",group_id AS "groupId",visibility`,
      [randomUUID(), departmentId, request.authenticatedUser!.id, request.body.title?.trim() ?? "", body, publishAt, expiresAt, request.body.commentsEnabled ?? true, groupId, visibility, request.body.bodyFormat ?? "plain"],
    );
    if (expiresAt) await pool.query("INSERT INTO community_post_lifecycle_audit(id,department_id,post_id,actor_user_id,action,details) VALUES($1,$2,$3,$4,'expiry_scheduled',$5::jsonb)", [randomUUID(), departmentId, result.rows[0].id, request.authenticatedUser!.id, JSON.stringify({ expiresAt: expiresAt.toISOString() })]);
    const author = await pool.query("SELECT display_name FROM app_users WHERE id=$1", [request.authenticatedUser!.id]);
    const post = { ...result.rows[0], authorName: author.rows[0].display_name, likeCount: 0, likedByMe: false, myReaction: null, reactions: {}, canDelete: true, comments: [] };
    if (mentionIds.length) {
      await pool.query("INSERT INTO community_post_mentions(department_id,post_id,contact_id) SELECT $1,$2,contact_id FROM unnest($3::uuid[]) AS mentions(contact_id) ON CONFLICT DO NOTHING", [departmentId, post.id, mentionIds]);
    }
    if (!publishAt || publishAt.getTime() <= Date.now()) {
      await createMentionNotifications(String(post.id), departmentId, request.authenticatedUser!.id, mentionIds);
      if (publishAt && mentionIds.length) await pool.query("UPDATE community_posts SET mentions_notified_at=now() WHERE id=$1 AND department_id=$2", [post.id, departmentId]);
      await createFeedNotifications(String(post.id), departmentId, request.authenticatedUser!.id, "post");
    }
    realtime.publish("module:community-feed:changed", departmentId, { postId: post.id, action: "created" });
    return reply.code(201).send(post);
  });

  app.patch<{ Params: { postId: string }; Body: { expiresAt: string | null } }>("/api/modules/community-feed/posts/:postId/expiration", {
    schema: { params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["expiresAt"], properties: { expiresAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const expiresAt = request.body.expiresAt ? new Date(request.body.expiresAt) : null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) return reply.code(400).send({ error: "Choose a future expiry time." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This location is currently read-only." }); }
      const current = await client.query<{ expires_at: Date | string | null }>(
        `SELECT expires_at FROM community_posts WHERE id=$1 AND department_id=$2
          AND expired_at IS NULL AND (author_user_id=$3 OR $4) FOR UPDATE`,
        [request.params.postId, departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
      );
      if (!current.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "This post could not be found or cannot be edited." }); }
      if (expiresAt) {
        const updated = await client.query<{ publish_at: Date | string | null }>("UPDATE community_posts SET expires_at=$3,updated_at=now() WHERE id=$1 AND department_id=$2 RETURNING publish_at", [request.params.postId, departmentId, expiresAt]);
        const publishAt = updated.rows[0]!.publish_at;
        if (publishAt && expiresAt.getTime() <= new Date(publishAt).getTime()) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Expiry must be after the scheduled publication time." }); }
      } else await client.query("UPDATE community_posts SET expires_at=NULL,updated_at=now() WHERE id=$1 AND department_id=$2", [request.params.postId, departmentId]);
      const previous = current.rows[0]!.expires_at ? new Date(current.rows[0]!.expires_at).toISOString() : null;
      const next = expiresAt?.toISOString() ?? null;
      if (previous !== next) await client.query(
        "INSERT INTO community_post_lifecycle_audit(id,department_id,post_id,actor_user_id,action,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
        [randomUUID(), departmentId, request.params.postId, request.authenticatedUser!.id, !next ? "expiry_cancelled" : !previous ? "expiry_scheduled" : "expiry_changed", JSON.stringify({ previousExpiresAt: previous, expiresAt: next })],
      );
      await client.query("COMMIT");
      realtime.publish("module:community-feed:changed", departmentId, { postId: request.params.postId, action: "expiry-updated" });
      return { expiresAt: next };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  });

  app.post<{ Params: { postId: string } }>("/api/modules/community-feed/posts/:postId/publish", {
    schema: { params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query(
      "UPDATE community_posts SET publish_at=NULL,updated_at=now() WHERE id=$1 AND department_id=$2 AND (author_user_id=$3 OR $4) RETURNING id,author_user_id",
      [request.params.postId, departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "This post could not be found or you cannot publish it." });
    const mentions = await pool.query<{ contact_id: string }>("SELECT contact_id::text FROM community_post_mentions WHERE department_id=$1 AND post_id=$2", [departmentId, request.params.postId]);
    await createMentionNotifications(request.params.postId, departmentId, String(result.rows[0].author_user_id), mentions.rows.map((mention) => mention.contact_id));
    await createFeedNotifications(request.params.postId, departmentId, String(result.rows[0].author_user_id), "post");
    realtime.publish("module:community-feed:changed", departmentId, { postId: request.params.postId, action: "published" });
    return { published: true };
  });

  app.patch<{ Params: { postId: string }; Body: { title: string; body: string; bodyFormat?: "plain" | "formatted" } }>("/api/modules/community-feed/posts/:postId", {
    schema: {
      params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["title", "body"], properties: { title: { type: "string", maxLength: 120 }, body: { type: "string", minLength: 1, maxLength: 4000 }, bodyFormat: { type: "string", enum: ["plain", "formatted"] } } },
    },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const body = request.body.body.trim();
    if (!body) return reply.code(400).send({ error: "Write something before saving the post." });
    const result = await pool.query(
      "UPDATE community_posts SET title=$1,body=$2,body_format=COALESCE($7,body_format),updated_at=now() WHERE id=$3 AND department_id=$4 AND (author_user_id=$5 OR $6) RETURNING id",
      [request.body.title.trim(), body, request.params.postId, departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin", request.body.bodyFormat ?? null],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "This post could not be found or you cannot edit it." });
    realtime.publish("module:community-feed:changed", departmentId, { postId: request.params.postId, action: "edited" });
    return { updated: true };
  });

  app.patch<{ Params: { postId: string }; Body: { commentsEnabled: boolean } }>("/api/modules/community-feed/posts/:postId/comments", {
    schema: {
      params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["commentsEnabled"], properties: { commentsEnabled: { type: "boolean" } } },
    },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query(
      "UPDATE community_posts SET comments_enabled=$1,updated_at=now() WHERE id=$2 AND department_id=$3 AND (author_user_id=$4 OR $5) RETURNING id",
      [request.body.commentsEnabled, request.params.postId, departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "This post could not be found or you cannot edit it." });
    return { commentsEnabled: request.body.commentsEnabled };
  });

  app.post<{ Params: { postId: string } }>("/api/modules/community-feed/posts/:postId/likes", {
    schema: { params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query(
      `INSERT INTO community_post_likes (post_id,user_id,reaction_type)
       SELECT post.id,$3,'like' FROM community_posts post WHERE post.id=$1 AND post.department_id=$2 AND post.expired_at IS NULL AND (post.expires_at IS NULL OR post.expires_at>now()) AND (post.publish_at IS NULL OR post.publish_at<=now()) AND ${groupAccess("post", 3, 4)}
       ON CONFLICT (post_id,user_id) DO UPDATE SET reaction_type='like',created_at=now() RETURNING post_id`,
      [request.params.postId, departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "This post could not be found or is not published yet." });
    await createFeedNotifications(request.params.postId, departmentId, request.authenticatedUser!.id, "reaction");
    return { liked: true };
  });

  app.delete<{ Params: { postId: string } }>("/api/modules/community-feed/posts/:postId/likes", {
    schema: { params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    await pool.query(
      `DELETE FROM community_post_likes like_row USING community_posts post
        WHERE like_row.post_id=post.id AND post.id=$1 AND post.department_id=$2 AND like_row.user_id=$3 AND like_row.reaction_type='like' AND ${groupAccess("post", 3, 4)}`,
      [request.params.postId, departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
    );
    return { liked: false };
  });

  app.post<{ Params: { postId: string }; Body: { reaction: "like" | "love" | "pray" | "celebrate" } }>("/api/modules/community-feed/posts/:postId/reactions", {
    schema: {
      params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["reaction"], properties: { reaction: { type: "string", enum: ["like", "love", "pray", "celebrate"] } } },
    },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query(
      `INSERT INTO community_post_likes(post_id,user_id,reaction_type)
       SELECT post.id,$3,$4 FROM community_posts post
        WHERE post.id=$1 AND post.department_id=$2 AND post.expired_at IS NULL AND (post.expires_at IS NULL OR post.expires_at>now()) AND (post.publish_at IS NULL OR post.publish_at<=now()) AND ${groupAccess("post", 3, 5)}
       ON CONFLICT(post_id,user_id) DO UPDATE SET reaction_type=EXCLUDED.reaction_type,created_at=now()
       RETURNING post_id`,
      [request.params.postId, departmentId, request.authenticatedUser!.id, request.body.reaction, request.activeDepartmentRole === "site_admin"],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "This post could not be found." });
    await createFeedNotifications(request.params.postId, departmentId, request.authenticatedUser!.id, "reaction");
    return { reaction: request.body.reaction };
  });

  app.delete<{ Params: { postId: string } }>("/api/modules/community-feed/posts/:postId/reactions", {
    schema: { params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    await pool.query(
      `DELETE FROM community_post_likes reaction USING community_posts post
        WHERE reaction.post_id=post.id AND post.id=$1 AND post.department_id=$2 AND reaction.user_id=$3 AND ${groupAccess("post", 3, 4)}`,
      [request.params.postId, departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"],
    );
    return { reaction: null };
  });

  app.post<{ Params: { postId: string }; Body: { body: string; mentions?: string[] } }>("/api/modules/community-feed/posts/:postId/comments", {
    schema: {
      params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["body"], properties: { body: { type: "string", minLength: 1, maxLength: 1000 }, mentions: { type: "array", maxItems: 20, uniqueItems: true, items: { type: "string", format: "uuid" } } } },
    },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const body = request.body.body.trim();
    if (!body) return reply.code(400).send({ error: "Write a comment before posting." });
    const mentionIds = [...new Set(request.body.mentions ?? [])];
    const peoplePermissions = request.activeDepartmentPermissions ?? [];
    if (mentionIds.length && request.activeDepartmentRole !== "site_admin" && !peoplePermissions.includes("people_view_private") && !peoplePermissions.includes("people_manage")) return reply.code(403).send({ error: "Private People access is required to mention people in Community Feed comments." });
    const result = await pool.query(
      `INSERT INTO community_post_comments (id,post_id,author_user_id,body)
       SELECT $1,post.id,$4,$5 FROM community_posts post WHERE post.id=$2 AND post.department_id=$3 AND post.expired_at IS NULL AND (post.expires_at IS NULL OR post.expires_at>now()) AND post.comments_enabled=TRUE AND (post.publish_at IS NULL OR post.publish_at<=now()) AND ${groupAccess("post", 4, 6)}
       RETURNING id,post_id AS "postId",body,author_user_id AS "authorId",created_at AS "createdAt"`,
      [randomUUID(), request.params.postId, departmentId, request.authenticatedUser!.id, body, request.activeDepartmentRole === "site_admin"],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "This post could not be found." });
    if (mentionIds.length) await createCommentMentionNotifications(request.params.postId, String(result.rows[0].id), departmentId, request.authenticatedUser!.id, mentionIds, body);
    const author = await pool.query("SELECT display_name FROM app_users WHERE id=$1", [request.authenticatedUser!.id]);
    const comment = { ...result.rows[0], authorName: author.rows[0].display_name };
    await createFeedNotifications(request.params.postId, departmentId, request.authenticatedUser!.id, "comment", String(comment.id));
    realtime.publish("module:community-feed:changed", departmentId, { postId: request.params.postId, action: "commented" });
    return reply.code(201).send(comment);
  });

  app.delete<{ Params: { postId: string } }>("/api/modules/community-feed/posts/:postId", {
    schema: { params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const canModerate = request.activeDepartmentRole === "site_admin";
    const result = await pool.query(
      "DELETE FROM community_posts WHERE id=$1 AND department_id=$2 AND ($3 OR author_user_id=$4) RETURNING id",
      [request.params.postId, departmentId, canModerate, request.authenticatedUser!.id],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "This post could not be found or you cannot remove it." });
    realtime.publish("module:community-feed:changed", departmentId, { postId: request.params.postId, action: "deleted" });
    return { deleted: true };
  });
}
