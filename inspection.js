/** Delivery inspection is a classroom observation simulation, not a real sensor or safety certificate. */
export const inspectionConfig={radiusM:25,preferredAltitudeM:80,speedMps:5,sectors:48,retryS:1,escalateS:8};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export function waypointSpeed(a,b,base=4,verticalFactor=.7){
  const speed=Number.isFinite(b.speedU)&&b.speedU>0?Math.min(base,b.speedU):base;
  return speed*(Math.hypot(b.x-a.x,b.z-a.z)<.01?verticalFactor:1);
}
export function buildInspectionMission(from,dest,{cfg,scale=5,planRoute,segCheck,config=inspectionConfig,bounds=Infinity}){
  const r=config.radiusM/scale,n=config.sectors;
  const limit=bounds-r-.1,centerXZ={x:Math.max(-limit,Math.min(limit,dest.x)),z:Math.max(-limit,Math.min(limit,dest.z))};
  const startAngle=Math.atan2(from.z-centerXZ.z,from.x-centerXZ.x);
  if(!(r>0&&n>=8&&config.speedMps>0))return {ok:false,reason:'Invalid inspection configuration.'};
  const levels=[...new Set([config.preferredAltitudeM,config.preferredAltitudeM+20,cfg.maxAltM-5].filter(m=>m>0&&m<=cfg.maxAltM))];
  for(const altitudeM of levels){
    const center={x:centerXZ.x,y:altitudeM/scale,z:centerXZ.z};
    const circle=Array.from({length:n+1},(_,i)=>({x:center.x+r*Math.cos(startAngle+i*2*Math.PI/n),y:center.y,z:center.z+r*Math.sin(startAngle+i*2*Math.PI/n)}));
    if(circle.slice(1).some((p,i)=>segCheck(circle[i],p)))continue;
    const approach=planRoute(from,circle[0],{base:altitudeM}),landing=planRoute(circle[n],dest);
    if(!approach.ok||!landing.ok)continue;
    const pts=approach.pts.map(p=>({...p,phase:'inspection_approach'}));
    const startIdx=pts.length;
    const speeds=circle.slice(1).map(p=>({...p,phase:'inspection_orbit',speedU:config.speedMps/scale}));
    pts.push(...speeds);
    const lengths=[0];for(let i=1;i<circle.length;i++)lengths.push(lengths.at(-1)+dist(circle[i-1],circle[i]));
    const orbit={center,radiusU:r,altitudeM,circle,startIdx,sectors:n,lengths,totalLength:lengths.at(-1),speedMps:config.speedMps};
    const best={...approach.mission.best,id:'A',chosen:true,label:`Inspection orbit · ${altitudeM} m`,pts,len:approach.len+orbit.totalLength};
    best.lenM=best.len*scale;
    return {...approach.mission,ok:true,best,candidates:[best],orbit,to:{...circle[n]}};
  }
  return {ok:false,reason:'No complete inspection orbit and onward landing route fits the current obstacles, airspace and altitude limit.'};
}
/** Progress measures actual path coverage, not wall time. A hold never advances it. */
export function orbitProgress(route,pos){
  const o=route.plan?.orbit;if(!o)return 0;
  const completed=Math.max(0,Math.min(o.sectors,route.idx-o.startIdx));
  if(completed>=o.sectors)return 1;
  if(route.idx<o.startIdx)return 0;
  const segment=o.lengths[completed+1]-o.lengths[completed];
  const partial=Math.max(0,Math.min(segment,dist(o.circle[completed],pos)));
  return Math.max(0,Math.min(1,(o.lengths[completed]+partial)/o.totalLength));
}
export function deliveryChecks(c,drones,{reserved=false,routeOK=false,cargoMatches=false}={}){
  const pad=c.task.order.customer.acc;
  const occupant=drones.find(d=>d!==c&&d.pos.y<.3&&Math.hypot(d.pos.x-pad.x,d.pos.z-pad.z)<2.5);
  const checks=[
    {id:'orbit',label:'Observation circuit complete',pass:(c.inspection?.progress??0)>=1-1e-6},
    {id:'cargo',label:'Assigned parcel aboard',pass:cargoMatches},
    {id:'route',label:'Static approach route valid',pass:routeOK},
    {id:'pad',label:'Delivery pad available',pass:!reserved&&!occupant,detail:reserved?'Pad reserved':occupant?`Occupied by ${occupant.id}`:''},
  ];
  return {passed:checks.every(c=>c.pass),checks};
}
