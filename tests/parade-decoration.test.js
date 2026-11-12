import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpectators,paradeAt,balloonAt,CROWD_ZONES} from '../parade-environment.js';
test('static spectators are cached while balloon, parade formation and crowd reservations stay unchanged',()=>{
 const spectators=createSpectators(),initial=paradeAt(0,{spectators,animateSpectators:false});
 for(const time of [0,20,30,42,80,150]){
  const animated=paradeAt(time,{spectators}),simplified=paradeAt(time,{spectators,animateSpectators:false});
  assert.equal(simplified.spectators,initial.spectators);assert.deepEqual(simplified.balloon,animated.balloon);assert.deepEqual(simplified.marchers,animated.marchers);assert.deepEqual(simplified.handlers,animated.handlers);assert.deepEqual(simplified.balloon,balloonAt(time));
  simplified.spectators.forEach((p,i)=>{assert.equal(p.wave,0);assert.deepEqual(p.pos,{x:spectators[i].x,y:0,z:spectators[i].z});});
 }
 assert.equal(CROWD_ZONES.length,6);assert.ok(CROWD_ZONES.every(z=>z.h===4.5));
});
