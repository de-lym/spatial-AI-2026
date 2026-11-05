import {waypointSpeed} from './inspection.js';
/** Pure proximity geometry. Scene axes: x east / y up / z south; distances in scene units. */
export const proximityConfig = {
  birdClearanceM: 18, birdLookS: 2, birdUncertaintyM: 4,
  recoveryS: 2, escalateS: 8, escapeM: 35,
};
export const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const mix = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
export function closestApproach(a,b,c,d) {
  const r = [a.x-c.x,a.y-c.y,a.z-c.z];
  const v = [b.x-a.x-d.x+c.x,b.y-a.y-d.y+c.y,b.z-a.z-d.z+c.z];
  const vv = v.reduce((s,x)=>s+x*x,0);
  const t = vv ? Math.max(0,Math.min(1,-r.reduce((s,x,i)=>s+x*v[i],0)/vv)) : 0;
  return Math.hypot(...r.map((x,i)=>x+t*v[i]));
}
/** Exact piecewise route prediction, including waypoint turns and vertical speed. */
export function trajectory(c, seconds, factor=1, speed=4, verticalFactor=.7) {
  const out = [{t:0,p:{...c.pos}}]; let p={...c.pos}, t=0;
  if (c.task && !c.hold && !c.placementWaiting && !c.inspectionLandingBlocked && factor>0) for (const w of c.task.route.pts.slice(c.task.route.idx)) {
    const d=distance(p,w); if (d<1e-9) continue;
    const v=waypointSpeed(p,w,speed,verticalFactor)*factor;
    const need=d/v, used=Math.min(need,seconds-t);
    const q=mix(p,w,used/need); t+=used; out.push({t,p:q}); p=q;
    if(t>=seconds-1e-9) break;
  }
  if(t<seconds) out.push({t:seconds,p});
  return out;
}
export function at(path,t) {
  for(let i=1;i<path.length;i++) if(t<=path[i].t+1e-9) {
    const a=path[i-1],b=path[i]; return mix(a.p,b.p,(t-a.t)/(b.t-a.t||1));
  }
  return path.at(-1).p;
}
export function pathCPA(a,b) {
  const times=[...new Set([...a,...b].map(x=>x.t))].sort((x,y)=>x-y);
  let min=Infinity;
  for(let i=1;i<times.length;i++) min=Math.min(min,closestApproach(at(a,times[i-1]),at(a,times[i]),at(b,times[i-1]),at(b,times[i])));
  return min;
}
export function boxSurfaceDistance(p,o) {
  return Math.hypot(Math.max(o.x0-p.x,0,p.x-o.x1),Math.max((o.y0??0)-p.y,0,p.y-o.h),Math.max(o.z0-p.z,0,p.z-o.z1));
}
/** If already inside a margin, only non-worsening, strictly separating motion is admissible. */
export function unsafeApproach(a,b,margin) {
  const initial=distance(a[0].p,b[0].p), min=pathCPA(a,b);
  if(initial<margin) return min<initial-1e-6 || distance(a.at(-1).p,b.at(-1).p)<=initial+1e-6;
  return min<margin;
}
/** Seeded changes make the bird unpredictable to the constant-velocity predictor, reproducible in tests. */
export function createBird(seed=19) {
  let s=seed;
  const random=()=>((s=(s*16807)%2147483647)/2147483647);
  return {id:'P-01',pos:{x:12,y:12,z:8},prev:{x:12,y:12,z:8},velocity:{x:0,y:0,z:0},turnIn:0,life:0,
    step(dt,bounds=55) {
      this.prev={...this.pos}; this.life+=dt; this.turnIn-=dt;
      if(this.turnIn<=0) {
        const angle=random()*Math.PI*2, speed=1+random()*1.5;
        this.velocity={x:Math.cos(angle)*speed,y:(random()-.5)*.7,z:Math.sin(angle)*speed};
        this.turnIn=.4+random()*.8;
      }
      for(const k of ['x','y','z']) this.pos[k]+=this.velocity[k]*dt;
      for(const k of ['x','z']) if(Math.abs(this.pos[k])>bounds) {this.pos[k]=Math.sign(this.pos[k])*bounds;this.velocity[k]*=-1;}
      if(this.pos.y<4||this.pos.y>22) {this.pos.y=Math.max(4,Math.min(22,this.pos.y));this.velocity.y*=-1;}
    },
  };
}
export function birdPath(b,seconds) {return [{t:0,p:{...b.pos}},{t:seconds,p:{x:b.pos.x+b.velocity.x*seconds,y:b.pos.y+b.velocity.y*seconds,z:b.pos.z+b.velocity.z*seconds}}];}
