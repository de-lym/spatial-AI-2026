import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildInspectionMission,orbitProgress,deliveryChecks,waypointSpeed,inspectionConfig} from '../inspection.js';
import {trajectory} from '../proximity.js';
import {cfg,world,bump,segCheck,planRoute} from '../spatial.js';
function setup(){world.bounds=58;world.obstacles=[];world.restricted=[];world.volumes=[{x0:-58,x1:58,z0:-58,z1:58,zloM:0,zhiM:120}];cfg.maxAltM=120;cfg.clearanceM=6;bump();}
test('a full orbit closes, fits obstacles and includes no early landing segment',()=>{
 setup();const from={x:-20,y:10,z:0},dest={x:0,y:0,z:0};
 const p=buildInspectionMission(from,dest,{cfg,planRoute,segCheck});assert.ok(p.ok);
 assert.ok(Math.hypot(p.orbit.circle[0].x-p.orbit.circle.at(-1).x,p.orbit.circle[0].z-p.orbit.circle.at(-1).z)<1e-9);
 assert.equal(p.orbit.circle.length,49);assert.equal(p.best.pts.at(-1).y,p.orbit.altitudeM/5);
 let prev=from;for(const q of p.best.pts){assert.equal(segCheck(prev,q),null);prev=q;}
});
test('coverage follows real position and waypoint index rather than elapsed time',()=>{
 setup();const p=buildInspectionMission({x:-20,y:10,z:0},{x:0,y:0,z:0},{cfg,planRoute,segCheck});
 const route={pts:p.best.pts,idx:p.orbit.startIdx,plan:p};assert.equal(orbitProgress(route,p.orbit.circle[0]),0);
 route.idx+=12;assert.ok(Math.abs(orbitProgress(route,p.orbit.circle[12])-.25)<1e-8);
 const held=orbitProgress(route,p.orbit.circle[12]);assert.equal(orbitProgress(route,p.orbit.circle[12]),held);
 route.idx=p.best.pts.length;assert.equal(orbitProgress(route,p.orbit.circle.at(-1)),1);
});
test('100 percent coverage does not approve a reserved or occupied pad or invalid cargo/route',()=>{
 const order={customer:{acc:{x:0,y:0,z:0}}},c={pos:{x:5,y:16,z:0},task:{order},inspection:{progress:1}},other={id:'D-02',pos:{x:0,y:0,z:0}};
 assert.equal(deliveryChecks(c,[c],{reserved:true,routeOK:true,cargoMatches:true}).passed,false);
 assert.equal(deliveryChecks(c,[c,other],{routeOK:true,cargoMatches:true}).passed,false);
 assert.equal(deliveryChecks(c,[c],{routeOK:false,cargoMatches:true}).passed,false);
 assert.equal(deliveryChecks(c,[c],{routeOK:true,cargoMatches:false}).passed,false);
 assert.equal(deliveryChecks(c,[c],{routeOK:true,cargoMatches:true}).passed,true);
 c.inspection.progress=.9;assert.equal(deliveryChecks(c,[c],{routeOK:true,cargoMatches:true}).passed,false);
});
test('no valid circle or onward path is reported as blocked',()=>{
 setup();world.restricted=[{id:'NO',name:'Closed',active:true,x0:-58,x1:58,z0:-58,z1:58,zloM:0,zhiM:120}];bump();
 assert.equal(buildInspectionMission({x:-20,y:10,z:0},{x:0,y:0,z:0},{cfg,planRoute,segCheck}).ok,false);
});
test('slow orbit speed is identical in exact trajectory prediction and movement speed helper',()=>{
 const a={x:0,y:10,z:0},b={x:10,y:10,z:0,speedU:1};assert.equal(waypointSpeed(a,b),1);
 const c={pos:a,task:{route:{idx:0,pts:[b]}}};assert.equal(trajectory(c,2).at(-1).p.x,2);
 c.inspectionLandingBlocked=true;assert.equal(trajectory(c,2).at(-1).p.x,0);
});
test('an edge delivery site gets an inward-centered orbit wholly inside the permitted envelope',()=>{
 setup();world.volumes=[{x0:-56,x1:56,z0:-56,z1:56,zloM:0,zhiM:120}];bump();
 const dest={x:48,y:0,z:53.1},p=buildInspectionMission({x:0,y:0,z:0},dest,{cfg,planRoute,segCheck,bounds:56});
 assert.ok(p.ok);assert.ok(p.orbit.center.z<dest.z);
 assert.ok(Math.hypot(p.orbit.center.x-dest.x,p.orbit.center.z-dest.z)<p.orbit.radiusU);
 for(const q of p.orbit.circle){assert.ok(Math.abs(q.x)<56&&Math.abs(q.z)<56);assert.equal(segCheck(q,q),null);}
});
