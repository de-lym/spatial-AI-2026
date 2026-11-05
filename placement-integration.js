import * as THREE from 'three';
import {SKYBRIDGE,placementFacts} from './placements.js';

/** Keep the opening real: each tower and the elevated span has its own solid AABB. */
export function buildPlacementArchitecture({scene,world,setLU,slab=.4}) {
  const reserved=new Set(['-32,-32','-16,-32']);
  for(const child of [...scene.children]) if(reserved.has(child.userData.fillerParcel))scene.remove(child);
  world.obstacles=world.obstacles.filter(o=>![-32,-16].some(x=>(o.x0+o.x1)/2>x-6&&(o.x0+o.x1)/2<x+6&&(o.z0+o.z1)/2>-38&&(o.z0+o.z1)/2<-26));
  const group=new THREE.Group();group.name='Skybridge architecture';scene.add(group);
  for(const [o,color] of [[SKYBRIDGE.west,0xe8e6e2],[SKYBRIDGE.east,0xe8e6e2],[SKYBRIDGE.span,0xbcc5d0]]) {
    world.obstacles.push({...o,typo:o.id==='SB-01'?'skybridge':'tower'});
    const geo=new THREE.BoxGeometry(o.x1-o.x0,o.h-o.y0,o.z1-o.z0);
    const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:.9}));
    mesh.position.set((o.x0+o.x1)/2,slab+(o.y0+o.h)/2,(o.z0+o.z1)/2);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
    // Facade ledges lie within the same collision envelope, so decoration does not fill the opening.
    for(let y=o.y0+1;y<o.h;y+=2) {
      const strip=new THREE.Mesh(new THREE.BoxGeometry(o.x1-o.x0,.08,o.z1-o.z0),new THREE.MeshStandardMaterial({color:0xd0d0cc}));
      strip.position.set(mesh.position.x,slab+y,mesh.position.z);group.add(strip);
    }
  }
  setLU(-32,-32,'cbd','West Tower / Skybridge');setLU(-16,-32,'cbd','East Tower / Skybridge');
  world.landmarks.push({name:'Skybridge SB-01',x:-24,z:-32});
  // Floor markings explain the two parallel routes without acting as solid obstacles.
  for(const x of SKYBRIDGE.lanes) {
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x,slab+.04,SKYBRIDGE.entryZ),new THREE.Vector3(x,slab+.04,SKYBRIDGE.exitZ)]),new THREE.LineDashedMaterial({color:0x7f8b94,dashSize:.6,gapSize:.5}));line.computeLineDistances();group.add(line);
  }
  return group;
}
export function installPlacements({S,cfg,world,ops,planRoute,segCheck,resetWorld,setStage,selectDrone,toast,camera,controls,setAdvanced,updatePanels}) {
  const state={mode:'idle',pending:new Map(),members:[],facts:new Map(),version:0,history:[]};
  const emit=(code,title,description,id=null)=>{
    const event={code,title,description,droneId:id,occurredAtSimSeconds:S.time,source:'placement'};
    ops.update(event);state.history.push(event);if(state.history.length>300)state.history.shift();
  };
  const factsFor=c=>placementFacts(c,S.couriers,{separationM:cfg.sepM});
  function focus(){controls.target.set(-24,9,-32);camera.position.copy(controls.target).add(new THREE.Vector3(6,24,80));camera.zoom=1.0;camera.updateProjectionMatrix();controls.update();}
  function reset(){state.mode='idle';state.pending.clear();state.members=[];state.facts.clear();state.history=[];for(const c of S.couriers){c.placementWaiting=false;c.placementTour=null;}state.version++;render();}
  function start(){
    if(cfg.sepM>35){toast('The two lanes are 35 m apart. Set drone separation to 35 m or less before starting this tour.');return false;}
    const a={x:SKYBRIDGE.lanes[0],y:10,z:SKYBRIDGE.entryZ},b={...a,z:SKYBRIDGE.exitZ};
    if(SKYBRIDGE.lanes.some(x=>segCheck({...a,x},{...b,x}))) {toast('The passage is blocked by current clearance or airspace settings. Adjust the rules, then retry.');return false;}
    resetWorld(true);state.mode='assembling';state.members=['D-01','D-02'];
    state.members.forEach((id,i)=>state.pending.set(id,SKYBRIDGE.lanes[i]));
    S.intake=false;setStage(4);S.running=true;selectDrone('D-01',null);setAdvanced(false);focus();
    emit('PLACEMENT_TOUR_START','Placement tour started','D-01 and D-02 will meet at the entrance, then fly through parallel lanes. Delivery orders continue afterward.');
    toast('Tour started. The two drones will meet before entering the passage.');render();updatePanels(true);return true;
  }
  function decoratePlan(c,original,dest) {
    if(!state.pending.has(c.id))return original;
    const x=state.pending.get(c.id),entry={x,y:10,z:SKYBRIDGE.entryZ},exit={x,y:10,z:SKYBRIDGE.exitZ};
    const legs=[planRoute(c.pos,entry),planRoute(entry,exit,{only:10}),planRoute(exit,dest)];
    if(legs.some(p=>!p.ok)) {
      state.mode='blocked';state.pending.delete(c.id);
      emit('PLACEMENT_TOUR_BLOCKED','Placement tour unavailable',`${c.id}: no validated complete route. Original delivery routing remains active.`,c.id);return original;
    }
    const pts=legs.flatMap(p=>p.pts.map(q=>({...q}))),entryIdx=legs[0].pts.length;
    pts[entryIdx-1].phase='placement_wait';
    const meta={id:c.id,entryIdx,released:false,routeId:null};
    const best={...legs[0].mission.best,id:'A',label:'Placement tour via Skybridge SB-01',pts,len:legs.reduce((s,p)=>s+p.len,0),chosen:true};
    best.lenM=best.len*5;state.pending.delete(c.id);
    const plan={...legs[0].mission,ok:true,best,candidates:[best],to:{...dest},placementTour:meta};
    return plan;
  }
  function beforePlan(){
    const members=state.members.map(id=>S.couriers.find(c=>c.id===id)).filter(Boolean);
    const ready=c=>c.placementTour&&c.task?.route.plan.placementTour===c.placementTour&&c.task.route.idx>=c.placementTour.entryIdx;
    const interrupted=members.some(c=>c.placementTour&&c.task&&c.task.route.plan.placementTour!==c.placementTour&&!c.placementTour.released);
    if(interrupted||state.mode==='blocked') {
      if(state.mode!=='interrupted'){state.mode='interrupted';emit('PLACEMENT_TOUR_INTERRUPTED','Tour interrupted','Traffic or new obstacles changed a tour route. Normal delivery and proximity checks remain active.');}
      for(const c of members){c.placementWaiting=false;if(c.placementTour)c.placementTour.released=true;}
      state.pending.clear();
    } else if(state.mode==='assembling'&&members.length===2&&members.every(ready)) {
      state.mode='crossing';for(const c of members){c.placementTour.released=true;c.placementWaiting=false;}
      emit('PLACEMENT_TOUR_RELEASE','Both drones ready','Two validated lanes, 35 m apart. Entering the building passage together.');
    }
    for(const c of members)c.placementWaiting=!!(state.mode==='assembling'&&ready(c)&&!c.placementTour.released);
    if(state.mode==='assembling'&&S.time>120){state.mode='interrupted';for(const c of members){c.placementWaiting=false;if(c.placementTour)c.placementTour.released=true;}state.pending.clear();emit('PLACEMENT_TOUR_TIMEOUT','Tour assembly timed out','Normal delivery routing resumes; the current rules or traffic prevented the rendezvous.');}
  }
  function gate(){for(const c of S.couriers)if(c.placementWaiting)c.sepFactor=0;}
  function afterMove(){
    for(const c of S.couriers){
      const current=factsFor(c),previous=state.facts.get(c.id)??[];
      const key=f=>f.relation+':'+f.referenceIds.join(',');
      for(const f of current)if(!previous.some(p=>key(p)===key(f)))emit('PLACEMENT_ENTER',f.label,`${c.id} · ${f.relation} · ${f.referenceIds.join(' + ')}`,c.id);
      for(const f of previous)if(!current.some(p=>key(p)===key(f)))emit('PLACEMENT_EXIT',`Left: ${f.label}`,`${c.id} · relation no longer holds.`,c.id);
      state.facts.set(c.id,current);
    }
    if(state.mode==='crossing'&&state.members.every(id=>{const c=S.couriers.find(c=>c.id===id);return c&&(c.pos.z-(SKYBRIDGE.span.z0+SKYBRIDGE.span.z1)/2)*Math.sign(SKYBRIDGE.exitZ-SKYBRIDGE.entryZ)>(SKYBRIDGE.span.z1-SKYBRIDGE.span.z0)/2+2;})) {
      state.mode='complete';emit('PLACEMENT_TOUR_COMPLETE','Passage complete','The two drones crossed beneath the skybridge. Their original pickup and delivery tasks continue.');
    }
    render();
  }
  function render(){
    const out=document.getElementById('placement-facts');if(!out)return;
    document.getElementById('placement-tour-state').textContent=`Tour: ${state.mode}`;
    const hud=document.getElementById('placement-live');
    const selected=S.couriers.find(c=>c===S.selected)??S.couriers[0];
    const active=selected?factsFor(selected):[];
    hud.hidden=state.mode==='idle';
    hud.textContent=`${selected?.id??'Fleet'} · ${state.mode==='assembling'?'Meeting at the passage entrance':state.mode==='complete'?'Passage complete — continuing deliveries':state.mode==='crossing'?'Crossing the passage':state.mode}`+(active.length?'\n'+active.map(f=>f.label).join(' · '):'');
    out.replaceChildren();let count=0;
    for(const c of S.couriers)for(const f of factsFor(c)) {
      const button=document.createElement('button');button.className='event';button.type='button';button.textContent=`${c.id} · ${f.label}`;button.onclick=()=>{selectDrone(c.id,button);setAdvanced(false);};out.append(button);count++;
    }
    if(!count){const p=document.createElement('p');p.className='small';p.textContent='No matching placement right now. Start the tour to see all three relations.';out.append(p);}
  }
  const dialog=document.getElementById('dlg-placement');
  document.getElementById('placement-start').onclick=()=>{dialog.returnFocus=document.getElementById('placement-start');dialog.showModal();};
  document.getElementById('placement-cancel').onclick=()=>dialog.close();
  document.getElementById('placement-confirm').onclick=()=>{dialog.close();start();};
  document.getElementById('placement-view').onclick=()=>{setAdvanced(false);focus();};
  document.getElementById('btn-placements').onclick=()=>{setAdvanced(true);document.getElementById('sec-placement').scrollIntoView({block:'start'});};
  return {state,reset,start,focus,decoratePlan,beforePlan,gate,afterMove,factsFor,snapshot:()=>({mode:state.mode,facts:Object.fromEntries(state.facts),history:state.history})};
}
