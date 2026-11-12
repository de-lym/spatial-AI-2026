import test from 'node:test';
import assert from 'node:assert/strict';
import {createParade} from '../parade.js';
const p=(x,y=14,z=0)=>({x,y,z});
const make=(options={})=>createParade({pads:[-30,-10,10,30].map((x,i)=>({id:`P${i}`,pos:p(x,5,35)})),plan:(a,b)=>({ok:true,pts:[b]}),blocked:()=>false,...options});
test('trace IDs, world linkage and exact trigger times survive deterministic reset',()=>{
 const e=make({events:['balloon','pigeons','confetti','wind']});for(let i=0;i<1800;i++)e.tick();
 const log=e.snapshot().log;assert.equal(new Set(log.map(r=>r.recordId)).size,log.length);
 assert.equal(log.find(r=>r.code==='BALLOON_DRIFT').time,20);assert.equal(log.find(r=>r.code==='BALLOON_DRIFT').eventId,'world:balloon:20');
 for(const r of log){assert.ok(Number.isFinite(r.time));if(r.agentId)assert.ok(r.position);if(r.parentId)assert.ok(log.some(p=>p.recordId===r.parentId));if(r.worldEventId)assert.ok(log.some(p=>p.eventId===r.worldEventId&&p.kind==='world'));}
 e.reset();for(let i=0;i<1800;i++)e.tick();assert.deepEqual(e.state.log,log);
});
test('historical knowledge excludes future discoveries',()=>{
 const e=make({obstacles:[{id:'box',x0:-22,x1:-20,z0:34,z1:36,h:8}]});const a=e.state.agents[0];a.forward=p(1,0);for(let i=0;i<5;i++)e.tick();
 const past=e.historical(.25);assert.ok(past.agents[0].knowledge['box:west']);assert.deepEqual(e.historical(0).agents[0].knowledge,{});
 const frozen=JSON.stringify(past.agents[0].knowledge);for(let i=0;i<300;i++)e.tick();assert.equal(JSON.stringify(past.agents[0].knowledge),frozen);
 for(const t of [0,.1,.3,5,15])for(const agent of e.historical(t).agents)for(const obs of Object.values(agent.knowledge))assert.ok(obs.time<=t);
 const live=e.state.time;e.historical(0);assert.equal(e.state.time,live);
});
test('onboard conflict, response and observed outcome form a trace chain',()=>{
 const e=make(),a=e.state.agents[0];a.pos=p(5,14,-29.955);a.route=[p(20,14,-29.955)];a.forward=p(1,0);e.tick();
 const conflict=e.state.log.find(r=>r.kind==='conflict');assert.equal(conflict.subjectId,'balloon');assert.ok(conflict.prediction);
 const decision=e.state.log.find(r=>r.code==='L3');assert.equal(decision.eventId,conflict.eventId);assert.equal(decision.parentId,conflict.recordId);assert.deepEqual(decision.position,p(5,14,-29.955));
 for(let i=0;i<300;i++)e.tick();assert.ok(e.state.log.some(r=>r.kind==='outcome'&&r.eventId===decision.eventId));
});
