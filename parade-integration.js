// Parade experiment mounted into the existing AIRSPACE shell. The engine (parade.js) is deterministic and renders nothing;
// this module only (a) maps its state onto the existing cards, tables, inspector and drawer, and (b) drives the 3D actors.
// Layout, graphics style and monochrome look are the shell's own — nothing here introduces new chrome.
import * as THREE from 'three';
import {CONFIG, createParade, distance} from './parade.js';
import {METHODS} from './parade-methods.js';
import {EVENT_IDS, EVENT_SCHEDULE} from './parade-events.js';
import {CROWD_ZONES} from './parade-environment.js';
import {createParadeVisual} from './parade-visual.js';
import {createEventVisual} from './parade-event-visual.js';
import {installObservability, TABS} from './parade-observability.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fresh = id => { const el = $(id); const c = el.cloneNode(true); el.replaceWith(c); return c; };   // drops the legacy delivery listeners
const SCALE_M = 5;                                                                                    // one scene unit = 5 m
const f1 = (n, s = '') => (n === null || n === undefined ? '—' : `${n.toFixed(1)}${s}`);

export function installParade({S, scene, world, planRoute, segCheck, camera, controls, removeOrder, routeLayer, selRing, setAdvanced, toast, SLAB}) {
  document.body.classList.add('parade-mode');
  for (const o of [...S.orders]) removeOrder(o);
  S.intake = false; S.selected = null; S.track = null; routeLayer.visible = false; S.running = false; S.stage = 4; S.speed = 1;

  // ---- engine: four rooftop pads (statically validated, mutually reachable) ----
  const candidates = world.obstacles.filter(o => o.y0 === undefined && o.h > 2 && o.h < 15)
    .map(o => ({id: `PAD-${o.id}`, name: o.name, pos: {x: (o.x0 + o.x1) / 2, y: o.h + 1.3, z: (o.z0 + o.z1) / 2}, roof: o.h})).filter(p => !segCheck(p.pos, p.pos));
  const pads = [];
  for (const target of [{x: -32, z: -32}, {x: 16, z: -16}, {x: 32, z: 32}, {x: -32, z: 32}]) {
    const options = candidates.filter(p => pads.every(q => distance(p.pos, q.pos) > 12)).sort((a, b) => Math.hypot(a.pos.x - target.x, a.pos.z - target.z) - Math.hypot(b.pos.x - target.x, b.pos.z - target.z));
    const p = options.find(p => !pads.length || planRoute(pads.at(-1).pos, p.pos).ok);
    if (!p) throw new Error('No connected rooftop pads available');
    pads.push(p);
  }
  const engine = createParade({pads, obstacles: world.obstacles, plan: planRoute, blocked: (a, b) => !!segCheck(a, b)});

  // ---- 3D actors ----
  const group = new THREE.Group(); scene.add(group);
  const paradeVisual = createParadeVisual(group, engine.state.parade);
  const eventVisual = createEventVisual(group);
  for (const p of pads) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.5, 40), new THREE.MeshBasicMaterial({color: 0x141414, side: THREE.DoubleSide}));
    ring.rotation.x = -Math.PI / 2; ring.position.set(p.pos.x, p.roof + .48, p.pos.z); group.add(ring);
  }
  const crowdLayer = new THREE.Group(); group.add(crowdLayer);        // published crowd reservations (22.5 m low-overflight exclusion)
  for (const z of CROWD_ZONES) {
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(z.x1 - z.x0, z.h, z.z1 - z.z0)), new THREE.LineDashedMaterial({color: 0x141414, dashSize: .6, gapSize: .5}));
    edges.computeLineDistances(); edges.position.set((z.x0 + z.x1) / 2, SLAB + z.h / 2, (z.z0 + z.z1) / 2); crowdLayer.add(edges);
  }
  const routeLines = S.couriers.map(() => { const l = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({color: 0x141414, dashSize: .5, gapSize: .35})); l.visible = false; group.add(l); return l; });
  const sensed = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({color: 0x141414, size: .55})); sensed.visible = false; group.add(sensed);
  const sensor = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color: 0x141414, transparent: true, opacity: .35})); sensor.visible = false; group.add(sensor);
  const highlight = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({color: 0x141414, transparent: true, opacity: .5, side: THREE.DoubleSide, depthWrite: false})); highlight.visible = false; group.add(highlight);

  // ---- state shared by the UI ----
  const map = $('map');
  let selected = null, view = 'individual', showRoutes = true, accumulator = 0, uiClock = 0, selectedLandmark = null, activeTab = 'flight', lastEvents = ['balloon'];
  let pendingConfig = {method: 1, events: ['balloon']}, mirroredTick = -1, mirroredSelection = null;
  const initialView = {position: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom};
  const inspectorEl = $('inspector');

  // ============================================================== shell mapping ==============================================================
  // Top bar: Run / speed / Reset stay; the two optional-tool buttons become camera shortcuts; the tour (delivery-only) is hidden.
  const play = fresh('btn-play'), reset = fresh('btn-reset'), locate = fresh('btn-inspection'), city = fresh('btn-placements'), tour = fresh('btn-tour');
  tour.hidden = true; locate.textContent = 'Locate parade'; locate.title = 'Zoom to the balloon'; city.textContent = 'Whole city'; city.title = 'Return to the overview';
  reset.title = 'Restart with the active conditions (pending edits are kept)';
  // Status bar: same strip, parade measurements.
  $('statusbar').innerHTML = '<span>Time <b id="st-time">0 s</b></span><span>Fleet <b id="st-fleet">—</b></span><span>Delivered <b id="st-first">0 / 3</b></span><span>Method <b id="st-method">—</b></span><span>Encounters <b id="st-alerts">0</b></span><span>Simulation <b id="st-sim">READY</b></span><span id="st-stage"><b id="map-sub">—</b></span>';
  // Left cards: Operations card now sets the experiment conditions (same switch and stepper controls).
  $('intake-label').textContent = 'Event conditions'; $('allocation-label').textContent = 'Method';
  const eventsSwitch = fresh('intake-toggle'), minus = fresh('fleet-minus'), plus = fresh('fleet-plus');
  eventsSwitch.title = 'Switch the selected events on / off (off = normal parade)'; minus.setAttribute('aria-label', 'Previous coordination method'); plus.setAttribute('aria-label', 'Next coordination method');
  minus.title = 'Previous method'; plus.title = 'Next method';
  $('fleet-target').setAttribute('aria-label', 'Coordination method');
  // Incident Queue → encounter log (severity tabs).
  document.querySelector('.incidenthead small').textContent = 'Encounters across all drones · newest first.';
  const tabButtons = [['tab-critical', 'urgent', 'Urgent', 'cnt-critical'], ['tab-battery', 'conflict', 'Conflict', 'cnt-battery'], ['tab-updates', 'notice', 'Notice', 'cnt-updates']];
  for (const [id, key, label, cnt] of tabButtons) { const b = fresh(id); b.dataset.category = key; b.innerHTML = `${label} <span class="count" id="${cnt}">0</span>`; }
  $('new-events').hidden = true; $('events').innerHTML = '';
  // Fleet Monitoring: same table; the last column becomes the shared 0–150 s event axis.
  document.querySelector('#fleet-table thead th:last-child').textContent = 'Events · 0–150 s';
  $('fleet-count').textContent = '4 drones'; document.querySelector('.fleethead > small').textContent = 'Select a drone to inspect; encounters sit on its time axis.';
  $('fleet-empty').hidden = true; $('fleet-wrap').hidden = false; $('fleet-table').hidden = false;
  const rows = new Map();
  for (const a of engine.state.agents) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><button type="button" data-select="${a.id}" aria-label="Inspect ${a.id}"></button></td><td></td><td></td><td></td><td></td><td></td><td class="axiscell"><div class="agent-track" data-events-for="${a.id}" aria-label="${a.id} event timeline"></div></td>`;
    const btn = tr.querySelector('button'); btn.textContent = a.id; btn.dataset.mark = String(+a.id.slice(-1) - 1); btn.style.setProperty('--dc', '#141414');
    btn.addEventListener('click', e => select(a.id, e.currentTarget));
    $('fleet-body').append(tr); rows.set(a.id, {tr, tds: [...tr.children], btn});
  }
  // Layers: only the layers that exist in this scenario.
  for (const id of ['lay-perm', 'lay-cand', 'lay-sel']) $(id).closest('label').hidden = true;
  $('lay-rest').closest('label').lastChild.textContent = ' Crowd zones'; S.layers.rest = false; $('lay-rest').checked = false;
  $('legend').innerHTML = '<section><b>Encounters</b><div><i style="background:#fff;border:1.5px solid #141414;border-radius:50%"></i>○ Notice</div><div><i style="background:#fff;border:3px solid #141414;border-radius:50%"></i>! Conflict</div><div><i style="background:#141414;border-radius:50%"></i>!! Urgent</div></section><section><b>Scene</b><div><i style="background:#f6f4f0;border:1.5px solid #141414"></i>Parade balloon</div><div><i style="background:#1b1b1d"></i>Crowd / marchers</div><div><i style="border:1.5px dashed #141414"></i>Crowd zone (&lt; 22.5 m)</div><div><i style="border:1.5px solid #141414;border-radius:50%"></i>Rooftop pad</div></section>';
  // Advanced drawer: setup, results, decision trace, model info — same section styling.
  document.querySelector('#advanced .advbody').innerHTML = `
    <p class="small">Conditions, results, decision trace and model notes for the parade experiment. The original delivery simulator is available at <code>?mode=legacy</code>.</p>
    <details open class="sec"><summary>Experiment setup <small id="setup-note"></small></summary>
      <div class="group"><span class="gtitle">Coordination method</span>${Object.entries(METHODS).map(([id, n]) => `<label class="auto"><input type="radio" name="method" value="${id}"> Method ${id} · ${n}</label>`).join('')}</div>
      <div class="group"><span class="gtitle">Event conditions</span>${EVENT_IDS.map(id => `<label class="auto"><input type="checkbox" data-event="${id}"> ${EVENT_SCHEDULE[id].name} <small>${EVENT_SCHEDULE[id].start}–${EVENT_SCHEDULE[id].end} s</small></label>`).join('')}</div>
      <p class="small" id="config-note" role="status"></p>
      <div id="pending-actions" hidden><button id="cfg-apply" disabled>Apply &amp; Restart</button> <button id="cfg-discard">Discard pending edits</button></div>
      <p class="small">No events = normal parade. Before the first tick edits apply immediately; after that they are staged until Apply &amp; Restart. Schedules never depend on method or drone state.</p>
    </details>
    <details class="sec"><summary>Results <small id="results-state"></small></summary><dl id="metrics"></dl><button id="export-json">Export JSON</button><p class="small" id="export-status" role="status"></p></details>
    <details class="sec"><summary>Decision trace <small>latest 100 · export has all</small></summary><label class="auto">Agent <select id="trace-filter"><option value="all">All agents</option>${engine.state.agents.map(a => `<option>${a.id}</option>`).join('')}</select></label><div id="trace-log"></div></details>
    <details class="sec"><summary>Model info</summary><div class="info small">
      <p><b>Method 1 · Fixed Priority.</b> Rank D-01 &gt; D-03 &gt; D-04 &gt; D-02 decides who yields in a predicted intent conflict.</p>
      <p><b>Method 2 · Cost Negotiation.</b> Each pair compares the modeled delay cost of deferring either drone; the cheaper deferral yields.</p>
      <p><b>Method 3 · Slot Bidding.</b> Drones bid for a time-limited lease on the conflict volume; non-winners stay out until it expires.</p>
      <p>All three share onboard avoidance (range-, FOV- and occlusion-limited sensing) and an explicitly separate simulator safety guard. Fixed 0.05 s steps, 150 s window, departures at 0 / 4 / 8 / 12 s. Policies are illustrative, not global optimizers. Tethers are stylized kinematics; physical touchdown is not modeled. Crowd zones prohibit landing and flight below 22.5 m.</p></div></details>`;
  const adv = $('advanced');

  // ============================================================== behaviour ==============================================================
  const obs = installObservability({engine, S, map, camera, controls, scene, refresh: () => renderUI(), closePanels: () => { selected = null; S.selected = null; inspectorEl.hidden = true; draw(); },
    excludeReplay: [group, routeLayer, selRing, ...S.couriers.flatMap(c => [c.mesh, c.halo, c.blockMesh, c.label])].filter(Boolean), logHost: $('events'), fleetRoot: $('fleet-body')});
  function setTab(key) { for (const [id, k] of tabButtons) { const b = $(id); b.setAttribute('aria-selected', String(k === key)); b.setAttribute('aria-controls', 'events'); } obs.setTab(key); }
  for (const [id, key] of tabButtons) $(id).addEventListener('click', () => setTab(key));
  setTab('urgent');

  function doReset(config = {method: engine.config.method, events: engine.config.events}) {
    obs.reset(); engine.reset(config); mirroredTick = -1; S.time = 0; S.running = false; accumulator = 0; selectedLandmark = null; mirror(); renderUI(); draw();
  }
  function syncControls() {
    document.querySelectorAll('#advanced input[name=method]').forEach(i => { i.checked = +i.value === pendingConfig.method; });
    document.querySelectorAll('#advanced input[data-event]').forEach(i => { i.checked = pendingConfig.events.includes(i.dataset.event); });
  }
  function setPending(next) {
    pendingConfig = {method: next.method, events: EVENT_IDS.filter(id => next.events.includes(id))};
    if (pendingConfig.events.length) lastEvents = [...pendingConfig.events];
    syncControls();
    if (engine.state.tick === 0) doReset(pendingConfig); else renderUI();
  }
  document.querySelectorAll('#advanced input[name=method], #advanced input[data-event]').forEach(i => i.addEventListener('change', () => setPending({
    method: +document.querySelector('#advanced input[name=method]:checked').value,
    events: [...document.querySelectorAll('#advanced input[data-event]')].filter(x => x.checked).map(x => x.dataset.event)})));
  eventsSwitch.addEventListener('click', () => setPending({method: pendingConfig.method, events: pendingConfig.events.length ? [] : lastEvents}));
  minus.addEventListener('click', () => setPending({method: ((pendingConfig.method + 1) % 3) + 1, events: pendingConfig.events}));
  plus.addEventListener('click', () => setPending({method: (pendingConfig.method % 3) + 1, events: pendingConfig.events}));
  $('cfg-apply').addEventListener('click', () => doReset(pendingConfig));
  $('cfg-discard').addEventListener('click', () => { pendingConfig = {method: engine.config.method, events: [...engine.config.events]}; syncControls(); renderUI(); });
  play.addEventListener('click', () => { if (engine.state.finished) return; S.running = !S.running; renderUI(); });
  reset.addEventListener('click', () => doReset());
  locate.addEventListener('click', () => { const p = engine.state.balloon; controls.target.set(p.x, 6, p.z); camera.position.set(p.x + 65, 58, p.z + 65); camera.zoom = .9; camera.updateProjectionMatrix(); controls.update(); });
  city.addEventListener('click', () => { camera.position.copy(initialView.position); controls.target.copy(initialView.target); camera.zoom = initialView.zoom; camera.updateProjectionMatrix(); controls.update(); });
  $('lay-rest').addEventListener('change', e => { crowdLayer.visible = e.target.checked; });
  crowdLayer.visible = false;
  $('trace-filter').addEventListener('change', renderUI);
  $('trace-log').addEventListener('click', e => { const b = e.target.closest('[data-trace-record]'); if (b) obs.open(engine.state.log.find(r => r.recordId === b.dataset.traceRecord), b); });
  $('export-json').addEventListener('click', () => {
    try {
      const blob = new Blob([JSON.stringify({schema: 'nyc-parade-v3', source: 'deterministic multi-method experiment', ...engine.snapshot()}, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `parade-method${engine.config.method}-${engine.config.events.join('-') || 'baseline'}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('export-status').textContent = 'Exported the active run, configuration and decision trace.';
    } catch { $('export-status').textContent = 'Export failed. Please try again.'; }
  });

  // Drone inspector: same card, tabs and panes; contents come from the agent.
  const tabBtns = [...document.querySelectorAll('[data-detail]')].map(b => fresh(b.id));
  function showTab(tab) { activeTab = tab; tabBtns.forEach(b => b.setAttribute('aria-selected', String(b.dataset.detail === tab))); document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== tab; }); }
  tabBtns.forEach((b, i) => { b.addEventListener('click', () => showTab(b.dataset.detail)); b.addEventListener('keydown', e => { const k = {ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabBtns.length - 1}[e.key]; if (k == null) return; e.preventDefault(); const n = tabBtns[(k + tabBtns.length) % tabBtns.length]; showTab(n.dataset.detail); n.focus(); }); });
  fresh('close-inspector').addEventListener('click', () => clearSelection());
  $('pane-location').innerHTML = `<h3>Machine view</h3><div id="robot" class="info"></div><details class="raw"><summary>Agent state → JSON</summary><pre id="robot-json"></pre></details>
    <h3>Sensor knowledge</h3><label class="auto">Display <select id="knowledge-view"><option value="individual">Selected agent</option><option value="shared">Same operator shared map</option><option value="overlap">Cross-operator overlap</option></select></label>
    <label class="auto"><input id="show-routes" type="checkbox" checked> Route &amp; sensor FOV</label><p class="small">Black points are observed surface samples; the city itself is viewer ground truth.</p>
    <h3>Surface landmarks</h3><div id="human" class="info"></div>`;
  $('pane-history').innerHTML = '<h3>Drone event history</h3><div id="insp-history"></div>';
  $('pane-flight').querySelector('p.small').textContent = 'Opening this inspector does not pause or alter the experiment. Observations and decisions are recorded in the decision trace.';
  $('knowledge-view').addEventListener('change', e => { view = e.target.value; draw(); });
  $('show-routes').addEventListener('change', e => { showRoutes = e.target.checked; draw(); });
  $('human').addEventListener('click', e => { const b = e.target.closest('[data-landmark]'); if (!b) return; selectedLandmark = b.dataset.landmark; if (b.dataset.accept !== undefined) engine.approve(engine.state.agents.find(a => a.id === selected).operator, b.dataset.landmark, b.dataset.accept === 'true'); renderUI(); draw(); });
  $('human').addEventListener('pointerover', e => { const b = e.target.closest('[data-surface]'); if (b) showSurface(b.dataset.surface); });
  $('human').addEventListener('pointerout', e => { if (!$('human').contains(e.relatedTarget)) showSurface(selectedLandmark); });
  $('insp-history').addEventListener('click', e => { const b = e.target.closest('[data-trace-record]'); if (b) obs.open(engine.state.log.find(r => r.recordId === b.dataset.traceRecord), b); });
  showTab('flight');
  addEventListener('keydown', e => { if (e.key === 'Escape' && !inspectorEl.hidden && !obs.inspectorOpen) clearSelection(); });
  $('btn-advanced').addEventListener('click', () => { if (adv.classList.contains('open')) { obs.close(); selected = null; S.selected = null; inspectorEl.hidden = true; draw(); renderUI(); } });   // the drawer shares the inspector slot

  function select(id, trigger) {
    const c = S.couriers.find(d => d.id === id); if (!c || !engine.state.agents.some(a => a.id === id)) return;
    obs.close(); selected = id; S.selected = c; S.track = c; selectedLandmark = null; inspectorEl.hidden = false; renderUI(); draw();
    if (trigger) $('close-inspector').focus({preventScroll: true});
  }
  function clearSelection() { if (!selected) return; selected = null; S.selected = null; inspectorEl.hidden = true; renderUI(); draw(); (document.querySelector('#fleet-body button') ?? $('fleet-title')).focus({preventScroll: true}); }

  // ---- 3D mirroring ----
  function mirror() {
    const s = engine.state; S.time = s.time;
    if (mirroredTick === s.tick && mirroredSelection === selected) return;
    mirroredTick = s.tick; mirroredSelection = selected;
    paradeVisual.update(s.parade, s.time); eventVisual.update(s.effects, s.time);
    for (const [i, a] of s.agents.entries()) {
      const c = S.couriers[i]; c.pos.set(a.pos.x, a.pos.y, a.pos.z); c.mesh.position.set(a.pos.x, a.pos.y + .4, a.pos.z);
      c.inner.rotation.y = Math.atan2(a.forward.x, a.forward.z); c.rotors.forEach((r, j) => { r.rotation.y = s.time * 28 * (j % 2 ? 1 : -1); });
      c.label.visible = false; c.halo.visible = false; c.blockMesh.visible = false;
    }
    const sel = s.agents.find(a => a.id === selected);
    selRing.visible = !!sel;
    if (sel) { selRing.position.set(sel.pos.x, SLAB + .06, sel.pos.z); selRing.scale.setScalar(1.1); }
  }
  function showSurface(id) {
    highlight.visible = false; if (!id || !selected) return;
    const [oid, face] = id.split(':'), o = world.obstacles.find(o => o.id === oid), a = engine.state.agents.find(a => a.id === selected), l = engine.state.landmarks[a.operator][id];
    if (!o || !l || l.status === 'rejected') return;
    highlight.material.color.set(l.status === 'approved' ? 0x8a8a8a : 0x141414);
    highlight.rotation.set(0, 0, 0); const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2, base = o.y0 ?? 0, h = o.h - base;
    if (face === 'roof') { highlight.rotation.x = -Math.PI / 2; highlight.scale.set(o.x1 - o.x0, o.z1 - o.z0, 1); highlight.position.set(cx, o.h + .08, cz); }
    else if (face === 'west' || face === 'east') { highlight.rotation.y = Math.PI / 2; highlight.scale.set(o.z1 - o.z0, h, 1); highlight.position.set(face === 'west' ? o.x0 - .08 : o.x1 + .08, base + h / 2, cz); }
    else { highlight.scale.set(o.x1 - o.x0, h, 1); highlight.position.set(cx, base + h / 2, face === 'north' ? o.z0 - .08 : o.z1 + .08); }
    highlight.visible = true;
  }
  function draw() {
    const s = engine.state, a = s.agents.find(a => a.id === selected);
    s.agents.forEach((agent, i) => {
      const l = routeLines[i]; l.visible = !!a && agent.id === selected && showRoutes && agent.route.length > 0;
      if (l.visible) { l.geometry.dispose(); l.geometry = new THREE.BufferGeometry().setFromPoints([agent.pos, ...agent.route].map(p => new THREE.Vector3(p.x, p.y + .4, p.z))); l.computeLineDistances(); }
    });
    sensed.visible = !!a; sensor.visible = !!a && showRoutes; showSurface(selectedLandmark); if (!a) return;
    let knowledge = a.knowledge; if (view === 'shared') knowledge = s.shared[a.operator]; if (view === 'overlap') knowledge = Object.fromEntries(Object.entries(s.shared.delivery).filter(([id]) => s.shared.camera[id]));
    sensed.geometry.dispose(); sensed.geometry = new THREE.BufferGeometry().setFromPoints(Object.values(knowledge).map(o => new THREE.Vector3(o.pos.x, o.pos.y + .4, o.pos.z)));
    // Wireframe of the same range / FOV cone the sensor uses (inspection only; obstacles still occlude sensing).
    const forward = new THREE.Vector3(a.forward.x, a.forward.y, a.forward.z).normalize(), side = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize(); if (side.lengthSq() < .01) side.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(side, forward).normalize(), origin = new THREE.Vector3(a.pos.x, a.pos.y + .4, a.pos.z), center = origin.clone().addScaledVector(forward, CONFIG.range), radius = CONFIG.range * Math.tan(CONFIG.fov / 2), pts = [];
    const edge = i => center.clone().addScaledVector(side, Math.cos(i / 24 * Math.PI * 2) * radius).addScaledVector(up, Math.sin(i / 24 * Math.PI * 2) * radius);
    for (let i = 0; i < 24; i++) { const rim = j => origin.clone().add(edge(j).sub(origin).normalize().multiplyScalar(CONFIG.range)); pts.push(rim(i), rim(i + 1)); if (i % 6 === 0) pts.push(origin, rim(i)); }
    sensor.geometry.dispose(); sensor.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  // ---- UI rendering (≈4 Hz) ----
  const remaining = a => a.route.reduce((n, p, i) => { const prev = i ? a.route[i - 1] : a.pos; return n + Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z); }, 0);
  const missionText = a => a.kind === 'camera' ? 'Film the balloon' : a.done ? a.state : a.goals[a.goal] ? `${a.goals[a.goal].action} · ${a.goals[a.goal].pad.id.replace('PAD-', '')}` : a.state;
  function renderUI() {
    const s = engine.state, a = s.agents.find(a => a.id === selected);
    const dirty = pendingConfig.method !== engine.config.method || JSON.stringify(pendingConfig.events) !== JSON.stringify(engine.config.events);
    const active = s.effects.active.map(id => EVENT_SCHEDULE[id].name), next = engine.config.events.map(id => EVENT_SCHEDULE[id]).filter(e => e.start > s.time).sort((x, y) => x.start - y.start)[0];
    const flying = s.agents.filter(x => !x.done && s.time >= x.depart && (x.route.length || Math.hypot(x.velocity.x, x.velocity.y, x.velocity.z) > .01)).length;
    // status strip
    $('st-time').textContent = `${s.time.toFixed(1)} / ${CONFIG.duration} s`; $('st-fleet').textContent = `4 total / ${s.agents.filter(x => s.time >= x.depart && !x.done).length} active`;
    $('st-first').textContent = `${s.agents.filter(x => x.done && ['Delivered', 'Returned'].includes(x.state)).length} / 3`;
    $('st-method').textContent = `${engine.config.method} · ${METHODS[engine.config.method]}`; $('st-alerts').textContent = String(obs.incidents.length);
    $('st-sim').textContent = s.finished ? 'COMPLETE' : S.running ? 'RUNNING' : s.tick ? 'PAUSED' : 'READY';
    $('map-sub').textContent = active.length ? active.join(' + ') : next ? `${next.name} · ${next.start} s` : 'Normal parade'; $('map-sub').title = 'Environment schedule (viewer). Agent detections appear in the decision trace.';
    // In Progress
    $('ip-flight').textContent = `${flying} active`; $('ip-hub').textContent = `${s.agents.filter(x => x.done || !x.route.length).length} at pad`;
    // Operations card
    $('intake-toggle').setAttribute('aria-checked', String(pendingConfig.events.length > 0)); $('intake-state').textContent = pendingConfig.events.length ? 'On' : 'Off';
    $('fleet-target').textContent = `${pendingConfig.method} / 3`; $('fleet-target').title = METHODS[pendingConfig.method];
    const note = `Active: Method ${engine.config.method} · ${engine.config.events.map(id => EVENT_SCHEDULE[id].name).join(' + ') || 'baseline'}.${dirty ? ' Pending edits — Apply & Restart in Advanced.' : ''}`;
    $('ops-feedback').textContent = note; $('emergency-target').textContent = a ? a.id : 'Select a drone';
    // play button
    play.textContent = s.finished ? 'Complete' : S.running ? 'Pause' : s.tick ? 'Resume' : 'Start'; play.disabled = s.finished; play.setAttribute('aria-pressed', String(S.running));
    // Advanced setup
    $('pending-actions').hidden = !dirty; $('cfg-apply').disabled = !dirty; $('config-note').textContent = `Current: Method ${engine.config.method} · ${engine.config.events.map(id => EVENT_SCHEDULE[id].name).join(' + ') || 'Baseline'}. ${dirty ? 'Pending edits — Apply & Restart to use the next conditions.' : 'Deterministic conditions.'}`;
    // Fleet table
    for (const agent of s.agents) {
      const r = rows.get(agent.id), t = r.tds; r.tr.classList.toggle('selected', agent.id === selected);
      const set = (i, v) => { if (t[i].textContent !== v) t[i].textContent = v; };
      set(1, `${agent.state}${agent.level !== 'L0' ? ' · ' + agent.level : ''}`); set(2, missionText(agent)); set(3, `${(agent.pos.y * SCALE_M).toFixed(0)} m`);
      set(4, agent.done || !agent.route.length ? '—' : `≈ ${Math.ceil(remaining(agent) / CONFIG.speed)} s`); set(5, `${agent.battery.toFixed(0)}%`);
      r.btn.title = `${agent.id}: ${agent.reason}`; r.btn.setAttribute('aria-pressed', String(agent.id === selected));
    }
    $('fleet-body').style.setProperty('--live-time', `${s.time / CONFIG.duration * 100}%`);
    // Drone inspector
    if (a) {
      $('inspector-title').textContent = a.id; $('inspector-subtitle').textContent = `${a.kind === 'camera' ? 'Camera' : 'Delivery'} drone · operator ${a.operator}`; inspectorEl.style.setProperty('--dc', '#141414');
      $('insp-human').innerHTML = `<p><b>${esc(a.state)} · ${a.level}</b></p><p>${esc(a.reason)}</p>`;
      $('insp-dl').innerHTML = `<div><dt>Distance flown</dt><dd>${f1(a.travel, ' m')}</dd></div><div><dt>Visual sampling</dt><dd>${a.sensorDegraded ? '25% · confetti' : 'Normal'}</dd></div><div><dt>Wind load</dt><dd>${((a.windLoad ?? 0) * 5).toFixed(1)} m/s</dd></div><div><dt>Battery</dt><dd>${f1(a.battery, '%')}</dd></div><div><dt>Waiting</dt><dd>${f1(a.wait, ' s')}</dd></div><div><dt>Route plans</dt><dd>${a.replans}</dd></div><div><dt>Own surface samples</dt><dd>${Object.keys(a.knowledge).length}</dd></div><div><dt>Shared operator samples</dt><dd>${Object.keys(s.shared[a.operator]).length}</dd></div><div><dt>Camera visibility</dt><dd>${a.kind === 'camera' ? f1(a.filmingTime ? a.visibleTime / a.filmingTime * 100 : 0, '%') : '—'}</dd></div>`;
      $('robot').innerHTML = `<p>Position (m): ${['x', 'y', 'z'].map(k => (a.pos[k] * SCALE_M).toFixed(1)).join(', ')}</p><p>Heading: ${['x', 'y', 'z'].map(k => a.forward[k].toFixed(2)).join(', ')} · speed ${(Math.hypot(a.velocity.x, a.velocity.y, a.velocity.z) * SCALE_M).toFixed(1)} m/s</p><p>Next waypoints: ${a.route.length}</p>`;
      $('robot-json').textContent = JSON.stringify({id: a.id, state: a.state, level: a.level, pos: a.pos, velocity: a.velocity, route: a.route.length, battery: a.battery, reason: a.reason}, null, 1);
      const proposals = Object.entries(s.landmarks[a.operator]).filter(([, l]) => l.status !== 'rejected');
      const markup = proposals.length ? proposals.map(([id, l]) => `<div class="parade-proposal" data-surface="${id}"><button data-landmark="${id}" aria-pressed="${selectedLandmark === id}">${esc(l.name)} · ${l.status}</button><small>${id} · ${l.count} independent observations</small>${l.status === 'proposed' ? `<button data-landmark="${id}" data-accept="true">Approve</button><button data-landmark="${id}" data-accept="false">Reject</button>` : ''}</div>`).join('') : '<p class="small">No pending proposals. Five spaced observations from distinct positions are required.</p>';
      if ($('human').innerHTML !== markup) $('human').innerHTML = markup;
      const mine = s.log.filter(e => e.id === a.id).slice(-40).reverse();
      const hist = mine.map(e => `<p><button data-trace-record="${e.recordId}">${e.time.toFixed(2)} s · ${esc(e.code)}</button><br>${esc(e.detail)}</p>`).join('') || '<p class="small">No events recorded for this drone yet.</p>';
      if ($('insp-history').innerHTML !== hist) $('insp-history').innerHTML = hist;
    }
    // Results + trace
    $('results-state').textContent = s.finished ? 'completed run' : `live · ${s.time.toFixed(1)} s (not final)`;
    $('metrics').innerHTML = [['Drone min separation', f1(s.minSeparation, ' m')], ['Balloon min clearance', f1(s.minBalloonClearance, ' m')], ['Contacts', s.collisions], ['Near-miss episodes', s.nearMisses], ['Delivered / returned', `${s.agents.filter(x => x.done && ['Delivered', 'Returned'].includes(x.state)).length} / 3`], ['Total waiting time', f1(s.agents.reduce((n, x) => n + x.wait, 0), ' s')], ['Coordination decisions', s.coordination.length], ['Pigeon detections', s.eventMetrics.pigeonDetections], ['Suppressed visual samples', s.eventMetrics.confettiSuppressed], ['Wind exposure', f1(s.eventMetrics.windSeconds, ' s')], ['Environment guard', s.eventMetrics.dynamicGuardStops]].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    const filter = $('trace-filter').value, log = s.log.filter(e => filter === 'all' || !e.id || e.id === filter);
    $('trace-log').innerHTML = log.slice(-100).reverse().map(e => `<p><button data-trace-record="${e.recordId}">${e.time.toFixed(2)} s · ${esc(e.id ?? 'System')} · ${esc(e.layer)} · ${esc(e.code)}</button><br>${esc(e.detail)}</p>`).join('') || '<p class="small">No decisions recorded yet.</p>';
  }
  syncControls();
  // keep the camera at the app's own default; only the zoom is widened to fit the whole parade loop
  mirror(); renderUI(); draw();

  return {
    engine, obs, pads, select, clearSelection, paradeVisual, eventVisual,
    refresh() { mirror(); renderUI(); draw(); },
    hover(id, x, y) {
      let tip = $('parade-hover'); if (!tip) { tip = document.createElement('div'); tip.id = 'parade-hover'; tip.className = 'parade-hover'; map.append(tip); }
      const a = engine.state.agents.find(a => a.id === id); tip.hidden = !a;
      if (a) { tip.textContent = `${a.id} · ${a.kind} · ${a.state}`; tip.style.left = `${Math.max(8, Math.min(map.clientWidth - 220, x + 12))}px`; tip.style.top = `${Math.max(8, y - 35)}px`; }
    },
    advance(seconds) { accumulator += seconds; while (accumulator + 1e-9 >= CONFIG.dt) { engine.tick(); accumulator -= CONFIG.dt; } if (engine.state.finished) S.running = false; mirror(); },
    render(dt) { obs.render(dt); mirror(); uiClock += dt; if (uiClock > .25) { uiClock = 0; renderUI(); draw(); } },
  };
}
