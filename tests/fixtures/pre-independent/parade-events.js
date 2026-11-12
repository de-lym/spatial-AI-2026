// Exogenous schedules: scene units are 5 m. Never depend on agents, policy or selection order.
export const EVENT_SCHEDULE=Object.freeze({
 balloon:{name:'Balloon Drift',start:20,end:42},
 pigeons:{name:'Pigeon Flock',start:26,end:54},
 confetti:{name:'Confetti',start:38,end:62},
 wind:{name:'Wind Gust',start:68,end:86}
});
export const EVENT_IDS=Object.keys(EVENT_SCHEDULE);
export function eventsAt(t,enabled=[]){
 const has=id=>enabled.includes(id)&&t>=EVENT_SCHEDULE[id].start&&t<EVENT_SCHEDULE[id].end;
 const pigeons=[];
 if(has('pigeons'))for(let i=0;i<12;i++){
  const u=(t-26)/28,phase=i*2.399963;
  pigeons.push({id:`PIGEON-${i+1}`,pos:{x:-40+80*u+(i%4-1.5)*.65,y:14+Math.sin(phase)*.7,z:-8+(Math.floor(i/4)-1)*.7},v:{x:80/28,y:0,z:0},radius:.45});
 }
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
