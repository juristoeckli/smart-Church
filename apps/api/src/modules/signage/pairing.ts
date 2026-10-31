import {createHash,randomBytes} from 'node:crypto';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {ModuleServerContext} from '../module-sdk.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const codeSchema={type:'string',minLength:8,maxLength:9,pattern:'^[A-HJ-NP-Za-hj-np-z2-9-]+$'};
export function registerSignagePairing(routes:FastifyInstance,context:ModuleServerContext,admin:(request:FastifyRequest,reply:FastifyReply)=>Promise<string|null>){
 const {pool}=context;
 async function limit(request:FastifyRequest,reply:FastifyReply,kind:string,maximum:number){
  if(!pool||!context.isDatabaseReady()){reply.code(503).send({error:'Signage is unavailable.'});return false;}
  const result=await pool.query(`INSERT INTO signage_pairing_attempts(bucket,attempts,resets_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN signage_pairing_attempts.resets_at<=now() THEN 1 ELSE signage_pairing_attempts.attempts+1 END,resets_at=CASE WHEN signage_pairing_attempts.resets_at<=now() THEN now()+interval '15 minutes' ELSE signage_pairing_attempts.resets_at END RETURNING attempts`,[kind+':'+hash(request.ip)]);
  if(result.rows[0].attempts>maximum){reply.header('Retry-After','900').code(429).send({error:'Too many pairing requests. Try again in 15 minutes.'});return false;}return true;
 }
 routes.post('/api/public/signage/pairing/start',async(request,reply)=>{
  if(!await limit(request,reply,'start',60))return reply;
  await pool!.query('DELETE FROM signage_pairing_sessions WHERE expires_at<now()');
  await pool!.query('DELETE FROM signage_pairing_attempts WHERE resets_at<now()');
  const alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  for(let attempt=0;attempt<3;attempt++){
   const code=Array.from(randomBytes(8),value=>alphabet[value%32]).join('');
   const pairingToken=randomBytes(32).toString('base64url'),apiKey='sc_'+randomBytes(32).toString('base64url');
   try{
    const row=(await pool!.query(`INSERT INTO signage_pairing_sessions(token_hash,code_hash,credential_hash,expires_at) VALUES($1,$2,$3,now()+interval '15 minutes') RETURNING expires_at AS "expiresAt"`,[hash(pairingToken),hash(code),hash(apiKey)])).rows[0];
    return reply.header('Cache-Control','no-store').code(201).send({code:code.slice(0,4)+'-'+code.slice(4),pairingToken,apiKey,expiresAt:row.expiresAt});
   }catch(error){if((error as {code?:string}).code!=='23505')throw error;}
  }
  return reply.code(503).send({error:'Could not create a pairing code. Try again.'});
 });
 routes.post<{Params:{id:string};Body:{code:string}}>('/api/signage/displays/:id/pairing',{schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',format:'uuid'}}},body:{type:'object',additionalProperties:false,required:['code'],properties:{code:codeSchema}}}},async(request,reply)=>{
  if(!context.validateMutation(request,reply))return reply;const site=await admin(request,reply);if(!site)return reply;
  if(!await limit(request,reply,'confirm',20))return reply;
  const client=await pool!.connect();try{await client.query('BEGIN');
   if(!await context.lockDepartmentForWrite(client,site)){await client.query('ROLLBACK');return reply.code(423).send({error:'This site is read-only.'});}
   const display=(await client.query('SELECT id,service_user_id FROM signage_displays WHERE department_id=$1 AND id=$2 FOR UPDATE',[site,request.params.id])).rows[0];
   if(!display){await client.query('ROLLBACK');return reply.code(404).send({error:'Display not found.'});}
   const session=(await client.query('SELECT * FROM signage_pairing_sessions WHERE code_hash=$1 AND display_id IS NULL AND expires_at>now() FOR UPDATE',[hash(request.body.code.replaceAll('-','').toUpperCase())])).rows[0];
   if(!session){await client.query('ROLLBACK');return reply.code(400).send({error:'This screen code is invalid, expired, or already used. Enter the code currently shown on the screen.'});}
   const changed=await client.query(`UPDATE app_users u SET api_key_hash=$2 WHERE id=$1 AND is_service_user AND is_enabled AND EXISTS(SELECT 1 FROM department_memberships m WHERE m.user_id=u.id AND m.department_id=$3 AND m.module_permissions->'signage' ? 'display') RETURNING id`,[display.service_user_id,session.credential_hash,site]);
   if(!changed.rowCount){await client.query('ROLLBACK');return reply.code(403).send({error:'Display access has been revoked.'});}
   await client.query('UPDATE signage_pairing_sessions SET display_id=$2,code_hash=NULL,confirmed_at=now() WHERE token_hash=$1',[session.token_hash,display.id]);
   await client.query('COMMIT');return reply.header('Cache-Control','no-store').send({ok:true});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 });
 routes.post<{Body:{pairingToken:string}}>('/api/public/signage/pairing/status',{schema:{body:{type:'object',additionalProperties:false,required:['pairingToken'],properties:{pairingToken:{type:'string',minLength:43,maxLength:43,pattern:'^[A-Za-z0-9_-]+$'}}}}},async(request,reply)=>{
  if(!await limit(request,reply,'status',6000))return reply;
  const session=(await pool!.query(`SELECT p.display_id AS "displayId",d.department_id AS "departmentId" FROM signage_pairing_sessions p LEFT JOIN signage_displays d ON d.id=p.display_id WHERE p.token_hash=$1 AND p.expires_at>now()`,[hash(request.body.pairingToken)])).rows[0];
  reply.header('Cache-Control','no-store');
  if(!session)return reply.code(410).send({error:'The screen code expired. A new code will appear automatically.'});
  return session.displayId?{status:'connected',displayId:session.displayId,departmentId:session.departmentId}:reply.header('Retry-After','3').code(202).send({status:'waiting'});
 });
 routes.post('/api/public/signage/pair',async(_request,reply)=>reply.code(410).send({error:'Refresh the player. Enter the code shown by the display in Signage → Displays.'}));
}
