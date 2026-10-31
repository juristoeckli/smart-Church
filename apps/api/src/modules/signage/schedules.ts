import {randomUUID} from 'node:crypto';
import type {ModuleServerContext} from '../module-sdk.js';
export const scheduleBody = {type:'object',additionalProperties:false,required:['displayId','showId','startsAt','endsAt'],properties:{displayId:{type:'string',format:'uuid'},showId:{type:'string',format:'uuid'},startsAt:{type:'string',format:'date-time'},endsAt:{type:'string',format:'date-time'}}};
export type ScheduleInput = {displayId:string;showId:string;startsAt:string;endsAt:string};
export async function saveSchedule(context:ModuleServerContext,site:string,input:ScheduleInput,id?:string) {
 if(!Number.isFinite(Date.parse(input.startsAt))||!Number.isFinite(Date.parse(input.endsAt))||Date.parse(input.endsAt)<=Date.parse(input.startsAt))return {status:400,error:'The schedule end must be after its start.'};
 const client=await context.pool!.connect();
 try{
  await client.query('BEGIN');
  if(!await context.lockDepartmentForWrite(client,site)){await client.query('ROLLBACK');return {status:423,error:'This site is read-only.'};}
  // Serialize changes at the site boundary, including moves between screens.
  await client.query('SELECT id FROM departments WHERE id=$1 FOR UPDATE',[site]);
  const display=await client.query('SELECT id FROM signage_displays WHERE department_id=$1 AND id=$2',[site,input.displayId]);
  const show=await client.query('SELECT id FROM signage_shows WHERE department_id=$1 AND id=$2 AND published_at IS NOT NULL',[site,input.showId]);
  if(!display.rowCount||!show.rowCount){await client.query('ROLLBACK');return {status:400,error:'Choose a display and a published show from this location.'};}
  if(id&&!(await client.query('SELECT id FROM signage_schedules WHERE department_id=$1 AND id=$2 FOR UPDATE',[site,id])).rowCount){await client.query('ROLLBACK');return {status:404,error:'Schedule not found.'};}
  const overlap=await client.query('SELECT id FROM signage_schedules WHERE department_id=$1 AND display_id=$2 AND starts_at<$4 AND ends_at>$3 AND ($5::uuid IS NULL OR id<>$5)',[site,input.displayId,input.startsAt,input.endsAt,id??null]);
  if(overlap.rowCount){await client.query('ROLLBACK');return {status:409,error:'This display already has a show scheduled during that time. Choose another time or edit the existing schedule.'};}
  const savedId=id??randomUUID();
  if(id)await client.query('UPDATE signage_schedules SET display_id=$3,show_id=$4,starts_at=$5,ends_at=$6 WHERE department_id=$1 AND id=$2',[site,id,input.displayId,input.showId,input.startsAt,input.endsAt]);
  else await client.query('INSERT INTO signage_schedules(id,department_id,display_id,show_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6)',[savedId,site,input.displayId,input.showId,input.startsAt,input.endsAt]);
  await client.query('COMMIT');return {status:id?200:201,id:savedId};
 }catch(error){await client.query('ROLLBACK');if((error as {code?:string}).code==='23503')return {status:409,error:'A selected display or show was removed. Refresh and try again.'};throw error;}finally{client.release();}
}
