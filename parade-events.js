// Exogenous schedules: scene units are 5 m. Never depend on agents, policy or selection order.
export const EVENT_SCHEDULE=Object.freeze({
 balloon:{name:'Balloon Drift',start:20,end:42},
 pigeons:{name:'Pigeon Flock',start:26,end:54},
 confetti:{name:'Confetti',start:38,end:62},
 wind:{name:'Wind Gust',start:68,end:86}
});
// Pigeon flocks: 4 flocks of 1–3 birds with pseudo-random (fixed-seed) crossing points, headings, altitudes and start times inside the 26–54 s window.
// The seed is fixed so every run and replay is identical; nothing depends on drones, method or selection.
function seeded(seed){return()=>{seed|=0;seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
export const PIGEON_FLOCKS=(()=>{
 const R=seeded(2025),flocks=[];let n=0;
 for(let k=0;k<4;k++){
  const size=1+Math.floor(R()*3),dur=12+R()*4,start=k===0?26:+(28+k*5+R()*4).toFixed(2),end=Math.min(54,start+dur),speed=2.4+R()*.8;
  const a=R()*Math.PI*2,dx=Math.cos(a),dz=Math.sin(a),cx=-40+R()*80,cz=-40+R()*80,half=speed*(end-start)/2;   // crosses (cx,cz) at mid-flight
  flocks.push({id:k+1,size,start,end,speed,dx,dz,x0:cx-dx*half,z0:cz-dz*half,y:9+R()*7,
   birds:Array.from({length:size},()=>({id:`PIGEON-${++n}`,px:(R()-.5)*1.4,py:(R()-.5)*1.2,pz:(R()-.5)*1.4}))});
 }
 return Object.freeze(flocks);
})();
export const EVENT_IDS=Object.keys(EVENT_SCHEDULE);
export function eventsAt(t,enabled=[]){
 const has=id=>enabled.includes(id)&&t>=EVENT_SCHEDULE[id].start&&t<EVENT_SCHEDULE[id].end;
 const pigeons=[];
 if(has('pigeons'))for(const f of PIGEON_FLOCKS){if(t<f.start||t>=f.end)continue;f.birds.forEach((b,i)=>{const u=t-f.start;pigeons.push({id:b.id,pos:{x:f.x0+f.dx*f.speed*u+b.px,y:f.y+b.py,z:f.z0+f.dz*f.speed*u+b.pz},v:{x:f.dx*f.speed,y:0,z:f.dz*f.speed},radius:.45});});}
 const confetti=has('confetti')?{pos:{x:8+(t-38)*.22,y:14,z:-8},radius:8,density:.75}:null;
 const strength=has('wind')?Math.sin((t-68)/18*Math.PI)**2:0;
 return {pigeons,confetti,wind:{x:.65*strength,y:0,z:-.35*strength},active:EVENT_IDS.filter(has)};
}
export function segmentInCloud(a,b,cloud){
 if(!cloud)return false;
 const d={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},len=d.x*d.x+d.y*d.y+d.z*d.z;
 const u=len?Math.max(0,Math.min(1,((cloud.pos.x-a.x)*d.x+(cloud.pos.y-a.y)*d.y+(cloud.pos.z-a.z)*d.z)/len)):0;
 return Math.hypot(a.x+d.x*u-cloud.pos.x,a.y+d.y*u-cloud.pos.y,a.z+d.z*u-cloud.pos.z)<cloud.radius;
}
