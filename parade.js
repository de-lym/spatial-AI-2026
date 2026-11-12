import {EVENT_IDS,EVENT_SCHEDULE,eventsAt,segmentInCloud} from './parade-events.js';
import {METHODS,choosePassage} from './parade-methods.js';
import {PARADE, PARADE_ROUTE, CROWD_ZONES, createSpectators, paradeAt, balloonAt} from './parade-environment.js';
export {balloonAt} from './parade-environment.js';
// Deterministic classroom kinematics. All positions use the existing scene units (5 m).
export const CONFIG = Object.freeze({version:3, method:1, events:['balloon'], dt:.05, duration:150,
  departures:[0,4,8,12], activation:20, speed:2, separation:6, balloonRadius:PARADE.balloonRadius,
  range:22, fov:Math.PI*110/180, tactical:6, immediate:2, emergency:.65});
export const point = p => ({x:p.x,y:p.y,z:p.z});
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const add=(a,b,s=1)=>({x:a.x+b.x*s,y:a.y+b.y*s,z:a.z+b.z*s});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const zero=()=>({x:0,y:0,z:0});
export function cpa(a,va,b,vb,horizon) {
  const r=sub(a,b),v=sub(va,vb),vv=dot(v,v);
  const time=vv<1e-12?0:Math.max(0,Math.min(horizon,-dot(r,v)/vv));
  return {time,distance:Math.hypot(...Object.values(add(r,v,time)))};
}
export function hitsBox(a,b,o) {
  let lo=0,hi=1;
  for(const [key,min,max] of [['x',o.x0,o.x1],['y',o.y0??0,o.h],['z',o.z0,o.z1]]) {
    const v=b[key]-a[key];
    if(Math.abs(v)<1e-9){if(a[key]<min||a[key]>max)return false;}
    else {const t1=(min-a[key])/v,t2=(max-a[key])/v;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>hi)return false;}
  }
  return true;
}
export function visible(a,p,obstacles,ignore=null) {
  const d=sub(p,a.pos),len=distance(p,a.pos);
  return len<=CONFIG.range && (len<1e-6||dot(d,a.forward)/len>=Math.cos(CONFIG.fov/2)) && !obstacles.some(o=>o.id!==ignore&&hitsBox(a.pos,p,o));
}
export function fixedPriority(a,b){return a.priority-b.priority||a.id.localeCompare(b.id);}
export function responseLevel(time){return time<=CONFIG.emergency?'L3':time<=CONFIG.immediate?'L2':'L1';}

