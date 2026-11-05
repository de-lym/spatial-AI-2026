/** Placement facts are geometric relations to named references, not exclusive flight modes. */
export const SKYBRIDGE = {
  id:'SB-01',name:'Skybridge',
  west:{id:'TW-W',name:'West Tower',x0:-35,x1:-30,z0:-36,z1:-28,y0:0,h:21},
  east:{id:'TW-E',name:'East Tower',x0:-18,x1:-13,z0:-36,z1:-28,y0:0,h:21},
  span:{id:'SB-01',name:'Skybridge span',x0:-30,x1:-18,z0:-35,z1:-29,y0:15,h:18},
  lanes:[-27.5,-20.5],entryZ:-42,exitZ:-22,altitude:10,
};
export function placementFacts(drone,drones,{scale=5,separationM=30,bridge=SKYBRIDGE}={}) {
  const p=drone.pos, {west,east,span}=bridge, facts=[];
  if(p.y<=.3)return facts;
  if(p.x>west.x1&&p.x<east.x0&&p.z>=Math.max(west.z0,east.z0)&&p.z<=Math.min(west.z1,east.z1)&&p.y<Math.min(west.h,east.h))
    facts.push({relation:'BETWEEN',referenceIds:[west.id,east.id],label:'Between the two towers'});
  if(p.x>=span.x0&&p.x<=span.x1&&p.z>=span.z0&&p.z<=span.z1&&p.y<span.y0)
    facts.push({relation:'UNDER',referenceIds:[span.id],label:'Under the skybridge'});
  for(const other of drones) {
    if(other===drone||other.pos.y<=.3)continue;
    const dx=(other.pos.x-p.x)*scale,dz=(other.pos.z-p.z)*scale,dy=(other.pos.y-p.y)*scale;
    const d=Math.hypot(dx,dy,dz),heading=drone.heading??0;
    const along=Math.abs(dx*Math.sin(heading)+dz*Math.cos(heading));
    const diff=Math.atan2(Math.sin(heading-(other.heading??0)),Math.cos(heading-(other.heading??0)));
    if(d>=separationM-1e-6&&d<=separationM+10&&Math.abs(dy)<=5&&along<=10&&Math.abs(diff)<=Math.PI/12)
      facts.push({relation:'NEXT_TO',referenceIds:[other.id],distanceM:d,label:`Next to ${other.id} · ${d.toFixed(1)} m apart`});
  }
  return facts;
}
