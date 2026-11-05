import {test} from 'node:test';
import assert from 'node:assert/strict';
import {closestApproach,trajectory,pathCPA,boxSurfaceDistance,unsafeApproach,createBird} from '../proximity.js';
import {cfg,world,bump,segCheck,planRoute} from '../spatial.js';
import {createEventStore} from '../ops-events.js';
const p=(x,y=10,z=0)=>({x,y,z});
const line=(a,b,t=1)=>[{t:0,p:a},{t,p:b}];
test('head-on and crossing encounters are detected between endpoints',()=>{
 assert.equal(closestApproach(p(-10),p(10),p(10),p(-10)),0);
 assert.equal(closestApproach(p(-10),p(10),p(0,10,-10),p(0,10,10)),0);
 assert.equal(closestApproach(p(-10),p(10),p(0,15,-10),p(0,15,10)),5);
});
test('piecewise prediction respects turns and vertical speed',()=>{
 const c={pos:p(0),task:{route:{idx:0,pts:[p(1),p(1,12)]}}};
 const a=trajectory(c,1);assert.equal(a[1].t,.25);assert.ok(Math.abs(a.at(-1).p.y-12)<1e-9);
 const held=trajectory({...c,hold:{}},1);assert.deepEqual(held.at(-1).p,c.pos);
 assert.equal(pathCPA(a,line(p(1,11),p(1,11))),0);
});
test('building distance uses surfaces, roofs and corners rather than centres',()=>{
 const o={x0:0,x1:10,z0:0,z1:10,h:20};
 assert.equal(boxSurfaceDistance(p(11,10,5),o),1);
 assert.equal(boxSurfaceDistance(p(5,23,5),o),3);
 assert.equal(boxSurfaceDistance(p(5,10,5),o),0);
 assert.equal(boxSurfaceDistance(p(13,24,10),o),5);
});
test('existing breach permits only strictly separating motion',()=>{
 assert.equal(unsafeApproach(line(p(0),p(-2)),line(p(1),p(1)),3),false);
 assert.equal(unsafeApproach(line(p(0),p(0)),line(p(1),p(1)),3),true);
 assert.equal(unsafeApproach(line(p(-5),p(5)),line(p(5),p(-5)),3),true);
});
test('seeded pigeon turns reproduce and diverge from constant velocity',()=>{
 const a=createBird(19),b=createBird(19);let changes=0,old='';
 for(let i=0;i<100;i++){a.step(.1);b.step(.1);const v=JSON.stringify(a.velocity);if(v!==old)changes++;old=v;}
 assert.deepEqual(a.pos,b.pos);assert.ok(changes>5);
});
test('planner and segment validator enforce inflated 3D obstacles and impossible routes',()=>{
 world.bounds=50;world.obstacles=[{id:'B1',name:'Box',x0:-3,x1:3,z0:-3,z1:3,h:12}];
 world.volumes=[{x0:-50,x1:50,z0:-50,z1:50,zloM:0,zhiM:120}];world.restricted=[];cfg.clearanceM=6;bump();
 assert.equal(segCheck(p(-10,10),p(10,10)).reason,'building');
 assert.equal(segCheck(p(-10,14),p(10,14)),null);
 const r=planRoute(p(-10,10),p(10,10));assert.ok(r.ok);
 let prev=p(-10,10);for(const q of r.pts){assert.equal(segCheck(prev,q),null);prev=q;}
 world.restricted=[{id:'CLOSED',name:'Closed',active:true,x0:-50,x1:50,z0:-50,z1:50,zloM:0,zhiM:120}];bump();
 assert.equal(planRoute(p(-10,10),p(10,10)).ok,false);
});
test('operations incidents deduplicate and resolve only on model clearance',()=>{
 const store=createEventStore();const ev={code:'PROX_PIGEON',droneId:'D-01',category:'critical',occurredAtSimSeconds:1};
 store.open(ev);store.open(ev);assert.equal(store.counts().critical,1);
 store.update({...ev,action:'HUMAN_ACK'});assert.equal(store.counts().critical,1);
 store.resolve(ev.code,ev.droneId,3);assert.equal(store.counts().critical,0);
 store.reset();assert.equal(store.state.events.length,0);
});
