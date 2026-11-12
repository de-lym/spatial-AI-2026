import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIncidents} from '../parade-incidents.js';
const point={x:1,y:2,z:3};
const record=(n,time,code,extra={})=>({recordId:`r${n}`,eventId:`e${n}`,time,code,agentId:'D-01',id:'D-01',position:point,layer:'Onboard',detail:'Onboard avoidance: balloon',kind:'decision',...extra});
test('routine observations and standalone predictions never create announcements',()=>{
 const rows=[record(1,1,'BALLOON_OBSERVED',{kind:'observation'}),record(2,2,'TRAFFIC_OBSERVED',{kind:'observation'}),record(3,3,'PREDICTED_CONFLICT',{kind:'conflict'}),record(4,4,'WIND_COMPENSATION')];
 assert.deepEqual(buildIncidents(rows,10),[]);
});
test('one continuous response episode retains its identity, highest severity and actual outcome',()=>{
 const rows=[record(1,1,'L2'),record(2,1.2,'RESPONSE_ENDED',{kind:'outcome',eventId:'e1'}),record(3,1.2,'L3'),record(4,2.5,'L2'),record(5,3,'RESPONSE_ENDED',{kind:'outcome',eventId:'e4',detail:'Recorded next state: Mission route'})];
 const before=JSON.stringify(rows),events=buildIncidents(rows,5);assert.equal(events.length,1);assert.equal(events[0].id,'encounter:r1');assert.equal(events[0].severity,3);assert.equal(events[0].representative.recordId,'r3');assert.equal(events[0].outcome.recordId,'r5');assert.equal(JSON.stringify(rows),before);
 assert.equal(buildIncidents([...rows,record(6,10,'L2')],10).length,2);
});
test('traffic participants share a single encounter across both agent histories',()=>{
 const rows=[record(1,3,'COST_NEGOTIATION',{layer:'Coordination',subjectId:'D-02',detail:'Yield to D-02'}),record(2,3.1,'L2',{agentId:'D-02',subjectId:'D-01',detail:'Onboard avoidance: D-01'})];
 const [event]=buildIncidents(rows,4);assert.equal(buildIncidents(rows,4).length,1);assert.deepEqual(event.participants,['D-01','D-02']);
});
test('short target losses stay quiet, sustained losses announce and link actual reacquisition',()=>{
 const loss=record(1,1,'TARGET_LOST');assert.equal(buildIncidents([loss],2.9).length,0);assert.equal(buildIncidents([loss],3).length,1);
 assert.equal(buildIncidents([loss,record(2,2,'TARGET_REACQUIRED')],10).length,0);
 const [event]=buildIncidents([loss,record(2,5,'TARGET_REACQUIRED')],10);assert.equal(event.severity,1);assert.equal(event.outcome.code,'TARGET_REACQUIRED');
});
test('historical queries do not promote a future escalation or future target-loss outcome',()=>{
 const rows=[record(1,1,'L2'),record(2,2,'L3')];assert.equal(buildIncidents(rows,1.5)[0].severity,2);assert.equal(buildIncidents(rows,2)[0].severity,3);
});
