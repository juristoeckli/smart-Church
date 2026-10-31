export function localDateTime(value:string,timeZone:string) {
 const parts=new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
 const part=(type:string)=>parts.find(item=>item.type===type)?.value;
 return part('year')+'-'+part('month')+'-'+part('day')+'T'+part('hour')+':'+part('minute');
}
export function localToIso(value:string,timeZone:string) {
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('Choose a start and end time.');
 const target=Date.parse(value+'Z');let instant=target;
 if(!Number.isFinite(target))throw new Error('Choose a valid date and time.');
 for(let i=0;i<4;i++){
  const local=Date.parse(localDateTime(new Date(instant).toISOString(),timeZone)+':00Z');
  const difference=target-local;
  if(!difference){
   // Choose the first occurrence of repeated wall-clock times when DST ends.
   for(let minutes=180;minutes>=15;minutes-=15){const earlier=instant-minutes*60000;if(localDateTime(new Date(earlier).toISOString(),timeZone)===value)return new Date(earlier).toISOString();}
   return new Date(instant).toISOString();
  }
  instant+=difference;
 }
 throw new Error("This time does not exist in the site's timezone. Choose another time.");
}
