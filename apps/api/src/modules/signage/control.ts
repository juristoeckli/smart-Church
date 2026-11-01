import {randomBytes} from 'node:crypto';
import type {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
import type {ModuleServerContext} from '../module-sdk.js';
import {RealtimeHub, websocketRequestProtocol} from '../../realtime.js';

type DeviceAccess = (request:FastifyRequest,reply:FastifyReply,id:string)=>Promise<{id:string;department_id:string}|null>;
export function signageControl(routes:FastifyInstance,context:ModuleServerContext,device:DeviceAccess) {
 const tickets=new Map<string,{id:string;role:string;departmentId:string;expires:number}>();
 const hub=new RealtimeHub(routes.server,async request=>{
  const token=new URL(request.url!,'http://localhost').searchParams.get('ticket')||'';
  const ticket=tickets.get(token);tickets.delete(token);
  return ticket&&ticket.expires>Date.now()?ticket:null;
 },async(identity,departmentId)=>{
  const result=await context.pool!.query(`SELECT 1 FROM signage_displays d JOIN departments site ON site.id=d.department_id JOIN app_users u ON u.id=d.service_user_id JOIN department_memberships m ON m.user_id=u.id AND m.department_id=d.department_id WHERE u.id=$1 AND d.department_id=$2 AND u.api_key_hash=$3 AND u.is_enabled AND u.is_service_user AND m.module_permissions->'signage' ? 'display' AND site.enabled_modules @> ARRAY['signage']::text[]`,[identity.id,departmentId,identity.role]);
  return !!result.rowCount;
 },(request,origin)=>{
  try{return !!origin&&new URL(origin).host===request.headers.host&&new URL(origin).protocol===websocketRequestProtocol(request)+':';}catch{return false;}
 },{path:'/api/signage/control',revalidate:true});
 routes.addHook('preClose',async()=>{hub.close();tickets.clear();});
 routes.get<{Params:{id:string}}>('/api/signage/device/:id/control-ticket',{schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',format:'uuid'}}}}},async(request,reply)=>{
  const display=await device(request,reply,request.params.id);if(!display)return reply;
  for(const [token,ticket] of tickets)if(ticket.expires<=Date.now()||ticket.id===request.authenticatedUser!.id)tickets.delete(token);
  if(tickets.size>=1000)return reply.code(429).send({error:'Try connecting again shortly.'});
  const account=(await context.pool!.query('SELECT api_key_hash FROM app_users WHERE id=$1',[request.authenticatedUser!.id])).rows[0];
  if(!account?.api_key_hash)return reply.code(403).send({error:'Pair this display first.'});
  const token=randomBytes(32).toString('base64url');
  tickets.set(token,{id:request.authenticatedUser!.id,role:account.api_key_hash,departmentId:display.department_id,expires:Date.now()+30000});
  return reply.header('Cache-Control','no-store').send({ticket:token});
 });
 return {
  changed:(departmentId:string)=>{
   hub.publish('signage:update',departmentId);
   context.realtime?.publish('signage:changed',departmentId);
  },
  reload:(departmentId:string,userId:string,displayId:string,reloadVersion:number)=>hub.publish('signage:reload',departmentId,{displayId,reloadVersion},userId),
  fullscreen:(departmentId:string,userId:string,displayId:string,fullscreenVersion:number,fullscreenAction='enter')=>hub.publish('signage:fullscreen',departmentId,{displayId,fullscreenVersion,fullscreenAction},userId),
 };
}
