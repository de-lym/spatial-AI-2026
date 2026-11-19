// Last 10m — the application: three views (Map / Monitor / Scene), the Simulation board and the operator console.
// main.js builds and draws the city; this module runs the nine independent scene simulations on top of it.
import { SCENES, GLOBAL_PARAMS, SCENE_PARAMS, DEFAULT_GLOBAL, sceneDefaults, SCALE_M } from './scenes.js';
import { createScene, statusOf, LEVEL_TEXT } from './sim.js';
import { createStage } from './stage.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtT = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable: run without persistence */ } },
};

const city = window.__sim;
if (!city) throw new Error('Last 10m: the city (main.js) did not start.');

// ---------------- state ----------------
let global = { ...DEFAULT_GLOBAL, ...store.get('l10.global', {}) };
let overrides = store.get('l10.overrides', {});           // scene id -> { key: value }
const memory = store.get('l10.memory', {});              // landmarks + static cells, written by the scenes
let sims = [], running = true, speed = 1, mode = 'map', sel = null, showKnow = false, draft = {}, boardCtx = null, uiClock = 0, memClock = 0, cellRR = 0;
const byId = (id) => sims.find((s) => s.state.def.id === id);
const paramsFor = (id) => ({ ...global, ...sceneDefaults(id), ...(overrides[id] ?? {}) });

function startScene(id) {
  const def = SCENES.find((s) => s.id === id);
  const sim = createScene(def, paramsFor(id), { obstacles: city.world.obstacles, memory });
  const i = sims.findIndex((s) => s.state.def.id === id);
  if (i >= 0) sims[i] = sim; else sims.push(sim);
  return sim;
}
function startAll() { sims = []; SCENES.forEach((d) => startScene(d.id)); }

// ---------------- 3D ----------------
const stage = createStage({ scene: city.scene, couriers: city.S.couriers, mainCamera: city.camera, obstacles: () => city.world.obstacles });
{ // frame the whole city for the map view
  const cam = city.camera, ctl = city.controls;
  ctl.target.set(0, 0, 4); cam.position.set(60, 52, 64); cam.zoom = 0.5; cam.updateProjectionMatrix(); ctl.update(); ctl.saveState?.();
}
const hideAirspaceDrones = () => city.S.couriers.forEach((c) => { c.mesh.visible = false; if (c.label) c.label.visible = false; if (c.halo) c.halo.visible = false; });

// ---------------- monitor wall: nine cells, created once ----------------
const wall = $('l10-wall');
wall.innerHTML = SCENES.map((d) => `<button type="button" class="cell" data-open="${d.id}" aria-label="Open scene ${d.id}, ${esc(d.title)}">
  <canvas width="480" height="300"></canvas><span class="cam"><span class="dot bg-red" style="width:6px;height:6px"></span>CAM-${d.id}</span><span class="bang">!</span>
  <span class="strip"><span class="dot"></span><b>${d.id} · ${esc(d.title)}</b><span class="chip"></span></span></button>`).join('');
const cells = [...wall.querySelectorAll('.cell')].map((el, i) => ({ el, id: SCENES[i].id, ctx: el.querySelector('canvas').getContext('2d'), dot: el.querySelector('.strip .dot'), chip: el.querySelector('.strip .chip') }));
function sizeCells() { for (const c of cells) { const r = c.el.getBoundingClientRect(); if (r.width > 10) { c.ctx.canvas.width = Math.round(r.width); c.ctx.canvas.height = Math.round(r.height); } } }
new ResizeObserver(sizeCells).observe(wall);

// ---------------- helpers ----------------
const statusFor = (sim) => statusOf(sim.state.level, sim.state.done);
const levelLabel = (sim) => (sim.state.done ? (sim.state.outcome === 'aborted' ? 'ABORTED' : 'DELIVERED') : sim.state.level === 'H' ? 'HUMAN' : sim.state.level);
function counts() { const c = { red: 0, yellow: 0, green: 0, grey: 0 }; for (const s of sims) c[statusFor(s)]++; return c; }
const severity = (s) => ({ red: 0, yellow: 1, green: 2, grey: 3 }[statusFor(s)]);

