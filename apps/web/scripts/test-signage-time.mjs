import assert from 'node:assert/strict';
import {formatScheduleDateTime,parseScheduleDateTime,localToIso} from '../src/modules/signage/time.ts';
import {getUserDateTimeFormat,setUserDateTimeFormat} from '../src/date-format.ts';
for(const [format,text] of [
 ['DD.MM.YYYY HH:MM','01.11.2026 14:05'],
 ['DD/MM/YYYY HH:MM','01/11/2026 14:05'],
 ['MM/DD/YYYY h:mm AM/PM','11/01/2026 02:05 PM'],
 ['YYYY-MM-DD HH:MM','2026-11-01 14:05'],
]) {
 setUserDateTimeFormat(format);assert.equal(getUserDateTimeFormat(),format);
 assert.equal(formatScheduleDateTime('2026-11-01T13:05:00Z','Europe/Zurich',format),text);
 assert.equal(parseScheduleDateTime(text,format),'2026-11-01T14:05');
 assert.equal(localToIso(parseScheduleDateTime(text,format),'Europe/Zurich'),'2026-11-01T13:05:00.000Z');
}
assert.equal(parseScheduleDateTime('11/01/2026 12:00 AM','MM/DD/YYYY h:mm AM/PM'),'2026-11-01T00:00');
assert.equal(parseScheduleDateTime('11/01/2026 12:00 PM','MM/DD/YYYY h:mm AM/PM'),'2026-11-01T12:00');
assert.equal(formatScheduleDateTime('2026-03-29T09:30:00Z','America/Phoenix','DD.MM.YYYY HH:MM'),'29.03.2026 02:30');
for(const value of ['31.02.2026 14:05','01.13.2026 14:05','01.11.2026 24:00','01.11.2026 12:60','11/01/2026 14:05'])assert.throws(()=>parseScheduleDateTime(value,'DD.MM.YYYY HH:MM'));
assert.throws(()=>parseScheduleDateTime('11/01/2026 13:00 PM','MM/DD/YYYY h:mm AM/PM'));
assert.throws(()=>localToIso(parseScheduleDateTime('29.03.2026 02:30','DD.MM.YYYY HH:MM'),'Europe/Zurich'),/does not exist/);
assert.equal(localToIso(parseScheduleDateTime('25.10.2026 02:30','DD.MM.YYYY HH:MM'),'Europe/Zurich'),'2026-10-25T00:30:00.000Z');
console.log('PASS: user date/time formats, site timezone, AM/PM, invalid dates, DST transitions');
