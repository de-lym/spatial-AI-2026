// Last 10m v2 — the application: one shared city, nine drones, a human operator who triages.
// Views: Map (routes, incident dots, delivery radius) · Monitor (3×3 wall of drone cameras) · Scene (one drone: console + camera).
// main.js builds and draws the city; this module runs the world simulation on top of it.
import { BOARD, PRESETS, DEFAULT_SETTINGS, createWorld, TIER_NAME, TITLE, SCENE_OF, WORLD_CONST } from './world.js?v=10';
import { createStage } from './stage.js?v=10';
import { SCALE_M, HUB } from './scenes.js';
import { LEVEL_TEXT } from './sim.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtT = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable: run without persistence */ } },
};
const TIER_COLOR = { 1: '#D93A26', 2: '#E8791B', 3: '#E3A11B' };
const TIER_CLS = { 1: 't1', 2: 't2', 3: 't3' };
const SPEEDS = [1, 2, 4, 8];

const city = window.__sim;
if (!city) throw new Error('Last 10m: the city (main.js) did not start.');

// ---------------- state ----------------
let settings = { ...DEFAULT_SETTINGS, ...store.get('l10.v2.settings', {}) };
let draft = {};
const memory = store.get('l10.v2.memory', {});
let runs = store.get('l10.v2.runs', []);                 // the last two finished runs, with their settings
let runNo = store.get('l10.v2.runNo', 0);
let lastSettings = null; let world = null, builtKey = '', cityData = null, building = false;
let showTrails = true; const viewIx = {};
let running = true, speedIx = 0, mode = 'map', sel = null, showKnow = false, scoreOpen = false, boardOpen = true, boardTouched = false;
let reportShown = false, scoreClock = 0, uiClock = 0, memClock = 0, cellRR = 0, sideSig = '', consoleSig = '';

// ---------------- city + run lifecycle ----------------
function ensureCity() {
  const key = `${settings.preset}:${settings.seed}`;
  if (key !== builtKey) { planCache.clear(); city.rebuildCity({ preset: settings.preset, seed: settings.seed }); cityData = city.exportCity(); builtKey = key; stage?.resetCache(); }
}
function startRun() {
  ensureCity();
  if (world && world.state.t > 30) { runs = [{ n: runNo, settings: { ...lastSettings }, card: world.scorecard() }, ...runs].slice(0, 2); store.set('l10.v2.runs', runs); store.set('l10.v2.memory', memory); }   // the run that was going is kept for the comparison
  lastSettings = { ...settings };
  world = createWorld(settings, { obstacles: cityData.obstacles, low: cityData.low, roads: cityData.roads, tiles: cityData.tiles, memory, plan: planner });
  runNo++; store.set('l10.v2.runNo', runNo);
  scoreOpen = false; reportShown = false; sideSig = ''; consoleSig = ''; if (mode === 'scene' && !world.droneOf(sel)) sel = 'D-01';
  renderBoard(); renderSide(); renderStatus(); renderScore();
}

// ---------------- flight boundary system: the AIRSPACE route planner decides every leg ----------------
// (map edge, building volumes + clearance, restricted volumes, permitted airspace with landing columns). Plans are cached per city.
const planCache = new Map();
function planner(from, to, opts) {
  const r1 = (v) => Math.round(v * 20) / 20, key = `${builtKey}|${r1(from.x)},${r1(from.y)},${r1(from.z)}>${r1(to.x)},${r1(to.y)},${r1(to.z)}|${opts?.base ?? ''}`;
  if (planCache.has(key)) return planCache.get(key);
  const r = city.planRoute(from, to, opts); const out = r?.ok ? { ok: true, pts: r.pts } : { ok: false };
  if (planCache.size > 4000) planCache.clear(); planCache.set(key, out); return out;
}

// ---------------- 3D ----------------
const stage = createStage({ scene: city.scene, couriers: city.S.couriers, obstacles: () => city.world.obstacles });
{ const cam = city.camera, ctl = city.controls; ctl.target.set(0, 0, 4); cam.position.set(60, 52, 64); cam.zoom = 0.4; cam.updateProjectionMatrix(); ctl.update(); ctl.saveState?.(); }
stage.setMainOnly([stage.trails]);                              // trails are drawn on the Map only
city.S.layers.rest = false; city.S.layers.perm = false; city.S.layers.cand = false; city.S.layers.sel = false;   // no airspace boxes on screen
const hideAirspaceDrones = () => city.S.couriers.forEach((c) => { c.mesh.visible = false; if (c.label) c.label.visible = false; if (c.halo) c.halo.visible = false; });

// ---------------- helpers ----------------
const tierOf = (d) => (d.event && ['open', 'acknowledged', 'auto'].includes(d.event.status) ? d.event.tier : 0);
const openTier = (d) => (['open', 'auto'].includes(d.event?.status) ? d.event.tier : 0);   // flashing: critical, being handled right now
const orderLine = (d) => (d.order ? `#${d.order.id}${d.order.urgent ? ' · URGENT' : ''} → ${d.order.addr.name}` : 'idle at hub');
const phaseText = (d) => ({ idle: 'idle at hub', enter: 'flying out', locate: 'locating', confirm: 'asking customer', descend: 'descending', scan: 'scanning', verify: 'verifying', wait: 'waiting', lower: 'lowering', reel: 'reeling in', release: 'releasing', reelup: 'reeling up', leave: 'flying home', return: 'returning (aborted)', land: 'landing', shift: 'moving to backup', climb: 'climbing', pickup: 'collecting at the shop' }[d.phase] ?? d.phase);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function counts() {
  const S = world.state, c = { 1: 0, 2: 0, 3: 0 }; for (const e of S.events) if (e.status === 'open' || e.status === 'auto') c[e.tier]++;
  const delivered = S.orders.filter((o) => o.outcome && o.outcome !== 'aborted').length, aborted = S.orders.filter((o) => o.outcome === 'aborted').length;
  return { open: c, delivered, aborted, inflight: S.drones.filter((d) => d.order).length, onHold: S.events.filter((e) => e.status === 'open').length };
}