// ---------------- mode switching ----------------
function setMode(m, id) {
  mode = m; if (id) sel = id;
  document.body.dataset.mode = m;
  document.querySelectorAll('#l10-switch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m || (m === 'scene' && b.dataset.mode === 'monitor'))));
  window.__l10.drawMain = m === 'map';
  if (m === 'monitor') sizeCells();
  if (m === 'scene') sizeBig();
  renderBoard(true); renderSide(); renderStatus();
}
function sizeBig() { const v = $('l10-view').getBoundingClientRect(); for (const id of ['l10-big', 'l10-overlay']) { const c = $(id); c.width = Math.max(300, Math.round(v.width)); c.height = Math.max(200, Math.round(v.height)); } }
new ResizeObserver(() => { if (mode === 'scene') sizeBig(); }).observe($('l10-view'));

// ---------------- Simulation board ----------------
function boardFields() {
  const g = GLOBAL_PARAMS.map((p) => ({ ...p, scope: 'global' }));
  return mode === 'scene' && sel ? [...(SCENE_PARAMS[sel] ?? []).map((p) => ({ ...p, scope: 'scene' })), ...g] : g;
}
function applied(key) { return mode === 'scene' && sel ? paramsFor(sel)[key] : global[key]; }
function fmtVal(p, v) { if (p.bool) return v ? 'yes' : 'no'; return `${v}${p.unit ? ' ' + p.unit : ''}`; }
function renderBoard(force = false) {
  const ctx = mode === 'scene' ? `scene:${sel}` : 'all';
  if (force || ctx !== boardCtx) { boardCtx = ctx; draft = {}; }
  const fields = boardFields(), isScene = mode === 'scene' && sel;
  const val = (k) => (k in draft ? draft[k] : applied(k));
  const tag = (p) => {
    if (p.key in draft && draft[p.key] !== applied(p.key)) return '<span class="tag pending">unsaved</span>';
    if (!isScene) return '';
    const o = overrides[sel] ?? {};
    return p.key in o ? '<span class="tag edited">edited</span>' : p.scope === 'scene' ? '' : '<span class="tag global">global</span>';
  };
  const nEdits = isScene ? Object.keys(overrides[sel] ?? {}).length : 0;
  const mem = val('memory');
  $('l10-board').innerHTML = `
    <div class="ctrl"><button type="button" class="black" data-act="run">${running ? 'Pause' : 'Run'}</button><button type="button" class="pill" data-act="speed">${speed}×</button><button type="button" class="pill" data-act="reset">Reset</button></div>
    <div class="head"><h2>Simulation board</h2><span class="small">${isScene ? sel : 'all 9 scenes'}</span></div>
    <div class="params">${fields.map((p) => `<label class="param"><span class="row"><span class="name">${esc(p.label)}${tag(p)}</span><span class="val">${esc(fmtVal(p, val(p.key)))}</span></span>
      <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${+val(p.key)}" data-key="${p.key}" aria-label="${esc(p.label)}"></label>`).join('')}
      <div class="param"><span class="row"><span class="name">Memory</span><span class="seg" role="group" aria-label="Memory"><button type="button" data-mem="fresh" aria-pressed="${mem === 'fresh'}">Fresh</button><button type="button" data-mem="retained" aria-pressed="${mem !== 'fresh'}">Retained</button></span></span></div>
    </div>
    <div class="foot">
      ${isScene ? `<span class="small">${nEdits ? `${nEdits} edit${nEdits > 1 ? 's' : ''} differ from the global set · <a href="#" data-act="reset-scene" style="color:#141414;font-weight:600">Reset</a>` : 'Same as the global set'}</span>` : ''}
      <div class="btns">${isScene ? '<button type="button" class="black" data-act="apply-scene">Apply to this scene</button><button type="button" class="pill" data-act="apply-all">Apply to all</button>' : '<button type="button" class="black" data-act="apply-all">Apply to all</button>'}</div>
    </div>`;
}
$('l10-board').addEventListener('input', (e) => {
  const k = e.target.dataset.key; if (!k) return;
  const p = boardFields().find((f) => f.key === k); draft[k] = +e.target.value;
  const row = e.target.closest('.param'); row.querySelector('.val').textContent = fmtVal(p, draft[k]);
  const name = row.querySelector('.name'); if (!name.querySelector('.pending')) { name.querySelector('.tag')?.remove(); name.insertAdjacentHTML('beforeend', '<span class="tag pending">unsaved</span>'); }
});
$('l10-board').addEventListener('click', (e) => {
  const mem = e.target.closest('[data-mem]'); if (mem) { draft.memory = mem.dataset.mem; renderBoardKeep(); return; }
  const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
  e.preventDefault();
  if (a === 'run') { running = !running; renderBoardKeep(); }
  if (a === 'speed') { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; renderBoardKeep(); }
  if (a === 'reset') { startAll(); toast('All nine scenes restarted.'); }
  if (a === 'apply-all') applyAll();
  if (a === 'apply-scene') applyScene();
  if (a === 'reset-scene') { delete overrides[sel]; store.set('l10.overrides', overrides); startScene(sel); renderBoard(true); toast(`${sel} back on the global set and restarted.`); }
});
function renderBoardKeep() { const d = draft; renderBoard(); draft = d; renderBoard(); }
function applyAll() {
  const gkeys = new Set([...GLOBAL_PARAMS.map((p) => p.key), 'memory']);
  for (const [k, v] of Object.entries(draft)) {
    if (gkeys.has(k)) { global[k] = v; for (const o of Object.values(overrides)) delete o[k]; }
    else if (sel) (overrides[sel] ??= {})[k] = v;
  }
  store.set('l10.global', global); store.set('l10.overrides', overrides);
  startAll(); renderBoard(true); toast('Applied to all nine scenes. Every scene restarted.');
}
function applyScene() {
  const o = { ...(overrides[sel] ?? {}) };
  for (const [k, v] of Object.entries(draft)) {
    const base = (SCENE_PARAMS[sel] ?? []).some((p) => p.key === k) ? sceneDefaults(sel)[k] : global[k];
    if (v === base) delete o[k]; else o[k] = v;
  }
  overrides[sel] = o; store.set('l10.overrides', overrides);
  startScene(sel); renderBoard(true); toast(`Applied to ${sel} only. ${sel} restarted.`);
}

// ---------------- side panel: summary (map), to resolve (monitor), console (scene) ----------------
function renderSide() {
  const el = $('l10-side'), c = counts();
  if (mode === 'map') {
    el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline"><h2>Scenes</h2><a href="#" data-mode="monitor" style="font-size:12px;color:#141414;font-weight:600">Open monitor →</a></div>
      <div class="tabs"><a data-mode="monitor" class="on">Emergency <span>${c.red}</span></a><a data-mode="monitor">Hazard <span>${c.yellow}</span></a><a data-mode="monitor">All <span>${sims.length}</span></a></div>`;
    return;
  }
  if (mode === 'monitor') {
    const list = sims.filter((s) => ['red', 'yellow'].includes(statusFor(s)) || s.state.outcome === 'aborted').sort((a, b) => severity(a) - severity(b) || (a.state.prompt?.deadline ?? 1e9) - (b.state.prompt?.deadline ?? 1e9));
    el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline"><h2>To resolve</h2><span class="small">most urgent first</span></div>
      <div class="list">${list.map((s) => { const st = statusFor(s), S = s.state, p = S.prompt;
        return `<button type="button" class="item ${st === 'red' ? 'red' : ''}" data-open="${S.def.id}"><span class="dot bg-${st}"></span><span style="min-width:0"><b>${S.def.id} · ${esc(S.def.title)}</b><span class="small">${esc(p ? p.text : S.done ? (S.outcome === 'aborted' ? 'Aborted · redelivery required' : 'Delivered') : S.levelReason)}</span></span>${p ? `<span class="when">auto in ${Math.max(0, Math.ceil(p.deadline - S.t))} s</span>` : `<span class="when" style="color:#5e5e5e">${levelLabel(s)}</span>`}</button>`; }).join('') || '<span class="small">Nothing to resolve.</span>'}</div>`;
    return;
  }
  renderConsole();
}
function lastDetail(S) { for (let i = S.events.length - 1; i >= 0; i--) if (S.events[i].detail) return S.events[i].detail; return null; }
function renderConsole() {
  const sim = byId(sel), el = $('l10-side'); if (!sim) return;
  const S = sim.state, st = statusFor(sim), p = S.prompt, det = p?.detail ?? lastDetail(S) ?? {};
  const checks = sim.checks();
  const cmds = sim.available();
  el.innerHTML = `<div id="l10-console" style="display:flex;flex-direction:column;gap:10px;min-height:0">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div><h2 style="font-size:18px">${S.def.id} · ${esc(S.def.title)}</h2><span class="small">${esc(S.def.place)} · ${S.drones[0].id} · ${esc(LEVEL_TEXT[S.level])}</span></div><span class="chip ${st}">${levelLabel(sim)}</span></div>
    ${checks.length ? `<div class="checks">${checks.map((c) => `<span class="${c.ok ? '' : 'bad'}" title="${esc(c.detail)}">${c.ok ? '✓' : '✕'} ${esc(c.label)}</span>`).join('')}</div>` : ''}
    <div class="q"><div><div>FOUND</div>${esc(det.found ?? '—')}</div><div><div>WHY NOT</div>${esc(det.why ?? '—')}</div><div><div>TRIED</div>${esc(det.tried ?? '—')}</div><div><div>PROPOSES</div>${esc(det.proposes ?? (S.done ? 'mission ended' : 'continue'))}</div></div>
    ${p ? `<div class="opts">${p.options.map((o, i) => `<button type="button" class="${o.primary ? 'black wide' : 'pill'}" data-cmd="${o.id}">${esc(o.label)}</button>`).join('')}</div>
      <div><div class="small" style="display:flex;justify-content:space-between"><span>No command → fixed rule: ${esc(p.options.find((o) => o.id === p.defaultId)?.label ?? '')}</span><b style="color:#D93A26" id="l10-count">${Math.max(0, Math.ceil(p.deadline - S.t))} s</b></div><div class="bar"><div id="l10-countbar" style="width:${Math.max(0, Math.min(100, (p.deadline - S.t) / (p.deadline - p.opened) * 100))}%"></div></div></div>` : ''}
    ${S.done ? `<div class="small">${S.outcome === 'aborted' ? 'Aborted — the parcel is going back. Redelivery required.' : 'Delivered.'} Hover ${S.metrics.hoverS.toFixed(0)} s · battery ${sim.summary().battery}%.</div><button type="button" class="black" data-act="rerun">Run this scene again</button>` :
      `<div class="opts">${cmds.filter((c) => c.id !== 'force').map((c) => `<button type="button" class="pill" data-cmd="${c.id}" ${c.enabled ? '' : 'disabled'}>${esc(c.label)}</button>`).join('')}</div>
      <button type="button" class="force" disabled>Force lower · ${esc(cmds.find((c) => c.id === 'force').reason)}</button>`}
  </div>`;
}
$('l10-side').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]'); if (open) { setMode('scene', open.dataset.open); return; }
  const m = e.target.closest('[data-mode]'); if (m) { e.preventDefault(); setMode(m.dataset.mode); return; }
  const c = e.target.closest('[data-cmd]'); if (c) { byId(sel)?.command(c.dataset.cmd); renderConsole(); return; }
  if (e.target.closest('[data-act="rerun"]')) { startScene(sel); renderConsole(); }
});

// ---------------- status bar ----------------
function renderStatus() {
  const c = counts(), t = Math.max(0, ...sims.map((s) => s.state.t));
  const done = sims.filter((s) => s.state.done), ab = done.filter((s) => s.state.outcome === 'aborted').length;
  $('l10-status').innerHTML = `<span>Time <b>${fmtT(t)}</b></span><span>Scenes <b>${sims.length}</b></span>
    <span><i class="dot bg-red"></i>Emergency <b>${c.red}</b><i>L4 / human</i></span><span><i class="dot bg-yellow"></i>Hazard <b>${c.yellow}</b><i>L2–L3</i></span>
    <span><i class="dot bg-green"></i>Normal <b>${c.green}</b><i>L0–L1</i></span><span><i class="dot bg-grey"></i>Ended <b>${c.grey}</b><i>${done.length - ab} delivered · ${ab} aborted</i></span><span>Seed <b>${global.seed}</b></span>`;
}

// ---------------- map frames ----------------
const frames = $('l10-frames');
frames.innerHTML = SCENES.map((d) => `<button type="button" data-open="${d.id}" aria-label="Open scene ${d.id}"><span>${d.id}</span></button>`).join('');
frames.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) setMode('scene', b.dataset.open); });
wall.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) setMode('scene', b.dataset.open); });
function placeFrames() {
  const canvas = city.renderer.domElement, r = canvas.getBoundingClientRect();
  [...frames.children].forEach((b, i) => {
    const d = SCENES[i], p = stage.projectWith(city.camera, { x: d.target.x, z: d.target.z }, r.width, r.height);
    b.style.left = `${r.left + p.x}px`; b.style.top = `${r.top + p.y}px`;
    const sim = byId(d.id), st = sim ? statusFor(sim) : 'grey';
    if (b.className !== st) b.className = st;
    const label = d.id + (st === 'red' ? '  !' : ''); if (b.firstChild.textContent !== label) b.firstChild.textContent = label;
  });
}

// ---------------- zoomed scene: overlay, labels, timeline ----------------
function drawOverlay(sim, cam) {
  const ov = $('l10-overlay'), g = ov.getContext('2d'), W = ov.width, H = ov.height; g.clearRect(0, 0, W, H);
  const S = sim.state, P = (x, z, y) => stage.projectWith(cam, { x, z, y }, W, H);
  if (showKnow) {
    const fill = ['rgba(110,110,110,.38)', 'rgba(46,154,87,.20)', 'rgba(20,20,20,.40)', 'rgba(217,58,38,.60)'];
    for (const c of sim.knowledgeCells()) {
      const st = c.state === 1 && c.age > 2 ? 0.5 : c.state; const a = P(c.x0 + 0.06, c.z0 + 0.06), b = P(c.x0 + 0.94, c.z0 + 0.06), d = P(c.x0 + 0.94, c.z0 + 0.94), e = P(c.x0 + 0.06, c.z0 + 0.94);
      g.fillStyle = st === 0.5 ? 'rgba(46,154,87,.09)' : fill[st]; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(d.x, d.y); g.lineTo(e.x, e.y); g.closePath(); g.fill();
    }
  }
  // labels
  const L = [];
  const t = P(S.def.target.x, S.def.target.z), blocked = sim.checks().some((c) => !c.ok);
  L.push({ ...t, cls: S.target.original && blocked && !S.done ? 'red' : '', text: `Target · ${S.def.landmarks[1] ?? 'drop pad'}${S.target.original && blocked && !S.done ? ' · blocked' : ''}` });
  if (S.def.kind !== 'battery' && (global.backupSpots ?? 1) > 0 || S.target.backup) { const b = P(S.def.backup.x, S.def.backup.z); L.push({ ...b, cls: S.target.backup ? 'green' : '', text: S.target.backup ? 'Backup · in use' : 'Backup spot' }); }
  if (S.def.alt) { const a = P(S.def.alt.x, S.def.alt.z); L.push({ ...a, text: 'West lawn' }); }
  for (const d of S.drones) if (d.visible && d.phase !== 'done') { const q = P(d.x, d.z, d.y + 0.6); L.push({ ...q, text: `${d.id} · ${Math.round((d.y - 0.4) * SCALE_M)} m · ${d.phase}` }); }
  for (const a of S.agents) if (a.visible !== false && (a.kind === 'dog' || (a.kind === 'person' && Math.hypot(a.x - S.target.x, a.z - S.target.z) < 1.5))) { const q = P(a.x, a.z, 1.2); L.push({ ...q, cls: 'red', text: `${a.kind === 'dog' ? 'Dog' : 'Person'} · ${(Math.hypot(a.x - S.target.x, a.z - S.target.z) * SCALE_M).toFixed(1)} m` }); }
  if (S.balloon) { const q = P(S.balloon.x, S.balloon.z, S.balloon.y + 1.4); L.push({ ...q, text: 'Parade balloon' }); }
  const sx = $('l10-view').clientWidth / W, sy = $('l10-view').clientHeight / H;
  $('l10-labels').innerHTML = L.filter((l) => l.x > 0 && l.x < W && l.y > 0 && l.y < H).map((l) => `<span class="label ${l.cls ?? ''}" style="left:${l.x * sx}px;top:${l.y * sy}px">${esc(l.text)}</span>`).join('');
}
function renderTimeline(sim) {
  const S = sim.state, span = Math.max(60, S.t + 5), key = new Set(['VERIFY_FAIL', 'REEL_IN', 'ASK_BACKUP', 'ASK_YIELD', 'ASK_LAWN', 'ABORT', 'DELIVERED', 'OCCLUDED', 'PAUSE', 'HOLD', 'ADAPT']);
  const ev = S.events.filter((e) => key.has(e.code) || e.kind === 'decision');
  const labels = []; let lastX = -99;
  for (const e of ev) { const x = e.t / span * 100; if (x - lastX > 14) { labels.push(`<span class="lbl" style="left:${x}%">${e.time} ${esc(e.code.toLowerCase().replace(/_/g, ' '))}</span>`); lastX = x; } }
  const ser = S.metrics.series, maxD = Math.max(20, ...ser.map((p) => p[1]));
  const pts = ser.map((p, i) => `${(i / Math.max(1, ser.length - 1) * 120).toFixed(1)},${(28 - p[1] / maxD * 26).toFixed(1)}`).join(' ');
  $('l10-timeline').innerHTML = `<button type="button" class="black" data-act="rerun-t" title="Replay this scene from the start" style="width:36px;height:36px;padding:0;border-radius:50%">↺</button>
    <div class="track"><div class="line"></div><div class="fill" style="width:${S.t / span * 100}%"></div>
      ${ev.map((e) => `<span class="tick ${e.kind === 'decision' ? 'decision' : ''}" style="left:${e.t / span * 100}%" data-text="${esc(`${e.time} · ${e.text}`)}"></span>`).join('')}${labels.join('')}</div>
    <span class="dist">Distance to You <b style="color:${S.outcome === 'aborted' ? '#D93A26' : '#141414'}">${(S.distanceM ?? 0).toFixed(1)} m</b></span><svg viewBox="0 0 120 30" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="#141414" stroke-width="1.6"/></svg>`;
}
$('l10-timeline').addEventListener('click', (e) => { if (e.target.closest('[data-act="rerun-t"]')) { startScene(sel); renderConsole(); } });
$('l10-know').addEventListener('click', () => { showKnow = !showKnow; $('l10-know').setAttribute('aria-pressed', String(showKnow)); });
$('l10-back').addEventListener('click', () => setMode('monitor'));
$('l10-switch').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });

function toast(msg) { const t = $('toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600); }

// ---------------- frame loop (called by main.js after it draws the city) ----------------
function frame(dt) {
  hideAirspaceDrones();
  if (running) { let left = dt * speed; while (left > 1e-6) { const s = Math.min(0.1, left); for (const sim of sims) sim.step(s); left -= s; } }
  stage.sync(sims);
  if (mode === 'map') placeFrames();
  if (mode === 'monitor') { for (let k = 0; k < 3; k++) { const c = cells[cellRR++ % cells.length], sim = byId(c.id); if (sim) stage.renderCell(sim, c.ctx); } }
  if (mode === 'scene') { const sim = byId(sel); if (sim) { const cam = stage.renderBig(sim, $('l10-big').getContext('2d')); drawOverlay(sim, cam); $('l10-cam').innerHTML = `<span class="dot bg-red" style="width:7px;height:7px"></span>CAM-${sel} · ${esc(sim.state.def.place)}`; $('l10-live').textContent = `LIVE ${fmtT(sim.state.t)}`; } }
  uiClock += dt; memClock += dt;
  if (uiClock > 0.25) {
    uiClock = 0; renderStatus();
    for (const c of cells) { const sim = byId(c.id); if (!sim) continue; const st = statusFor(sim); c.el.classList.toggle('red', st === 'red'); c.dot.className = `dot bg-${st}`; c.chip.className = `chip ${st}`; c.chip.textContent = levelLabel(sim); }
    if (mode !== 'scene') renderSide();
    else { const sim = byId(sel); if (sim) { renderTimeline(sim); const p = sim.state.prompt, cnt = $('l10-count'); if (p && cnt && !sim.state.done) { cnt.textContent = `${Math.max(0, Math.ceil(p.deadline - sim.state.t))} s`; $('l10-countbar').style.width = `${Math.max(0, Math.min(100, (p.deadline - sim.state.t) / (p.deadline - p.opened) * 100))}%`; } if (!document.activeElement?.closest?.('#l10-console') && (sigOf(sim) !== consoleSig)) { consoleSig = sigOf(sim); renderConsole(); } } }
  }
  if (memClock > 5) { memClock = 0; store.set('l10.memory', memory); }
}
let consoleSig = '';
const sigOf = (sim) => { const S = sim.state; return [S.level, S.prompt?.code, S.done, S.hold, S.drones[0].phase, S.events.length, sim.checks().map((c) => c.ok).join()].join('|'); };

window.__l10 = { drawMain: true, frame, setSpeed: (v) => { speed = v; renderBoardKeep(); }, advance: (sec) => { for (let t = 0; t < sec; t += 0.1) for (const s of sims) s.step(0.1); }, get sims() { return sims; }, setMode, get mode() { return mode; }, startAll, command: (id, c) => byId(id)?.command(c), memory };
startAll();
setMode('map');
