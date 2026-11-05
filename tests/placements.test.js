import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SKYBRIDGE,placementFacts} from '../placements.js';
import {segCheck,world,cfg,bump,planRoute,nearestObstacle} from '../spatial.js';
import {boxSurfaceDistance} from '../proximity.js';
const drone=(id,x,y,z)=>({id,pos:{x,y,z},heading:0});
test('under and between require the actual overhead footprint and tower gap',()=>{
 const a=drone('D-01',-27.5,10,-32);
 assert.deepEqual(placementFacts(a,[a]).map(f=>f.relation),['BETWEEN','UNDER']);
 assert.equal(placementFacts(drone('D-01',0,10,-32),[]).length,0);
 assert.equal(placementFacts(drone('D-01',-27.5,22,-32),[]).length,0);
 assert.equal(placementFacts(drone('D-01',-27.5,0,-32),[]).length,0);
});
test('next to is lateral, aligned and safely separated, not merely near',()=>{
 const a=drone('D-01',-27.5,10,-32),b=drone('D-02',-20.5,10,-32);
 assert.equal(placementFacts(a,[a,b]).filter(f=>f.relation==='NEXT_TO')[0].distanceM,35);
 b.pos.x=a.pos.x+2;assert.equal(placementFacts(a,[a,b]).some(f=>f.relation==='NEXT_TO'),false);
 b.pos.x=-20.5;b.heading=Math.PI;assert.equal(placementFacts(a,[a,b]).some(f=>f.relation==='NEXT_TO'),false);
 b.heading=0;b.pos.y=12;assert.equal(placementFacts(a,[a,b]).some(f=>f.relation==='NEXT_TO'),false);
});
test('elevated solid supports underside, interior, roof, side and clearance checks',()=>{
 world.bounds=58;world.obstacles=[...['west','east','span'].map(k=>({...SKYBRIDGE[k]}))];world.restricted=[];
 world.volumes=[{x0:-58,x1:58,z0:-58,z1:58,zloM:20,zhiM:120}];cfg.maxAltM=120;cfg.clearanceM=6;bump();
 const p={x:-24,y:10,z:-32};
 assert.equal(segCheck({...p,z:-42},{...p,z:-22}),null);
 assert.equal(segCheck({...p,y:14.5},{...p,y:14.5}).reason,'building');
 assert.equal(segCheck({...p,y:16},{...p,y:16}).reason,'building');
 assert.equal(segCheck({...p,y:20},{...p,y:20}),null);
 assert.equal(segCheck({...p,x:-32},{...p,x:-32}).reason,'building');
 assert.equal(boxSurfaceDistance(p,SKYBRIDGE.span),5);
 assert.equal(nearestObstacle(p).d,5);
 const route=planRoute({...p,z:-42},{...p,z:-22},{only:10});assert.ok(route.ok);
 let from={...p,z:-42};for(const q of route.pts){assert.equal(segCheck(from,q),null);from=q;}
 cfg.clearanceM=30;bump();assert.notEqual(segCheck({...p,z:-42},{...p,z:-22}),null);
});
