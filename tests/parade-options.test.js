import test from 'node:test';
import assert from 'node:assert/strict';
import {EVENT_IDS,EVENT_SCHEDULE,eventsAt,segmentInCloud} from '../parade-events.js';
import {choosePassage,delayCost} from '../parade-methods.js';
import {createParade,balloonAt} from '../parade.js';
const p=(x,y=14,z=0)=>({x,y,z});
const pads=[-30,-10,10,30].map((x,i)=>({id:`P${i}`,pos:p(x,6,35)}));
const make=options=>createParade({pads,plan:(a,b)=>({ok:true,pts:[b]}),blocked:()=>false,...options});
const finish=e=>{for(let i=0;i<3000;i++)e.tick();return e.snapshot();};
test('all event combinations are order-independent and isolate each trajectory',()=>{
 for(let mask=0;mask<16;mask++){const events=EVENT_IDS.filter((_,i)=>mask&(1<<i));for(const t of [0,26,38,45,54,62,68,76,86,150]){const env=eventsAt(t,events);assert.deepEqual(env,eventsAt(t,[...events].reverse()));for(const id of events){const single=eventsAt(t,[id]);if(id==='pigeons')assert.deepEqual(env.pigeons,single.pigeons);if(id==='confetti')assert.deepEqual(env.confetti,single.confetti);if(id==='wind')assert.deepEqual(env.wind,single.wind);}}}
 assert.ok(eventsAt(26,['pigeons']).pigeons.length>=1&&eventsAt(26,['pigeons']).pigeons.length<=3);assert.equal(eventsAt(54,['pigeons']).pigeons.length,0);assert.equal(eventsAt(38,['confetti']).confetti.radius,8);assert.ok(eventsAt(77,['wind']).wind.x>.6);
});
test('cloud affects only intersecting sightlines',()=>{const cloud={pos:p(0),radius:3};assert.ok(segmentInCloud(p(-8),p(8),cloud));assert.ok(!segmentInCloud(p(-8,14,6),p(8,14,6),cloud));});
test('cost negotiation can reverse fixed rank and exposes reproducible counterfactual costs',()=>{
 const a={id:'A',priority:1,kind:'delivery',wait:0,battery:100,route:[],pos:p(-10),velocity:p(2,0)};
 const b={...a,id:'B',priority:4,kind:'camera',pos:p(0,14,-10),velocity:p(0,0,2)};
 const opts={time:8,prediction:{time:5},reservations:{}};
 assert.equal(choosePassage(a,b,{...opts,method:1}).winner.id,'A');const r=choosePassage(a,b,{...opts,method:2});assert.equal(r.winner.id,'B');assert.ok(r.costs.B>r.costs.A);assert.ok(delayCost({...a,wait:20},2)>delayCost(a,2));
});
test('bidding leases a conflict volume, keeps winner during its interval, reauctions after expiry',()=>{
 const a={id:'A',priority:1,kind:'delivery',wait:0,battery:100,route:[],pos:p(-10),velocity:p(2,0)},b={...a,id:'B',kind:'camera',pos:p(0,14,-10),velocity:p(0,0,2)},reservations={};
 const opts={method:3,time:8,prediction:{time:5},reservations};const first=choosePassage(a,b,opts);assert.equal(first.winner.id,'B');assert.ok(first.slot.end>8);assert.equal(first.slot.center.x,0);a.wait=100;
 assert.equal(choosePassage(a,b,{...opts,time:9}).winner.id,'B');assert.equal(choosePassage(a,b,{...opts,time:20}).winner.id,'A');
});
test('real crossing executes each policy and keeps imminent avoidance above arbitration',()=>{
 for(const method of [1,2,3]){const e=make({method});e.state.tick=160;e.state.time=8;const [a,b,c]=e.state.agents;a.pos=p(-10);a.route=[p(20)];a.forward=p(1,0);c.pos=p(0,14,-10);c.route=[p(0,14,20)];c.forward=p(0,0,1);c.package='PKG-D-03';b.done=true;b.pos=p(50,20,50);e.tick();assert.equal(e.state.coordination.length,1);assert.equal(e.state.coordination[0].winner,method===1?'D-01':'D-03');assert.equal(e.config.method,method);e.reset();assert.equal(e.config.method,method);}
 for(const method of [1,2,3]){const e=make({method});const a=e.state.agents[0];a.pos=p(5,14,-29.955);a.route=[p(20,14,-29.955)];a.forward=p(1,0);e.tick();assert.equal(a.level,'L3');assert.match(a.reason,/Onboard avoidance/);}
});
test('all methods and combined events replay full trajectories, effects, logs and metrics exactly',()=>{
 for(const method of [1,2,3]){const e=make({method,events:EVENT_IDS});const one=finish(e);e.reset();assert.deepEqual(finish(e),one);assert.deepEqual(one.config.events,EVENT_IDS);assert.equal(one.config.method,method);for(const id of EVENT_IDS)assert.equal(one.log.filter(x=>x.code===(id==='balloon'?'BALLOON_DRIFT':`${id.toUpperCase()}_START`)).length,1);assert.ok(one.eventMetrics.windSeconds>17.9);}
});
test('confetti truly suppresses new visual observations and preserves prior knowledge',()=>{
 const obstacle={id:'box',x0:9,x1:10,z0:-8.5,z1:-7.5,h:28};
 const e=make({events:['confetti'],obstacles:[obstacle]});e.state.tick=800;e.state.time=40;const a=e.state.agents[0];a.pos=p(7,14,-8);a.forward=p(1,0);a.knowledge.old={count:1};a.route=[p(20,14,-8)];e.tick();assert.equal(a.sensorDegraded,true);assert.equal(a.knowledge['box:west'],undefined);assert.ok(a.knowledge.old);assert.ok(e.state.eventMetrics.confettiSuppressed>0);
 const clear=make({events:[],obstacles:[obstacle]});clear.state.tick=800;clear.state.time=40;const b=clear.state.agents[0];b.pos=p(7,14,-8);b.forward=p(1,0);b.route=[p(20,14,-8)];clear.tick();assert.ok(b.knowledge['box:west']);
});
test('wind changes actual movement and logs compensation, balloon trajectory stays independent',()=>{
 const run=events=>{const e=make({events});e.state.tick=1500;e.state.time=75;const a=e.state.agents[0];a.pos=p(-40,20,35);a.route=[p(40,20,35)];e.tick();return e;};const base=run([]),wind=run(['wind']);assert.notDeepEqual(wind.state.agents[0].pos,base.state.agents[0].pos);assert.ok(wind.state.log.some(e=>e.code==='WIND_COMPENSATION'));assert.deepEqual(wind.state.balloon,balloonAt(75.05,false));
});
test('pigeons are perceived locally, unseen flocks do not populate agent knowledge',()=>{
 // Place the agent 12 units from a live pigeon along its flight direction; look toward it, then away from it.
 const bird=eventsAt(35.05,['pigeons']).pigeons[0],dir=Math.hypot(bird.v.x,bird.v.z),ux=bird.v.x/dir,uz=bird.v.z/dir;
 const setup=sign=>{const e=make({events:['pigeons']});e.state.tick=700;e.state.time=35;const a=e.state.agents[0];a.pos=p(bird.pos.x-ux*12,bird.pos.y,bird.pos.z-uz*12);a.forward={x:ux*sign,y:0,z:uz*sign};a.route=[p(a.pos.x+ux*sign*10,a.pos.y,a.pos.z+uz*sign*10)];e.tick();return e;};
 const seen=setup(1),unseen=setup(-1);assert.ok(seen.state.agents[0].observations.pigeons);assert.equal(unseen.state.agents[0].observations.pigeons,undefined);
});
