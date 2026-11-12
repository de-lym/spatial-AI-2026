import test from 'node:test';
import assert from 'node:assert/strict';
import {PARADE,PARADE_ROUTE,ROUTE_LENGTH,routeAt,driftAt,balloonAt,createSpectators,paradeAt,CROWD_ZONES} from '../parade-environment.js';
import {createParade,hitsBox} from '../parade.js';
const pads=[-30,-10,10,30].map((x,i)=>({id:`P${i}`,pos:{x,y:6,z:35}}));
const make=options=>createParade({pads,plan:(a,b)=>({ok:true,pts:[b]}),blocked:()=>false,...options});
test('loop uses only existing street centers and closes without teleporting',()=>{
 const streets=[-56,-40,-24,-8,8,24,40,56];
 for(let i=1;i<PARADE_ROUTE.length;i++){const a=PARADE_ROUTE[i-1],b=PARADE_ROUTE[i];assert.ok(a.x===b.x&&streets.includes(a.x)||a.z===b.z&&streets.includes(a.z));}
 assert.deepEqual(routeAt(0),routeAt(ROUTE_LENGTH));
 for(let t=0;t<300;t+=.05){const a=balloonAt(t,false),b=balloonAt(t+.05,false);assert.ok(Math.hypot(b.x-a.x,b.z-a.z)<=PARADE.speed*.05+1e-9);}
});
test('drift pulse is fixed, bounded and selectable without changing ground progress',()=>{
 assert.equal(driftAt(20),0);assert.equal(driftAt(30),1);assert.equal(driftAt(42),0);
 for(let t=0;t<=150;t+=.25){const a=paradeAt(t),b=paradeAt(t,{drift:false});assert.equal(a.progress,b.progress);assert.deepEqual(a.marchers,b.marchers);assert.equal(driftAt(t,false),0);if(t<=20||t>=42)assert.deepEqual(a.balloon,b.balloon);}
});
test('spectators stay in sidewalk slots, face the balloon and exclude solid footprints',()=>{
 const obstacle={x0:-28,x1:-20,z0:-39,z1:-25,h:8};const seeds=createSpectators([obstacle]);assert.ok(seeds.length>100);
 for(const t of [0,20,30,80,150])for(const [i,p] of paradeAt(t,{spectators:seeds}).spectators.entries()){
  const s=seeds[i];assert.ok(Math.hypot(p.pos.x-s.x,p.pos.z-s.z)<=.100001);
  assert.equal(hitsBox({...p.pos,y:.5},{...p.pos,y:.5},obstacle),false);
  const b=balloonAt(t);assert.equal(p.heading,Math.atan2(b.x-p.pos.x,b.z-p.pos.z));
 }
});
test('marcher spacing holds through every route corner and wrap; handler tethers react',()=>{
 for(let t=0;t<300;t+=.1){const env=paradeAt(t),people=[...env.marchers,...env.handlers];
  for(let i=0;i<people.length;i++)for(const b of people.slice(i+1))assert.ok(Math.hypot(people[i].pos.x-b.pos.x,people[i].pos.z-b.pos.z)>.44,`overlap at ${t}: ${people[i].id} / ${b.id}`);
 }
 const drift=paradeAt(30),base=paradeAt(30,{drift:false});assert.equal(drift.handlers.length,6);
 assert.ok(drift.handlers.every((h,i)=>h.tension>base.handlers[i].tension&&h.hand.y<1&&h.anchor.y>10));assert.notDeepEqual(drift.handlers.map(h=>h.pos),base.handlers.map(h=>h.pos));
});
test('event and strategy selection are validated and reset without changing the schedule',()=>{
 assert.equal(make({method:2}).config.method,2);assert.equal(make({method:3}).config.method,3);assert.throws(()=>make({method:4}),/Unsupported/);assert.throws(()=>make({events:['unknown']}),/Unsupported/);
 const e=make({events:[]});for(let i=0;i<610;i++)e.tick();assert.equal(e.state.log.some(x=>x.code==='BALLOON_DRIFT'),false);assert.deepEqual(e.state.balloon,balloonAt(30.5,false));
 e.reset({events:['balloon']});for(let i=0;i<610;i++)e.tick();assert.deepEqual(e.state.balloon,balloonAt(30.5));assert.equal(e.state.log.filter(x=>x.code==='BALLOON_DRIFT').length,1);
});
test('published crowd ground zones reject landing, low overflight and unsafe route endpoints',()=>{
 const e=make();const ground={x:8,y:0,z:-20},low={...ground,y:3},high={...ground,y:6};
 assert.equal(e.crowdBlocked(ground,ground),true);assert.equal(e.crowdBlocked(low,low),true);assert.equal(e.crowdBlocked(high,high),false);
 const a=e.state.agents[0];a.pos={...ground,y:3};a.route=[{...ground,y:3,z:-10}];e.tick();assert.equal(a.level,'L3');assert.match(a.reason,/crowd zone/);assert.equal(e.state.crowdStops,1);
 const landing=make({pads:pads.map(p=>({...p,pos:ground}))});for(let i=0;i<30;i++)landing.tick();assert.equal(landing.state.agents[0].goal,0);assert.equal(landing.state.agents[0].state,'Pad unavailable');
 assert.equal(CROWD_ZONES.length,6);
});
