// Event log, map icons, per-drone event axes and the independent historical replay, mounted into the existing
// shell: Incident Queue card (log), Fleet Monitoring (event axis column) and an Event Inspector that uses the same
// floating inspector card as the drone inspector. Read-only: it never advances or modifies the simulation.
import * as THREE from 'three';
import {createReplayView} from './parade-replay-view.js';
import {buildIncidents, ANNOUNCEMENT_LEVELS} from './parade-incidents.js';
const esc = s => String(s ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const TABS = {urgent: 3, conflict: 2, notice: 1};
export function installObservability({engine,S,map,camera,controls,scene,refresh,closePanels,excludeReplay=[],logHost,fleetRoot}) {
  let replay=null, chosen=null, lastTrigger=null, knowledgeMode=false, replayView=null, replaySnapshot=null, previewClock=0;
  let cacheKey='', cachedLog=null, incidents=[], held=false, tab='urgent', lastSig='';
  const bubbles=document.createElement('div'); bubbles.className='event-bubbles'; map.append(bubbles);
  const inspector=document.createElement('aside'); inspector.className='inspector event-inspector'; inspector.id='event-inspector';
  inspector.hidden=true; inspector.setAttribute('aria-label','Event inspector'); map.append(inspector);
  inspector.innerHTML=`<div class="inspectorhead"><div><h2 id="event-title">Event</h2><small id="event-sub"></small></div><button id="event-close" aria-label="Close event inspector">×</button></div>
    <div class="inspectorart"><canvas id="event-preview-canvas" hidden aria-label="Independent historical event replay" role="img"></canvas><span class="livechip"><i></i>REPLAY · independent</span></div>
    <div class="event-replay"><span id="replay-time"></span><input id="replay-scrub" type="range" step="0.25" aria-label="Replay time"><div class="replay-buttons"><button id="replay-play">Pause</button><button id="event-replay-start">Restart</button><select id="replay-speed" aria-label="Replay speed"><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select><button id="replay-camera">Free camera</button></div><label class="auto"><input id="replay-knowledge" type="checkbox"> Agent knowledge view</label></div>
    <div class="inspectorbody"><div id="event-heading"></div><div id="event-summary"></div><div id="event-details"></div><p class="small" id="event-preview-note" role="status"></p></div>`;
  const $=id=>document.getElementById(id);
  const logNodes=new Map(), bubbleNodes=new Map(), axisNodes=new Map();
  function disposePreview(){if(replayView){replayView.dispose();replayView=null;const canvas=$('event-preview-canvas');canvas.replaceWith(canvas.cloneNode());}$('event-preview-canvas').hidden=true;}
  function close(){inspector.hidden=true;replay=null;replaySnapshot=null;disposePreview();}
  function sampleReplay(){if(!replay||!replayView)return;const stamp=Math.floor(replay.time/.25+1e-7);if(!replaySnapshot||Math.floor(replaySnapshot.time/.25+1e-7)!==stamp)replaySnapshot=engine.historical(replay.time);replayView.update(replaySnapshot,knowledgeMode);}
  function updateIncidents(){
    const key=`${Math.floor(engine.state.time*2)}:${engine.state.log.length}`;
    if(key===cacheKey&&cachedLog===engine.state.log)return;cacheKey=key;cachedLog=engine.state.log;incidents=buildIncidents(engine.state.log,engine.state.time);
  }
  function resolve(value){
    updateIncidents();
    if(value?.representative)return incidents.find(e=>e.id===value.id)??value;
    const found=incidents.find(e=>e.records.some(r=>r.recordId===value?.recordId));
    if(found)return found;
    // Raw trace records remain inspectable without being promoted to announcements.
    return {id:`record:${value.recordId}`,time:value.time,lastTime:value.time,title:value.code.replaceAll('_',' ').toLowerCase(),
      agentId:value.agentId,participants:value.agentId?[value.agentId]:[],position:value.position,severity:0,
      representative:value,records:[value],layers:[value.layer],outcome:value.kind==='outcome'?value:null,raw:true};
  }
  function start(value){
    const incident=resolve(value),e=incident.representative;chosen=incident;disposePreview();
    // The clip boundary is frozen at opening. The main simulation continues independently.
    const start=Math.max(0,Math.floor(Math.min(e.time-5,engine.state.time-13)/.25)*.25),end=Math.min(engine.state.time,start+13);
    replay={start,end,time:start,playing:true,speed:1,free:false};replaySnapshot=null;previewClock=0;
    $('replay-scrub').min=start;$('replay-scrub').max=end;$('replay-speed').value='1';$('replay-camera').textContent='Free camera';
    try{
      replaySnapshot=engine.historical(start);
      replayView=createReplayView({canvas:$('event-preview-canvas'),sourceScene:scene,exclude:excludeReplay,couriers:S.couriers,initial:replaySnapshot,focus:e.position??engine.historical(e.time).balloon,agentId:e.agentId});
      replayView.update(replaySnapshot,knowledgeMode);$('event-preview-canvas').hidden=false;replayView.render();
    }catch(error){console.error(error);disposePreview();replay.playing=false;$('event-preview-note').textContent='Replay preview is unavailable. Close and reopen this event to retry.';}
  }
  function open(value,trigger){
    const incident=resolve(value);lastTrigger=trigger??document.activeElement;close();knowledgeMode=false;$('replay-knowledge').checked=false;chosen=incident;
    closePanels();inspector.hidden=false;renderInspector();start(incident);$('event-close').focus({preventScroll:true});refresh?.();
  }
  function renderInspector(){
    if(!chosen)return;const i=chosen,e=i.representative,level=ANNOUNCEMENT_LEVELS[i.severity];
    const response=[...i.records].reverse().find(r=>/^L[123]$/.test(r.code)||['FIXED_PRIORITY','COST_NEGOTIATION','SLOT_AWARDED'].includes(r.code));
    const outcome=i.targetLoss?(i.outcome?'Target reacquired.':'Target has remained out of view for at least 2 seconds; no reacquisition recorded.'):
      i.outcome?.detail.replace(/^Observed response ended; next state: (.*)\. No causal success assumed\.$/,'Response ended. Recorded next state: $1.')??'No response-end recorded yet.';
    $('event-title').textContent=i.title;$('event-sub').textContent=`${i.participants.join(' ↔ ')||'Environment'} · T + ${i.time.toFixed(2)} s`;
    $('event-heading').innerHTML=`<p class="severity-badge severity-${i.severity}">${level?`${level.icon} ${level.name}`:'Trace detail'} · ${esc(i.layers.join(' / '))}</p>`;
    $('event-summary').innerHTML=`<h3>What happened</h3><p>${esc(i.targetLoss?'Camera target was lost through the actual sensor checks.':i.title==='Simulator safety intervention'?'The simulator safety layer intervened in proposed motion.':i.subject==='balloon'?'The balloon conflicted with the drone’s predicted safety envelope.':i.subject==='pigeons'?'The drone responded to a locally sensed flock.':e.detail)}</p><h3>Agent response</h3><p>${esc(response?.detail??(i.targetLoss?'Search uses the last observed target position.':'See the recorded steps below.'))}</p><h3>Recorded outcome</h3><p>${esc(outcome)}</p>`;
    $('event-details').innerHTML=`<details><summary>Recorded steps · ${i.records.length}</summary><div class="event-linked">${i.records.map(r=>`<p><b>${r.time.toFixed(2)} s · ${esc(r.agentId??'World')} · ${esc(r.layer)}</b><br>${esc(r.detail)}</p>`).join('')}</div></details><details><summary>Technical details</summary><dl><dt>Encounter</dt><dd>${esc(i.id)}</dd><dt>Record</dt><dd>${esc(e.recordId)}</dd><dt>Event</dt><dd>${esc(e.eventId)}</dd><dt>Response level</dt><dd>${esc(e.level)}</dd><dt>Position (scene units)</dt><dd>${e.position?Object.values(e.position).map(v=>v.toFixed(2)).join(', '):'World trigger'}</dd><dt>World source</dt><dd>${esc(e.worldEventId)}</dd></dl></details>`;
    $('event-preview-note').textContent='Independent historical replay · the main experiment stays live';
  }
  $('event-close').onclick=()=>{close();refresh?.();if(lastTrigger?.isConnected)lastTrigger.focus({preventScroll:true});};
  $('event-replay-start').onclick=()=>{if(replay){replay.time=replay.start;replay.playing=true;replaySnapshot=null;sampleReplay();}};
  const hold=event=>{held=true;event.currentTarget.setPointerCapture?.(event.pointerId);};
  addEventListener('pointerup',()=>{setTimeout(()=>held=false,0);});addEventListener('pointercancel',()=>{held=false;});
  const counts=()=>({urgent:incidents.filter(i=>i.severity===3).length,conflict:incidents.filter(i=>i.severity===2).length,notice:incidents.filter(i=>i.severity===1).length});
  function syncCards(){
    if(held)return;
    const sig=`${incidents.map(i=>i.id+':'+i.lastTime+':'+i.severity+':'+(i.outcome?1:0)).join('|')}#${tab}#${chosen?.id}#${inspector.hidden}`;
    const cn=document.getElementById('event-log-count');if(cn)cn.textContent=incidents.length;
    if(sig===lastSig)return;lastSig=sig;
    // Incident Queue card: newest first, filtered by tab. One entry per encounter.
    const rows=incidents.filter(i=>tab==='all'||i.severity===TABS[tab]).sort((a,b)=>b.lastTime-a.lastTime),valid=new Set();
    logHost.querySelector('.empty')?.remove();
    for(const i of rows){
      valid.add(i.id);let b=logNodes.get(i.id);
      if(!b){b=document.createElement('button');b.type='button';b.dataset.encounter=i.id;b.onpointerdown=hold;b.onclick=()=>open(incidents.find(e=>e.id===b.dataset.encounter),b);logNodes.set(i.id,b);}
      b.className=`event severity-${i.severity}${chosen?.id===i.id&&!inspector.hidden?' selected':''}`;
      const html=`<strong>${ANNOUNCEMENT_LEVELS[i.severity].name} · T+${i.time.toFixed(1)} · ${esc(i.participants.join(' / '))}</strong><span>${esc(i.title)}${i.outcome?(i.targetLoss?' · target reacquired':' · response ended'):''}</span>`;
      if(b.dataset.html!==html){b.innerHTML=html;b.dataset.html=html;}b.title='Open details and independent replay. The main simulation keeps running.';
    }
    for(const [key,b] of logNodes)if(!valid.has(key)){b.remove();logNodes.delete(key);}
    let prev=null;for(const i of rows){const b=logNodes.get(i.id);if(prev?prev.nextSibling!==b:logHost.firstChild!==b)logHost.insertBefore(b,prev?prev.nextSibling:logHost.firstChild);prev=b;}
    if(!rows.length&&!logHost.querySelector('.empty')){const p=document.createElement('div');p.className='empty';p.textContent='No important encounters yet. Events will appear here as drones respond.';logHost.append(p);}
    // Per-drone event axes (shared 0–150 s scale), grouped when markers would overlap.
    const used=new Set();
    for(const agent of engine.state.agents){
      const track=fleetRoot.querySelector(`[data-events-for="${agent.id}"]`);if(!track)continue;
      const mine=incidents.filter(i=>i.participants.includes(agent.id));
      const bins=Math.max(1,Math.floor(track.clientWidth/30)),groups=new Map();
      for(const i of mine){const bin=Math.min(bins-1,Math.floor(i.time/150*bins));if(!groups.has(bin))groups.set(bin,[]);groups.get(bin).push(i);}
      for(const [bin,group] of groups){const key=`${agent.id}/${bin}`;used.add(key);let b=axisNodes.get(key);
        if(!b){b=document.createElement('button');b.type='button';b.onpointerdown=hold;b.onclick=()=>{const list=JSON.parse(b.dataset.encounters).map(id=>incidents.find(i=>i.id===id)).filter(Boolean);if(!list.length)return;open(list[0],b);if(list.length>1){const choices=document.createElement('div');choices.className='event-group';choices.innerHTML='<h3>Events at this time</h3>';for(const i of list){const x=document.createElement('button');x.textContent=`${i.time.toFixed(2)} s · ${i.title}`;x.onclick=()=>open(i,b);choices.append(x);}$('event-details').prepend(choices);}};track.append(b);axisNodes.set(key,b);}
        const severity=Math.max(...group.map(i=>i.severity));b.dataset.encounters=JSON.stringify(group.map(i=>i.id));b.style.left=`${group[0].time/150*100}%`;
        b.className=`agent-event severity-${severity}${group.some(i=>i.id===chosen?.id&&!inspector.hidden)?' selected':''}`;
        b.textContent=group.length>1?String(group.length):ANNOUNCEMENT_LEVELS[severity].icon;
        b.title=group.map(i=>`${i.time.toFixed(2)} s · ${ANNOUNCEMENT_LEVELS[i.severity].name} · ${i.title}`).join('\n');b.setAttribute('aria-label',`${agent.id}: ${b.title}`);
      }
    }
    for(const [key,b] of axisNodes)if(!used.has(key)){b.remove();axisNodes.delete(key);}
  }
  function project(){
    if(held)return;
    const t=engine.state.time,rect=map.getBoundingClientRect(),isOpen=!inspector.hidden;
    const rows=incidents.filter(i=>i.time<=t&&(i.lastTime>=t-12||isOpen&&chosen?.id===i.id)&&i.position).sort((a,b)=>Number(isOpen&&chosen?.id===b.id)-Number(isOpen&&chosen?.id===a.id)||b.severity-a.severity||b.lastTime-a.lastTime);
    const placed=[],valid=new Set();
    for(const i of rows){
      if(placed.length>=3)break;
      const v=new THREE.Vector3(i.position.x,i.position.y+1,i.position.z).project(camera);
      if(v.z<-1||v.z>1)continue;
      const x=(v.x+1)*rect.width/2,y=(1-v.y)*rect.height/2;
      if(x<20||y<20||x>rect.width-20||y>rect.height-70)continue;
      if(placed.some(p=>Math.abs(p.x-x)<40&&Math.abs(p.y-y)<40))continue;
      placed.push({x,y});valid.add(i.id);let b=bubbleNodes.get(i.id);
      if(!b){b=document.createElement('button');b.type='button';b.dataset.encounter=i.id;b.onpointerdown=hold;b.onclick=()=>open(incidents.find(r=>r.id===b.dataset.encounter),b);bubbles.append(b);bubbleNodes.set(i.id,b);}
      b.className=`event-bubble severity-${i.severity}${isOpen&&chosen?.id===i.id?' selected':''}`;b.setAttribute('aria-pressed',String(isOpen&&chosen?.id===i.id));b.style.left=`${x}px`;b.style.top=`${y}px`;
      b.textContent=ANNOUNCEMENT_LEVELS[i.severity].icon;
      b.title=`${i.participants.join(' / ')} · ${i.title} · ${ANNOUNCEMENT_LEVELS[i.severity].name} · T + ${i.time.toFixed(2)} s`;b.setAttribute('aria-label',b.title);
    }
    for(const [key,b] of bubbleNodes)if(!valid.has(key)){b.remove();bubbleNodes.delete(key);}
  }
  $('replay-play').onclick=()=>{if(!replay)return;if(replay.time>=replay.end)replay.time=replay.start;replay.playing=!replay.playing;};
  $('replay-scrub').oninput=e=>{if(!replay)return;replay.time=+e.target.value;replay.playing=false;sampleReplay();replayView?.render();};
  $('replay-speed').onchange=e=>{if(replay)replay.speed=+e.target.value;};
  $('replay-camera').onclick=()=>{if(!replay||!replayView)return;replay.free=!replay.free;if(replay.free)replayView.free();else replayView.lock();$('replay-camera').textContent=replay.free?'Lock view':'Free camera';};
  $('replay-knowledge').onchange=e=>{knowledgeMode=e.target.checked;sampleReplay();replayView?.render();};
  addEventListener('keydown',e=>{if(e.key==='Escape'&&!inspector.hidden){close();refresh?.();if(lastTrigger?.isConnected)lastTrigger.focus({preventScroll:true});}});
  return {
    get active(){return !!replay;},get preview(){return replayView;},get clip(){return replay;},get inspectorOpen(){return !inspector.hidden;},
    get incidents(){updateIncidents();return incidents;},open,close,
    setTab(t){tab=t;lastSig='';syncCards();},get tab(){return tab;},
    reset(){close();chosen=null;cacheKey='';cachedLog=null;incidents=[];lastSig='';for(const nodes of [logNodes,bubbleNodes,axisNodes]){for(const b of nodes.values())b.remove();nodes.clear();}},
    render(dt){
      if(replay&&replayView&&!inspector.hidden){
        if(replay.playing){replay.time=Math.min(replay.end,replay.time+dt*replay.speed);if(replay.time>=replay.end)replay.playing=false;}
        $('replay-play').textContent=replay.playing?'Pause':'Play';$('replay-scrub').value=replay.time;
        $('replay-time').textContent=`Clip ${(Math.floor(replay.time*4)/4).toFixed(2)} s · ${replay.start.toFixed(2)}–${replay.end.toFixed(2)} s`;
        previewClock+=dt;if(previewClock>=1/15){previewClock=0;sampleReplay();replayView.render();}
      }
      updateIncidents();syncCards();project();
    }
  };
}
