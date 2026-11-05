import * as THREE from 'three';
import {proximityConfig as config,trajectory,pathCPA,birdPath,createBird,distance,unsafeApproach,boxSurfaceDistance} from './proximity.js';

/** Adapter uses the existing route planner, delivery state and operations store; no second simulation clock. */
export function installProximity({S,cfg,world,scale,ops,scene,segCheck,planRoute,destOf,toast,selectDrone,prioCmp,extraState=()=>({}),onJointDeadlock=()=>false}) {
  let birds=[], sequence=0, archive=[], dropped=0;
  const conditions=new Map(), markers=new Map();
  const key=(c,cause)=>`${c.id}:${cause}`;
  function record(c,cause,action,message,extra={}) {
    const e={code:`PROX_${cause}`,droneId:c.id,orderId:c.task?.order?.id??null,
      occurredAtSimSeconds:S.time,title:`${action} · ${cause.toLowerCase()}`,
      description:`${c.id} · ${message}`,source:'proximity',action,...extra};
    if(action==='HUMAN_REQUIRED') ops.open({...e,category:'critical'}); else ops.update(e);
    archive.push({auditId:++sequence,...e,positionM:{east:c.pos.x*scale,north:-c.pos.z*scale,up:c.pos.y*scale},
      thresholds:{...config,separationM:cfg.sepM,buildingClearanceM:cfg.clearanceM}});
    if(archive.length>2000) {archive.shift();dropped++;}
  }
  function condition(c,cause,message,{immediate=false,auto='AUTO_HOLD',targets=[]}={}) {
    const k=key(c,cause); let state=conditions.get(k);
    if(!state) {
      state={droneId:c.id,cause,since:S.time,lastSeen:S.time,message,action:auto,targets}; conditions.set(k,state);
      state.reportedAction=auto;record(c,cause,auto,message,{targets});
    }
    state.lastSeen=S.time; state.message=message; state.targets=targets;
    if(state.action!=='HUMAN_REQUIRED') state.action=auto;
    if(immediate||S.time-state.since>=config.escalateS) {
      if(state.action!=='HUMAN_REQUIRED') {
        state.action='HUMAN_REQUIRED';state.reportedAction='HUMAN_REQUIRED';record(c,cause,'HUMAN_REQUIRED',message+' · review airspace / clear external hazard; no forced landing or unsafe override.',{targets});
      }
    }
  }
  const predict=(c,s,f=1)=>trajectory(c,s,f);
  const birdMargin=()=> (config.birdClearanceM+config.birdUncertaintyM)/scale;
  function birdRisk(c,f=1,h=config.birdLookS) {
    return birds.filter(b=>pathCPA(predict(c,h,f),birdPath(b,h))<birdMargin());
  }
  function tryEscape(c) {
    if(!c.task||c.hold) return false;
    // Emergency candidates remain inside the existing permitted union and obstacle clearance.
    for(const dy of [0,2,-2]) for(let i=0;i<8;i++) {
      const angle=i*Math.PI/4,r=config.escapeM/scale;
      const q={x:c.pos.x+Math.cos(angle)*r,y:c.pos.y+dy,z:c.pos.z+Math.sin(angle)*r,phase:'cruise'};
      if(segCheck(c.pos,q)) continue;
      const route={pts:[q],idx:0}, probe={pos:c.pos,task:{route}};
      const duration=distance(c.pos,q)/4;
      if(birds.some(b=>unsafeApproach(predict(probe,duration),birdPath(b,duration),birdMargin()))) continue;
      if(S.couriers.some(other=>other!==c&&other.pos.y>.3&&unsafeApproach(predict(probe,duration),predict(other,duration,other.sepFactor??1),cfg.sepM/scale))) continue;
      const plan=planRoute(q,destOf(c.task).acc);
      if(!plan.ok) continue;
      const R=c.task.route; R.pts=[q,...plan.pts];R.idx=0;R.rerouted=true;R.plan=plan.mission;
      c.rerouteWhy='to avoid an unpredictable pigeon';c.rerouteUntil=S.time+3;
      record(c,'PIGEON','AUTO_EVADE','Validated escape segment and onward route; motion remains subject to the final joint guard.');
      return true;
    }
    return false;
  }
  function prepare(dt) {
    for(const b of birds) {b.step(dt,world.bounds-3);const m=markers.get(b.id);if(m)m.position.set(b.pos.x,b.pos.y+.4,b.pos.z);}
    // The teaching bird is not constrained to navigable drone airspace. Its direction changes are hidden from prediction.
    for(const c of S.couriers) {
      c.proximityStop=false;
      if(!c.task||c.pos.y<.3) continue;
      const risks=birdRisk(c);
      if(risks.length) {
        if(S.time>=(c.nextBirdPlan??0)) {
          c.nextBirdPlan=S.time+.75;
          c.birdEvading=tryEscape(c);
        }
        const safe=c.birdEvading&&!birdRisk(c).length;
        c.proximityStop=!safe;
        condition(c,'PIGEON',`${risks.map(b=>b.id).join(', ')} predicted inside ${config.birdClearanceM} m + ${config.birdUncertaintyM} m uncertainty. ${safe?'Escape selected.':'Braking; no validated escape currently available.'}`,{auto:safe?'AUTO_EVADE':'AUTO_HOLD',targets:risks.map(b=>b.id)});
      }
      // A post-emergency quiet interval prevents repeated stop/resume oscillation.
      const p=conditions.get(key(c,'PIGEON'));
      if(!risks.length&&p&&S.time-p.lastSeen<config.recoveryS&&!c.birdEvading) c.proximityStop=true;
      if(c.blocked?.until>S.time&&!c.hold) condition(c,'BUILDING_OR_AIRSPACE','Obstacle or restricted volume detected; existing planner recalculated a validated route.',{auto:'AUTO_REROUTE'});
      if(c.hold) condition(c,'BUILDING_OR_AIRSPACE',c.hold.reason,{auto:'AUTO_HOLD'});
    }
  }
  function guard(dt) {
    const active=S.couriers.filter(c=>c.task||c.pos.y>=.3);
    for(const c of active) if(c.proximityStop)c.sepFactor=0;
    // Monotonic fixed-point stops: any stop may expose a new conflict for a higher-priority drone.
    for(let iteration=0;iteration<=active.length;iteration++) {
      let changed=false;
      for(const c of active) {
        let path=predict(c,dt,c.sepFactor??1);
        const bad=path.slice(1).some((p,i)=>segCheck(path[i].p,p.p));
        const birdBad=birds.filter(b=>unsafeApproach(path,birdPath(b,dt),birdMargin()));
        if(bad||birdBad.length) {
          if(c.sepFactor>0) {c.sepFactor=0;changed=true;}
          condition(c,bad?'BUILDING_OR_AIRSPACE':'PIGEON','Next movement rejected by swept geometry; hold is a fallback, not a guarantee.',{auto:'AUTO_HOLD'});
        }
      }
      for(let i=0;i<active.length;i++) for(let j=i+1;j<active.length;j++) {
        const a=active[i],b=active[j];
        if(a.pos.y<.3&&b.pos.y<.3) continue;
        const pa=predict(a,dt,a.sepFactor??1),pb=predict(b,dt,b.sepFactor??1);
        if(!unsafeApproach(pa,pb,cfg.sepM/scale)) continue;
        // Existing sepPlan determines right of way. Stop the yielding drone first; then recheck BOTH trajectories.
        const loser=(a.sepFactor??1)<(b.sepFactor??1)?a:(b.sepFactor??1)<(a.sepFactor??1)?b:prioCmp(a,b)<=0?b:a;
        const stop=(loser.sepFactor??1)>0?loser:loser===a?b:a;
        if((stop.sepFactor??1)>0) {stop.sepFactor=0;changed=true;}
        stop.sepBy=[...new Set([...(stop.sepBy??[]),stop===a?b.id:a.id])];
        condition(stop,'DRONE',`Yield to ${stop===a?b.id:a.id}; joint motion guard.`,{targets:[stop===a?b.id:a.id]});
      }
      if(!changed)break;
    }
    for(const c of active) {
      if(c.sep?.state==='waiting'||c.sep?.state==='yielding') condition(c,'DRONE',`Existing priority: occupied pad, deadlock boost, earlier departure, then ID; yielding to ${(c.sep.by??[]).join(', ')||'traffic'}.`,{auto:c.sepFactor===0?'AUTO_HOLD':'AUTO_SLOW',targets:c.sep.by});
      const p=predict(c,dt,c.sepFactor??1);
      const residual=birds.filter(b=>unsafeApproach(p,birdPath(b,dt),birdMargin()));
      if(residual.length) condition(c,'PIGEON','No validated safe movement: bird may enter the hold position. Unresolved proximity; human review required.',{immediate:true,targets:residual.map(b=>b.id)});
      if(segCheck(c.pos,c.pos)) condition(c,'BUILDING_OR_AIRSPACE','Current position violates clearance or permitted airspace. Cannot promise a safe hold.',{immediate:true});
      for(const other of active) if(other!==c&&c.pos.y>=.3&&other.pos.y>=.3&&distance(c.pos,other.pos)<cfg.sepM/scale) condition(c,'DRONE','Separation already breached; do not teleport or force an unsafe manoeuvre.',{immediate:true,targets:[other.id]});
      if((c.sepFactor??1)===0&&c.task) c.sep={state:'waiting',by:[...new Set([...(c.sep?.by??[]),...(c.sepBy??[])])]};
      c.jointWaitS=(c.sepFactor??1)===0&&c.task?(c.jointWaitS??0)+dt:0;
    }
    // A final guard stop can create a mutual wait not visible to the earlier planner.
    // Plan a recovery only; every affected drone stays stopped until the next full validation step.
    for(const c of active) if(c.jointWaitS>=5&&c.sep?.by?.length){
      const group=[c,...c.sep.by.map(id=>active.find(d=>d.id===id)).filter(Boolean)];
      if(group.every(d=>(d.sepFactor??1)===0)&&onJointDeadlock(group)){group.forEach(d=>{d.jointWaitS=0;d.sepFactor=0;});break;}
    }
    for(const [k,s] of conditions) if(S.time-s.lastSeen>=config.recoveryS) {
      const c=S.couriers.find(c=>c.id===s.droneId);
      if(c) {ops.resolve(`PROX_${s.cause}`,c.id,S.time);record(c,s.cause,'AUTO_RESUME','Condition clear for recovery interval; normal planning resumes.');c.birdEvading=false;}
      conditions.delete(k);
    }
    for(const s of conditions.values()) if(s.reportedAction!==s.action) {
      const c=S.couriers.find(c=>c.id===s.droneId);if(c)record(c,s.cause,s.action,s.message,{targets:s.targets});s.reportedAction=s.action;
    }
    render();
  }
  function reset() {
    for(const m of markers.values()){scene.remove(m);m.geometry.dispose();m.material.dispose();}
    markers.clear();birds=[];conditions.clear();archive=[];sequence=0;dropped=0;render();
  }
  function encounter() {
    const c=S.couriers.find(c=>c===S.selected&&c.task&&c.pos.y>4)??S.couriers.find(c=>c.task&&c.pos.y>4);
    if(!c){toast('Start Live Flight and wait until a drone is airborne above 20 m.');return false;}
    const b=createBird(19+sequence);b.id=`P-${String(markers.size+1).padStart(2,'0')}`;
    const p=predict(c,.8).at(-1).p;
    b.pos={x:p.x+3,y:p.y,z:p.z};b.velocity={x:-2,y:0,z:0};b.turnIn=1;
    if(birds.length>=8) {toast('Eight pigeons already active; use Clear pigeons first.');return false;}
    birds.push(b);
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(.45,8,6),new THREE.MeshStandardMaterial({color:0x595959}));
    mesh.position.set(b.pos.x,b.pos.y+.4,b.pos.z);scene.add(mesh);markers.set(b.id,mesh);
    record(c,'PIGEON','SCENARIO','Synthetic pigeon spawned near predicted flight path.',{targets:[b.id]});render();return true;
  }
  function clearBirds() {for(const m of markers.values()){scene.remove(m);m.geometry.dispose();m.material.dispose();}markers.clear();birds=[];toast('Pigeons cleared. Recovery still requires the quiet interval.');render();}
  function acknowledge() {
    const pending=[...conditions.values()].filter(s=>s.action==='HUMAN_REQUIRED'&&!s.acknowledged);
    for(const s of pending) {s.acknowledged=true;const c=S.couriers.find(c=>c.id===s.droneId);if(c)record(c,s.cause,'HUMAN_ACK','Operator reviewed the incident; condition remains open until the hazard clears.');}
    toast(pending.length?'Review recorded; active hazards remain open.':'No unreviewed human escalation.');render();
  }
  function building(c) {
    const nearest=world.obstacles.map(o=>({id:o.id,name:o.name,metres:boxSurfaceDistance(c.pos,o)*scale})).sort((a,b)=>a.metres-b.metres)[0];
    return nearest??{id:null,name:'No buildings',metres:null};
  }
  function snapshot() {return {schemaVersion:2,simulationOnly:true,context:extraState(),simSeconds:S.time,config:{...config,separationM:cfg.sepM,buildingClearanceM:cfg.clearanceM},birds:birds.map(b=>({id:b.id,pos:{...b.pos},velocity:{...b.velocity}})),conditions:[...conditions.values()],audit:archive,droppedAuditEvents:dropped,operations:ops.state.events};}
  function render() {
    const el=document.getElementById('prox-summary');if(!el)return;
    const states=[...conditions.values()];el.textContent=`${birds.length} pigeon(s) · ${states.length} active proximity condition(s) · ${states.filter(s=>s.action==='HUMAN_REQUIRED').length} human review(s)`;
    const list=document.getElementById('prox-active');list.replaceChildren();
    for(const s of states) {const b=document.createElement('button');b.type='button';b.textContent=`${s.droneId} · ${s.cause} · ${s.action}${s.acknowledged?' · reviewed':''}`;b.title=s.message;b.onclick=()=>selectDrone(s.droneId,b);list.append(b);}
    document.getElementById('prox-ack').disabled=!states.some(s=>s.action==='HUMAN_REQUIRED'&&!s.acknowledged);
    document.getElementById('prox-clear').disabled=!birds.length;
  }
  for(const [id,k] of [['p-bird','birdClearanceM'],['p-uncertainty','birdUncertaintyM'],['p-birdlook','birdLookS'],['p-escalate','escalateS']]) {
    const el=document.getElementById(id);el.value=config[k];document.getElementById(id+'-v').textContent=config[k];
    el.addEventListener('input',()=>{config[k]=Number(el.value);document.getElementById(id+'-v').textContent=config[k];});
  }
  document.getElementById('prox-encounter').onclick=encounter;
  document.getElementById('prox-clear').onclick=clearBirds;
  document.getElementById('prox-ack').onclick=acknowledge;
  document.getElementById('prox-export').onclick=()=>{
    try {const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'}));a.href=url;a.download='proximity-session.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Session export created.');}
    catch {toast('Export failed. Retry in a browser that permits downloads.');}
  };
  return {prepare,guard,reset,encounter,clearBirds,acknowledge,snapshot,config,conditions,building};
}
