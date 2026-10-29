import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = context;
  const unavailable = (reply: { code: (status: number) => { send: (body: object) => unknown } }) => reply.code(503).send({ error: "The community feed is unavailable." });

  app.get("/api/modules/community-feed/posts", async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const currentUserId = request.authenticatedUser!.id;
    const result = await pool.query(
      `SELECT post.id,post.title,post.body,post.created_at AS "createdAt",post.author_user_id AS "authorId",author.display_name AS "authorName",
              (SELECT count(*)::int FROM community_post_likes like_row WHERE like_row.post_id=post.id) AS "likeCount",
              EXISTS (SELECT 1 FROM community_post_likes like_row WHERE like_row.post_id=post.id AND like_row.user_id=$2) AS "likedByMe",
              (post.author_user_id=$2 OR $3) AS "canDelete",
              COALESCE((SELECT json_agg(json_build_object(
                'id',comment.id,'body',comment.body,'authorId',comment.author_user_id,
                'authorName',comment_author.display_name,'createdAt',comment.created_at
              ) ORDER BY comment.created_at,comment.id)
                FROM community_post_comments comment JOIN app_users comment_author ON comment_author.id=comment.author_user_id
               WHERE comment.post_id=post.id), '[]'::json) AS comments
         FROM community_posts post JOIN app_users author ON author.id=post.author_user_id
        WHERE post.department_id=$1 ORDER BY post.created_at DESC,post.id DESC LIMIT 100`,
      [departmentId, currentUserId, request.activeDepartmentRole === "site_admin"],
    );
    return result.rows;
  });

  app.post<{ Body: { title?: string; body: string } }>("/api/modules/community-feed/posts", {
    schema: { body: { type: "object", additionalProperties: false, required: ["body"], properties: { title: { type: "string", maxLength: 120 }, body: { type: "string", minLength: 1, maxLength: 4000 } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const body = request.body.body.trim();
    if (!body) return reply.code(400).send({ error: "Write something before publishing." });
    const result = await pool.query(
      `INSERT INTO community_posts (id,department_id,author_user_id,title,body)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id,title,body,created_at AS "createdAt",author_user_id AS "authorId"`,
      [randomUUID(), departmentId, request.authenticatedUser!.id, request.body.title?.trim() ?? "", body],
    );
    const author = await pool.query("SELECT display_name FROM app_users WHERE id=$1", [request.authenticatedUser!.id]);
    const post = { ...result.rows[0], authorName: author.rows[0].display_name, likeCount: 0, likedByMe: false, canDelete: true, comments: [] };
    realtime.publish("module:community-feed:changed", departmentId, { postId: post.id, action: "created" });
    return reply.code(201).send(post);
  });

  app.post<{ Params: { postId: string } }>("/api/modules/community-feed/posts/:postId/likes", {
    schema: { params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query(
      `INSERT INTO community_post_likes (post_id,user_id)
       SELECT post.id,$3 FROM community_posts post WHERE post.id=$1 AND post.department_id=$2
       ON CONFLICT (post_id,user_id) DO NOTHING RETURNING post_id`,
      [request.params.postId, departmentId, request.authenticatedUser!.id],
    );
    if (!result.rowCount) {
      const exists = await pool.query("SELECT 1 FROM community_posts WHERE id=$1 AND department_id=$2", [request.params.postId, departmentId]);
      if (!exists.rowCount) return reply.code(404).send({ error: "This post could not be found." });
    }
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
        WHERE like_row.post_id=post.id AND post.id=$1 AND post.department_id=$2 AND like_row.user_id=$3`,
      [request.params.postId, departmentId, request.authenticatedUser!.id],
    );
    return { liked: false };
  });

  app.post<{ Params: { postId: string }; Body: { body: string } }>("/api/modules/community-feed/posts/:postId/comments", {
    schema: {
      params: { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["body"], properties: { body: { type: "string", minLength: 1, maxLength: 1000 } } },
    },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const body = request.body.body.trim();
    if (!body) return reply.code(400).send({ error: "Write a comment before posting." });
    const result = await pool.query(
      `INSERT INTO community_post_comments (id,post_id,author_user_id,body)
       SELECT $1,post.id,$4,$5 FROM community_posts post WHERE post.id=$2 AND post.department_id=$3
       RETURNING id,post_id AS "postId",body,author_user_id AS "authorId",created_at AS "createdAt"`,
      [randomUUID(), request.params.postId, departmentId, request.authenticatedUser!.id, body],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "This post could not be found." });
    const author = await pool.query("SELECT display_name FROM app_users WHERE id=$1", [request.authenticatedUser!.id]);
    const comment = { ...result.rows[0], authorName: author.rows[0].display_name };
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