// ---------------- mode switching ----------------
function setMode(m, id) {
  mode = m; if (id) sel = id; if (!sel) sel = 'D-01';
  if (!boardTouched) boardOpen = m === 'map';
  document.body.dataset.mode = m;
  document.querySelectorAll('#l10-switch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m || (m === 'scene' && b.dataset.mode === 'monitor'))));
  window.__l10.drawMain = m === 'map';
  if (m === 'monitor') sizeCells(); if (m === 'scene') sizeBig();
  sideSig = ''; consoleSig = ''; renderBoard(); renderSide(); renderStatus();
}

// ---------------- Simulation board ----------------
const groupsOf = () => [...new Set(BOARD.map((b) => b.group))];
function fmtVal(p, v) { return `${v}${p.unit ? (p.unit === '%' || p.unit === 'm' || p.unit === '/min' ? '' : ' ') + p.unit : ''}`; }
function renderBoard() {
  const val = (k) => (k in draft ? draft[k] : settings[k]);
  const dirty = Object.keys(draft).some((k) => draft[k] !== settings[k]);
  const pend = (k) => (k in draft && draft[k] !== settings[k] ? '<span class="tag pending">unsaved</span>' : '');
  const slider = (p) => `<label class="param"><span class="row"><span class="name">${esc(p.label)}${pend(p.key)}</span><span class="val">${esc(fmtVal(p, val(p.key)))}</span></span>
      <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${+val(p.key)}" data-key="${p.key}" aria-label="${esc(p.label)}"></label>`;
  const mem = val('memory');
  $('l10-board').innerHTML = `
    <div class="ctrl"><button type="button" class="black" data-act="run">${running ? 'Pause' : 'Run'}</button><button type="button" class="pill" data-act="speed">${SPEEDS[speedIx]}×</button><button type="button" class="pill" data-act="reset">Reset</button>
      <button type="button" class="pill fold" data-act="fold" aria-expanded="${boardOpen}" title="${boardOpen ? 'Collapse the board' : 'Expand the board'}">${boardOpen ? '▾' : '▸'}</button></div>
    <div class="head"><h2>Simulation board</h2><span class="small">run ${runNo}${dirty ? ' · unsaved edits' : ''}</span></div>
    <div class="bbody" ${boardOpen ? '' : 'hidden'}>
      <div class="grp"><div class="gl">City · building cluster${pend('preset')}</div>
        <div class="presets" role="group" aria-label="Building cluster">${PRESETS.map((p) => `<button type="button" data-preset="${p.id}" aria-pressed="${val('preset') === p.id}">${esc(p.label)}</button>`).join('')}</div></div>
      ${groupsOf().map((g) => `<div class="grp"><div class="gl">${g}</div><div class="params">${BOARD.filter((b) => b.group === g).map(slider).join('')}
        ${g === 'Weather' ? `<div class="param"><span class="row"><span class="name">Agent memory${pend('memory')}</span></span><span class="seg" role="group" aria-label="Memory"><button type="button" data-mem="fresh" aria-pressed="${mem === 'fresh'}">Fresh</button><button type="button" data-mem="retained" aria-pressed="${mem === 'retained'}">Retained</button></span></div>` : ''}</div></div>`).join('')}
    </div>
    <div class="foot"><label class="seed">Seed <input type="number" data-key="seed" value="${val('seed')}" min="1" max="99999" aria-label="Seed"></label>
      <button type="button" class="black" data-act="apply">Apply &amp; restart</button></div>`;
  $('l10-board').classList.toggle('open', boardOpen);
}
$('l10-board').addEventListener('input', (e) => {
  const k = e.target.dataset.key; if (!k) return;
  const p = BOARD.find((f) => f.key === k); draft[k] = +e.target.value;
  if (p) { const row = e.target.closest('.param'); row.querySelector('.val').textContent = fmtVal(p, draft[k]); const name = row.querySelector('.name'); if (!name.querySelector('.pending')) name.insertAdjacentHTML('beforeend', '<span class="tag pending">unsaved</span>'); }
  if (k === 'radiusM') { window.__l10.radiusDraft = draft[k]; window.__l10.radiusUntil = performance.now() + 1600; }
});
$('l10-board').addEventListener('change', (e) => { if (e.target.dataset.key === 'radiusM') { window.__l10.radiusUntil = performance.now() + 1200; } if (e.target.dataset.key === 'seed') renderBoard(); });
$('l10-board').addEventListener('click', (e) => {
  const pr = e.target.closest('[data-preset]'); if (pr) { draft.preset = pr.dataset.preset; renderBoard(); return; }
  const mm = e.target.closest('[data-mem]'); if (mm) { draft.memory = mm.dataset.mem; renderBoard(); return; }
  const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
  if (a === 'run') { running = !running; renderBoard(); }
  if (a === 'speed') { speedIx = (speedIx + 1) % SPEEDS.length; renderBoard(); }
  if (a === 'fold') { boardOpen = !boardOpen; boardTouched = true; renderBoard(); }
  if (a === 'reset') restart('Run restarted with the applied settings.');
  if (a === 'apply') { settings = { ...settings, ...draft, seed: Math.max(1, Math.floor(draft.seed ?? settings.seed)) }; draft = {}; window.__l10.radiusDraft = null; store.set('l10.v2.settings', settings); restart('Applied. The city and the run were rebuilt.'); }
});
function restart(msg) {
  toast(settings.preset !== (builtKey.split(':')[0]) ? 'Building the city…' : 'Restarting…');
  setTimeout(() => { startRun(); toast(msg); }, 30);
}

// ---------------- side panel: To resolve (map / monitor) · console (scene) ----------------
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function rowHTML(e) {
  const auto = e.status === 'auto', waited = world.state.t - e.opened;
  return `<button type="button" class="item ${TIER_CLS[e.tier]}${auto ? ' auto' : ''}" data-open="${e.drone}" data-ev="${e.id}"><span class="tdot" style="background:${TIER_COLOR[e.tier]}">${e.tier}</span>
    <span style="min-width:0;flex:1"><b>${esc(e.drone)} · ${esc(TITLE[e.type])}${e.urgent ? '<span class="urg">URGENT</span>' : ''}</b>
    <span class="small">${auto ? 'Handled automatically · no action needed' : e.clearNow ? 'Looks clear now · tap to continue' : 'On hold · waiting for you'}</span></span>
    <span class="when">${auto ? 'AUTO' : mmss(waited)}</span></button>`;
}
function renderSide() {
  if (!world) return;
  const el = $('l10-side');
  if (mode === 'scene') { renderConsole(true); return; }
  const q = world.queue(), c = counts();
  const sig = q.map((e) => `${e.id}${e.status}${e.clearNow ? 1 : 0}`).join();
  if (sig !== sideSig || !el.querySelector('.list')) {
    sideSig = sig;
    el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline"><h2>To resolve</h2><span class="small">tier, then longest waiting</span></div>
      <div class="tabs"><a class="t1">① Critical <span>${c.open[1]}</span></a><a class="t2">② Urgent <span>${c.open[2]}</span></a><a class="t3">③ Can wait <span>${c.open[3]}</span></a></div>
      <div class="list">${q.length ? q.map(rowHTML).join('') : '<p class="small" style="padding:6px 2px">Nothing to resolve. Drones are working.</p>'}</div>`;
  } else {
    el.querySelectorAll('.tabs a span').forEach((s, i) => { s.textContent = c.open[i + 1]; });
    for (const e of q) { const row = el.querySelector(`[data-ev="${e.id}"]`); if (row && e.status === 'open') row.querySelector('.when').textContent = mmss(world.state.t - e.opened); }
  }
}
// one plain sentence: what happened, and what the drone did about it
const GONE = { ped: 'The person has walked away from the drop spot.', dog: 'The dog has left the drop spot.', car: 'The car has driven off the pad.', pigeon: 'The flock has passed.', occluded: 'The confetti has settled.', gust: 'The gust has passed.', nofly: 'The no-fly zone has been lifted.' };
function whatHappened(d, ev) {
  if (ev.clearNow && GONE[ev.type]) return GONE[ev.type];
  const S = world.state, T = d.target ?? d.order?.addr;
  switch (ev.type) {
    case 'ped': case 'dog': { const a = [...S.agents.peds, ...S.agents.dogs].filter((x) => (ev.type === 'dog') === (x.kind === 'dog')).sort((x, y) => dist(x, T) - dist(y, T))[0]; const m = a ? `${(dist(a, T) * SCALE_M).toFixed(0)} m` : 'close';
      return `${ev.type === 'dog' ? 'A dog is' : 'Someone is'} ${m} from the drop spot.`; }
    case 'conflict': { const o = world.droneOf(ev.with); return `${o.id} needs the same airspace (${ev.kind2}).`; }
    case 'nofly': return 'A temporary no-fly zone opened on the route.';
    case 'gust': return `A ${(world.activeGust()?.v ?? 12).toFixed(0)} m/s gust is pushing toward a tall building.`;
    case 'pigeon': return 'A pigeon flock is in the flight path.';
    case 'occluded': return 'Parade confetti hides the drop spot from the sensor.';
    case 'car': return 'A car is parked on the delivery pad.';
    case 'silent': return `The customer has not answered for ${mmss(S.t - (d.confirmStart ?? S.t))}. After 5:00 the drone gives up and flies home.`;
  }
  return '';
}
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');
function renderConsole(force) {
  const el = $('l10-side'), d = sel && world ? world.droneOf(sel) : null; if (!d) return;
  const S = world.state, ev = d.event && ['open', 'auto', 'acknowledged'].includes(d.event.status) ? d.event : null;
  const live = ev && (ev.status === 'open' || (ev.status === 'auto' && !ev.option));
  const sig = [d.phase, ev?.id, ev?.status, ev?.option, ev?.clearNow, d.order?.id, S.done].join('|');
  if (!force && sig === consoleSig) { const w = $('l10-waited'); if (w && ev?.status === 'open') w.textContent = mmss(S.t - ev.opened); return; }
  consoleSig = sig;
  const head = `<div class="c-head"><div><h2>${esc(d.id)} · ${esc(phaseText(d))}</h2><span class="small">${esc(orderLine(d))}</span></div>
      ${ev ? `<span class="tchip" style="background:${TIER_COLOR[ev.tier]}">${ev.tier} · ${esc(TIER_NAME[ev.tier])}</span>` : `<span class="chip ${d.order ? 'green' : 'grey'}">${d.order ? 'Normal' : 'Idle'}</span>`}</div>`;
  if (!ev) {
    el.innerHTML = `<div id="l10-console">${head}<p class="c-note">${d.order ? 'No problem. Nothing to do.' : 'Waiting at the hub for the next order.'}</p>
      ${d.order && !['return', 'land', 'idle'].includes(d.phase) ? '<div class="opts"><button type="button" class="pill wide" data-cmd="return">Return to hub</button></div>' : ''}</div>`;
    return;
  }
  const status = ev.status === 'auto' ? (ev.option ? 'Override sent.' : 'Handled automatically. It continues by itself when it is safe. You can still change it:')
    : ev.status === 'acknowledged' ? 'You chose to wait. It continues by itself when it is clear.'
    : ev.clearNow ? 'It looks clear now. The drone is still on hold until you decide.' : 'On hold until you decide.';
  const opts = live ? ev.options.filter((o) => !(ev.status === 'auto' && ['wait', 'rule'].includes(o.id))).map((o) => {
    const label = ev.clearNow && o.id === 'wait' ? 'Continue (it is clear)' : o.label;
    return `<button type="button" class="${o.primary && ev.status === 'open' ? 'black wide' : 'pill'}" data-resolve="${ev.id}" data-opt="${o.id}">${esc(label)}</button>`;
  }).join('') : '';
  el.innerHTML = `<div id="l10-console">${head}
    <div class="evcard t${ev.tier}"><b>${esc(TITLE[ev.type])}${ev.urgent ? ' <span class="urg">URGENT ORDER</span>' : ''}</b>
      <p>${esc(whatHappened(d, ev))}${ev.clearNow ? '' : ` ${esc(cap(ev.safeAction ?? ''))}.`}</p>
      <span class="small">${esc(status)}${ev.status === 'open' ? ` · waiting <b id="l10-waited">${mmss(S.t - ev.opened)}</b>` : ''}</span></div>
    ${opts ? `<div class="opts">${opts}</div>` : ''}</div>`;
}
$('l10-side').addEventListener('click', (e) => {
  const rs = e.target.closest('[data-resolve]'); if (rs) { world.resolve(rs.dataset.resolve, rs.dataset.opt); consoleSig = ''; sideSig = ''; renderConsole(true); return; }
  const open = e.target.closest('[data-open]'); if (open) { setMode('scene', open.dataset.open); return; }
  const c = e.target.closest('[data-cmd]'); if (c) { world.command(sel, c.dataset.cmd); consoleSig = ''; renderConsole(true); }
});

// ---------------- status bar ----------------
function renderStatus() {
  if (!world) return; const c = counts(), S = world.state;
  $('l10-status').innerHTML = `<span>Shift <b>${fmtT(S.t)}</b><i>/ ${fmtT(world.shiftS)}</i></span><span>Delivered <b>${c.delivered}</b><i>${c.aborted} aborted</i></span><span>In flight <b>${c.inflight}</b>/9</span>
    <span><i class="tdot s" style="background:${TIER_COLOR[1]}">1</i><b>${c.open[1]}</b></span><span><i class="tdot s" style="background:${TIER_COLOR[2]}">2</i><b>${c.open[2]}</b></span><span><i class="tdot s" style="background:${TIER_COLOR[3]}">3</i><b>${c.open[3]}</b></span>
    <span>On hold <b>${c.onHold}</b></span><span>Run <b>${runNo}</b></span><span><a href="#" data-score="1">${S.done ? 'Shift report' : 'Report'}</a></span>`;
}
$('l10-status').addEventListener('click', (e) => { if (e.target.closest('[data-score]')) { e.preventDefault(); scoreOpen = true; renderScore(); } });

// ---------------- shift report: drawn, not written ----------------
const SETTING_LABEL = { preset: 'City', orders: 'Orders', urgentPct: 'Urgent %', radiusM: 'Radius m', flocks: 'Flocks', pedestrians: 'Pedestrians', dogs: 'Dogs', replyPct: 'Reply %', gustPerMin: 'Gust /min', memory: 'Memory', seed: 'Seed', shiftMin: 'Shift min' };
const PRESET_LABEL = Object.fromEntries(PRESETS.map((p) => [p.id, p.label]));
const fmtN = (v, u = '') => (v == null ? '—' : `${v}${u}`);
const INK = '#141414', MUTED = '#6E6C69', LIGHT = '#D9D5CD', SURF = '#F6F4EF';
// small line pictograms (24×24, stroke = currentColor)
const ICON = {
  city: '<path d="M3 21V9l5-3v15M8 21V4l6 3v14M14 21v-9l7 2v7M2 21h20"/>', orders: '<path d="M4 8l8-4 8 4v9l-8 4-8-4z M4 8l8 4 8-4 M12 12v9"/>', urgent: '<path d="M12 3v11 M12 18.5v.5"/><circle cx="12" cy="12" r="10"/>',
  radius: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5"/><path d="M12 12h9"/>', flocks: '<path d="M2 10c3-3 5-3 7 0 2-3 4-3 7 0 M9 17c2-2 3.5-2 5 0 2-2 3.5-2 5 0"/>',
  pedestrians: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7l-3 7 M12 14l3 7 M8 11l4-3 4 3"/>', dogs: '<path d="M4 13h11l3-4h2v3l-2 2v6 M6 13v7 M15 13v7 M4 13l-1-3"/>',
  replyPct: '<path d="M4 5h16v10H9l-5 4z"/>', gustPerMin: '<path d="M3 9h11a3 3 0 1 0-3-3 M3 14h15a3 3 0 1 1-3 3 M3 19h7"/>', memory: '<path d="M6 4h12v16H6z M9 8h6 M9 12h6 M9 16h3"/>', shiftMin: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2 M9 2h6"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const STATE = [['w', 'At the drop spot', INK], ['f', 'Flying', '#8E8B85'], ['p', 'At the shop', '#B9B5AE'], ['r', 'Going home', LIGHT], ['h', 'On hold for you', TIER_COLOR[2]], ['a', 'Critical, handled', TIER_COLOR[1]], ['i', 'At the hub', '#EEEBE4']];
const STATE_OF = Object.fromEntries(STATE.map(([k, l, c]) => [k, { l, c }]));

function conditionsHTML(st) {
  const items = [['city', PRESET_LABEL[st.preset] ?? st.preset], ['orders', `${st.orders} / 10 min`], ['urgent', `${st.urgentPct}% urgent`], ['radius', `${st.radiusM} m`], ['flocks', `${st.flocks} flocks`], ['pedestrians', `${st.pedestrians} people`], ['dogs', `${st.dogs} dogs`], ['replyPct', `${st.replyPct}% reply`], ['gustPerMin', `${st.gustPerMin} gusts/min`], ['memory', st.memory === 'fresh' ? 'Fresh memory' : 'Retained memory'], ['shiftMin', `${st.shiftMin ?? 10} min shift`]];
  return `<div class="rp-cond">${items.map(([k, t]) => `<span title="${esc(SETTING_LABEL[k] ?? k)}">${icon(k)}${esc(t)}</span>`).join('')}</div>`;
}
function donutSVG(c) {
  const parts = [['Delivered', c.deliveredN, INK], ['At backup spot', c.deliveredAltN, MUTED], ['Aborted', c.abortedN, TIER_COLOR[1]], ['Not finished', c.unfinished, LIGHT]].filter((p) => p[1] > 0);
  const tot = Math.max(1, c.received), R = 52, r = 34, cx = 64, cy = 64; let a0 = -Math.PI / 2;
  const arcs = parts.map(([l, n, col]) => {
    const a1 = a0 + n / tot * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0, P = (ang, rad) => `${(cx + Math.cos(ang) * rad).toFixed(2)},${(cy + Math.sin(ang) * rad).toFixed(2)}`;
    const d = parts.length === 1 ? `M${cx - R},${cy}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0M${cx - r},${cy}a${r},${r} 0 1,1 ${2 * r},0a${r},${r} 0 1,1 ${-2 * r},0` : `M${P(a0, R)}A${R},${R} 0 ${big} 1 ${P(a1, R)}L${P(a1, r)}A${r},${r} 0 ${big} 0 ${P(a0, r)}Z`;
    a0 = a1; return `<path d="${d}" fill="${col}" fill-rule="evenodd" stroke="${SURF}" stroke-width="2"><title>${l}: ${n}</title></path>`;
  }).join('');
  const pct = Math.round((c.deliveredN + c.deliveredAltN) / tot * 100);
  return `<div class="rp-donut"><svg viewBox="0 0 128 128" role="img" aria-label="Outcome of ${c.received} orders">${arcs}<text x="64" y="62" text-anchor="middle" class="big">${pct}%</text><text x="64" y="78" text-anchor="middle" class="sm">delivered</text></svg>
    <ul>${[['Delivered', c.deliveredN, INK], ['At backup spot', c.deliveredAltN, MUTED], ['Aborted', c.abortedN, TIER_COLOR[1], c.unreachable ? `${c.unreachable} customer unreachable` : ''], ['Not finished', c.unfinished, LIGHT, 'still in the queue or in the air']].map(([l, n, col, sub]) => `<li><i style="background:${col}"></i><b>${n}</b> ${l}${sub ? `<span>${esc(sub)}</span>` : ''}</li>`).join('')}<li class="tot">${c.received} orders received</li></ul></div>`;
}
function mapSVG(S, settingsUsed) {
  const obs = cityData?.obstacles ?? [], tiles = cityData?.tiles ?? [], ext = 62, hMax = Math.max(1, ...obs.map((o) => o.h));
  const tileR = tiles.map((t) => `<rect x="${t.cx - 5.85}" y="${t.cz - 5.85}" width="11.7" height="11.7" fill="#EFECE5"/>`).join('');
  const bld = obs.map((o) => `<rect x="${o.x0.toFixed(1)}" y="${o.z0.toFixed(1)}" width="${(o.x1 - o.x0).toFixed(1)}" height="${(o.z1 - o.z0).toFixed(1)}" fill="${INK}" fill-opacity="${(0.18 + 0.6 * o.h / hMax).toFixed(2)}"><title>${esc(o.name ?? o.id)} · ${Math.round(o.h * SCALE_M)} m</title></rect>`).join('');
  const tracks = (S.tracks ?? []).map((tr) => { let d = '', pen = false; for (const p of tr) { if (!p) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${p[0]},${p[1]}`; pen = true; } return d ? `<path d="${d}" fill="none" stroke="${INK}" stroke-opacity=".28" stroke-width=".35" stroke-linejoin="round"/>` : ''; }).join('');
  const rad = (settingsUsed.radiusM ?? 200) / SCALE_M;
  const dots = S.events.map((e) => `<circle cx="${e.pos.x.toFixed(1)}" cy="${e.pos.z.toFixed(1)}" r="1.5" fill="${TIER_COLOR[e.tier]}" stroke="${SURF}" stroke-width=".5"><title>${fmtT(e.opened)} · ${esc(e.drone)} · ${esc(TITLE[e.type])}</title></circle>`).join('');
  return `<svg class="rp-map" viewBox="${-ext} ${-ext} ${ext * 2} ${ext * 2}" role="img" aria-label="Routes and incidents">${tileR}${bld}<circle cx="0" cy="0" r="${rad}" fill="none" stroke="${TIER_COLOR[1]}" stroke-width=".5" stroke-dasharray="2 1.5"/>${tracks}<rect x="-2" y="-2" width="4" height="4" fill="${SURF}" stroke="${INK}" stroke-width=".6"><title>Hub</title></rect>${dots}</svg>`;
}
function eventsHTML(card) {
  const types = Object.entries(card.byType ?? {}).sort((a, b) => b[1] - a[1]), max = Math.max(1, ...types.map((t) => t[1]));
  const TIERS = { ped: 1, conflict: 1, nofly: 1, gust: 1, dog: 2, pigeon: 2, occluded: 2, car: 3, silent: 3 };
  return `<div class="rp-bars">${types.map(([k, n]) => `<div class="row" title="${esc(TITLE[k])}: ${n}"><span class="lab">${esc(TITLE[k])}</span><span class="track"><i style="width:${n / max * 100}%;background:${TIER_COLOR[TIERS[k]]}"></i></span><b>${n}</b></div>`).join('')}</div>
    <div class="rp-legend">${[1, 2, 3].map((t) => `<span><i style="background:${TIER_COLOR[t]}"></i>${t} ${TIER_NAME[t]}</span>`).join('')}</div>`;
}
function ganttSVG(S) {
  const rows = S.gantt ?? [], T = Math.max(1, ...rows.map((r) => r.length)), W = 600, RH = 14, G = 4, LW = 34, H = rows.length * (RH + G);
  const bars = rows.map((r, i) => { let out = '', k = 0; while (k < r.length) { let j = k; while (j < r.length && r[j] === r[k]) j++; const st = STATE_OF[r[k]] ?? STATE_OF.i; out += `<rect x="${(LW + k / T * (W - LW)).toFixed(2)}" y="${i * (RH + G)}" width="${Math.max(0.6, (j - k) / T * (W - LW)).toFixed(2)}" height="${RH}" fill="${st.c}"${r[k] === 'a' ? ' class="hatch"' : ''}><title>${S.drones[i].id} · ${fmtT(k)}–${fmtT(j)} · ${st.l}</title></rect>`; k = j; } return `<text x="0" y="${i * (RH + G) + RH - 3}" class="id">${S.drones[i].id}</text>${out}`; }).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<text x="${LW + f * (W - LW)}" y="${H + 12}" class="tick" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${fmtT(f * T)}</text>`).join('');
  return `<svg class="rp-gantt" viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="What each drone did over the shift">${bars}${ticks}</svg>
    <div class="rp-legend">${STATE.map(([k, l, c]) => `<span><i style="background:${c}"${k === 'a' ? ' class="hatch"' : ''}></i>${l}</span>`).join('')}</div>`;
}
const arrow = (cur, prev, better) => { if (prev == null || cur == null || cur === prev) return ''; const up = cur > prev, good = better > 0 ? up : !up; return `<em class="${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(+(cur - prev).toFixed(1))}</em>`; };
function renderScore() {
  const el = $('l10-score'); el.hidden = !scoreOpen; if (!scoreOpen || !world) return;
  const S = world.state, c = world.scorecard(), st = lastSettings ?? settings, prev = runs[0]?.card ?? null, ended = S.done;
  const delPct = (x) => (x ? Math.round(((x.deliveredN ?? 0) + (x.deliveredAltN ?? 0)) / Math.max(1, x.received ?? x.orders ?? 1) * 100) : null);
  const hero = [
    ['Delivered', delPct(c), '%', delPct(prev), 1], ['Two-drone conflicts', c.conflicts, '', prev?.conflicts, -1], ['Events', c.eventsTotal, '', prev?.eventsTotal, -1],
    ['Avg wait for you', c.wait[2] ?? c.wait[3], ' s', prev?.wait?.[2] ?? prev?.wait?.[3], -1], ['Fleet time on hold', c.holdSharePct, '%', prev?.holdSharePct, -1], ['Score', c.score, '', prev?.score, 1],
  ];
  el.innerHTML = `<div class="sc-head"><div><h2>Shift report · run ${runNo}</h2><span class="small">${ended ? `Shift over · ${fmtT(c.time)}` : `Live · ${fmtT(c.time)} of ${fmtT((st.shiftMin ?? 10) * 60)}`} · seed ${st.seed}${prev ? ` · ▲▼ compared with run ${runs[0].n}` : ''}</span></div><button type="button" class="pill" data-sc="close">Close</button></div>
    ${conditionsHTML(st)}
    <div class="rp-hero">${hero.map(([l, v, u, pv, b]) => `<div><b>${fmtN(v, u)}</b><span>${l}</span>${arrow(v, pv, b)}</div>`).join('')}</div>
    <div class="rp-grid">
      <section><h3>Orders</h3>${donutSVG(c)}</section>
      <section><h3>Where they flew, where things happened</h3>${mapSVG(S, st)}<div class="rp-legend"><span><i style="background:${TIER_COLOR[1]};border-radius:50%"></i>incident (tier colour)</span><span><i class="dash"></i>delivery radius</span></div></section>
      <section><h3>What happened</h3>${eventsHTML(c)}<p class="small">Critical events handled by the drones themselves: <b>${c.autoHandled}</b>${c.closestTier1M != null ? ` · closest approach ${c.closestTier1M} m` : ''}. Longest anyone waited for you: <b>${fmtN(c.longestWaitS, ' s')}</b>.</p></section>
    </div>
    <section><h3>The nine drones over the shift</h3>${ganttSVG(S)}</section>
    <div class="sc-foot"><button type="button" class="black" data-sc="again">${ended ? 'Start the next shift' : 'Restart the shift'}</button><button type="button" class="pill" data-sc="close">Close</button></div>`;
}
$('l10-score').addEventListener('click', (e) => {
  const a = e.target.closest('[data-sc]')?.dataset.sc; if (!a) return;
  if (a === 'close') { scoreOpen = false; renderScore(); } if (a === 'again') restart('New shift started.');
});

// ---------------- monitor wall: nine drone cameras ----------------
const wall = $('l10-wall');
wall.innerHTML = Array.from({ length: 9 }, (_, i) => `<button type="button" class="cell" data-open="D-0${i + 1}" aria-label="Open drone D-0${i + 1}">
  <canvas width="480" height="300"></canvas><span class="cam"><span class="dot bg-red" style="width:6px;height:6px"></span>CAM-D-0${i + 1}</span><span class="bang"></span><span class="rot" role="button" tabindex="0" title="Change the view angle">⟳</span>
  <span class="strip"><b>D-0${i + 1}</b><span class="what"></span><span class="chip"></span></span></button>`).join('');
const cells = [...wall.querySelectorAll('.cell')].map((el, i) => ({ el, id: `D-0${i + 1}`, ctx: el.querySelector('canvas').getContext('2d'), bang: el.querySelector('.bang'), what: el.querySelector('.what'), chip: el.querySelector('.chip') }));
function sizeCells() { for (const c of cells) { const r = c.el.getBoundingClientRect(); if (r.width > 10) { c.ctx.canvas.width = Math.round(r.width); c.ctx.canvas.height = Math.round(r.height); } } }
new ResizeObserver(sizeCells).observe(wall);
wall.addEventListener('click', (e) => {
  const rot = e.target.closest('.rot'); if (rot) { e.stopPropagation(); const id = rot.closest('[data-open]').dataset.open; viewIx[id] = ((viewIx[id] ?? 0) + 1) % 4; return; }
  const b = e.target.closest('[data-open]'); if (b) setMode('scene', b.dataset.open);
});

// ---------------- map: drone markers, routes, incident dots, delivery radius ----------------
const frames = $('l10-frames');
frames.innerHTML = Array.from({ length: 9 }, (_, i) => `<button type="button" data-open="D-0${i + 1}" aria-label="Open drone D-0${i + 1}" hidden><span></span></button>`).join('');   // warning labels only: shown while a drone has an open event
frames.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) setMode('scene', b.dataset.open); });
const fx = $('l10-mapfx'), fxg = fx.getContext('2d');
function drawMap() {
  const canvas = city.renderer.domElement, r = canvas.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
  if (fx.width !== W || fx.height !== H) { fx.width = W; fx.height = H; }
  fxg.clearRect(0, 0, W, H);
  const P = (x, z, y) => { const p = stage.projectWith(city.camera, { x, z, y }, r.width, r.height); return { x: r.left + p.x, y: r.top + p.y }; };
  const S = world.state, t = performance.now() / 1000;
  // delivery radius: a green circle around the hub that only shows while the radius is being adjusted; otherwise fully transparent
  const L = window.__l10, left = (L.radiusUntil ?? 0) - performance.now();
  if (left > 0 && L.radiusDraft != null) {
    const a = Math.min(1, left / 500), radiusU = L.radiusDraft / SCALE_M;
    fxg.save(); fxg.globalAlpha = a; fxg.lineWidth = 2.5; fxg.strokeStyle = '#2E9A57'; fxg.fillStyle = 'rgba(46,154,87,.10)'; fxg.beginPath();
    for (let i = 0; i <= 96; i++) { const q = i / 96 * Math.PI * 2, p = P(HUB.x + Math.cos(q) * radiusU, HUB.z + Math.sin(q) * radiusU, 0.5); i ? fxg.lineTo(p.x, p.y) : fxg.moveTo(p.x, p.y); }
    fxg.closePath(); fxg.fill(); fxg.stroke();
    const hubP = P(HUB.x, HUB.z, 0.5); fxg.fillStyle = '#2E9A57'; fxg.font = '600 12px Inter, sans-serif'; fxg.fillText(`${L.radiusDraft} m`, hubP.x + 8, hubP.y - 10); fxg.restore();
  }
  // incident dots: where each incident happened; colour follows the tier
  for (const e of S.events.slice(-120)) {
    const p = P(e.pos.x, e.pos.z, 0.5), live = e.status === 'open' || e.status === 'auto', col = TIER_COLOR[e.tier], rad = live ? 7 : 4.5;
    if (live && e.tier === 1) { const k = (t * 1.6) % 1; fxg.strokeStyle = col; fxg.globalAlpha = 1 - k; fxg.lineWidth = 2; fxg.beginPath(); fxg.arc(p.x, p.y, rad + 4 + k * 14, 0, 7); fxg.stroke(); fxg.globalAlpha = 1; }
    fxg.globalAlpha = live ? 1 : 0.7; fxg.fillStyle = col; fxg.strokeStyle = '#fff'; fxg.lineWidth = 1.5; fxg.beginPath(); fxg.arc(p.x, p.y, rad, 0, 7); fxg.fill(); fxg.stroke(); fxg.globalAlpha = 1;
  }
  // warning labels: only a drone with an open event gets one (colour = tier); idle and normal drones carry no marker
  [...frames.children].forEach((b, i) => {
    const d = S.drones[i], ev = ['open', 'auto'].includes(d.event?.status) ? d.event : null;
    if (!ev) { if (!b.hidden) b.hidden = true; return; }
    if (b.hidden) b.hidden = false;
    const p = P(d.x, d.z, d.y); b.style.left = `${p.x + 14}px`; b.style.top = `${p.y - 14}px`;
    const cls = `t${ev.tier}${ev.tier === 1 ? ' flash' : ''}`; if (b.className !== cls) b.className = cls;
    if (b.firstChild.textContent !== '!') b.firstChild.textContent = '!'; b.title = `${d.id} · ${TITLE[ev.type]}`;
  });
}

