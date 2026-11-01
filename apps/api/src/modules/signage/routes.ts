import { randomUUID } from "node:crypto";
import {saveSchedule, scheduleBody, type ScheduleInput} from "./schedules.js";
import { registerSignageSystem } from "./system.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

type Slide = { heading: string; body: string; duration?: number; mediaId?: string; url?: string; kind?: "text" | "image" | "video" | "webpage" };

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  app.register(async (routes) => {
    const mutationSites=new WeakMap<FastifyRequest,string>();
    routes.addHook('onResponse',async(request,reply)=>{
      const site=mutationSites.get(request);
      // Publish only after a successful handler has committed its changes.
      if(site&&reply.statusCode>=200&&reply.statusCode<300&&['POST','PUT','PATCH','DELETE'].includes(request.method)&&! /\/(reload|fullscreen|exit-fullscreen)(?:\?|$)/.test(request.url))control.changed(site);
    });
    routes.setErrorHandler((error,request,reply)=>{
      const code=(error as {code?:string}).code;
      if(code==='40P01'||code==='40001')return reply.code(409).send({error:'Another change was saved at the same time. Refresh and try again.'});
      if(code==='23503'||code==='23001')return reply.code(409).send({error:'A selected file, show, or display is in use or was removed. Refresh and try again.'});
      if(code==='23505')return reply.code(409).send({error:'This account or pairing code is already assigned. Refresh and try again.'});
      if(code==='23514'||code==='22P02')return reply.code(400).send({error:'Check the supplied name, file, and identifiers.'});
      const status=(error as {statusCode?:number}).statusCode??500;
      if(status>=500)request.log.error({err:error,module:'signage'},'Signage request failed.');
      return reply.code(status).send({error:status>=500?'Signage is temporarily unavailable. Try again.':(error as Error).message});
    });
    async function manager(request: FastifyRequest, reply: FastifyReply, requireAdmin = false) {
      if (!pool || !isDatabaseReady()) { reply.code(503).send({ error: "The signage database is unavailable." }); return null; }
      const departmentId = await resolveDepartmentId(request, reply);
      if (!departmentId) return null;
      if (request.authenticatedUser?.isServiceUser) { reply.code(403).send({error:"Use a person account to manage signage."}); return null; }
      const access = await pool.query<{ enabled_modules: string[]; role: string; module_permissions: Record<string, string[]> }>(
        `SELECT d.enabled_modules,m.role,m.module_permissions FROM departments d JOIN department_memberships m ON m.department_id=d.id WHERE d.id=$1 AND m.user_id=$2`,
        [departmentId, request.authenticatedUser?.id],
      );
      const row = access.rows[0];
      if (!row?.enabled_modules?.includes("signage")) { reply.code(404).send({ error: "Public signage is not enabled for this location." }); return null; }
      const grants = row.module_permissions?.signage ?? [];
      const isAdmin = row.role === "site_admin" || grants.includes("admin") || grants.includes("manage");
      if (!isAdmin && (requireAdmin || !grants.includes("operator"))) { reply.code(403).send({ error: requireAdmin ? "Signage Admin access is required." : "Signage Operator access is required." }); return null; }
      mutationSites.set(request,departmentId);
      return departmentId;
    }
    const admin = (request: FastifyRequest, reply: FastifyReply) => manager(request, reply, true);

    async function validSlides(site:string, slides:Slide[], reply:FastifyReply) {
      for(const slide of slides) {
        if(slide.kind==='webpage') {
          try { const url=new URL(slide.url||'');if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid URL'); }
          catch {reply.code(400).send({error:'Enter a valid HTTP or HTTPS webpage URL without login credentials.'});return false;}
        } else if(slide.url) {reply.code(400).send({error:'Only webpage slides may contain a URL.'});return false;}
      }
      if(slides.some(slide=>slide.mediaId && slide.kind!=='image' && slide.kind!=='video')){reply.code(400).send({error:'Choose Image or Video for slides containing media.'});return false;}
      if (slides.some(slide => (slide.kind === "image" || slide.kind === "video") && !slide.mediaId)) {reply.code(400).send({error:"Choose a media file for every image or video slide."});return false;}
      for(const slide of slides.filter(slide=>slide.mediaId)) {
        const media=(await pool!.query("SELECT content_type FROM signage_media WHERE department_id=$1 AND id=$2",[site,slide.mediaId])).rows[0];
        if(!media || !media.content_type.startsWith((slide.kind === "video" ? "video" : "image")+"/")) {reply.code(400).send({error:"Choose media of the correct type from this site's library."});return false;}
      }
      return true;
    }

    routes.get("/api/signage/shows", async (request, reply) => {
      const departmentId = await manager(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(`SELECT s.id,s.title,s.slides,s.published_at AS "publishedAt",s.revision,s.draft_version AS "draftVersion",s.published_draft_version AS "publishedDraftVersion",s.updated_at AS "updatedAt" FROM signage_shows s WHERE s.department_id=$1 ORDER BY lower(s.title)`, [departmentId]);
      return result.rows;
    });

    routes.post<{ Body: { title: string; slides: Slide[]; expectedVersion?: number } }>("/api/signage/shows", { schema: { body: { type: "object", additionalProperties: false, required: ["title", "slides"], properties: { expectedVersion: { type: "integer", minimum: 1 }, title: { type: "string", minLength: 1, maxLength: 160 }, slides: { type: "array", maxItems: 50, items: { type: "object", additionalProperties: false, required: ["heading", "body"], properties: { heading: { type: "string", maxLength: 160 }, body: { type: "string", maxLength: 4000 }, duration: { type: "integer", minimum: 3, maximum: 600 }, mediaId: { type: "string", format: "uuid" }, url: {type:"string",maxLength:2048}, kind: { type: "string", enum: ["text", "image", "video", "webpage"] } } } } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await manager(request, reply);
      if (!departmentId) return reply;
      const title = request.body.title.trim();
      if (!title || !request.body.slides.length) return reply.code(400).send({ error: "Add a title and at least one slide." });
      if(!await validSlides(departmentId,request.body.slides,reply))return reply;
      const result = await pool!.query(`INSERT INTO signage_shows(id,department_id,title,slides) VALUES($1,$2,$3,$4) RETURNING id,title,slides,draft_version AS "draftVersion",updated_at AS "updatedAt"`, [randomUUID(), departmentId, title, JSON.stringify(request.body.slides)]);
      return reply.code(201).send(result.rows[0]);
    });

    routes.put<{ Params: { id: string }; Body: { title: string; slides: Slide[]; expectedVersion?: number } }>("/api/signage/shows/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["title", "slides"], properties: { expectedVersion: { type: "integer", minimum: 1 }, title: { type: "string", minLength: 1, maxLength: 160 }, slides: { type: "array", minItems: 1, maxItems: 50, items: { type: "object", additionalProperties: false, required: ["heading", "body"], properties: { heading: { type: "string", maxLength: 160 }, body: { type: "string", maxLength: 4000 }, duration: { type: "integer", minimum: 3, maximum: 600 }, mediaId: { type: "string", format: "uuid" }, url: {type:"string",maxLength:2048}, kind: { type: "string", enum: ["text", "image", "video", "webpage"] } } } } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await manager(request, reply);
      if (!departmentId) return reply;
      if(!request.body.title.trim())return reply.code(400).send({error:"Enter a show name."});
      if(!await validSlides(departmentId,request.body.slides,reply))return reply;
      const result = await pool!.query(`UPDATE signage_shows SET title=$3,slides=$4,draft_version=draft_version+1,updated_at=now() WHERE department_id=$1 AND id=$2 AND ($5::integer IS NULL OR draft_version=$5) RETURNING id,title,slides,draft_version AS "draftVersion",updated_at AS "updatedAt"`, [departmentId, request.params.id, request.body.title.trim(), JSON.stringify(request.body.slides),request.body.expectedVersion??null]);
      if (!result.rowCount) return reply.code(409).send({ error: "This show was changed or removed. Reload it before saving again." });
      return result.rows[0];
    });

    routes.delete<{ Params: { id: string } }>("/api/signage/shows/:id", async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await manager(request, reply);
      if (!departmentId) return reply;
      const client=await pool!.connect();try{await client.query('BEGIN');
        if(!await context.lockDepartmentForWrite(client,departmentId)){await client.query('ROLLBACK');return reply.code(423).send({error:'This site is read-only.'});}
        await client.query('SELECT id FROM departments WHERE id=$1 FOR UPDATE',[departmentId]);
        await client.query("UPDATE signage_displays SET default_show_id=NULL WHERE department_id=$1 AND default_show_id=$2", [departmentId, request.params.id]);
        const result = await client.query("DELETE FROM signage_shows WHERE department_id=$1 AND id=$2", [departmentId, request.params.id]);
        if(!result.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Show not found.'});}
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
      return reply.code(204).send();
    });

    routes.get("/api/signage/displays", async (request, reply) => {
      const departmentId = await manager(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(`SELECT d.id,d.name,d.default_show_id AS "defaultShowId",d.fullscreen_state AS "fullscreenState",d.display_metrics AS "displayMetrics",d.clock_offset_ms AS "clockOffsetMs",d.clock_round_trip_ms AS "clockRoundTripMs",d.player_version AS "playerVersion",d.playback_error AS "playbackError",d.download_progress AS "downloadProgress",d.current_show_id AS "currentShowId",d.service_user_id AS "serviceUserId",u.display_name AS "serviceUserName",installation_type AS "installationType",host(last_ip_address) AS "lastIpAddress",last_seen_at AS "lastSeenAt",uptime_seconds AS "uptimeSeconds",d.created_at AS "createdAt" FROM signage_displays d JOIN app_users u ON u.id=d.service_user_id WHERE d.department_id=$1 ORDER BY lower(d.name)`, [departmentId]);
      return result.rows;
    });

    routes.get("/api/signage/service-accounts", async (request, reply) => {
      const departmentId = await admin(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(`SELECT u.id,u.display_name AS "displayName" FROM app_users u JOIN department_memberships m ON m.user_id=u.id AND m.department_id=$1 WHERE u.is_service_user AND u.is_enabled AND u.api_key_hash IS NOT NULL AND m.module_permissions->'signage' ? 'display' ORDER BY lower(u.display_name)`, [departmentId]);
      return result.rows;
    });

    routes.post<{ Body: { name: string; serviceUserId: string } }>("/api/signage/displays", { schema: { body: { type: "object", additionalProperties: false, required: ["name", "serviceUserId"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, serviceUserId: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await admin(request, reply);
      if (!departmentId) return reply;
      const authorizedAccount = await pool!.query(`SELECT u.id FROM app_users u JOIN department_memberships m ON m.user_id=u.id AND m.department_id=$2 WHERE u.id=$1 AND u.is_service_user AND u.is_enabled AND u.api_key_hash IS NOT NULL AND m.module_permissions->'signage' ? 'display'`, [request.body.serviceUserId, departmentId]);
      if (!authorizedAccount.rowCount) return reply.code(400).send({ error: "Choose an enabled service account with an API key and signage display access at this location." });
      const result = await pool!.query(`INSERT INTO signage_displays(id,department_id,service_user_id,name) VALUES($1,$2,$3,$4) RETURNING id,name,service_user_id AS "serviceUserId"`, [randomUUID(), departmentId, request.body.serviceUserId, request.body.name.trim()]);
      return reply.code(201).send(result.rows[0]);
    });

    routes.delete<{ Params: { id: string } }>("/api/signage/displays/:id", async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await admin(request, reply);
      if (!departmentId) return reply;
      const client=await pool!.connect();try{await client.query("BEGIN");
        const result=await client.query("DELETE FROM signage_displays WHERE department_id=$1 AND id=$2 RETURNING service_user_id,managed_account",[departmentId,request.params.id]);
        if(!result.rowCount){await client.query("ROLLBACK");return reply.code(404).send({error:"Display not found."});}
        await client.query("UPDATE app_users SET is_enabled=CASE WHEN $2 THEN false ELSE is_enabled END,api_key_hash=NULL WHERE id=$1",[result.rows[0].service_user_id,result.rows[0].managed_account]);
        await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
      return reply.code(204).send();
    });

    routes.get("/api/signage/schedules", async (request, reply) => {
      const departmentId = await manager(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(`SELECT s.id,s.display_id AS "displayId",d.name AS "displayName",s.show_id AS "showId",h.title AS "showTitle",s.starts_at AS "startsAt",s.ends_at AS "endsAt" FROM signage_schedules s JOIN signage_displays d ON d.department_id=s.department_id AND d.id=s.display_id JOIN signage_shows h ON h.department_id=s.department_id AND h.id=s.show_id WHERE s.department_id=$1 ORDER BY s.starts_at DESC LIMIT 250`, [departmentId]);
      return result.rows;
    });

    routes.post<{Body:ScheduleInput}>("/api/signage/schedules", {schema:{body:scheduleBody}}, async(request,reply)=>{
      if(!validateMutation(request,reply))return reply;
      const site=await manager(request,reply);if(!site)return reply;
      const {status,...result}=await saveSchedule(context,site,request.body);
      return reply.code(status).send(result);
    });
    routes.put<{Params:{id:string};Body:ScheduleInput}>("/api/signage/schedules/:id", {schema:{params:{type:"object",required:["id"],properties:{id:{type:"string",format:"uuid"}}},body:scheduleBody}}, async(request,reply)=>{
      if(!validateMutation(request,reply))return reply;
      const site=await manager(request,reply);if(!site)return reply;
      const {status,...result}=await saveSchedule(context,site,request.body,request.params.id);
      return reply.code(status).send(result);
    });
    routes.delete<{ Params: { id: string } }>("/api/signage/schedules/:id", async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await manager(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query("DELETE FROM signage_schedules WHERE department_id=$1 AND id=$2", [departmentId, request.params.id]);
      if (!result.rowCount) return reply.code(404).send({ error: "Schedule not found." });
      return reply.code(204).send();
    });

    async function serviceAccountDisplay(request: FastifyRequest, reply: FastifyReply, displayId: string) {
      if (!pool || !isDatabaseReady() || !request.authenticatedUser) { reply.code(401).send({ error: "Sign in with this display's service account." }); return null; }
      const departmentId = await resolveDepartmentId(request, reply);
      if (!departmentId) return null;
      const result = await pool.query<{ id: string; department_id: string }>(`SELECT d.id,d.department_id FROM signage_displays d JOIN departments site ON site.id=d.department_id JOIN app_users u ON u.id=d.service_user_id AND u.is_service_user AND u.is_enabled JOIN department_memberships m ON m.user_id=u.id AND m.department_id=d.department_id WHERE d.id=$1 AND d.department_id=$2 AND d.service_user_id=$3 AND m.module_permissions->'signage' ? 'display' AND site.enabled_modules @> ARRAY['signage']::text[]`, [displayId, departmentId, request.authenticatedUser.id]);
      if (!result.rows[0]) { reply.code(403).send({ error: "This service account is not assigned to that signage display." }); return null; }
      return result.rows[0];
    }

    const control=registerSignageSystem(routes, context, manager, serviceAccountDisplay, admin);
    routes.get<{ Params: { displayId: string } }>("/api/signage/device/:displayId/current", { schema: { params: { type: "object", required: ["displayId"], properties: { displayId: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const display = await serviceAccountDisplay(request, reply, request.params.displayId);
      if (!display) return reply;
      const result = await pool!.query(`SELECT s.id,s.published_title AS title,s.published_slides AS slides,s.revision,s.published_at AS "updatedAt" FROM signage_shows s WHERE s.department_id=$1 AND s.published_at IS NOT NULL AND s.id=COALESCE((SELECT sc.show_id FROM signage_schedules sc WHERE sc.department_id=$1 AND sc.display_id=$2 AND sc.starts_at<=now() AND sc.ends_at>now() ORDER BY sc.starts_at DESC LIMIT 1),(SELECT default_show_id FROM signage_displays WHERE department_id=$1 AND id=$2))`, [display.department_id, display.id]);
      return { displayId: display.id, show: result.rows[0] ?? null, serverTime: new Date().toISOString() };
    });

    routes.post<{ Params: { displayId: string }; Body: { installationType: string; uptimeSeconds: number; playerVersion?: string; playbackError?: string; currentShowId?: string; downloadProgress?: number; clockOffsetMs?: number; clockRoundTripMs?: number; fullscreenState?: string; displayMetrics?: {screenWidth:number;screenHeight:number;viewportWidth:number;viewportHeight:number;pixelRatio:number} } }>("/api/signage/device/:displayId/heartbeat", { schema: { params: { type: "object", required: ["displayId"], properties: { displayId: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["installationType", "uptimeSeconds"], properties: { installationType: { type: "string", minLength: 1, maxLength: 80 }, uptimeSeconds: { type: "integer", minimum: 0, maximum: 2147483647 }, playerVersion: { type: "string", maxLength: 40 }, playbackError: { type: "string", maxLength: 1000 }, currentShowId: { type: "string", maxLength: 80 }, downloadProgress: { type: "integer", minimum: 0, maximum: 100 }, clockOffsetMs: { type: "number", minimum: -1e15, maximum: 1e15 }, clockRoundTripMs: { type: "number", minimum: 0, maximum: 120000 }, fullscreenState: {type:"string",enum:["active","windowed","pending","blocked","unsupported"]}, displayMetrics:{type:"object",additionalProperties:false,required:["screenWidth","screenHeight","viewportWidth","viewportHeight","pixelRatio"],properties:{screenWidth:{type:"integer",minimum:0,maximum:100000},screenHeight:{type:"integer",minimum:0,maximum:100000},viewportWidth:{type:"integer",minimum:0,maximum:100000},viewportHeight:{type:"integer",minimum:0,maximum:100000},pixelRatio:{type:"number",minimum:0.1,maximum:20}}} } } } }, async (request, reply) => {
      const display = await serviceAccountDisplay(request, reply, request.params.displayId);
      if (!display) return reply;
      const ip = request.ip;
      if (await context.isDepartmentWritable(display.department_id)) {
        await pool!.query(`UPDATE signage_displays SET installation_type=$3,last_ip_address=CASE WHEN $4::inet IS NULL THEN last_ip_address ELSE $4::inet END,last_seen_at=now(),uptime_seconds=$5,player_version=$6,playback_error=$7,current_show_id=$8,download_progress=$9,clock_offset_ms=$10,clock_round_trip_ms=$11,fullscreen_state=$12,display_metrics=$13,updated_at=now() WHERE id=$1 AND department_id=$2`, [display.id, display.department_id, request.body.installationType, ip, request.body.uptimeSeconds,request.body.playerVersion ?? null,request.body.playbackError ?? null,request.body.currentShowId ?? null,request.body.downloadProgress ?? null,request.body.clockOffsetMs ?? null,request.body.clockRoundTripMs ?? null,request.body.fullscreenState ?? null,request.body.displayMetrics?JSON.stringify(request.body.displayMetrics):null]);
      }
      context.realtime?.publish("signage:status",display.department_id,{displayId:display.id});
      const command=(await pool!.query('SELECT reload_version,fullscreen_version,fullscreen_action FROM signage_displays WHERE id=$1 AND department_id=$2',[display.id,display.department_id])).rows[0];
      return reply.header("Cache-Control","no-store").send({ ok: true, serverTime: new Date().toISOString(),reloadVersion:command?.reload_version??0,fullscreenVersion:command?.fullscreen_version??0,fullscreenAction:command?.fullscreen_action??"enter" });
    });
  });
}
