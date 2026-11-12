// Illustrative deterministic, pairwise policies, not global optimizers or a financial market.
export const METHODS={1:'Fixed Priority',2:'Cost Negotiation',3:'Slot Bidding'};
export function delayCost(a,seconds){
 const remaining=a.route.reduce((n,p,i)=>{const prev=i?a.route[i-1]:a.pos;return n+Math.hypot(p.x-prev.x,p.y-prev.y,p.z-prev.z);},0);
 const mission=a.kind==='camera'?3:a.package?2:1;
 // Deferral gets more expensive as waiting accrues; all terms are model assumptions.
 return +(seconds*mission+(a.wait??0)*.3+(100-a.battery)*.08+remaining*.015).toFixed(6);
}
export function choosePassage(a,b,{method,time,prediction,reservations}){
 if(method===1)return {winner:a.priority<b.priority||a.priority===b.priority&&a.id<b.id?a:b,detail:'fixed priority'};
 const seconds=Math.max(.5,prediction.time+1),ca=delayCost(a,seconds),cb=delayCost(b,seconds);
 if(method===2){const winner=ca===cb?(a.id<b.id?a:b):ca>cb?a:b;return {winner,detail:`cost negotiation: defer ${a.id}=${ca}, defer ${b.id}=${cb}; minimize modeled delay cost`,costs:{[a.id]:ca,[b.id]:cb}};}
 const key=[a.id,b.id].sort().join('/');let slot=reservations[key];
 if(!slot||slot.end<=time){
  const bidA=ca+(a.wait??0)*.2,bidB=cb+(b.wait??0)*.2,winner=bidA===bidB?(a.id<b.id?a:b):bidA>bidB?a:b;
  const center={x:(a.pos.x+a.velocity.x*prediction.time+b.pos.x+b.velocity.x*prediction.time)/2,y:(a.pos.y+a.velocity.y*prediction.time+b.pos.y+b.velocity.y*prediction.time)/2,z:(a.pos.z+a.velocity.z*prediction.time+b.pos.z+b.velocity.z*prediction.time)/2};
  slot=reservations[key]={key,winner:winner.id,start:time,end:+(time+seconds+1).toFixed(2),center,radius:6,bids:{[a.id]:+bidA.toFixed(6),[b.id]:+bidB.toFixed(6)}};
 }
 return {winner:slot.winner===a.id?a:b,detail:`slot bidding: ${slot.winner} reserved conflict volume until ${slot.end.toFixed(2)} s`,slot};
}