// ---------------- zoomed scene: overlay labels + timeline ----------------
function sizeBig() { const v = $('l10-view').getBoundingClientRect(); for (const id of ['l10-big', 'l10-overlay']) { const c = $(id); c.width = Math.max(300, Math.round(v.width)); c.height = Math.max(200, Math.round(v.height)); } }
new ResizeObserver(() => { if (mode === 'scene') sizeBig(); }).observe($('l10-view'));
function drawOverlay(d, cam) {
  const ov = $('l10-overlay'), g = ov.getContext('2d'), W = ov.width, H = ov.height; g.clearRect(0, 0, W, H);
  const S = world.state, P = (x, z, y) => stage.projectWith(cam, { x, z, y }, W, H), o = d.order;
  if (showKnow && o) {
    const fill = ['rgba(110,110,110,.38)', 'rgba(46,154,87,.20)', 'rgba(20,20,20,.40)', 'rgba(217,58,38,.60)'];
    for (const c of world.knowledgeCells(d.id)) {
      const st = c.state === 1 && c.age > 2 ? 0.5 : c.state; const a = P(c.x0 + 0.06, c.z0 + 0.06), b = P(c.x0 + 0.94, c.z0 + 0.06), e = P(c.x0 + 0.94, c.z0 + 0.94), f = P(c.x0 + 0.06, c.z0 + 0.94);
      g.fillStyle = st === 0.5 ? 'rgba(46,154,87,.09)' : fill[st]; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(e.x, e.y); g.lineTo(f.x, f.y); g.closePath(); g.fill();
    }
  }
  const L = [];                     // side: 'l' = drone-related, left of the figure · 'r' = everything else, right of the figure / circumstance
  if (o) {
    const blocked = d.lastCheck?.some((c) => !c.ok) && !d.target?.backup;
    const t = P(o.addr.x, o.addr.z); L.push({ ...t, side: 'r', cls: blocked ? 'red' : '', text: `Target · ${o.addr.name}${blocked ? ' · blocked' : ''}` });
    if (o.addr.backup) { const b = P(o.addr.backup.x, o.addr.backup.z); L.push({ ...b, side: 'r', cls: d.target?.backup ? 'green' : '', text: d.target?.backup ? 'Backup · in use' : 'Backup spot' }); }
  }
  for (const x of S.drones) if (Math.hypot(x.x - d.x, x.z - d.z) < 14 && x.phase !== 'idle') { const q = P(x.x, x.z, x.y); L.push({ ...q, side: 'l', cls: x === d ? '' : 'dim', text: `${x.id} · ${Math.round((x.y - 0.4) * SCALE_M)} m · ${phaseText(x)}` }); }
  for (const a of [...S.agents.peds, ...S.agents.dogs]) if (o && dist(a, o.addr) < 5) { const q = P(a.x, a.z, 0.6); L.push({ ...q, side: 'r', cls: dist(a, o.addr) < 2.6 ? 'red' : '', text: `${a.kind === 'dog' ? 'Dog' : 'Person'} · ${(dist(a, o.addr) * SCALE_M).toFixed(1)} m` }); }
  for (const z of world.activeZones()) if (Math.hypot(z.x - d.x, z.z - d.z) < 14) { const q = P(z.x, z.z, 0.6); L.push({ ...q, side: 'r', cls: 'red', text: `No-fly zone · ${Math.ceil(z.t1 - S.t)} s` }); }
  const cl = world.activeCloud(); if (cl && Math.hypot(cl.x - d.x, cl.z - d.z) < 14) { const q = P(cl.x, cl.z, cl.top * 0.5); L.push({ ...q, side: 'r', text: 'Confetti' }); }
  const sx = $('l10-view').clientWidth / W, sy = $('l10-view').clientHeight / H, GAP = 24, OFF = 16;
  const vis = L.filter((l) => l.x > 0 && l.x < W && l.y > 0 && l.y < H);
  for (const side of ['l', 'r']) {      // keep labels of one side from stacking on top of each other
    const col = vis.filter((l) => l.side === side).sort((p, q) => p.y - q.y); let last = -1e9;
    for (const l of col) { l.ly = Math.max(l.y, last + GAP / sy); last = l.ly; }
  }
  $('l10-labels').innerHTML = vis.map((l) => `<span class="label ${l.side} ${l.cls ?? ''}" style="left:${(l.x + (l.side === 'l' ? -OFF : OFF)) * sx}px;top:${l.ly * sy}px">${esc(l.text)}</span>`).join('');
}
function renderTimeline(d) {
  const S = world.state, o = d.order, t0 = o?.tAssigned ?? Math.max(0, S.t - 60), span = Math.max(60, S.t - t0 + 5);
  const keys = new Set(['EVENT', 'OPERATOR', 'AUTO', 'ABORT', 'DELIVERED', 'ADAPT', 'VERIFY_FAIL']);
  const ev = d.log.filter((e) => e.t >= t0 && keys.has(e.code));
  const labels = []; let lastX = -99; for (const e of ev) { const x = (e.t - t0) / span * 100; if (x - lastX > 14) { labels.push(`<span class="lbl" style="left:${x}%">${e.time} ${esc(e.code.toLowerCase().replace(/_/g, ' '))}</span>`); lastX = x; } }
  const ser = d.series, maxD = Math.max(20, ...ser.map((p) => p[1]));
  const pts = ser.map((p, i) => `${(i / Math.max(1, ser.length - 1) * 120).toFixed(1)},${(28 - p[1] / maxD * 26).toFixed(1)}`).join(' ');
  $('l10-timeline').innerHTML = `<div class="track"><div class="line"></div><div class="fill" style="width:${Math.min(100, (S.t - t0) / span * 100)}%"></div>
      ${ev.map((e) => `<span class="tick ${['OPERATOR', 'AUTO'].includes(e.code) ? 'decision' : ''}" style="left:${(e.t - t0) / span * 100}%" data-text="${esc(`${e.time} · ${e.text}`)}"></span>`).join('')}${labels.join('')}</div>
    <span class="dist">Distance to You <b>${(d.distanceM ?? 0).toFixed(1)} m</b></span><svg viewBox="0 0 120 30" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="#141414" stroke-width="1.6"/></svg>`;
}
$('l10-rot').addEventListener('click', () => { viewIx[sel] = ((viewIx[sel] ?? 0) + 1) % 4; });
$('l10-trails').addEventListener('click', () => { showTrails = !showTrails; $('l10-trails').setAttribute('aria-pressed', String(showTrails)); });
$('l10-know').addEventListener('click', () => { showKnow = !showKnow; $('l10-know').setAttribute('aria-pressed', String(showKnow)); });
$('l10-back').addEventListener('click', () => setMode('monitor'));
$('l10-switch').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
function toast(msg) { const t = $('toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600); }

// ---------------- frame loop (called by main.js after it draws the city) ----------------
function frame(dt) {
  if (!world) return;
  hideAirspaceDrones();
  if (running && !world.state.done) { let left = dt * SPEEDS[speedIx]; while (left > 1e-6 && !world.state.done) { const s = Math.min(0.1, left); world.step(s); left -= s; } }
  stage.sync(world, mode === 'scene' ? sel : null);
  stage.syncTrails(world, mode === 'map' && showTrails);
  const pr = city.parade; if (pr?.paradeVisual && pr.engine?.paradeAtTime) pr.paradeVisual.update(pr.engine.paradeAtTime(world.state.t), world.state.t);   // the parade runs on the world clock
  fx.style.display = mode === 'map' ? 'block' : 'none';
  if (mode === 'map') drawMap();
  if (mode === 'monitor') { for (let k = 0; k < 3; k++) { const c = cells[cellRR++ % cells.length], d = world.droneOf(c.id); stage.renderCell(world, d, c.ctx, viewIx[c.id] ?? 0); } }
  if (mode === 'scene') { const d = world.droneOf(sel); if (d) { const cam = stage.renderBig(world, d, $('l10-big').getContext('2d'), viewIx[sel] ?? 0); drawOverlay(d, cam); $('l10-cam').innerHTML = `<span class="dot bg-red" style="width:7px;height:7px"></span>CAM-${sel} · ${esc(orderLine(d))}`; $('l10-live').textContent = world.state.done ? 'ENDED' : running ? 'LIVE' : 'PAUSED'; } }
  uiClock += dt; memClock += dt;
  if (uiClock > 0.25) {
    uiClock = 0; renderStatus();
    for (const c of cells) {
      const d = world.droneOf(c.id), tier = tierOf(d), open = openTier(d);
      c.el.className = `cell${tier ? ' ' + TIER_CLS[tier] : ''}${open === 1 ? ' flash' : ''}`;
      c.bang.textContent = tier || ''; c.bang.style.background = tier ? TIER_COLOR[tier] : ''; c.what.textContent = d.order ? `#${d.order.id}${d.order.urgent ? '!' : ''} ${phaseText(d)}` : 'idle at hub';
      c.chip.textContent = d.event ? TITLE[d.event.type] : LEVEL_TEXT[d.level]; c.chip.className = `chip ${tier ? 't' + tier : d.order ? 'green' : 'grey'}`;
    }
    if (mode === 'scene') { const d = world.droneOf(sel); if (d) { renderTimeline(d); renderConsole(false); } } else renderSide();
  }
  if (world.state.done && !reportShown) { reportShown = true; scoreOpen = true; renderScore(); toast('Shift over: here is the report.'); }   // the shift ends: the report opens by itself
  if (scoreOpen && !world.state.done) { scoreClock += dt; if (scoreClock > 4) { scoreClock = 0; const el = $('l10-score'), st = el.scrollTop; renderScore(); el.scrollTop = st; } }
  if (memClock > 5) { memClock = 0; store.set('l10.v2.memory', memory); }
}

window.__l10 = { drawMain: true, radiusDraft: null, frame, advance: (sec) => { for (let t = 0; t < sec; t += 0.1) world.step(0.1); }, get world() { return world; }, get runs() { return runs; }, setMode, get mode() { return mode; },
  resolve: (id, opt) => world.resolve(id, opt), restart: (s) => { settings = { ...settings, ...s }; startRun(); }, setSpeed: (ix) => { speedIx = ix; renderBoard(); }, openScore: () => { scoreOpen = true; renderScore(); }, get settings() { return settings; } };
startRun();
setMode('map');
