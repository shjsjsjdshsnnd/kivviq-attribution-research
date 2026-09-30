import assert from 'node:assert/strict';
import { test } from 'vitest';
import { CALENDAR_VERSION, CalendarError, validateCalendar, localMidnightUtc, lastCompleteLocalDays, calendarComparisonProblems, describeCalendarComparison } from '../../src/diagnosis/engine.js';
const context = {version: CALENDAR_VERSION, timezone:'America/Toronto',alignment:'LOCAL_CALENDAR_DATES'} as const;
test('spring-forward uses 7 complete local days, not 168 hours',()=>{
 const p=lastCompleteLocalDays('2026-03-10T16:00:00Z',context.timezone,7);
 assert.deepEqual(p.current,{start:'2026-03-03T05:00:00.000Z',end:'2026-03-10T04:00:00.000Z'});
 const d=describeCalendarComparison(p.reference,p.current,p.comparisonKind,p.calendar);
 assert.equal(d.status,'aligned'); assert.equal(d.current?.days,7); assert.equal(d.current?.elapsedHours,167); assert.equal(d.reference?.elapsedHours,168);
});
test('fall-back uses a 169-hour local week',()=>{
 const p=lastCompleteLocalDays('2026-11-03T16:00:00Z',context.timezone,7);
 const d=describeCalendarComparison(p.reference,p.current,p.comparisonKind,p.calendar);
 assert.equal(d.current?.elapsedHours,169); assert.equal(d.status,'aligned');
});
test('after UTC midnight still excludes the merchant current day',()=>{
 const p=lastCompleteLocalDays('2026-10-01T02:00:00Z',context.timezone,1);
 assert.deepEqual(p.current,{start:'2026-09-29T04:00:00.000Z',end:'2026-09-30T04:00:00.000Z'});
});
test('just after local midnight advances the completed day',()=>{
 const p=lastCompleteLocalDays('2026-10-01T04:00:00Z',context.timezone,1);
 assert.equal(p.current.end,'2026-10-01T04:00:00.000Z');
});
test('exact local midnight has no partial today interval',()=>{
 const p=lastCompleteLocalDays('2026-03-09T04:00:00Z',context.timezone,1);
 assert.equal(p.current.start,'2026-03-08T05:00:00.000Z'); assert.equal(p.current.end,'2026-03-09T04:00:00.000Z');
});
test('fractional-hour timezone uses real offsets',()=>{
 assert.equal(localMidnightUtc('2026-09-30','Asia/Kathmandu'),'2026-09-29T18:15:00.000Z');
});
test('30-minute DST shift is supported',()=>{
 const p=lastCompleteLocalDays('2026-10-06T12:00:00Z','Australia/Lord_Howe',7);
 const d=describeCalendarComparison(p.reference,p.current,p.comparisonKind,p.calendar);
 assert.equal(d.current?.elapsedHours,167.5); assert.equal(d.status,'aligned');
});
test('same-calendar-date YoY preserves local boundaries',()=>{
 const p=lastCompleteLocalDays('2026-03-10T16:00:00Z',context.timezone,7,'YOY');
 assert.equal(p.reference.start,'2025-03-03T05:00:00.000Z');
 assert.equal(p.reference.end,'2025-03-10T04:00:00.000Z');
 assert.deepEqual(calendarComparisonProblems(p.reference,p.current,'YOY',p.calendar),[]);
});
test('52-week convention is explicit',()=>{
 const p=lastCompleteLocalDays('2026-09-30T16:00:00Z',context.timezone,7,'YOY','LOCAL_52_WEEKS');
 assert.equal(p.reference.start,'2025-09-24T04:00:00.000Z');
 assert.deepEqual(calendarComparisonProblems(p.reference,p.current,'YOY',p.calendar),[]);
 assert.ok(calendarComparisonProblems(p.reference,p.current,'YOY',context).includes('yoy_period_alignment_unverified'));
});
test('weekday mix is reported, not adjusted away',()=>{
 const p=lastCompleteLocalDays('2026-09-30T16:00:00Z',context.timezone,3,'YOY');
 const d=describeCalendarComparison(p.reference,p.current,'YOY',p.calendar);
 assert.ok(d.warnings?.includes('weekday_mix_differs')); assert.equal(d.adjustment,'raw_not_seasonally_adjusted');
});
test('Feb 29 YoY does not silently become Feb 28',()=>{
 assert.throws(()=>lastCompleteLocalDays('2024-03-01T16:00:00Z',context.timezone,1,'YOY'),CalendarError);
});
test('leap-day local previous-day comparison is valid',()=>{
 const p=lastCompleteLocalDays('2024-03-01T16:00:00Z',context.timezone,1);
 assert.equal(p.current.start,'2024-02-29T05:00:00.000Z');
});
test('different leap-year day counts cannot masquerade as matched periods',()=>{
 assert.throws(()=>lastCompleteLocalDays('2024-03-02T16:00:00Z',context.timezone,3,'YOY'),CalendarError);
});
test('nonexistent local date fails closed',()=>{
 assert.throws(()=>localMidnightUtc('2011-12-30','Pacific/Apia'),CalendarError);
});
test('ambiguous local midnight fails closed',()=>{
 assert.throws(()=>localMidnightUtc('2026-11-01','America/Havana'),CalendarError);
});
test('nonexistent midnight DST transition fails closed',()=>{
 assert.throws(()=>localMidnightUtc('2026-03-08','America/Havana'),CalendarError);
});
test('a forged non-midnight reference fails calendar checks',()=>{
 const p=lastCompleteLocalDays('2026-03-10T16:00:00Z',context.timezone,7);
 assert.deepEqual(calendarComparisonProblems({...p.reference,start:'2026-02-24T06:00:00Z'},p.current,'PREVIOUS',context),['local_calendar_alignment_unverified']);
});
test('unequal local-day counts remain rejected',()=>{
 const p=lastCompleteLocalDays('2026-03-10T16:00:00Z',context.timezone,7);
 assert.ok(calendarComparisonProblems({...p.reference,start:'2026-02-25T05:00:00Z'},p.current,'PREVIOUS',context).includes('local_day_counts_differ'));
});
test('local comparison gaps remain rejected',()=>{
 const p=lastCompleteLocalDays('2026-03-10T16:00:00Z',context.timezone,7);
 assert.ok(calendarComparisonProblems({start:'2026-02-23T05:00:00Z',end:'2026-03-02T05:00:00Z'},p.current,'PREVIOUS',context).includes('previous_period_not_adjacent'));
});
test('overlapping windows remain rejected',()=>{
 const p=lastCompleteLocalDays('2026-03-10T16:00:00Z',context.timezone,7);
 assert.ok(calendarComparisonProblems(p.current,p.current,'PREVIOUS',context).includes('reference_overlaps_or_follows_current'));
});
for(const zone of ['Mars/Olympus','','+04:00']) test(`invalid timezone ${zone}`,()=>assert.throws(()=>validateCalendar({...context,timezone:zone}),CalendarError));
for(const days of [0,-1,367,2.2,NaN,Infinity]) test(`invalid day count ${days}`,()=>assert.throws(()=>lastCompleteLocalDays('2026-09-30T16:00:00Z',context.timezone,days),CalendarError));
test('unknown and accessor fields cannot smuggle evaluator data',()=>{
 assert.throws(()=>validateCalendar({...context,trueWorld:1}),CalendarError);
 const x={...context};Object.defineProperty(x,'timezone',{get(){throw new Error('Getter executed');}});
 assert.throws(()=>validateCalendar(x),CalendarError);
});
test('invalid timestamps are rejected without Date normalization',()=>{
 assert.throws(()=>lastCompleteLocalDays('2026-02-30T12:00:00Z',context.timezone,7),CalendarError);
 assert.throws(()=>lastCompleteLocalDays('2026-03-10T12:00:00',context.timezone,7),CalendarError);
});
test('52-week alignment cannot be used to redefine previous period',()=>{
 assert.throws(()=>lastCompleteLocalDays('2026-03-10T16:00:00Z',context.timezone,7,'PREVIOUS','LOCAL_52_WEEKS'),CalendarError);
});
test('280 reproducible complete-day windows across timezones',()=>{
 for(const timezone of ['America/Toronto','Europe/London','Asia/Kathmandu','Australia/Lord_Howe'])for(let day=1;day<=70;day++){
 const asOf=new Date(Date.UTC(2026,1,day,15)).toISOString();
 const p=lastCompleteLocalDays(asOf,timezone,7);
 const d=describeCalendarComparison(p.reference,p.current,'PREVIOUS',p.calendar);
 assert.equal(d.status,'aligned');assert.equal(d.current?.days,7);assert.equal(d.reference?.days,7);
 assert.ok(Date.parse(p.current.end)<=Date.parse(asOf));assert.equal(p.reference.end,p.current.start);
 assert.deepEqual(p,lastCompleteLocalDays(asOf,timezone,7));
 }
});
