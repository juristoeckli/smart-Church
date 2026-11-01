import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ModuleServerContext } from '../module-sdk.js';
type Access = (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
type DeviceAccess = (request: FastifyRequest, reply: FastifyReply, id: string) => Promise<{id:string;department_id:string}|null>;
import {registerSignagePairing} from "./pairing.js";
import {signageControl} from './control.js';
const idParams = {type:'object',required:['id'],properties:{id:{type:'string',format:'uuid'}}};

export function registerSignageSystem(routes: FastifyInstance, context: ModuleServerContext, manager: Access, device: DeviceAccess, admin: Access) {
 const {pool,validateMutation}=context;
 const control=signageControl(routes,context,device);
 const uploads=new Set<FastifyRequest>();
 routes.addHook('onResponse',async request=>{uploads.delete(request);});
 routes.addHook('onRequestAbort',async request=>{uploads.delete(request);});
 const uploadAccess=async(request:FastifyRequest,reply:FastifyReply)=>{
  if(context.authenticate){
   if(!await context.authenticate(request,reply)||!await manager(request,reply))return reply;
   if(!validateMutation(request,reply))return reply;
  }
  if(uploads.size>=2)return reply.header('Retry-After','5').code(429).send({error:'Two media uploads are already in progress. Try again shortly.'});
  uploads.add(request);
 };
 routes.get('/api/signage/settings',async(request,reply)=>{const site=await manager(request,reply);if(!site)return reply;return (await pool!.query('SELECT name,time_zone AS "timeZone" FROM departments WHERE id=$1',[site])).rows[0];});
 routes.post<{Params:{id:string};Body:{expectedVersion?:number}|undefined}>('/api/signage/shows/:id/publish',{preValidation:async request=>{request.body??={};},schema:{params:idParams,body:{type:'object',additionalProperties:false,properties:{expectedVersion:{type:'integer',minimum:1}}}}},async(request,reply)=>{
  if(!validateMutation(request,reply))return reply;const site=await manager(request,reply);if(!site)return reply;
  const result=await pool!.query(`UPDATE signage_shows SET published_title=title,published_slides=slides,published_draft_version=draft_version,published_at=now(),revision=revision+1 WHERE id=$1 AND department_id=$2 AND jsonb_array_length(slides)>0 AND ($3::integer IS NULL OR draft_version=$3) RETURNING revision`,[request.params.id,site,request.body?.expectedVersion??null]);
  return result.rowCount?result.rows[0]:reply.code(409).send({error:'The draft was changed or removed. Reload and review the current draft before publishing.'});
 });
 routes.get('/api/signage/media',async(request,reply)=>{const site=await manager(request,reply);if(!site)return reply;return (await pool!.query('SELECT id,name,content_type AS "contentType",size FROM signage_media WHERE department_id=$1 ORDER BY created_at DESC',[site])).rows;});
 routes.addContentTypeParser('application/vnd.smart-church.signage-media',{parseAs:'buffer',bodyLimit:100*1024*1024},(_req,body,done)=>done(null,body));
 routes.post<{Body:Buffer;Querystring:{name:string;type:string}}>('/api/signage/media',{onRequest:uploadAccess,bodyLimit:100*1024*1024,schema:{querystring:{type:'object',required:['name','type'],properties:{name:{type:'string',minLength:1,maxLength:160},type:{type:'string',enum:['image/png','image/jpeg','image/webp','video/mp4','video/webm']}}}}},async(request,reply)=>{
  if(!validateMutation(request,reply))return reply;const site=await manager(request,reply);if(!site)return reply;
  if(!Buffer.isBuffer(request.body)||!request.body.length)return reply.code(400).send({error:'Choose an image or video.'});
  const b=request.body,t=request.query.type;
  const valid=t==='image/png'?b.length>=45&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.toString('ascii',12,16)==='IHDR'&&b.readUInt32BE(16)>0&&b.readUInt32BE(20)>0&&b.readUInt32BE(16)<=8192&&b.readUInt32BE(20)<=8192:t==='image/jpeg'?b.length>=4&&b[0]===255&&b[1]===216&&b[b.length-2]===255&&b[b.length-1]===217:t==='image/webp'?b.length>=20&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'&&b.readUInt32LE(4)+8===b.length:t==='video/mp4'?b.length>=24&&b.toString('ascii',4,8)==='ftyp':b.length>=32&&b.subarray(0,4).equals(Buffer.from([26,69,223,163]));
  if(!valid)return reply.code(400).send({error:'The file content does not match its media type.'});
  const client=await pool!.connect();try{await client.query('BEGIN');
   if(!await context.lockDepartmentForWrite(client,site)){await client.query('ROLLBACK');return reply.code(423).send({error:'This site is read-only.'});}
   await client.query('SELECT id FROM departments WHERE id=$1 FOR UPDATE',[site]);
   const inventory=(await client.query('SELECT coalesce(sum(size),0) AS bytes,count(*) AS files FROM signage_media WHERE department_id=$1',[site])).rows[0];
   if(Number(inventory.bytes)+b.length>2*1024*1024*1024||Number(inventory.files)>=500){await client.query('ROLLBACK');return reply.code(413).send({error:'The signage media library has reached its limit of 2 GB or 500 files. Remove unused files before uploading more.'});}
   const result=await client.query('INSERT INTO signage_media(id,department_id,name,content_type,size,data) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[randomUUID(),site,request.query.name.trim()||'Media',t,b.length,b]);await client.query('COMMIT');return reply.code(201).send(result.rows[0]);
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 });
 routes.get<{Params:{id:string}}>('/api/signage/media/:id',{schema:{params:idParams}},async(request,reply)=>{const site=await manager(request,reply);if(!site)return reply;const row=(await pool!.query('SELECT content_type,data FROM signage_media WHERE id=$1 AND department_id=$2',[request.params.id,site])).rows[0];return row?reply.header('Cache-Control','no-store').type(row.content_type).send(row.data):reply.code(404).send({error:'Media not found.'});});
 routes.delete<{Params:{id:string}}>('/api/signage/media/:id',{schema:{params:idParams}},async(request,reply)=>{
  if(!validateMutation(request,reply))return reply;const site=await manager(request,reply);if(!site)return reply;
  const used=await pool!.query(`SELECT id FROM signage_shows WHERE department_id=$1 AND (slides @> $2::jsonb OR published_slides @> $2::jsonb) LIMIT 1`,[site,JSON.stringify([{mediaId:request.params.id}])]);if(used.rowCount)return reply.code(409).send({error:'This media is used by a draft or published show. Remove it from the show first.'});
  try{const result=await pool!.query('DELETE FROM signage_media WHERE id=$1 AND department_id=$2',[request.params.id,site]);return result.rowCount?reply.code(204).send():reply.code(404).send({error:'Media not found.'});}
  catch(error){if((error as {code?:string}).code==='23503')return reply.code(409).send({error:'This media was added to a show. Remove it from the draft and published show first.'});throw error;}
 });
 routes.post<{Body:{name:string}}>('/api/signage/displays/provision',{schema:{body:{type:'object',additionalProperties:false,required:['name'],properties:{name:{type:'string',minLength:1,maxLength:120}}}}},async(request,reply)=>{
  if(!validateMutation(request,reply))return reply;const site=await admin(request,reply);if(!site)return reply;
  if(!request.body.name.trim())return reply.code(400).send({error:'Enter a display name.'});
  const name=request.body.name.trim();if(!name)return reply.code(400).send({error:'Enter a display name.'});
  const client=await pool!.connect();try{await client.query('BEGIN');const userId=randomUUID(),displayId=randomUUID();
   await client.query(`INSERT INTO app_users(id,email,username,display_name,password_hash,role,is_service_user,service_user_owner_id,is_enabled,can_change_password,must_change_password,server_permissions) VALUES($1,NULL,$2,$3,$4,'user',true,$5,true,false,false,'{}')`,[userId,`signage_${userId.replaceAll('-','').slice(0,24)}`,name.slice(0,100),randomBytes(64).toString('hex'),request.authenticatedUser!.id]);
   await client.query(`INSERT INTO department_memberships(user_id,department_id,role,permissions,module_permissions) VALUES($1,$2,'member','{}','{"signage":["display"]}')`,[userId,site]);
   await client.query('INSERT INTO signage_displays(id,department_id,service_user_id,name,managed_account) VALUES($1,$2,$3,$4,true)',[displayId,site,userId,name]);await client.query('COMMIT');return reply.code(201).send({id:displayId});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 });
 routes.put<{Params:{id:string};Body:{name:string;defaultShowId:string|null}}>('/api/signage/displays/:id/settings',{schema:{params:idParams,body:{type:'object',additionalProperties:false,required:['name','defaultShowId'],properties:{name:{type:'string',minLength:1,maxLength:120},defaultShowId:{type:['string','null'],format:'uuid'}}}}},async(request,reply)=>{
  if(!validateMutation(request,reply))return reply;const site=await admin(request,reply);if(!site)return reply;
  if(!request.body.name.trim())return reply.code(400).send({error:'Enter a display name.'});
  if(request.body.defaultShowId&&!(await pool!.query('SELECT id FROM signage_shows WHERE id=$1 AND department_id=$2 AND published_at IS NOT NULL',[request.body.defaultShowId,site])).rowCount)return reply.code(400).send({error:'Publish the default show first.'});
  const result=await pool!.query('UPDATE signage_displays SET name=$3,default_show_id=$4 WHERE id=$1 AND department_id=$2 RETURNING id',[request.params.id,site,request.body.name.trim(),request.body.defaultShowId]);return result.rowCount?result.rows[0]:reply.code(404).send({error:'Display not found.'});
 });
 registerSignagePairing(routes,context,admin);
 routes.post<{Params:{id:string}}>('/api/signage/displays/:id/fullscreen',{schema:{params:idParams}},async(request,reply)=>{
  if(!validateMutation(request,reply))return reply;const site=await manager(request,reply);if(!site)return reply;
  const result=await pool!.query('UPDATE signage_displays SET fullscreen_version=fullscreen_version+1 WHERE id=$1 AND department_id=$2 RETURNING id,service_user_id,fullscreen_version',[request.params.id,site]);
  if(result.rowCount)control.fullscreen(site,result.rows[0].service_user_id,result.rows[0].id,result.rows[0].fullscreen_version);
  return result.rowCount?{ok:true}:reply.code(404).send({error:'Display not found.'});
 });
 routes.post<{Params:{id:string}}>('/api/signage/displays/:id/reload',{schema:{params:idParams}},async(request,reply)=>{
  if(!validateMutation(request,reply))return reply;const site=await manager(request,reply);if(!site)return reply;
  const result=await pool!.query('UPDATE signage_displays SET reload_version=reload_version+1 WHERE id=$1 AND department_id=$2 RETURNING id,service_user_id,reload_version',[request.params.id,site]);
  if(result.rowCount)control.reload(site,result.rows[0].service_user_id,result.rows[0].id,result.rows[0].reload_version);
  return result.rowCount?{ok:true}:reply.code(404).send({error:'Display not found.'});
 });
 async function plan(site:string,id:string){
  const client=await pool!.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const shows=(await client.query(`SELECT id,published_title AS title,published_slides AS slides,revision FROM signage_shows WHERE department_id=$1 AND published_at IS NOT NULL AND (id=(SELECT default_show_id FROM signage_displays WHERE id=$2 AND department_id=$1) OR id IN(SELECT show_id FROM signage_schedules WHERE display_id=$2 AND department_id=$1 AND ends_at>now() AND starts_at<now()+interval '7 days'))`,[site,id])).rows;
  const display=(await client.query('SELECT default_show_id FROM signage_displays WHERE id=$1 AND department_id=$2',[id,site])).rows[0];
  if(!display){await client.query('COMMIT');return null;}
  const schedules=(await client.query(`SELECT show_id AS "showId",starts_at AS "startsAt",ends_at AS "endsAt" FROM signage_schedules WHERE display_id=$1 AND department_id=$2 AND ends_at>now() AND starts_at<now()+interval '7 days' ORDER BY starts_at DESC`,[id,site])).rows;
  const ids=[...new Set(shows.flatMap(show=>show.slides.map((slide:{mediaId?:string})=>slide.mediaId).filter(Boolean)))];
  const media=(await client.query('SELECT id,size,sha256,content_type AS "contentType" FROM signage_media WHERE department_id=$1 AND id=ANY($2::uuid[])',[site,ids])).rows;
  await client.query('COMMIT');return {shows,schedules,media,defaultShowId:display.default_show_id,serverTime:new Date().toISOString(),validUntil:new Date(Date.now()+7*86400000).toISOString()};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 routes.get<{Params:{id:string}}>('/api/signage/device/:id/plan',{schema:{params:idParams}},async(request,reply)=>{const display=await device(request,reply,request.params.id);if(!display)return reply;const result=await plan(display.department_id,display.id);return result??reply.code(404).send({error:'Display not found.'});});
 routes.get<{Params:{id:string;mediaId:string}}>('/api/signage/device/:id/media/:mediaId',{schema:{params:{type:'object',required:['id','mediaId'],properties:{id:{type:'string',format:'uuid'},mediaId:{type:'string',format:'uuid'}}}}},async(request,reply)=>{
  const display=await device(request,reply,request.params.id);if(!display)return reply;const playback=await plan(display.department_id,display.id);
  if(!playback?.shows.some(show=>show.slides.some((slide:{mediaId?:string})=>slide.mediaId===request.params.mediaId)))return reply.code(403).send({error:'This media is not assigned to this display.'});
  const row=(await pool!.query('SELECT content_type,data FROM signage_media WHERE id=$1 AND department_id=$2',[request.params.mediaId,display.department_id])).rows[0];return row?reply.type(row.content_type).header('Cache-Control','no-store').send(row.data):reply.code(404).send({error:'Media not found.'});
 });
}
