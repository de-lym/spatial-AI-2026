import * as THREE from 'three';
import {inspectionConfig as config,buildInspectionMission,orbitProgress,deliveryChecks} from './inspection.js';

export function installInspection({S,cfg,world,ops,scene,planRoute,segCheck,scale,toast,resetWorld,setStage,selectDrone,setAdvanced,camera,controls,updatePanels}){
  const state={records:new Map(),reservations:new Set(),history:[],serial:0,demo:false};
  const visuals=new Map();
  const record=(c,code,title,description,critical=false)=>{
    const ev={code,category:critical?'critical':'updates',source:'inspection',droneId:c.id,orderId:c.inspection?.orderId??c.task?.order.id??null,occurredAtSimSeconds:S.time,title,description};
    if(critical)ops.open(ev);else ops.update(ev);
    state.history.push(ev);if(state.history.length>400)state.history.shift();
  };
  function info(c,order){
    let s=state.records.get(order.id);
    if(!s){s={orderId:order.id,droneId:c.id,padId:order.customer.stationId,status:'approaching',progress:0,checks:[],attempts:0,token:null,since:S.time,lastQuarter:0,message:'Approaching the observation circuit.'};state.records.set(order.id,s);}
    c.inspection=s;return s;
  }
  const isCleared=(c,order)=>c.inspection?.orderId===order.id&&c.inspection.status==='cleared';
  function build(c,order){
    const s=info(c,order),plan=buildInspectionMission(c.pos,order.customer.acc,{cfg,scale,planRoute,segCheck,config,bounds:Math.min(world.bounds,Math.max(...world.volumes.map(v=>v.x1)),-Math.min(...world.volumes.map(v=>v.x0)),Math.max(...world.volumes.map(v=>v.z1)),-Math.min(...world.volumes.map(v=>v.z0)))});
    if(plan.ok){
      s.attempts++;s.token=`I-${order.id}-${++state.serial}`;s.status='approaching';s.progress=0;s.lastQuarter=0;s.checks=[];s.reviewAt=0;s.message='Approaching the observation circuit.';s.since=S.time;
      plan.orbit.token=s.token;
      record(c,'INSPECTION_PLANNED','Inspection route ready',`${c.id} · ${s.padId} · ${config.radiusM} m radius, ${plan.orbit.altitudeM} m altitude. Simulated observation, not real vision.`);
      ops.resolve('INSPECTION_BLOCKED',c.id,S.time);makeVisual(c,plan.orbit,order.customer.acc);
    }else{
      if(s.status!=='blocked')record(c,'INSPECTION_UNAVAILABLE','Inspection cannot start',`${c.id} · ${plan.reason}`);
      s.status='blocked';s.message=plan.reason;hideVisual(c.id);
    }
    return plan;
  }
  function prepare(){
    for(const c of S.couriers){
      c.inspectionLandingBlocked=false;
      if(c.task?.kind==='inspection'&&c.inspection&&c.task.route.plan?.orbit?.token!==c.inspection.token&&!c.hold){
        c.inspection.status='interrupted';c.inspection.message='Avoidance changed the observation route; the inspection must restart.';
        record(c,'INSPECTION_INTERRUPTED','Inspection interrupted',`${c.id} · Rebuilding a complete circuit after a route change.`);
        c.hold={reason:c.inspection.message,timer:0};
      }
      if(c.inspection?.status==='blocked'&&S.time-c.inspection.since>=config.escalateS)escalate(c,c.inspection.message);
      if(c.task?.kind==='toCustomer'&&c.inspection&&['cleared','landing_wait'].includes(c.inspection.status)){
        const availability=padAvailable(c);
        if(!availability){
          if(c.inspection.status!=='landing_wait'){c.inspection.status='landing_wait';c.inspection.waitSince=S.time;record(c,'INSPECTION_APPROACH_PAUSED','Approach paused','Delivery pad became unavailable after the check. Parcel remains aboard.');}
          c.inspectionLandingBlocked=true;c.inspection.message='Approach paused: delivery pad unavailable.';
          if(S.time-c.inspection.waitSince>=config.escalateS)escalate(c,c.inspection.message);
        }else if(c.inspection.status==='landing_wait'){
          c.inspection.status='cleared';c.inspection.message='Pad available again; approach may resume.';ops.resolve('INSPECTION_BLOCKED',c.id,S.time);record(c,'INSPECTION_APPROACH_RESUMED','Approach resumed',c.inspection.message);
        }
      }
    }
  }
  function padAvailable(c){const pad=c.task.order.customer.acc;return !state.reservations.has(c.task.order.customer.stationId)&&!S.couriers.some(d=>d!==c&&d.pos.y<.3&&Math.hypot(d.pos.x-pad.x,d.pos.z-pad.z)<2.5);}
  function escalate(c,message){
    if(!ops.state.events.some(e=>e.code==='INSPECTION_BLOCKED'&&e.droneId===c.id&&e.category==='critical'&&e.resolvedAtSimSeconds==null))record(c,'INSPECTION_BLOCKED','Inspection needs human review',`${c.id} · ${message} No delivery has been confirmed.`,true);
  }
  function motionAllowed(c){
    if(c.inspectionLandingBlocked)return false;
    if(c.task?.kind==='inspection'&&c.task.route.plan?.orbit?.token!==c.inspection?.token)return false;
    return true;
  }
  function gate(){for(const c of S.couriers)if(!motionAllowed(c))c.sepFactor=0;}
  function review(c){
    const s=c.inspection;if(!s)return false;
    if(c.task.route.idx>=c.task.route.pts.length&&c.task.route.plan?.orbit?.token===s.token){s.progress=1;if(s.lastQuarter<4){s.lastQuarter=4;record(c,'INSPECTION_PROGRESS','Observation 100%',`${c.id} · Complete flight circuit; evaluating separate landing checks.`);}}
    if(S.time<(s.reviewAt??0))return false;s.reviewAt=S.time+config.retryS;
    const route=planRoute(c.pos,c.task.order.customer.acc);
    const result=deliveryChecks(c,S.couriers,{reserved:state.reservations.has(s.padId),routeOK:route.ok,cargoMatches:c.carry.includes(c.task.order)});
    s.checks=result.checks;
    if(result.passed){
      s.status='cleared';s.message='Circuit complete. Model checks passed; approach authorized in this simulation.';s.clearedAt=S.time;
      record(c,'INSPECTION_PASSED','Model checks passed',`${c.id} · Observation complete; cargo, static approach and delivery pad checks passed. Proceeding to approach.`);
      ops.resolve('INSPECTION_BLOCKED',c.id,S.time);hideVisual(c.id);render();return true;
    }
    const message=result.checks.filter(ch=>!ch.pass).map(ch=>ch.detail||ch.label).join('; ');
    if(s.status!=='waiting'){s.waitSince=S.time;record(c,'INSPECTION_WAIT','Observation complete — checks pending',`${c.id} · ${message}. Parcel stays aboard.`);}
    s.status='waiting';s.message=message;
    if(S.time-(s.waitSince??S.time)>=config.escalateS)escalate(c,message);
    render();return false;
  }
  function afterMove(){
    for(const c of S.couriers){
      if(c.task?.kind!=='inspection'||!c.inspection)continue;
      const s=c.inspection,R=c.task.route;
      if(R.plan?.orbit?.token!==s.token)continue;
      const progress=orbitProgress(R,c.pos);s.progress=progress;
      if(progress>0&&progress<1&&s.status==='approaching'&&!c.hold){s.status='scanning';s.message='Orbiting and collecting simulated observation coverage.';record(c,'INSPECTION_SCAN_START','Scanning delivery site',`${c.id} · ${s.padId} · Progress follows actual flight along the ring.`);}
      const quarter=Math.floor(progress*4+1e-7);
      if(quarter>s.lastQuarter){s.lastQuarter=quarter;record(c,'INSPECTION_PROGRESS',`Observation ${Math.round(progress*100)}%`,`${c.id} · Circuit coverage only. Landing approval is a separate model check.`);}
      if(s.status==='scanning')s.message=(c.hold||(c.sepFactor??1)===0)?'Observation paused for clearance; coverage is not advancing.':'Orbiting and collecting simulated observation coverage.';
      updateVisual(c,R.plan.orbit);
    }
    render();
  }
  function onDelivered(c,order){
    if(!c.inspection||c.inspection.orderId!==order.id)return;
    c.inspection.status='delivered';c.inspection.message='Parcel delivered after completed observation and model checks.';record(c,'INSPECTION_DROPOFF','Inspected delivery complete',`${c.id} · Order #${order.id} delivered at ${order.customer.stationId}.`);hideVisual(c.id);render();
  }
  function canDeliver(c){return c.inspection?.orderId===c.task?.order.id&&c.inspection.status==='cleared'&&padAvailable(c);}
  function hideVisual(id){const v=visuals.get(id);if(v){scene.remove(v.group);v.group.traverse(x=>{x.geometry?.dispose();x.material?.dispose();});visuals.delete(id);}}
  function makeVisual(c,o,pad){
    hideVisual(c.id);const group=new THREE.Group();scene.add(group);
    const points=o.circle.map(p=>new THREE.Vector3(p.x,p.y+.4,p.z));
    const base=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x1f4fd1,transparent:true,opacity:.25}));group.add(base);
    const arc=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x1f4fd1,transparent:true,opacity:.95}));group.add(arc);
    const beam=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:0x1f4fd1,dashSize:.45,gapSize:.3,transparent:true,opacity:.6}));group.add(beam);
    const marker=new THREE.Mesh(new THREE.RingGeometry(1.5,1.7,32),new THREE.MeshBasicMaterial({color:0x1f4fd1,side:THREE.DoubleSide,transparent:true,opacity:.7}));marker.rotation.x=-Math.PI/2;marker.position.set(pad.x,.48,pad.z);group.add(marker);
    visuals.set(c.id,{group,arc,beam,pad});
  }
  function updateVisual(c,o){
    const v=visuals.get(c.id);if(!v)return;
    const n=Math.min(o.sectors,Math.max(0,c.task.route.idx-o.startIdx));
    const points=o.circle.slice(0,n+1).map(p=>new THREE.Vector3(p.x,p.y+.4,p.z));
    if(c.inspection.progress>0&&c.inspection.progress<1)points.push(new THREE.Vector3(c.pos.x,c.pos.y+.4,c.pos.z));
    v.arc.geometry.dispose();v.arc.geometry=new THREE.BufferGeometry().setFromPoints(points.length>1?points:[new THREE.Vector3(),new THREE.Vector3()]);
    const p=c.pos;v.beam.visible=c.inspection.status==='scanning';v.beam.geometry.dispose();v.beam.geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p.x,p.y+.4,p.z),new THREE.Vector3(v.pad.x,.5,v.pad.z)]);v.beam.computeLineDistances();
  }
  function focus(){
    const c=selected()??S.couriers.find(c=>c.inspection&&c.task?.kind==='inspection');
    if(!c||!c.inspection){toast('Wait until a drone has picked up a parcel and planned its inspection.');return;}
    const order=c.task?.order??S.orders.find(o=>o.id===c.inspection.orderId);if(!order)return;
    controls.target.set(order.customer.acc.x,Math.min(10,c.task?.route.plan?.orbit?.center.y??10),order.customer.acc.z);camera.position.copy(controls.target).add(new THREE.Vector3(22,28,60));camera.zoom=1.05;camera.updateProjectionMatrix();controls.update();selectDrone(c.id,null);setAdvanced(false);
  }
  const selected=()=>S.couriers.find(c=>c===S.selected&&c.inspection&&['inspection','toCustomer'].includes(c.task?.kind));
  function reserve(padId,blocked=true){
    if(blocked)state.reservations.add(padId);else state.reservations.delete(padId);
    for(const c of S.couriers)if(c.inspection?.padId===padId)record(c,blocked?'INSPECTION_PAD_RESERVED':'INSPECTION_PAD_RELEASED',blocked?'Test pad reserved':'Test pad released',`${padId} · Session-only teaching reservation.`);
    render();
  }
  function reset(){for(const id of [...visuals.keys()])hideVisual(id);state.records.clear();state.reservations.clear();state.history=[];state.serial=0;state.demo=false;for(const c of S.couriers){c.inspection=null;c.inspectionLandingBlocked=false;}render();}
  function startDemo(){resetWorld(true);state.demo=true;S.intake=false;setStage(4);S.running=true;selectDrone('D-01',null);setAdvanced(false);toast('Inspection demo started. Each parcel gets a full observation circuit before delivery.');updatePanels(true);}
  function label(c){const s=c?.inspection;if(!s)return 'Not started';return `${s.status.toUpperCase()} · ${Math.round(s.progress*100)}% observation · ${s.message}`;}
  function render(){
    const el=document.getElementById('inspection-list');if(!el)return;el.replaceChildren();
    const records=[...state.records.values()];
    if(!records.length){const p=document.createElement('p');p.className='small';p.textContent='No inspection yet. Pick up a parcel or start the demo.';el.append(p);}
    for(const s of records.slice(-12)){const b=document.createElement('button');b.className='event';b.type='button';b.textContent=`${s.droneId} · ${s.padId} · ${s.status.toUpperCase()} · ${Math.round(s.progress*100)}%`;b.title=s.message;b.onclick=()=>{selectDrone(s.droneId,b);focus();};el.append(b);}
    const c=S.couriers.find(c=>c===S.selected&&c.inspection)??S.couriers.find(c=>c.inspection&&c.task?.kind==='inspection')??S.couriers.find(c=>c.inspection&&c.task?.kind==='toCustomer');
    const hud=document.getElementById('inspection-live');hud.hidden=!c;
    if(c){const s=c.inspection;hud.style.top=document.getElementById('placement-live').hidden?'140px':'216px';document.getElementById('inspection-live-title').textContent=`${c.id} · ${s.padId} · ${s.status.toUpperCase()}`;document.getElementById('inspection-live-text').textContent=`${Math.round(s.progress*100)}% observation coverage · ${s.message}`;document.getElementById('inspection-progress').value=Math.round(s.progress*100);}
    const reserveButton=document.getElementById('inspection-reserve');reserveButton.disabled=!c||!['inspection','toCustomer'].includes(c.task?.kind);reserveButton.textContent=c&&state.reservations.has(c.inspection.padId)?'Test: release delivery pad':'Test: reserve delivery pad';
    document.getElementById('inspection-summary').textContent=`${records.length} inspection(s) · ${state.reservations.size} test pad reservation(s). Observation is simulated, not camera recognition.`;
  }
  const dialog=document.getElementById('dlg-inspection');document.getElementById('inspection-start').onclick=()=>{dialog.returnFocus=document.getElementById('inspection-start');dialog.showModal();};document.getElementById('inspection-cancel').onclick=()=>dialog.close();document.getElementById('inspection-confirm').onclick=()=>{dialog.close();startDemo();};
  document.getElementById('inspection-view').onclick=focus;
  document.getElementById('inspection-reserve').onclick=()=>{const c=selected()??S.couriers.find(c=>c.inspection&&c.task?.kind==='inspection');if(!c){toast('Select a drone with an active inspection.');return;}const pad=c.inspection.padId;reserve(pad,!state.reservations.has(pad));toast(state.reservations.has(pad)?`${pad} reserved for this test; delivery will wait.`:`${pad} released; checks will retry.`);};
  document.getElementById('btn-inspection').onclick=()=>{setAdvanced(true);document.getElementById('sec-inspection').scrollIntoView({block:'start'});};
  for(const [id,key] of [['inspection-radius','radiusM'],['inspection-altitude','preferredAltitudeM'],['inspection-speed','speedMps']]){const input=document.getElementById(id),value=document.getElementById(id+'-v');input.value=config[key];value.textContent=config[key];input.oninput=()=>{config[key]=Number(input.value);value.textContent=config[key];};}
  return {state,config,build,isCleared,prepare,gate,afterMove,review,onDelivered,canDeliver,motionAllowed,label,reserve,focus,startDemo,reset,snapshot:()=>({config:{...config},records:[...state.records.values()].map(s=>({...s})),reservations:[...state.reservations],history:state.history})};
}