export function createParade({pads,plan,blocked:staticBlocked,obstacles=[],method=1,events=CONFIG.events}) {
  if(![1,2,3].includes(method))throw new Error('Unsupported coordination method');
  const spectators=createSpectators(obstacles);
  const crowdBlocked=(a,b)=>CROWD_ZONES.some(o=>hitsBox(a,b,o));
  const blocked=(a,b)=>staticBlocked(a,b)||crowdBlocked(a,b);
  let config,state;
  function configure(nextEvents,nextMethod){
    if(!Array.isArray(nextEvents)||nextEvents.some(e=>!EVENT_IDS.includes(e)))throw new Error('Unsupported environmental event');
    if(![1,2,3].includes(nextMethod))throw new Error('Unsupported coordination method');
    config={...CONFIG,method:nextMethod,events:EVENT_IDS.filter(e=>nextEvents.includes(e))};
  }
  configure(events,method);
  let frames=[], sequence=0, episodes={}, responseBefore={};
  const worldId=type=>`world:${type}:${EVENT_SCHEDULE[type]?.start??0}`;
  const sourceType=code=>code.includes('BALLOON')?'balloon':code.includes('PIGEON')?'pigeons':code.includes('CONFETTI')?'confetti':code.includes('WIND')?'wind':null;
  function record(code,id,detail,layer='UTM',extra={}){
    const a=state.agents?.find(a=>a.id===id),type=sourceType(code)??sourceType(String(extra.subjectId??'').toUpperCase());
    const row={recordId:`trace:${String(++sequence).padStart(6,'0')}`,time:state.time,code,id,agentId:id,detail,layer,
      kind:layer==='Environment'?'world':code.includes('DETECTED')||code==='BALLOON_OBSERVED'?'observation':'decision',
      position:a?point(a.pos):null,level:a?.level??null,...(type&&config.events.includes(type)&&state.time>=EVENT_SCHEDULE[type].start&&state.time<=EVENT_SCHEDULE[type].end?{worldEventId:worldId(type)}:{}),...extra};
    row.eventId=extra.eventId??(layer==='Environment'&&type?worldId(type):row.recordId);
    if(extra.subjectId){const obs=[...state.log].reverse().find(e=>e.agentId===id&&e.kind==='observation'&&e.subjectId===extra.subjectId);if(obs&&row.kind==='conflict'){row.parentId=obs.recordId;}}
    state.log.push(row);return row;
  }
  function capture(){
    // Knowledge entries are immutable observations; copy dictionaries to preserve discovery time.
    frames.push({time:state.time,tick:state.tick,finished:state.finished,balloon:point(state.balloon),effects:state.effects,
      agents:state.agents.map(a=>({...a,pos:point(a.pos),forward:point(a.forward),velocity:point(a.velocity),route:a.route.map(point),history:[],knowledge:{...a.knowledge},observations:{...a.observations}})),
      shared:{delivery:{...state.shared.delivery},camera:{...state.shared.camera}},
      landmarks:structuredClone(state.landmarks)});
  }
  function historical(time){const f=frames[Math.max(0,Math.min(frames.length-1,Math.floor(time/(CONFIG.dt*5)+1e-7)))];
    return {...state,...f,parade:paradeAt(f.time,{drift:config.events.includes('balloon'),spectators,animateSpectators:false}),log:state.log.filter(e=>e.time<=f.time)};
  }
  function reset({events=config.events,method=config.method}={}){
    configure(events,method);
    frames=[];sequence=0;episodes={};responseBefore={};
    state={time:0,tick:0,finished:false,balloon:balloonAt(0,config.events.includes('balloon')),parade:paradeAt(0,{drift:config.events.includes('balloon'),spectators,animateSpectators:false}),effects:eventsAt(0,config.events),reservations:{},coordination:[],crowdStops:0,eventMetrics:{pigeonDetections:0,confettiSuppressed:0,windSeconds:0,dynamicGuardStops:0},log:[],minSeparation:null,minBalloonClearance:null,collisions:0,nearMisses:0,contacts:[],shared:{delivery:{},camera:{}},landmarks:{delivery:{},camera:{}}};
    state.agents=CONFIG.departures.map((depart,i)=>({id:`D-0${i+1}`,kind:i===1?'camera':'delivery',operator:i===1?'camera':'delivery',priority:[1,4,2,3][i],depart,
      pos:point(pads[i].pos),home:point(pads[i].pos),forward:{x:0,y:0,z:-1},velocity:zero(),route:[],history:[],knowledge:{},observations:{},lastTarget:null,
      goals:i===1?[]:i===3?[{pad:pads[0],action:'Returned'}]:[{pad:pads[(i+1)%pads.length],action:'Picked up'},{pad:pads[i===2?1:(i+2)%pads.length],action:'Delivered'}],
      goal:0,state:'Scheduled',level:'L0',reason:'Published departure and mission intent',battery:100,wait:0,travel:0,replans:0,visibleTime:0,filmingTime:0,package:i===3?'previous delivery complete':null}));
    record('L0_INTENTS',null,`${METHODS[config.method]}; fixed ranks D-01 > D-03 > D-04 > D-02 apply only to Method 1. Departures 0 / 4 / 8 / 12 s. Policy is illustrative.`);
    capture();return state;
  }
  function setRoute(a,target){
    let r=plan(a.pos,target);
    const clear=pts=>{let prev=a.pos;return pts.every(p=>{const ok=!blocked(prev,p);prev=p;return ok;});};
    if(r.ok&&!clear(r.pts)){
      // Try a climb above the published crowd reservation, using the existing planner
      // for each leg. Validate all legs, including both approach and descent.
      const up={...a.pos,y:Math.max(a.pos.y,PARADE.crowdFloor+.5)},over={...target,y:Math.max(target.y,PARADE.crowdFloor+.5)};
      const legs=[plan(a.pos,up),plan(up,over),plan(over,target)];
      r=legs.every(l=>l.ok)?{ok:true,pts:legs.flatMap(l=>l.pts)}:{ok:false};
      if(r.ok&&!clear(r.pts))r={ok:false};
    }
    a.route=r.ok?r.pts.map(point):[];a.replans++;a.lastPlan=state.time;
    if(!r.ok){a.reason='No route clear of city and published crowd zone; retry pending';return false;}return true;
  }
  function velocity(a){const q=a.route[0];if(!q)return zero();const d=distance(a.pos,q);return d<1e-9?zero():{x:(q.x-a.pos.x)*Math.min(CONFIG.speed,d/CONFIG.dt)/d,y:(q.y-a.pos.y)*Math.min(CONFIG.speed,d/CONFIG.dt)/d,z:(q.z-a.pos.z)*Math.min(CONFIG.speed,d/CONFIG.dt)/d};}
  function sensorVisible(a,p,ignore=null){
    if(!visible(a,p,obstacles,ignore))return false;
    if(segmentInCloud(a.pos,p,state.effects.confetti)){
      // Deterministic reduced visual sampling: one frame in four survives the cloud.
      if(state.tick%4!==0){state.eventMetrics.confettiSuppressed++;return false;}
    }
    return true;
  }
  function sense(a){
    a.sensorDegraded=segmentInCloud(a.pos,add(a.pos,a.forward,CONFIG.range),state.effects.confetti);
    if(a.sensorDegraded&&!a.wasDegraded)record('CONFETTI_OCCLUSION',a.id,'Visual sampling reduced to 25%; known surfaces retained.','Onboard');a.wasDegraded=a.sensorDegraded;
    for(const o of obstacles){
      const cx=(o.x0+o.x1)/2,cz=(o.z0+o.z1)/2,cy=((o.y0??0)+o.h)/2;
      const surfaces=[['roof',{x:cx,y:o.h+.01,z:cz}],['west',{x:o.x0-.01,y:cy,z:cz}],['east',{x:o.x1+.01,y:cy,z:cz}],['north',{x:cx,y:cy,z:o.z0-.01}],['south',{x:cx,y:cy,z:o.z1+.01}]];
      for(const [face,p] of surfaces)if((face==='roof'?a.pos.y>o.h:face==='west'?a.pos.x<o.x0:face==='east'?a.pos.x>o.x1:face==='north'?a.pos.z<o.z0:a.pos.z>o.z1)&&sensorVisible(a,p,o.id)){
        const id=`${o.id}:${face}`,old=a.knowledge[id];
        if(!old||state.time-old.time>=2&&distance(old.from,a.pos)>=1){
          const obs={count:(old?.count??0)+1,time:state.time,from:point(a.pos),pos:p,name:`${o.name??o.id} · ${face}`};
          a.knowledge[id]=obs;state.shared[a.operator][id]=obs;
          if(obs.count>=5&&!state.landmarks[a.operator][id]){state.landmarks[a.operator][id]={...obs,status:'proposed'};record('LANDMARK_PROPOSED',a.id,id,'Mapping');}
        }
      }
    }
    if(a.kind==='camera'){const target=a.lastTarget??balloonAt(0),d=distance(a.pos,target);if(d>.01)a.forward={x:(target.x-a.pos.x)/d,y:(target.y-a.pos.y)/d,z:(target.z-a.pos.z)/d};if(a.lastTarget&&state.time-(a.observations.balloon?.time??0)>5){const angle=state.time*.6;a.forward={x:Math.cos(angle),y:0,z:Math.sin(angle)};}}
    const sees=sensorVisible(a,state.balloon);
    if(sees&&!a.sawBalloon)record('BALLOON_OBSERVED',a.id,'Balloon became visible through onboard range, FOV and occlusion checks.','Onboard',{kind:'observation',subjectId:'balloon'});a.sawBalloon=sees;
    if(sees){a.observations.balloon={pos:point(state.balloon),time:state.time};a.lastTarget=point(state.balloon);}
    return sees;
  }
  function mission(a,sees){
    if(a.kind==='camera'){
      a.filmingTime+=CONFIG.dt;if(sees)a.visibleTime+=CONFIG.dt;
      a.state=sees?(a.hadTarget?'Track':'Reacquire'):a.hadTarget?'Search':'Acquire';
      if(a.previousVisibility!==undefined&&a.previousVisibility!==sees)record(sees?'TARGET_REACQUIRED':'TARGET_LOST',a.id,sees?'Camera target visible again.':'Camera target not visible through current sensor checks; search uses last observation.','Onboard');a.previousVisibility=sees;
      if(sees)a.hadTarget=true;
      // Hidden target motion is never read here. Search from the last observation or the published parade start.
      const target=a.lastTarget??balloonAt(0);
      const stale=!a.cameraPlanTarget||distance(target,a.cameraPlanTarget)>3;
      if(state.time-(a.lastPlan??-10)>2&&(!a.route.length||stale)){
        // Turns can put a preferred filming offset inside a tower. Try fixed,
        // statically validated vantage points based only on the last observation.
        for(const [dx,dz] of [[-9,0],[0,9],[9,0],[0,-9],[-7,7]]){
          const q={x:target.x+dx,y:target.y+2,z:target.z+dz};
          if(setRoute(a,q)){a.cameraPlanTarget=point(target);break;}
        }
      }
    }else{
      const g=a.goals[a.goal];if(!g){a.state=a.id==='D-04'?'Returned':'Delivered';a.done=true;a.completedAt=state.time;record('MISSION_COMPLETE',a.id,a.state,'Onboard');return;}
      if(distance(a.pos,g.pad.pos)<.08){
        // Current-world pad and approach recheck, with a dwell; never equate arrival with delivery.
        const occupied=state.agents.some(b=>b!==a&&distance(b.pos,g.pad.pos)<CONFIG.separation);
        if(blocked(a.pos,a.pos)||occupied||g.action==='Delivered'&&a.package!==`PKG-${a.id}`){a.state='Pad unavailable';a.reason=crowdBlocked(a.pos,a.pos)?'Ground crowd: landing / handoff prohibited':'Wait / recheck approach';return;}
        a.dwell=(a.dwell??0)+CONFIG.dt;a.state='Verify rooftop pad';
        if(a.dwell>=1){record('PAD_VERIFIED',a.id,`${g.pad.id}: ${g.action}`,'Onboard');a.package=g.action==='Picked up'?`PKG-${a.id}`:null;a.goal++;a.dwell=0;a.route=[];}
      }else if(!a.route.length&&state.time-(a.lastPlan??-10)>.5)setRoute(a,g.pad.pos);
      if(a.route.length)a.state='En route';
    }
  }
  function evade(a,hazards){
    // Candidate trajectories checked against static constraints AND moving hazards; a hold is a candidate, never assumed safe.
    const candidates=[zero(),{x:0,y:CONFIG.speed,z:0},{x:0,y:-CONFIG.speed,z:0}];
    for(const y of [0,1,-1])for(let i=0;i<8;i++){const angle=i*Math.PI/4;candidates.push({x:Math.cos(angle)*CONFIG.speed,y,z:Math.sin(angle)*CONFIG.speed});}
    let best=null,bestScore=-Infinity;
    for(const v of candidates){const end=add(a.pos,v,CONFIG.immediate);if(blocked(a.pos,end))continue;
      let safe=true,clear=Infinity;
      for(const h of hazards){const p=cpa(a.pos,v,h.pos,h.v,CONFIG.immediate);const current=distance(a.pos,h.pos);clear=Math.min(clear,p.distance-h.margin);if(p.distance<h.margin&&p.distance<current-.001)safe=false;}
      if(!safe)continue;
      const desired=velocity(a),score=Math.min(clear,12)+dot(v,desired)*.2;
      if(score>bestScore){best=v;bestScore=score;}
    }
    return best;
  }
  function tick(){
    if(state.finished)return;
    responseBefore=Object.fromEntries(state.agents.map(a=>[a.id,{pos:point(a.pos)}]));
    state.tick++;state.time=+(state.tick*CONFIG.dt).toFixed(8);const dt=CONFIG.dt;
    const oldBalloon=state.balloon;state.parade=paradeAt(state.time,{drift:config.events.includes('balloon'),spectators,animateSpectators:false});state.balloon=state.parade.balloon;const bv={x:(state.balloon.x-oldBalloon.x)/dt,y:0,z:(state.balloon.z-oldBalloon.z)/dt};
    state.effects=eventsAt(state.time,config.events);
    for(const id of config.events){const e=EVENT_SCHEDULE[id];if(state.tick===Math.round(e.start/dt))record(id==='balloon'?'BALLOON_DRIFT':`${id.toUpperCase()}_START`,null,`${e.name}: fixed schedule ${e.start}–${e.end} s.`,'Environment');if(state.tick===Math.round(e.end/dt))record(`${id.toUpperCase()}_END`,null,`${e.name} ended.`,'Environment');}
    if(state.effects.active.includes('wind'))state.eventMetrics.windSeconds+=dt;
    for(const [key,slot] of Object.entries(state.reservations))if(slot.end<=state.time)delete state.reservations[key];
    const active=state.agents.filter(a=>state.time>=a.depart);
    for(const a of active){
      if(a.state==='Scheduled'){a.state='Departed';record('DEPART',a.id,'Scheduled release.');}
      if(a.done){a.velocity=zero();continue;}
      a.level='L0';a.reason='Mission route';a.prediction=null;if(a.needsReplan&&state.time-(a.lastPlan??0)>.5){a.route=[];a.needsReplan=false;}const sees=sense(a);mission(a,sees);a.velocity=velocity(a);
      // Kinematic wind response: flight controller opposes the gust, consuming available speed.
      // A bounded residual drift remains in the world velocity and is checked by every safety layer.
      const wind=state.effects.wind,windLoad=Math.hypot(wind.x,wind.z);a.windLoad=windLoad;
      if(windLoad){const factor=1-windLoad*.35;a.velocity={x:a.velocity.x*factor+wind.x*.12,y:a.velocity.y,z:a.velocity.z*factor+wind.z*.12};if(!a.wasWind)record('WIND_COMPENSATION',a.id,'Speed authority reduced; 12% residual gust checked against geometry and moving hazards.','Onboard');a.wasWind=true;}else a.wasWind=false;
      const len=Math.hypot(a.velocity.x,a.velocity.y,a.velocity.z);if(len>.01)a.forward={x:a.velocity.x/len,y:a.velocity.y/len,z:a.velocity.z/len};
    }
    // Layer A shares intended trajectories, never sensor knowledge. Pairwise conflict decisions
    // compare the cost of each feasible hold; slot auctions lease a conflict volume for a time window.
    for(let i=0;i<active.length;i++)for(const b of active.slice(i+1)){
      const a=active[i];if(a.done&&b.done)continue;
      const pred=cpa(a.pos,a.velocity,b.pos,b.velocity,CONFIG.tactical);
      if(pred.distance>=CONFIG.separation||pred.time<=CONFIG.immediate)continue;
      const result=choosePassage(a,b,{method:config.method,time:state.time,prediction:pred,reservations:state.reservations});
      const winner=result.winner,loser=winner===a?b:a;
      if(loser.done)continue;
      const hold=cpa(loser.pos,zero(),winner.pos,winner.velocity,CONFIG.tactical);
      if(hold.distance>=CONFIG.separation){
        loser.velocity=zero();loser.level='L1';loser.prediction=pred;loser.reason=`Yield to ${winner.id} (${METHODS[config.method]})`;
        const signature=`${a.id}/${b.id}/${winner.id}/${result.slot?.end??''}`;
        if(loser.lastCoordination!==signature){const conflict=record('INTENT_CONFLICT',loser.id,`Published intents predict CPA in ${pred.time.toFixed(2)} s at ${pred.distance.toFixed(2)} scene units.`,'Coordination',{kind:'conflict',subjectId:winner.id,prediction:{...pred}});record(config.method===1?'FIXED_PRIORITY':config.method===2?'COST_NEGOTIATION':'SLOT_AWARDED',loser.id,result.detail,'Coordination',{eventId:conflict.eventId,parentId:conflict.recordId,subjectId:winner.id});state.coordination.push({time:state.time,method:config.method,winner:winner.id,loser:loser.id,...(result.costs?{costs:result.costs}:{}),...(result.slot?{slot:{...result.slot}}:{})});loser.lastCoordination=signature;}
      }
    }
    // A lease remains enforceable between auctions. Non-winners defer entry into its
    // conflict volume until expiry; a hold is accepted only if safe against live traffic.
    if(config.method===3)for(const slot of Object.values(state.reservations))for(const a of active){
      if(a.id===slot.winner||a.done||distance(a.pos,slot.center)<slot.radius)continue;
      const entry=cpa(a.pos,a.velocity,slot.center,zero(),Math.min(CONFIG.tactical,slot.end-state.time));
      if(entry.distance<slot.radius&&active.every(b=>b===a||cpa(a.pos,zero(),b.pos,b.velocity,CONFIG.immediate).distance>=CONFIG.separation)){
        a.velocity=zero();a.level='L1';a.reason=`Slot gate: ${slot.winner} owns conflict volume until ${slot.end.toFixed(2)} s`;
      }
    }
    // Layer B acts immediately, independent of operator rank. Only locally visible dynamic objects.
    for(const a of active){if(a.done)continue;const hazards=[];
      if(sensorVisible(a,state.balloon))hazards.push({pos:state.balloon,v:bv,margin:CONFIG.balloonRadius+2,id:'balloon'});
      for(const b of active)if(b!==a&&sensorVisible(a,b.pos)){hazards.push({pos:b.pos,v:b.velocity,margin:CONFIG.separation,id:b.id});if(!a.observations[b.id]||state.time-a.observations[b.id].time>5)record('TRAFFIC_OBSERVED',a.id,`Locally visible traffic: ${b.id}.`,'Onboard',{kind:'observation',subjectId:b.id});a.observations[b.id]={pos:point(b.pos),time:state.time};}
      for(const bird of state.effects.pigeons)if(sensorVisible(a,bird.pos)){
        hazards.push({pos:bird.pos,v:bird.v,margin:bird.radius+2,id:bird.id});
        if(!a.observations.pigeons||state.time-a.observations.pigeons.time>1){a.observations.pigeons={time:state.time,pos:point(bird.pos)};state.eventMetrics.pigeonDetections++;record('PIGEON_DETECTED',a.id,'Locally sensed deterministic flock; avoidance evaluated separately.','Onboard',{kind:'observation',subjectId:bird.id});}
      }
      const threats=hazards.map(h=>({...h,...cpa(a.pos,a.velocity,h.pos,h.v,CONFIG.immediate)})).filter(h=>h.distance<h.margin);
      if(threats.length){const p=threats.sort((a,b)=>a.time-b.time)[0];a.level=distance(a.pos,p.pos)<p.margin?'L3':responseLevel(p.time);a.prediction={time:p.time,distance:p.distance};a.reason=`Onboard avoidance: ${p.id}`;
        if(a.lastThreat!==p.id)record('PREDICTED_CONFLICT',a.id,`Onboard CPA ${p.time.toFixed(2)} s, separation ${p.distance.toFixed(2)} scene units; margin ${p.margin}.`,'Onboard',{kind:'conflict',subjectId:p.id,prediction:{time:p.time,distance:p.distance,margin:p.margin}});a.lastThreat=p.id;
        const v=evade(a,hazards);a.velocity=v??zero();if(!v){a.reason='UNRESOLVED: no validated escape; review required';a.level='L3';}
        a.needsReplan=true;
      }else a.lastThreat=null;
    }
    // Validate proposed static motion BEFORE checking joint motion: another agent may now be stopped.
    for(const a of active)if(blocked(a.pos,add(a.pos,a.velocity,dt))){const crowd=crowdBlocked(a.pos,add(a.pos,a.velocity,dt));a.velocity=zero();a.level='L3';a.reason=crowd?'Published crowd zone: low overflight prohibited':'Static constraint blocked motion';if(crowd)state.crowdStops++;a.needsReplan=true;}
    // Omniscient environment guard is explicitly separate from onboard sensing.
    const dynamic=[{pos:state.balloon,v:bv,margin:CONFIG.balloonRadius+.6,id:'balloon'},...state.effects.pigeons.map(b=>({pos:b.pos,v:b.v,margin:b.radius+2,id:b.id}))];
    const traffic=a=>active.filter(b=>b!==a).map(b=>({pos:b.pos,v:b.velocity,margin:CONFIG.separation}));
    for(const a of active){if(a.done)continue;const threats=dynamic.filter(h=>{const d=distance(a.pos,h.pos);return cpa(a.pos,a.velocity,h.pos,h.v,h.id==='balloon'?dt:CONFIG.immediate).distance<h.margin&&d>=h.margin;});if(threats.length){const v=evade(a,[...dynamic,...traffic(a)]);a.velocity=v??zero();a.level='L3';a.reason=`Simulator environment guard: ${threats[0].id}`;a.needsReplan=true;state.eventMetrics.dynamicGuardStops++;}}
    // Persistent joint holds need a checked escape, rather than indefinitely freezing both
    // agents. One mover at a time uses the shared simulator safety fallback for every method.
    const recovering=active.find(a=>a.recoveryUntil>state.time&&!a.done);
    const mover=recovering??[...active].filter(a=>!a.done&&(a.guardStall??0)>2).sort(fixedPriority)[0];
    if(mover){
      const hazards=[...dynamic,...traffic(mover)],escape=recovering?mover.recoveryVelocity:evade(mover,hazards);
      if(escape&&Math.hypot(escape.x,escape.y,escape.z)>.1&&!blocked(mover.pos,add(mover.pos,escape,dt))&&hazards.every(h=>{const current=distance(mover.pos,h.pos),pred=cpa(mover.pos,escape,h.pos,h.v,CONFIG.immediate);return pred.distance>=h.margin||current<h.margin&&pred.distance>=current-.001;})){
        if(!recovering){mover.recoveryUntil=state.time+1.5;mover.recoveryVelocity=escape;record('GUARD_RECOVERY',mover.id,'Persistent joint hold: checked temporary escape, then replan.','Simulator guard');}
        mover.velocity=escape;mover.level='L3';mover.reason='Simulator checked hold recovery';mover.needsReplan=true;
      }else{mover.recoveryUntil=0;mover.guardStall=0;}
    }
    // Joint swept-motion guard is an explicit simulator safety net (omniscient, distinct from perception).
    for(let pass=0;pass<active.length;pass++)for(const a of active)for(const b of active){
      if(fixedPriority(a,b)<=0||a.done)continue;
      if(cpa(a.pos,a.velocity,b.pos,b.velocity,dt).distance<CONFIG.separation&&distance(a.pos,b.pos)>=CONFIG.separation){
        a.velocity=zero();a.level='L3';a.reason=`Simulator swept guard: ${b.id}`;
        if(cpa(a.pos,a.velocity,b.pos,b.velocity,dt).distance<CONFIG.separation){b.velocity=zero();b.level='L3';b.reason=`Simulator joint hold: ${a.id}`;}
      }
    }
    for(const a of active){if(a.done)continue;
      let next=add(a.pos,a.velocity,dt);
      if(blocked(a.pos,next)){next=a.pos;a.velocity=zero();a.level='L3';a.reason=crowdBlocked(a.pos,next)?'Published crowd zone: low overflight prohibited':'Static constraint blocked motion';a.needsReplan=true;}
      const moved=distance(a.pos,next);a.guardStall=moved<.001&&(a.reason.startsWith('Simulator')||a.reason.startsWith('UNRESOLVED'))?(a.guardStall??0)+dt:0;a.travel+=moved*5;if(moved<.001&&!a.done)a.wait+=dt;
      a.battery=Math.max(0,a.battery-dt*.015-moved*.025);a.pos=point(next);
      if(a.battery<10){a.state='Aborted: low battery';a.done=true;a.velocity=zero();record('ABORT',a.id,'Low battery; no certified contingency landing modeled.','Onboard');}
      if(a.route[0]&&distance(a.pos,a.route[0])<1e-7)a.route.shift();
      if(a.needsReplan&&a.level==='L0'&&state.time-a.lastPlan>1){a.route=[];a.needsReplan=false;}
      if(state.tick%10===0)a.history.push(point(a.pos));
      if(a.lastResponse!==a.level+a.reason){
        const old=episodes[a.id];
        if(old)record('RESPONSE_ENDED',a.id,`Observed response ended; next state: ${a.reason}. No causal success assumed.`,old.layer,{kind:'outcome',eventId:old.eventId,parentId:old.recordId,position:responseBefore[a.id].pos});
        const row=record(a.level,a.id,a.reason,a.reason.startsWith('Simulator')?'Simulator guard':a.level==='L2'||a.level==='L3'?'Onboard':'UTM',{position:responseBefore[a.id].pos,velocity:point(a.velocity),prediction:a.prediction?{...a.prediction}:null});
        if(a.level!=='L0'){
          const cause=[...state.log].reverse().find(e=>e!==row&&e.agentId===a.id&&e.time===state.time&&['conflict','decision'].includes(e.kind)&&!['outcome'].includes(e.kind));
          if(cause){row.parentId=cause.recordId;row.eventId=cause.eventId;}
          const type=sourceType(a.reason.toUpperCase());if(type&&config.events.includes(type)&&state.time>=EVENT_SCHEDULE[type].start&&state.time<EVENT_SCHEDULE[type].end)row.worldEventId=worldId(type);
          episodes[a.id]=row;
        }else{delete episodes[a.id];a.lastThreat=null;}
        a.lastResponse=a.level+a.reason;
      }
    }
    const contacts=[];
    for(let i=0;i<active.length;i++){
      const a=active[i],clearance=distance(a.pos,state.balloon)-CONFIG.balloonRadius;
      state.minBalloonClearance=Math.min(state.minBalloonClearance??Infinity,clearance*5);
      if(clearance<.6)contacts.push(`${a.id}:balloon`);
      for(const bird of state.effects.pigeons)if(distance(a.pos,bird.pos)<bird.radius+.6)contacts.push(`${a.id}:${bird.id}`);
      for(const b of active.slice(i+1)){const d=distance(a.pos,b.pos)*5;state.minSeparation=Math.min(state.minSeparation??Infinity,d);if(d<6)contacts.push(`${a.id}:${b.id}`);if(d<CONFIG.separation*5){const key=`near:${a.id}:${b.id}`;if(!state.contacts.includes(key))state.nearMisses++;contacts.push(key);}}
    }
    state.collisions+=contacts.filter(k=>!k.startsWith('near:')&&!state.contacts.includes(k)).length;state.contacts=contacts;
    if(state.time>=CONFIG.duration){state.finished=true;record('RUN_COMPLETE',null,'150 s observation window ended. Incomplete missions remain incomplete.');}
    if(state.tick%5===0)capture();
  }
  reset();return {get config(){return config;},get state(){return state;},tick,reset,historical,get frames(){return frames;},crowdBlocked,approve(operator,id,accept){const l=state.landmarks[operator]?.[id];if(l?.status==='proposed')l.status=accept?'approved':'rejected';},snapshot(){return JSON.parse(JSON.stringify({config,pads,environment:{route:PARADE_ROUTE,policy:PARADE,crowdZones:CROWD_ZONES,eventSchedule:EVENT_SCHEDULE},...state}));}};
}
