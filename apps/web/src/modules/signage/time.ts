import type {DateTimeFormat} from '@smart-church/contracts';

export function formatScheduleDateTime(value:string,timeZone:string,format:DateTimeFormat) {
 // Format the site's wall-clock components, not the browser's timezone.
 const local=localDateTime(value,timeZone),year=local.slice(0,4),month=local.slice(5,7),day=local.slice(8,10),hour=Number(local.slice(11,13)),minute=local.slice(14,16);
 const date=format.startsWith('YYYY')?year+'-'+month+'-'+day:format.startsWith('MM/')?month+'/'+day+'/'+year:format.includes('/')?day+'/'+month+'/'+year:day+'.'+month+'.'+year;
 return date+' '+(format.includes('AM/PM')?String(hour%12||12).padStart(2,'0')+':'+minute+(hour<12?' AM':' PM'):local.slice(11,16));
}
export function parseScheduleDateTime(value:string,format:DateTimeFormat) {
 const pattern=format.startsWith('YYYY')?/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/:format.includes('AM/PM')?/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i:format.includes('/')?/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/:/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/;
 const match=value.trim().match(pattern);
 if(!match)throw new Error('Enter a date and time using '+format+'.');
 const year=Number(format.startsWith('YYYY')?match[1]:match[3]);
 const month=Number(format.startsWith('MM/')?match[1]:match[2]);
 const day=Number(format.startsWith('YYYY')?match[3]:format.startsWith('MM/')?match[2]:match[1]);
 let hour=Number(match[4]);const minute=Number(match[5]);
 if(format.includes('AM/PM')){if(hour<1||hour>12)throw new Error('Choose a valid time.');hour=hour%12+(match[6].toUpperCase()==='PM'?12:0);}
 const date=new Date(Date.UTC(year,month-1,day,hour,minute));
 if(year<1000||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day||hour>23||minute>59)throw new Error('Choose a valid date and time.');
 return String(year)+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0')+'T'+String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
}

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
