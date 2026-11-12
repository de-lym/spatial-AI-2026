// Exogenous environment: pure functions of simulation time, never drone decisions or method.
// Existing street centers on the unchanged 16-unit city grid. One unit = 5 m.
export const PARADE_ROUTE = Object.freeze([
  [-24,-40],[8,-40],[8,-8],[40,-8],[40,24],[-24,24],[-24,-40]
].map(([x,z])=>Object.freeze({x,z})));
export const PARADE = Object.freeze({speed:.9,start:42,height:14,driftStart:20,driftPeak:30,driftEnd:42,
  crowdFloor:4.5,reservedHalfWidth:3.7,personRadius:.22,balloonRadius:4.6});
const lengths=PARADE_ROUTE.slice(1).map((p,i)=>Math.hypot(p.x-PARADE_ROUTE[i].x,p.z-PARADE_ROUTE[i].z));
export const ROUTE_LENGTH=lengths.reduce((a,b)=>a+b,0);
export function routeAt(distance){
  let d=((distance%ROUTE_LENGTH)+ROUTE_LENGTH)%ROUTE_LENGTH;
  for(let i=0;i<lengths.length;i++){
    if(d<lengths[i]||i===lengths.length-1){const a=PARADE_ROUTE[i],b=PARADE_ROUTE[i+1],dx=(b.x-a.x)/lengths[i],dz=(b.z-a.z)/lengths[i];
      return {x:a.x+dx*d,y:0,z:a.z+dz*d,dx,dz,segment:i,along:d};}
    d-=lengths[i];
  }
}
// Parallel lanes meet at mitered junctions, so people keep continuous positions
// and lane separation instead of snapping sideways when the centerline turns.
export function laneAt(distance,offset=0){
  const p=routeAt(distance),i=p.segment,n=lengths.length;
  const tangent=j=>{const a=PARADE_ROUTE[j],b=PARADE_ROUTE[j+1];return {x:(b.x-a.x)/lengths[j],z:(b.z-a.z)/lengths[j]};};
  const prev=tangent((i+n-1)%n),next=tangent((i+1)%n),u=p.along/lengths[i];
  const nx=-p.dz,nz=p.dx;
  return {...p,x:p.x+offset*(nx-prev.z*(1-u)-next.z*u),z:p.z+offset*(nz+prev.x*(1-u)+next.x*u)};
}
export function driftAt(t,enabled=true){
  // Smooth fixed pulse; baseline and event have exactly the same parade progress.
  if(!enabled||t<=PARADE.driftStart||t>=PARADE.driftEnd)return 0;
  const u=t<=PARADE.driftPeak?(t-PARADE.driftStart)/(PARADE.driftPeak-PARADE.driftStart):(PARADE.driftEnd-t)/(PARADE.driftEnd-PARADE.driftPeak);
  return u*u*(3-2*u);
}
export function balloonAt(t,enabled=true){const p=routeAt(PARADE.start+PARADE.speed*t),d=driftAt(t,enabled);
  return {x:p.x+3*d,y:PARADE.height,z:p.z-1.5*d};}
function person(id,role,p,heading,extra={}){return {id,role,pos:{x:p.x,y:0,z:p.z},heading,...extra};}
export function createSpectators(obstacles=[]){
  const people=[];let base=0;
  for(let seg=0;seg<lengths.length;seg++){
    for(let d=4;d<lengths[seg]-3;d+=1.35)for(const side of [-1,1]){
      const p=routeAt(base+d),x=p.x-p.dz*side*2.85,z=p.z+p.dx*side*2.85;
      // Keep the complete motion envelope outside buildings and junction crossings.
      if([-56,-40,-24,-8,8,24,40,56].some(q=>Math.abs((p.dx?x:z)-q)<2.9))continue;
      if(obstacles.some(o=>(o.y0??0)<1&&x>o.x0-.5&&x<o.x1+.5&&z>o.z0-.5&&z<o.z1+.5))continue;
      people.push({id:`S-${people.length}`,x,z,dx:p.dx,dz:p.dz,side,phase:people.length*2.399963});
    }base+=lengths[seg];
  }return people;
}
const staticCrowds=new WeakMap();
function staticWatchers(spectators){
  if(!staticCrowds.has(spectators))staticCrowds.set(spectators,spectators.map(s=>person(s.id,'spectator',{x:s.x,z:s.z},Math.atan2(s.dz*s.side,-s.dx*s.side),{wave:0})));
  return staticCrowds.get(spectators);
}
export function paradeAt(t,{drift=true,spectators=[],animateSpectators=true}={}){
  const progress=PARADE.start+PARADE.speed*t,balloon=balloonAt(t,drift),pulse=driftAt(t,drift);
  const watchers=animateSpectators?spectators.map((s,i)=>{
    // Sparse, bounded steps in each spectator's own sidewalk slot, reproducible at any t.
    const step=.10*Math.sin(t*.65+s.phase)**9;
    const pos={x:s.x+s.dx*step,y:0,z:s.z+s.dz*step};
    return person(s.id,'spectator',pos,Math.atan2(balloon.x-pos.x,balloon.z-pos.z),{wave:Math.max(0,Math.sin(t*1.3+i*1.7))**12});
  }):staticWatchers(spectators);
  const marchers=[];
  for(let row=0;row<8;row++)for(let col=0;col<3;col++){
    const p=laneAt(progress-8-row*1.6,(col-1)*.65);
    marchers.push(person(`M-${row}-${col}`,'marcher',{x:p.x,z:p.z},Math.atan2(p.dx,p.dz),{wave:0}));
  }
  const handlers=[];
  for(const along of [-3,0,3])for(const side of [-1,1]){
    const p=laneAt(progress+along,side*1.25);
    // Shift toward the fixed deviation, constrained inside the existing 4-unit road.
    const x=p.x+.35*pulse,z=p.z-.15*pulse;
    const anchor={x:balloon.x-p.dz*side*1.25,y:balloon.y-1.8,z:balloon.z+p.dx*side*1.25+along*.25};
    const hand={x,y:.75,z};
    const tension=Math.min(1,.35+pulse*.65);
    handlers.push(person(`H-${along}-${side}`,'handler',{x,z},Math.atan2(balloon.x-x,balloon.z-z),{wave:0,hand,anchor,tension,lean:pulse*.18}));
  }
  return {progress,balloon,drift:pulse,spectators:watchers,marchers,handlers,staticSpectators:!animateSpectators};
}
// Published event ground reservation, independent of sensing. Covers all crowd envelopes
// and the moving formation for the entire run. It is a conservative 22.5 m low-overflight
// exclusion and no-ground-landing area, not an assertion of omniscient pedestrian sensing.
export const CROWD_ZONES=Object.freeze(PARADE_ROUTE.slice(1).map((p,i)=>{
  const a=PARADE_ROUTE[i],w=PARADE.reservedHalfWidth;
  return Object.freeze({id:`PARADE-GROUND-${i}`,x0:Math.min(a.x,p.x)-w,x1:Math.max(a.x,p.x)+w,z0:Math.min(a.z,p.z)-w,z1:Math.max(a.z,p.z)+w,y0:0,h:PARADE.crowdFloor});
}));
