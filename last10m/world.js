// Last 10m v2 — ONE shared city, nine fixed drones (D-01 … D-09), a stream of orders, nine event types and a human
// operator who has to triage. Pure JS (no three.js): runs in node tests as well as in the browser. Deterministic for a
// given seed + settings: every random draw comes from a seeded stream and none of them depends on operator input,
// except what the operator decides to do about it.
// Units: scene units (1 u = 5 m), seconds. Ground top = SLAB. x east, z south, y up.
//
// The nine v1 scenes became nine event types:
//   A1 dog on drop zone · A2 car on pad · A3 pedestrian in descent zone · B1 pigeon flock · B2 two-drone conflict
//   B3 gust toward building · C1 sensor occluded · C2 customer silent · C3 sudden no-fly zone
// and they are sorted into three urgency tiers (see TIER / WINDOW) with fixed-rule defaults when nobody acts.

import { SCALE_M, HUB } from './scenes.js';
import { CONST, levelRank, LEVEL_TEXT } from './sim.js';
import { PARADE_ROUTE } from '../parade-environment.js';

const { SLAB, CRUISE, HOVER, DETECT_U } = CONST;
export { LEVEL_TEXT };

// ------------------------------------------------------------------ board / settings
export const PRESETS = [
  { id: 'high', label: 'High-rise heavy' },
  { id: 'low', label: 'Low-rise heavy' },
  { id: 'mixed', label: 'Mixed / interleaved' },
];
export const BOARD = [
  { group: 'Orders', key: 'orders', label: 'Orders count', unit: '', min: 9, max: 60, step: 1, def: 24 },
  { group: 'Orders', key: 'urgentPct', label: 'Urgent ratio', unit: '%', min: 0, max: 100, step: 5, def: 25 },
  { group: 'Orders', key: 'radiusM', label: 'Delivery radius', unit: 'm', min: 80, max: 300, step: 10, def: 200 },
  { group: 'Agents', key: 'flocks', label: 'Pigeon flocks', unit: '', min: 0, max: 6, step: 1, def: 2 },
  { group: 'Agents', key: 'pedestrians', label: 'Pedestrians', unit: '', min: 0, max: 12, step: 1, def: 4 },
  { group: 'Agents', key: 'dogs', label: 'Dogs', unit: '', min: 0, max: 8, step: 1, def: 3 },
  { group: 'Agents', key: 'replyPct', label: 'Customer reply rate', unit: '%', min: 0, max: 100, step: 5, def: 70 },
  { group: 'Weather', key: 'gustPerMin', label: 'Gust frequency', unit: '/min', min: 0, max: 6, step: 0.5, def: 2 },
];
export const DEFAULT_SETTINGS = { ...Object.fromEntries(BOARD.map((b) => [b.key, b.def])), preset: 'mixed', memory: 'retained', seed: 2026 };

// ------------------------------------------------------------------ event hierarchy
export const TIER = { ped: 1, conflict: 1, nofly: 1, gust: 1, dog: 2, pigeon: 2, occluded: 2, car: 3, silent: 3 };
export const WINDOW = { 1: [5, 8], 2: [15, 20], 3: [45, 60] };          // seconds the operator has
export const TIER_NAME = { 1: 'Critical', 2: 'Urgent', 3: 'Can wait' };
export const TITLE = { ped: 'Pedestrian in descent zone', conflict: 'Two-drone conflict', nofly: 'Sudden no-fly zone', gust: 'Gust toward building',
  dog: 'Dog on drop zone', pigeon: 'Pigeon flock in path', occluded: 'Sensor occluded', car: 'Car parked on pad', silent: 'Customer silent' };
export const SCENE_OF = { dog: 'A1', car: 'A2', ped: 'A3', pigeon: 'B1', conflict: 'B2', gust: 'B3', occluded: 'C1', silent: 'C2', nofly: 'C3' };
export const EVENT_TYPES = Object.keys(TIER);

// ------------------------------------------------------------------ constants (formerly board parameters)
const V = 4, VZ = 1.6, LOWER = 0.28, REEL = 0.7;           // 20 m/s cruise, 1.4 m/s tether pay-out
const HOVER_BUDGET = 75, TIME_CAP = 900, MAX_TRIES = 2, BACKUP_DX = -3.2, PAD_DZ = 5.1;
const PED_ZONE = 2.6, DOG_ZONE = 2.2, FRESH_S = 2, BATTERY_RESERVE = 20, N_DRONES = 9, GRID = 13;
const HOVER_PHASES = new Set(['locate', 'confirm', 'descend', 'scan', 'verify', 'lower', 'wait', 'reel', 'shift', 'climb', 'release']);
const FLIGHT = new Set(['enter', 'leave', 'return']);

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hyp = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const dist3 = (a, b) => Math.hypot(a.x - b.x, (a.y ?? SLAB) - (b.y ?? SLAB), a.z - b.z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtT = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function segDist(p, a, b) { const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz, u = L2 ? clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / L2, 0, 1) : 0; return Math.hypot(p.x - (a.x + dx * u), p.z - (a.z + dz * u)); }
const ROUTE = PARADE_ROUTE.map((p) => ({ x: p.x, z: p.z }));
export const paradeDistance = (p) => Math.min(...ROUTE.slice(1).map((q, i) => segDist(p, ROUTE[i], q)));
const routePoint = (u) => { const L = ROUTE.length - 1, f = u * L, i = Math.min(L - 1, Math.floor(f)), k = f - i; return { x: ROUTE[i].x + (ROUTE[i + 1].x - ROUTE[i].x) * k, z: ROUTE[i].z + (ROUTE[i + 1].z - ROUTE[i].z) * k }; };

/**
 * createWorld(settings, { obstacles, tiles, memory })
 *   obstacles: [{x0,x1,z0,z1,h}]   tiles: [{cx,cz,landUse,name}]   memory: { landmarks: {addressKey: true} } (mutated)
 */
export function createWorld(input = {}, { obstacles = [], tiles = [], memory = {} } = {}) {
  const P = { ...DEFAULT_SETTINGS, ...input };
  const seedOf = (k) => rng(((P.seed >>> 0) * 31 + k * 7919) >>> 0);
  const Rord = seedOf(1), Rped = seedOf(2), Rdog = seedOf(3), Rfl = seedOf(4), Rgust = seedOf(5), Rzone = seedOf(6), Rconf = seedOf(7), Revt = seedOf(8);
  if (P.memory === 'fresh') memory.landmarks = {};
  memory.landmarks ??= {};

  // ---- addresses: the front pad of every parcel inside the delivery radius (the hub block, sensitive facilities and ponds excluded)
  const tilesByKey = new Map(tiles.map((t) => [`${Math.round(t.cx / 16)},${Math.round(t.cz / 16)}`, t]));
  const radiusU = P.radiusM / SCALE_M;
  const ctxOf = (a) => {
    let low = 0, tall = 0, n = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const t = tilesByKey.get(`${Math.round(a.tile.cx / 16) + i},${Math.round(a.tile.cz / 16) + j}`); if (!t) continue; n++; if (t.landUse === 'housing') low++; if (t.landUse === 'cbd') tall++; }
    return { lowShare: n ? low / n : 0, tallShare: n ? tall / n : 0, paradeNear: clamp(1 - paradeDistance(a) / 12, 0, 1) };
  };
  let all = tiles.filter((t) => !(t.cx === 0 && t.cz === 0) && t.landUse !== 'sensitive' && !/pond/i.test(t.name || ''))
    .map((t) => ({ key: `${t.cx},${t.cz}`, x: t.cx, z: t.cz + PAD_DZ, tile: t, name: t.name || t.id, id: t.id }));
  all.sort((a, b) => hyp(a, HUB) - hyp(b, HUB));
  let addresses = all.filter((a) => hyp(a, HUB) <= radiusU);
  if (addresses.length < 4) addresses = all.slice(0, 4);
  for (const a of addresses) a.ctx = ctxOf(a);

  // ---- orders (all random draws of an order come from its own stream, so board changes never reshuffle other orders)
  const orders = [];
  for (let i = 0; i < P.orders; i++) {
    const rr = rng(((P.seed >>> 0) * 13 + i * 97 + 5) >>> 0), a = addresses[Math.floor(Rord() * addresses.length)];
    const urgent = Rord() < P.urgentPct / 100;
    orders.push({ id: i + 1, addr: a, urgent, confettiRoll: rr(), confettiDur: 20 + rr() * 10, status: 'queued', tries: 0, drone: null, tAssigned: null, tDone: null, outcome: null, redelivered: false,
      car: rr() < 0.05 + 0.3 * a.ctx.lowShare, carUntil: 60 + rr() * 110, needConfirm: rr() < 0.6, replyRoll: rr(), replyRoll2: rr(), replyDelay: 4 + rr() * 22, dogAttn: rr() < 0.85, backupOK: rr() < 0.3 });
  }

  // ---- ground and air agents (they have their own simple behaviour; they are not scenery)
  const pickAddr = (R, weight) => { const w = addresses.map(weight), s = w.reduce((x, y) => x + y, 0); let u = R() * s; for (let i = 0; i < w.length; i++) { u -= w[i]; if (u <= 0) return addresses[i]; } return addresses.at(-1); };
  const peds = Array.from({ length: P.pedestrians }, (_, k) => { const a = pickAddr(Rped, (x) => 0.4 + x.ctx.paradeNear + 0.6 * x.ctx.tallShare); return { id: `P${k + 1}`, kind: 'person', x: a.x + (Rped() - 0.5) * 3, z: a.z + (Rped() - 0.5) * 3, goal: a, wait: Rped() * 4, phase: Rped() * 6, heading: 0, speed: 0.7 + Rped() * 0.3 }; });
  const dogs = Array.from({ length: P.dogs }, (_, k) => { const a = pickAddr(Rdog, (x) => 0.25 + x.ctx.lowShare * 2); return { id: `G${k + 1}`, kind: 'dog', home: a, x: a.x + BACKUP_DX, z: a.z + 0.4, state: 'roam', t0: 0, stay: 0, heading: 0, k, forOrder: null }; });
  const flocks = Array.from({ length: P.flocks }, (_, k) => { const th = Math.floor(Rfl() * 4) * Math.PI / 2 + (Rfl() - 0.5) * 0.5; return { id: `F${k + 1}`, n: 4 + Math.floor(Rfl() * 3), dx: Math.cos(th), dz: Math.sin(th), lat: (Rfl() - 0.5) * 2 * Math.min(44, radiusU * 0.85), off: Rfl() * 120, speed: 2.2 + Rfl() * 0.8, y: SLAB + 9 + Rfl() * 7 }; });
  const flockBirds = (t) => { const out = []; for (const f of flocks) { const s = ((t * f.speed + f.off) % 120) - 60; for (let i = 0; i < f.n; i++) out.push({ id: `${f.id}b${i}`, flock: f.id, x: f.dx * s - f.dz * f.lat + (i % 3 - 1) * 1.6, z: f.dz * s + f.dx * f.lat + (Math.floor(i / 3) - 0.5) * 1.6, y: f.y + Math.sin(t * 5 + i) * 0.15, flap: t * 14 + i }); } return out; };

  // ---- environment schedules (fixed by the seed; the board only changes how many / how often)
  const gusts = []; { const rate = P.gustPerMin / 60; if (rate > 0) { let t = 0; while (t < TIME_CAP + 60) { t += -Math.log(1 - Rgust()) / rate; const d = 6 + Rgust() * 4; gusts.push({ t0: +t.toFixed(2), t1: +(t + d).toFixed(2), ang: Rgust() * Math.PI * 2, v: 9 + Rgust() * 7 }); t += d; } } }
  const zones = []; { let t = 25 + Rzone() * 20; while (t < TIME_CAP + 60) { const onRoute = Rzone() < 0.6, c = onRoute ? routePoint(Rzone()) : (() => { const a = addresses[Math.floor(Rzone() * addresses.length)]; return { x: a.x, z: a.z - 2 }; })(); const dur = 20 + Rzone() * 15; zones.push({ id: `Z${zones.length + 1}`, t0: +t.toFixed(1), t1: +(t + dur).toFixed(1), x: c.x, z: c.z, r: 3.5 + Rzone() * 2 }); t += 18 + Rzone() * 14; } }
  const clouds = []; { let t = 20 + Rconf() * 15; while (t < TIME_CAP + 60) { const c = routePoint(Rconf()), dur = 20 + Rconf() * 10; clouds.push({ id: `C${clouds.length + 1}`, t0: +t.toFixed(1), t1: +(t + dur).toFixed(1), x: c.x, z: c.z, r: 5.5, top: 6.5 }); t += 24 + Rconf() * 14; } }
  const active = (list, t) => list.find((g) => t >= g.t0 && t < g.t1) ?? null;
  let dynClouds = 0;

  // ---- state
  const S = {
    P, t: 0, done: false, endedBy: null, orders, drones: [], events: [], agents: { peds, dogs }, flocks, gusts, zones, clouds, addresses,
    log: [], queuePeak: 0, series: [], completed: 0,
  };
  const home = (i) => ({ x: (i % 3 - 1) * 2.7, z: 3.2 + Math.floor(i / 3) * 2.7 });
  for (let i = 0; i < N_DRONES; i++) {
    const h = home(i);
    S.drones.push({ id: `D-0${i + 1}`, idx: i, x: h.x, y: SLAB, z: h.z, home: h, phase: 'idle', visible: true, order: null, target: null, cruise: CRUISE, drop: 0, speedK: 1, battery: 100,
      held: false, hold: false, event: null, timer: 0, waitT: 0, hover: 0, px: 0, pz: 0, readyAt: i * 1.2, level: 'L0', maxLevel: 'L0', levelReason: 'At hub', route: [], routeLog: 0,
      log: [], series: [], know: null, lmCount: 0, confirmed: false, approved: false, delivered: false, yieldFor: null, yieldCap: 0, lastCheck: [], zoneSeen: new Set(), distanceM: 0, scanned: false, seenAt: -99 });
  }
  const droneOf = (id) => S.drones.find((d) => d.id === id);
  const lmKey = (o) => o.addr.key;
  const custReplies = (o) => (o.tries === 0 ? o.replyRoll : o.replyRoll2) < P.replyPct / 100;   // monotonic in the reply rate; a second attempt gets a fresh chance
  const isKnown = (o) => !!memory.landmarks[lmKey(o)];

  function log(d, code, text, extra = {}) {
    const e = { t: S.t, time: fmtT(S.t), code, text, drone: d?.id ?? null, ...extra };
    S.log.push(e); if (S.log.length > 600) S.log.shift();
    if (d) { d.log.push(e); if (d.log.length > 120) d.log.shift(); }
  }
  function setLevel(d, level, reason) { d.level = level; d.levelReason = reason; if (levelRank(level) > levelRank(d.maxLevel)) d.maxLevel = level; }

  // ---------------------------------------------------------------- helpers: terrain, sensing
  function cruiseHeightFor(a, b) {
    let top = 0;
    for (const o of obstacles) for (let k = 0; k <= 24; k++) { const x = a.x + (b.x - a.x) * k / 24, z = a.z + (b.z - a.z) * k / 24; if (x > o.x0 - 1 && x < o.x1 + 1 && z > o.z0 - 1 && z < o.z1 + 1) top = Math.max(top, o.h); }
    return clamp(top + 2, CRUISE, 23);
  }
  const cloudOver = (p, h = 0) => clouds.find((c) => S.t >= c.t0 && S.t < c.t1 && hyp(p, c) < c.r + 0.5 && h < c.top + 0.3) ?? null;
  const inCloud = (p) => clouds.find((c) => S.t >= c.t0 && S.t < c.t1 && hyp(p, c) < c.r + 0.5) ?? null;
  const sensorRadius = (d) => (cloudOver(d, d.y - SLAB) ? 0.6 : clamp(2.6 + (d.y - SLAB) * 0.3, 3, 6));
  const zoneAt = (p, margin = 0) => zones.find((z) => S.t >= z.t0 && S.t < z.t1 && hyp(p, z) < z.r + margin) ?? null;
  const watchedBy = (d, a) => hyp(a, d) <= sensorRadius(d);
  const backupOf = (o) => ({ x: o.addr.x + BACKUP_DX, z: o.addr.z, name: 'Backup spot', backup: true });

  // ---------------------------------------------------------------- the five checks (read only what the drone can sense)
  function checks(d) {
    const T = d.target, o = d.order; if (!T || !o) return { ok: false, list: [], blockers: {} };
    const known = isKnown(o) || d.lmCount > 0.5;
    const seenDyn = [...peds, ...dogs].filter((a) => hyp(a, T) <= (a.kind === 'dog' ? DOG_ZONE : PED_ZONE) && watchedBy(d, a));
    const fresh = S.t - d.seenAt <= FRESH_S;
    const birds = flockBirds(S.t).filter((b) => dist3(b, { x: d.x, y: d.y, z: d.z }) < 1.5);
    const carBlock = o.car && S.t < o.carUntil && !T.backup;
    const authorized = !T.backup || d.approved || o.backupOK;
    const list = [
      { key: 'loc', label: 'Correct location', ok: known, detail: known ? (isKnown(o) ? 'known landmark (memory)' : 'matched instruction') : 'not recognised yet' },
      { key: 'safe', label: 'Space is safe', ok: fresh && !seenDyn.length, detail: !fresh ? 'not observed recently' : seenDyn.length ? `${seenDyn[0].kind} ${Math.max(0.5, hyp(seenDyn[0], T) * SCALE_M).toFixed(1)} m from target` : 'clear, seen <2 s ago' },
      { key: 'column', label: 'Descent path clear', ok: !birds.length, detail: birds.length ? 'object in the column' : 'tether column free' },
      { key: 'pad', label: 'Facility available', ok: !carBlock, detail: carBlock ? 'pad occupied by a parked car' : 'pad free' },
      { key: 'auth', label: 'Within authorization', ok: authorized, detail: !T.backup ? 'customer’s spot' : authorized ? 'authorized backup' : 'backup needs approval' },
    ];
    d.lastCheck = list;
    return { ok: list.every((c) => c.ok), list, blockers: { dyn: seenDyn, carBlock, fresh } };
  }

  // ---------------------------------------------------------------- events
  const OPTIONS = {
    ped: [['wait', 'Wait until clear', 1], ['backup', 'Use backup spot'], ['return', 'Return to hub']],
    dog: [['wait', 'Wait for it to leave', 1], ['backup', 'Use backup spot'], ['return', 'Return to hub']],
    car: [['backup', 'Use backup spot (approve)', 1], ['wait', 'Keep waiting'], ['return', 'Return to hub']],
    pigeon: [['wait', 'Hold until they pass', 1], ['climb', 'Climb over (+15 m)'], ['return', 'Return to hub']],
    occluded: [['wait', 'Wait for it to settle', 1], ['climb', 'Climb above and rescan'], ['return', 'Return to hub']],
    gust: [['wait', 'Hold until it passes', 1], ['resume', 'Continue now'], ['return', 'Return to hub']],
    nofly: [['wait', 'Wait outside the zone', 1], ['return', 'Return to hub']],
    silent: [['assume', 'Deliver to the instructed spot', 1], ['wait', 'Keep waiting'], ['return', 'Return to hub']],
  };
  function optionsFor(ev, d) {
    if (ev.type === 'conflict') { const other = droneOf(ev.with); return [{ id: 'rule', label: `${d.id} yields (priority rule)`, primary: true }, { id: 'swap', label: `Override: ${other.id} yields` }]; }
    return OPTIONS[ev.type].map(([id, label, primary]) => ({ id, label, primary: !!primary }));
  }
  const defaultFor = (ev) => (ev.type === 'conflict' ? 'rule' : ev.tier === 3 ? 'return' : 'wait');   // the fixed rule when nobody acts

  function openEvent(d, type, extra = {}) {
    if (d.event || !d.order) return null;
    const base = TIER[type], urgent = d.order.urgent, tier = urgent ? Math.max(1, base - 1) : base;      // an urgent order raises the tier by one
    const [lo, hi] = WINDOW[tier], win = lo + Revt() * (hi - lo);
    const ev = { id: `E${S.events.length + 1}`, type, base, tier, urgent, drone: d.id, order: d.order.id, opened: S.t, window: +win.toFixed(1), deadline: S.t + win, status: 'open',
      resolvedBy: null, resolvedAt: null, reaction: null, missed: false, option: null, pos: { x: d.x, z: d.z }, closestM: null, autoSafe: false, safeAction: null, ...extra };
    ev.options = optionsFor(ev, d); ev.defaultId = defaultFor(ev);
    S.events.push(ev); d.event = ev;
    ev.safeAction = safetyAction(d, ev);                  // safety is never left to the human: the drone acts first …
    ev.autoSafe = tier === 1;
    setLevel(d, 'H', TITLE[type]);                         // … and then asks what to do next
    log(d, 'EVENT', `${TITLE[type]} — tier ${tier} (${TIER_NAME[tier]}); ${ev.safeAction}.`, { eventId: ev.id, tier });
    return ev;
  }
  function safetyAction(d, ev) {
    switch (ev.type) {
      case 'ped': case 'dog': if (d.drop > 0.05) { d.phase = 'reel'; return 'reeled the parcel up and hovered'; } if (['descend', 'scan', 'verify', 'lower'].includes(d.phase)) d.phase = 'wait'; return 'stopped lowering and hovered';
      case 'conflict': d.held = true; d.heldBy = ev.id; droneOf(ev.with).climbOver = true; return 'stopped and holding; the other drone climbs 15 m to pass';
      case 'nofly': d.held = true; d.heldBy = ev.id; return 'stopped outside the zone';
      case 'gust': if (d.drop > 0.05) { d.phase = 'reel'; return 'reeled up and hovered'; } d.held = true; d.heldBy = ev.id; return 'hovering above the roofline';
      case 'pigeon': d.held = true; d.heldBy = ev.id; return 'holding until the flock passes';
      case 'occluded': if (['descend', 'scan', 'verify', 'lower'].includes(d.phase)) d.phase = 'climb'; return 'climbing above the cloud';
      default: return 'hovering';
    }
  }
  function closeEvent(ev, by, status = 'cleared') {
    const d = droneOf(ev.drone); ev.status = status; ev.resolvedBy ??= by; ev.resolvedAt ??= S.t; ev.closedAt = S.t;
    if (d.event === ev) d.event = null;
    if (d.heldBy === ev.id) { d.held = false; d.heldBy = null; }
    if (levelRank(d.level) >= levelRank('H') && d.phase !== 'return') setLevel(d, 'L0', 'Cleared');
  }
  function abort(d, reason) {
    if (d.phase === 'return' || d.phase === 'land' || d.phase === 'idle') return;
    setLevel(d, 'L4', reason); log(d, 'ABORT', `${reason} Returning to hub; the order goes back to the queue.`);
    d.phase = 'return'; d.abortedOrder = true; if (d.event) closeEvent(d.event, 'self', 'closed'); d.held = false; d.heldBy = null; d.hold = false; setLevel(d, 'L4', reason);
  }
  function switchBackup(d, why) { d.target = backupOf(d.order); setLevel(d, 'L3', why); log(d, 'ADAPT', why); d.phase = 'shift'; d.held = false; d.waitT = 0; d.escalated = false; }

  function applyOption(d, ev, id) {
    d.held = false; d.heldBy = null;
    switch (id) {
      case 'backup': d.approved = true; switchBackup(d, 'Backup spot approved.'); break;
      case 'return': abort(d, 'Sent home.'); break;
      case 'climb': d.climbOver = true; setLevel(d, 'L3', 'Climbing over'); if (ev.type === 'occluded') d.phase = 'climb'; break;
      case 'resume': d.gustIgnore = active(gusts, S.t)?.t1 ?? 0; setLevel(d, 'L1', 'Continuing in gust'); break;
      case 'assume': d.confirmed = true; setLevel(d, 'L2', 'Assuming the instructed spot'); if (d.phase === 'confirm') d.phase = 'descend'; break;
      case 'rule': case 'swap': {
        const other = droneOf(ev.with), yielder = id === 'rule' ? d : other, goer = yielder === d ? other : d;
        yielder.held = true; yielder.heldBy = null; yielder.yieldFor = goer.id; yielder.yieldCap = S.t + 45; goer.held = false; goer.heldBy = null; goer.climbOver = true;
        setLevel(yielder, 'L3', `${yielder.id} yields to ${goer.id}`); setLevel(goer, 'L1', 'Proceeding'); break;
      }
    }
  }
  function resolve(evId, optionId, by = 'operator') {
    const ev = S.events.find((e) => e.id === evId); if (!ev || ev.status !== 'open') return false;
    if (!ev.options.some((o) => o.id === optionId)) return false;
    const d = droneOf(ev.drone), wasHeld = ['pigeon', 'gust', 'nofly'].includes(ev.type);
    ev.resolvedBy = by; ev.resolvedAt = S.t; ev.option = optionId; ev.missed = by === 'auto';
    ev.reaction = by === 'operator' ? +(S.t - ev.opened).toFixed(2) : null;
    log(d, by === 'auto' ? 'AUTO' : 'OPERATOR', `${by === 'auto' ? 'No reply in time — fixed rule: ' : 'Operator: '}${ev.options.find((o) => o.id === optionId).label}.`, { eventId: ev.id, tier: ev.tier });
    if (optionId === 'wait') { ev.status = 'acknowledged'; ev.waiting = true; d.event = ev; if (wasHeld) { d.held = true; d.heldBy = ev.id; } setLevel(d, 'L2', 'Waiting'); return true; }   // stays attached to the drone until the hazard clears (or the hover budget ends it)
    ev.status = 'resolved'; if (d.event === ev) d.event = null;
    if (ev.type === 'conflict') { const other = droneOf(ev.with); if (other.conflictEvent === ev) other.conflictEvent = null; }
    applyOption(d, ev, optionId);
    return true;
  }

  // ---------------------------------------------------------------- orders and drones
  function nextOrder() { const q = orders.filter((o) => o.status === 'queued'); q.sort((a, b) => (b.urgent - a.urgent) || a.id - b.id); return q[0] ?? null; }
  function assign(d, o) {
    o.status = 'active'; o.drone = d.id; o.tAssigned = S.t; if (o.tries > 0) o.redelivered = true;
    d.order = o; d.target = { x: o.addr.x, z: o.addr.z, name: o.addr.name, original: true }; d.cruise = cruiseHeightFor(d.home, o.addr);
    d.phase = 'enter'; d.drop = 0; d.hover = 0; d.waitT = 0; d.escalated = false; d.approved = false; d.confirmed = false; d.confettiDone = false; d.lmCount = 0; d.delivered = false; d.abortedOrder = false;
    d.climbOver = false; d.zoneSeen = new Set(); d.route = [{ x: d.x, z: d.z }]; d.routeLog = S.t; d.series = []; d.scanned = false; d.seenAt = -99; d.gustIgnore = 0; d.speedK = 1;
    d.know = { ox: o.addr.x - GRID / 2, oz: o.addr.z - GRID / 2, state: new Uint8Array(GRID * GRID), seen: new Float32Array(GRID * GRID).fill(-99) };
    setLevel(d, 'L0', 'Departed'); d.maxLevel = 'L0';
    log(d, 'DEPART', `${d.id} takes order #${o.id}${o.urgent ? ' (URGENT)' : ''} to ${o.addr.name}, cruising at ${Math.round(d.cruise * SCALE_M)} m.`);
  }
  function goTo(d, p, y, dt, speed = V) {
    const dx = p.x - d.x, dz = p.z - d.z, L = Math.hypot(dx, dz), s = speed * d.speedK * dt;
    if (L > 1e-4) { const k = Math.min(1, s / L); d.x += dx * k; d.z += dz * k; }
    d.y += clamp(y - d.y, -VZ * dt * 1.5, VZ * dt * 1.5);
    return L < 0.05 && Math.abs(y - d.y) < 0.05;
  }
  const finishOrder = (d, outcome) => {
    const o = d.order; o.status = outcome; o.outcome = outcome; o.tDone = S.t; S.completed++;
    d.delivered = true; log(d, 'DELIVERED', outcome === 'delivered' ? `Order #${o.id} delivered at the requested spot.` : `Order #${o.id} delivered at the backup spot (${Math.round(hyp(d.target, o.addr) * SCALE_M)} m away).`);
    setLevel(d, 'L0', 'Delivered');
  };
  function sense(d, dt) {
    const K = d.know; if (!K) return; const r = sensorRadius(d);
    for (let k = 0; k < GRID * GRID; k++) {
      const c = { x: K.ox + (k % GRID) + 0.5, z: K.oz + Math.floor(k / GRID) + 0.5 }; if (hyp(c, d) > r) continue;
      K.seen[k] = S.t; K.state[k] = obstacles.some((o) => c.x > o.x0 && c.x < o.x1 && c.z > o.z0 && c.z < o.z1) || (d.order.car && S.t < d.order.carUntil && !d.target.backup && hyp(c, d.order.addr) < 0.9) ? 2 : 1;
    }
    for (const a of [...peds, ...dogs]) if (hyp(a, d) <= r) { const i = Math.floor(a.x - K.ox) + Math.floor(a.z - K.oz) * GRID; if (i >= 0 && i < GRID * GRID && Math.floor(a.x - K.ox) < GRID) { K.state[i] = 3; K.seen[i] = S.t; } }
    if (r >= 1.5) d.seenAt = S.t;
    if (hyp(d, d.order.addr) <= r + 1 && !isKnown(d.order)) { d.lmCount += dt; if (d.lmCount >= 3) { memory.landmarks[lmKey(d.order)] = true; log(d, 'LANDMARK', `New landmark: ${d.order.addr.name}.`); } }
  }

  function stepDrone(d, dt) {
    if (d.phase === 'idle') {
      if (S.t >= d.readyAt && !S.done) { const o = nextOrder(); if (o) assign(d, o); }
      return;
    }
    const hovering = HOVER_PHASES.has(d.phase);
    d.battery -= dt * (hovering ? 0.12 : 0.08);
    if (hovering) d.hover += dt;
    const flying = FLIGHT.has(d.phase);
    if (d.order && !['return', 'land'].includes(d.phase)) {
      if (d.battery <= BATTERY_RESERVE) return abort(d, `Battery reached the ${BATTERY_RESERVE}% reserve.`);
      if (d.hover > HOVER_BUDGET) return abort(d, `Hover budget of ${HOVER_BUDGET} s used up.`);
    }
    if (flying) {                                         // route trace for the map
      if (S.t - d.routeLog >= 0.6) { d.routeLog = S.t; d.route.push({ x: d.x, z: d.z, ret: d.phase !== 'enter' }); if (d.route.length > 160) d.route.shift(); }
    }
    if (d.yieldFor && ['return', 'land', 'leave'].includes(d.phase)) { d.yieldFor = null; d.held = false; }      // leaving the area is always allowed
    if (d.held && !d.heldBy && !d.yieldFor) d.held = false;                                   // safety net: a hold always has an owner (an event or a yield)
    if (d.yieldFor) {                                     // yielding: wait until the other drone has gone by (or finished at the pad), at most 45 s
      const g = droneOf(d.yieldFor), gone = !g.order || ['idle', 'land', 'leave', 'return'].includes(g.phase);
      const clear = gone || (hyp(d, g) > 3.6 && hyp(aheadOf(d, 2.5), g) > 3.6 && hyp(aheadOf(d, 2.5), aheadOf(g, 2.5)) > 3.6);
      if (!clear && S.t < d.yieldCap) return;
      d.yieldFor = null; d.held = false; setLevel(d, 'L0', 'Resumed');
    }
    if (d.hold || d.held || (d.sepStop ?? 0) > S.t) return;
    const o = d.order, T = d.target, ground = SLAB;
    switch (d.phase) {
      case 'enter': {
        // pigeons: look 2 s ahead; slow within 20 m, hold within 8 m
        const close = nearestBird(d);
        if (close < 2.4) { d.speedK = 0; if (!d.event) openEvent(d, 'pigeon'); return; }
        d.speedK = close < 5 ? 0.35 : 1;
        const lift = clamp(0.2 + (d.y - ground) / Math.max(2, d.cruise * 0.5), 0.2, 1);
        d.speedK *= lift;
        const cy = d.climbOver ? Math.min(SLAB + 23, SLAB + d.cruise + 3) : SLAB + d.cruise;
        if (goTo(d, T, cy, dt)) { d.speedK = 1; d.phase = 'locate'; d.timer = 0; log(d, 'LOCATE', isKnown(o) ? `Recognised ${o.addr.name} from memory.` : `Searching for ${o.addr.name}…`); }
        return;
      }
      case 'locate': {
        d.timer += dt;
        if (d.timer >= (isKnown(o) ? 1 : 4)) { if (o.needConfirm && !d.confirmed) { d.phase = 'confirm'; d.confirmStart = S.t; log(d, 'ASK_CUSTOMER', 'Asked the customer to confirm the drop spot.'); } else d.phase = 'descend'; }
        return;
      }
      case 'confirm': {
        if (custReplies(o) && S.t - d.confirmStart >= o.replyDelay) { d.confirmed = true; d.phase = 'descend'; log(d, 'CONFIRMED', 'Customer confirmed the spot.'); return; }
        if (!custReplies(o) && S.t - d.confirmStart >= 8 && !d.event) openEvent(d, 'silent');
        return;
      }
      case 'descend': { if (columnBusy(d) && d.y - SLAB > HOVER + 1) return;                    // another drone is working that pad: wait above it
        if (!d.confettiDone && o.tries === 0 && o.confettiRoll < 0.6 * o.addr.ctx.paradeNear) { d.confettiDone = true; clouds.push({ id: `Cd${++dynClouds}`, t0: S.t, t1: S.t + o.confettiDur, x: o.addr.x, z: o.addr.z, r: 5, top: 6.5, dynamic: true }); log(d, 'EVENT', 'Parade confetti drifts over the yard.'); }
        const cl = cloudOver(d, d.y - SLAB); if (cl && d.y - SLAB < cl.top && hyp(d, cl) < cl.r - 0.5 && !d.event) { openEvent(d, 'occluded', { cloud: cl.id }); return; } if (goTo(d, T, ground + HOVER, dt)) { d.phase = 'scan'; d.timer = 0; } return; }
      case 'shift': { if (goTo(d, T, ground + HOVER, dt, 1.2)) { d.phase = 'scan'; d.timer = 0; log(d, 'SCAN', 'Scanning the backup spot.'); } return; }
      case 'climb': { if (goTo(d, T, ground + 7.2, dt) && !inCloud(d)) { if (d.event?.type === 'occluded') closeEvent(d.event, 'self'); d.phase = 'descend'; log(d, 'RESCAN', 'Cloud gone: descending to rescan.'); } return; }
      case 'scan': {
        d.timer += dt;
        const cl = cloudOver(d, d.y - SLAB);
        if (cl && sensorRadius(d) < 1 && !d.event) { openEvent(d, 'occluded', { cloud: cl.id }); return; }
        if (d.timer >= (isKnown(o) ? 1 : 2.5)) d.phase = 'verify';
        return;
      }
      case 'verify': {
        const v = checks(d);
        if (v.ok) { setLevel(d, T.backup ? 'L3' : 'L0', 'Verified: lowering the parcel.'); log(d, 'VERIFY_OK', `All five checks pass at ${T.backup ? 'the backup spot' : o.addr.name}: lowering.`); d.phase = 'lower'; d.waitT = 0; return; }
        log(d, 'VERIFY_FAIL', `Verify failed: ${v.list.filter((c) => !c.ok).map((c) => c.label.toLowerCase()).join(', ')}.`);
        if (v.blockers.carBlock) { if (o.backupOK) { switchBackup(d, 'Pad blocked by a car: moving to the pre-authorized backup spot.'); return; } d.phase = 'wait'; if (!d.event) openEvent(d, 'car'); return; }
        d.phase = 'wait'; setLevel(d, 'L2', 'Waiting'); return;
      }
      case 'wait': {
        d.waitT += dt; d.timer += dt;
        if (d.timer >= 1) {
          d.timer = 0; const v = checks(d);
          if (v.ok && !d.event?.waiting) { d.phase = 'lower'; setLevel(d, T.backup ? 'L3' : 'L0', 'Spot clear again: lowering.'); log(d, 'VERIFY_OK', 'Spot clear again: lowering.'); d.waitT = 0; }
          else if (!v.ok && v.blockers.dyn.length && !d.event) openEvent(d, v.blockers.dyn[0].kind === 'dog' ? 'dog' : 'ped');
          else if (!v.ok && v.blockers.carBlock && !d.event) { if (o.backupOK) switchBackup(d, 'Pad blocked by a car: moving to the pre-authorized backup spot.'); else openEvent(d, 'car'); }
        }
        return;
      }
      case 'lower': {
        const near = [...peds, ...dogs].find((a) => hyp(a, T) <= (a.kind === 'dog' ? DOG_ZONE : PED_ZONE) && watchedBy(d, a));
        if (near && !d.event) { openEvent(d, near.kind === 'dog' ? 'dog' : 'ped'); return; }
        if (near) { d.phase = 'reel'; return; }
        d.drop = Math.min(HOVER, d.drop + LOWER * dt);
        if (d.drop >= HOVER - 1e-3) { d.phase = 'release'; d.timer = 0; }
        return;
      }
      case 'reel': { d.drop = Math.max(0, d.drop - REEL * dt); if (d.drop <= 1e-3) { d.phase = 'wait'; d.timer = 0; } return; }
      case 'release': {
        d.timer += dt;
        if (d.timer > 1) { d.parcelAt = { x: T.x, z: T.z }; finishOrder(d, T.backup ? 'delivered-alt' : 'delivered'); d.phase = 'reelup'; }
        return;
      }
      case 'reelup': { d.drop = Math.max(0, d.drop - REEL * dt * 1.5); if (d.drop <= 0) d.phase = 'leave'; return; }
      case 'leave': { const close = nearestBird(d); if (close < 2.4) { d.speedK = 0; if (!d.event) openEvent(d, 'pigeon'); return; } d.speedK = close < 5 ? 0.35 : 1; if (goTo(d, d.home, SLAB + Math.min(23, d.cruise + (d.climbOver ? 3 : 0)), dt)) { d.speedK = 1; d.phase = 'land'; } return; }
      case 'return': {
        d.drop = Math.max(0, d.drop - REEL * dt * 1.5); if (d.drop > 0) return;
        const close = nearestBird(d); d.speedK = close < 2.4 ? 0 : close < 5 ? 0.35 : 1;
        if (goTo(d, d.home, SLAB + Math.max(d.cruise + (d.climbOver ? 3 : 0), d.y - SLAB), dt)) { d.speedK = 1; d.phase = 'land'; }
        return;
      }
      case 'land': {
        if (goTo(d, d.home, ground, dt)) {
          d.phase = 'idle'; d.readyAt = S.t + 2; d.battery = 100; d.route = []; d.parcelAt = null; d.delivered = false;
          const o2 = d.order;
          if (d.abortedOrder && o2 && o2.status === 'active') { o2.tries++; o2.status = o2.tries < MAX_TRIES ? 'queued' : 'aborted'; if (o2.status === 'aborted') { o2.outcome = 'aborted'; o2.tDone = S.t; S.completed++; } }
          d.order = null; d.target = null; setLevel(d, 'L0', 'At hub'); d.maxLevel = 'L0';
        }
        return;
      }
    }
  }
  const columnBusy = (d) => S.drones.some((e) => e !== d && e.order && e.target && hyp(e.target, d.target) < 2.6 && (['descend', 'scan', 'verify', 'wait', 'lower', 'reel', 'release', 'reelup', 'shift', 'climb'].includes(e.phase) || (['return', 'leave'].includes(e.phase) && hyp(e, d.target) < 3) || (['locate', 'confirm'].includes(e.phase) && lowerPriority(d, e) === d)));
  const nearestBird = (d) => { if (!flocks.length) return 99; let m = 99; for (const b of flockBirds(S.t)) m = Math.min(m, Math.hypot(b.x - d.x, (b.y - d.y) * 0.45, b.z - d.z)); return m; };

  // ---------------------------------------------------------------- environment, agents, detectors
  function updateAgents(dt) {
    for (const p of peds) {
      const wants = () => S.drones.filter((d) => d.order && ['enter', 'locate', 'confirm', 'descend', 'scan', 'verify', 'wait'].includes(d.phase) && hyp(d, p) < 40);
      const retarget = () => { const w = wants(); p.goal = w.length && Rped() < 0.7 ? w[Math.floor(Rped() * w.length)].order.addr : pickAddr(Rped, (x) => 0.4 + x.ctx.paradeNear + 0.6 * x.ctx.tallShare); p.look = 8 + Rped() * 8; };
      if (p.wait > 0) { p.wait -= dt; p.phase += dt * 0.5; continue; }
      p.look = (p.look ?? 10) - dt; if (p.look <= 0) retarget();
      const dx = p.goal.x - p.x, dz = p.goal.z - p.z, L = Math.hypot(dx, dz);
      if (L < 0.25) { p.wait = 2 + Rped() * 3; retarget(); continue; }
      p.x += dx / L * p.speed * dt; p.z += dz / L * p.speed * dt; p.heading = Math.atan2(dx, dz); p.phase += dt * 6;
    }
    for (const g of dogs) {
      if (g.state === 'roam') {
        g.x = g.home.x + BACKUP_DX + Math.sin(S.t * 0.4 + g.k) * 0.6; g.z = g.home.z + 0.4 + Math.cos(S.t * 0.3 + g.k) * 0.4;
        for (const d of S.drones) if (d.order && d.order.addr === g.home && d.phase === 'lower' && d.drop >= HOVER * 0.4 && d.order.dogAttn && g.forOrder !== d.order.id) {
          g.state = 'run'; g.t0 = S.t; g.stay = 18 + Rdog() * 24; g.forOrder = d.order.id; g.from = { x: g.x, z: g.z }; g.to = { x: g.home.x + 0.35, z: g.home.z + 0.2 };
        }
      } else {
        const e = S.t - g.t0, walk = 1, p = e < walk ? e / walk : e < walk + g.stay ? 1 : Math.max(0, 1 - (e - walk - g.stay) / walk);
        g.x = g.from.x + (g.to.x - g.from.x) * p + (p === 1 ? Math.sin(S.t * 0.9) * 0.18 : 0); g.z = g.from.z + (g.to.z - g.from.z) * p + (p === 1 ? Math.cos(S.t * 0.7) * 0.12 : 0);
        g.heading = Math.atan2(g.to.x - g.from.x, g.to.z - g.from.z) + (e > walk + g.stay ? Math.PI : 0);
        if (e > walk * 2 + g.stay) g.state = 'roam';
      }
    }
    const gu = active(gusts, S.t);
    for (const d of S.drones) {
      const tx = gu && d.phase !== 'idle' && S.t >= (d.gustIgnore ?? 0) ? Math.cos(gu.ang) * gu.v / 16 * 0.35 : 0, tz = gu && d.phase !== 'idle' ? Math.sin(gu.ang) * gu.v / 16 * 0.35 : 0;
      d.px += (tx - d.px) * Math.min(1, dt * 2); d.pz += (tz - d.pz) * Math.min(1, dt * 2);
    }
  }
  const priority = (d) => [d.order?.urgent ? 0 : 1, d.idx];
  const lowerPriority = (a, b) => { const pa = priority(a), pb = priority(b); return pa[0] !== pb[0] ? (pa[0] > pb[0] ? a : b) : (pa[1] > pb[1] ? a : b); };   // urgent first, then the lower ID goes first
  const pairCool = new Map();
  const aheadOf = (d, s) => { if (!FLIGHT.has(d.phase) && !['enter', 'descend', 'shift', 'climb'].includes(d.phase)) return d; const tg = d.phase === 'leave' || d.phase === 'return' ? d.home : d.target; if (!tg) return d; const hx = tg.x - d.x, hz = tg.z - d.z, L = Math.hypot(hx, hz) || 1, m = Math.min(L, V * s); return { x: d.x + hx / L * m, z: d.z + hz / L * m }; };
  function conflictScan() {
    const live = S.drones.filter((d) => d.order && !['idle', 'land'].includes(d.phase));
    const atPad = (d) => !FLIGHT.has(d.phase);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j], key = `${a.id}/${b.id}`; if ((pairCool.get(key) ?? 0) > S.t) continue;
      if (a.yieldFor === b.id || b.yieldFor === a.id) continue;                      // one of them is already yielding to the other
      const dy = Math.abs(a.y - b.y), pa = aheadOf(a, 2.5), pb = aheadOf(b, 2.5);
      const flightNear = dy < 1.3 && (hyp(a, b) < 2.4 || hyp(pa, pb) < 2.4);
      const padOverlap = (atPad(a) || atPad(b)) && hyp(a.target, b.target) < 2.6 && hyp(a, b) < 3.2 && dy < 6;
      if (!flightNear && !padOverlap) continue;
      pairCool.set(key, S.t + 6);
      const y = lowerPriority(a, b), g = y === a ? b : a;                              // the rule: urgent first, then the lower ID; the other yields
      if (y.event) { y.held = true; y.yieldFor = g.id; y.yieldCap = S.t + 45; g.climbOver = true; log(y, 'YIELD', `${y.id} yields to ${g.id} (priority rule; it is already handling another event).`); continue; }   // no second event on a busy drone
      const ev = openEvent(y, 'conflict', { with: g.id, kind2: padOverlap ? 'descent overlap' : 'path overlap' });
      if (ev) g.conflictEvent = ev;
    }
  }
  /** last line of defence, independent of events and of the operator: two airborne drones never get closer than ~7 m */
  function separationGuard() {
    const live = S.drones.filter((d) => d.order && !['idle', 'land'].includes(d.phase));
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (hyp(a, b) < 1.4 && Math.abs(a.y - b.y) < 1.4) { const y = lowerPriority(a, b); y.sepStop = S.t + 0.35; }
    }
  }
  function detectors() {
    const gu = active(gusts, S.t);
    for (const d of S.drones) {
      if (!d.order || d.phase === 'idle' || d.phase === 'land' || d.phase === 'return') continue;
      // no-fly zones
      if (!d.event) for (const z of zones) {
        if (S.t < z.t0 || S.t >= z.t1 || d.zoneSeen.has(z.id)) continue;
        const ahead = (() => { const tg = d.phase === 'leave' ? d.home : d.target, hx = tg.x - d.x, hz = tg.z - d.z, L = Math.hypot(hx, hz) || 1, m = FLIGHT.has(d.phase) ? Math.min(L, V * 2.5) : 0; return { x: d.x + hx / L * m, z: d.z + hz / L * m }; })();
        const targetIn = d.phase === 'enter' && hyp(d.target, z) < z.r && hyp(d, d.target) < 14;
        if (hyp(d, z) < z.r + 0.6 || hyp(ahead, z) < z.r + 0.6 || targetIn) { d.zoneSeen.add(z.id); openEvent(d, 'nofly', { zone: z.id }); break; }
      }
      // gust toward a building taller than the drone
      if (!d.event && gu && gu.v >= 9 && S.t >= (d.gustIgnore ?? 0)) {
        for (const o of obstacles) {
          const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2, dx = cx - d.x, dz = cz - d.z, L = Math.hypot(dx, dz) || 1;
          const gap = Math.max(o.x0 - d.x, 0, d.x - o.x1) + Math.max(o.z0 - d.z, 0, d.z - o.z1);
          if (gap < 3 && o.h >= 8 && o.h + SLAB > d.y - 0.5 && (dx / L * Math.cos(gu.ang) + dz / L * Math.sin(gu.ang)) > 0.3) { openEvent(d, 'gust', { gust: gu.t0 }); break; }
        }
      }
    }
    // pedestrians / dogs reaching the descent zone while a parcel is down are handled by the drone state machine; track closest approach
    for (const ev of S.events) {
      if (ev.tier !== 1 || (ev.status !== 'open' && ev.status !== 'acknowledged')) continue;
      const d = droneOf(ev.drone); let m = Infinity; const me = { x: d.x, y: d.y - d.drop, z: d.z };
      if (ev.type === 'conflict') m = dist3(d, droneOf(ev.with)) * SCALE_M;
      else if (ev.type === 'ped' || ev.type === 'dog') for (const a of [...peds, ...dogs]) if (hyp(a, d) < 4) { const pp = { x: a.x, y: SLAB + 0.4, z: a.z }; m = Math.min(m, dist3(pp, d) * SCALE_M); if (d.drop > 0.05) m = Math.min(m, dist3(pp, me) * SCALE_M); }
      if (Number.isFinite(m)) ev.closestM = ev.closestM == null ? +m.toFixed(1) : Math.min(ev.closestM, +m.toFixed(1));
    }
  }
  function selfClose() {
    const gu = active(gusts, S.t);
    for (const ev of S.events) {
      if (ev.status !== 'open' && ev.status !== 'acknowledged') continue;
      const d = droneOf(ev.drone); let clear = false;
      switch (ev.type) {
        case 'ped': case 'dog': { const T = d.target; clear = !T || ![...peds, ...dogs].some((a) => hyp(a, T) <= (a.kind === 'dog' ? DOG_ZONE : PED_ZONE) + 0.8); break; }
        case 'pigeon': clear = nearestBird(d) > 5.5; break;
        case 'occluded': { const c = clouds.find((x) => x.id === ev.cloud); clear = !c || S.t >= c.t1; break; }
        case 'gust': clear = !gu || gu.t0 !== ev.gust; break;
        case 'nofly': { const z = zones.find((x) => x.id === ev.zone); clear = !z || S.t >= z.t1; break; }
        case 'silent': clear = d.confirmed; break;
        case 'car': clear = !!d.target?.backup || S.t >= d.order.carUntil; break;
        case 'conflict': clear = false; break;
      }
      if (clear && ev.type !== 'conflict') {
        closeEvent(ev, 'self');
        if (ev.type === 'occluded' && d.phase === 'climb') { d.phase = 'descend'; }
        if ((ev.type === 'ped' || ev.type === 'dog') && d.phase === 'wait') d.timer = 1;
      }
    }
  }
  function deadlines() {
    for (const ev of S.events) if (ev.status === 'open' && S.t >= ev.deadline) resolve(ev.id, ev.defaultId, 'auto');
  }
  const queueList = () => S.events.filter((e) => e.status === 'open').sort((a, b) => a.tier - b.tier || (a.deadline - S.t) - (b.deadline - S.t));

  // ---------------------------------------------------------------- commands
  function command(droneId, id) {
    const d = droneOf(droneId); if (!d || !d.order || S.done) return false;
    switch (id) {
      case 'hold': d.hold = true; setLevel(d, 'L2', 'Held by operator.'); log(d, 'OPERATOR', 'Operator: hold position.'); return true;
      case 'resume': d.hold = false; setLevel(d, 'L0', 'Resumed.'); log(d, 'OPERATOR', 'Operator: resume.'); return true;
      case 'return': d.hold = false; abort(d, 'Operator sent the drone home.'); return true;
      case 'reel': if (d.phase === 'lower') { d.phase = 'reel'; log(d, 'OPERATOR', 'Operator: reel in.'); return true; } return false;
      case 'wait15': d.hover -= 15; log(d, 'OPERATOR', 'Operator: extend the wait by 15 s.'); return true;
    }
    return false;
  }
  function available(droneId) {
    const d = droneOf(droneId), act = !!d?.order && !S.done && !['return', 'land', 'idle'].includes(d.phase);
    return [
      { id: 'hold', label: 'Hold here', enabled: act && !d.hold }, { id: 'resume', label: 'Resume', enabled: act && d.hold },
      { id: 'reel', label: 'Reel in', enabled: act && d.phase === 'lower' }, { id: 'wait15', label: 'Wait +15 s', enabled: act && HOVER_PHASES.has(d.phase) },
      { id: 'return', label: 'Return to hub', enabled: act }, { id: 'force', label: 'Force lower', enabled: false, reason: 'not offered: verification is required' },
    ];
  }

  // ---------------------------------------------------------------- tick
  function parcelPos(d) {
    if (d.parcelAt && d.delivered && d.phase !== 'enter') return { x: d.parcelAt.x, y: SLAB, z: d.parcelAt.z };
    const swing = Math.hypot(d.px, d.pz) * 0.5 * (d.drop / HOVER);
    return { x: d.x + d.px * (d.drop / HOVER) + swing * 0.2, y: d.y - 0.25 - d.drop, z: d.z + d.pz * (d.drop / HOVER) };
  }
  function step(dt) {
    if (S.done) return;
    S.t += dt;
    updateAgents(dt);
    conflictScan();
    separationGuard();
    detectors();
    deadlines();
    selfClose();
    for (const d of S.drones) {
      stepDrone(d, dt);
      if (d.order && d.phase !== 'idle') sense(d, dt);
      if (d.order && S.t - (d.lastSeries ?? -9) >= 0.5) {
        d.lastSeries = S.t; const p = parcelPos(d), dm = Math.hypot(p.x - d.order.addr.x, p.y - SLAB, p.z - d.order.addr.z) * SCALE_M; d.distanceM = dm;
        d.series.push([+(S.t - d.order.tAssigned).toFixed(1), +dm.toFixed(1)]); if (d.series.length > 400) d.series.shift();
      }
    }
    S.queuePeak = Math.max(S.queuePeak, queueList().length);
    if (S.t - (S.lastSample ?? -9) >= 5) { S.lastSample = S.t; S.series.push([+S.t.toFixed(0), queueList().length]); }
    const finalOrders = orders.every((o) => ['delivered', 'delivered-alt', 'aborted'].includes(o.status));
    if (finalOrders && S.drones.every((d) => d.phase === 'idle')) { S.done = true; S.endedBy = 'orders'; log(null, 'END', 'All orders are done or aborted.'); }
    else if (S.t >= TIME_CAP) { S.done = true; S.endedBy = 'cap'; log(null, 'END', `Time cap of ${TIME_CAP} s reached.`); }
  }
  function run(seconds, dt = 0.1) { for (let t = 0; t < seconds && !S.done; t += dt) step(dt); return S; }

  // ---------------------------------------------------------------- scorecard
  function scorecard() {
    const ev = S.events, mean = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null);
    const react = (t) => mean(ev.filter((e) => e.tier === t && e.reaction != null).map((e) => e.reaction));
    const n = Math.max(1, orders.length), by = (o) => orders.filter((x) => x.outcome === o).length;
    const aborted = orders.filter((x) => x.outcome === 'aborted' || !x.outcome).length;
    const t1 = ev.filter((e) => e.tier === 1), closest = t1.map((e) => e.closestM).filter((x) => x != null);
    const missed = ev.filter((e) => e.missed), minutes = Math.max(1 / 6, S.t / 60);
    const dels = orders.filter((o) => o.outcome && o.outcome !== 'aborted' && o.tDone != null && o.tAssigned != null).map((o) => o.tDone - o.tAssigned);
    return {
      time: +S.t.toFixed(0), endedBy: S.endedBy, orders: orders.length,
      reaction: { 1: react(1), 2: react(2), 3: react(3) }, missed: missed.length, missedByTier: { 1: missed.filter((e) => e.tier === 1).length, 2: missed.filter((e) => e.tier === 2).length, 3: missed.filter((e) => e.tier === 3).length },
      delivered: +(by('delivered') / n * 100).toFixed(0), deliveredAlt: +(by('delivered-alt') / n * 100).toFixed(0), aborted: +(aborted / n * 100).toFixed(0), redelivered: orders.filter((o) => o.redelivered).length,
      closestTier1M: closest.length ? Math.min(...closest) : null, eventsTotal: ev.length, tier1: t1.length, eventsPerMin: +(ev.length / minutes).toFixed(1), peakQueue: S.queuePeak, avgDeliveryS: mean(dels),
      byType: Object.fromEntries(EVENT_TYPES.map((t) => [t, ev.filter((e) => e.type === t).length])),
      score: Math.max(0, Math.round(100 - 1.5 * missed.filter((e) => e.tier === 1).length - 0.8 * missed.filter((e) => e.tier === 2).length - 0.4 * missed.filter((e) => e.tier === 3).length - 0.5 * aborted / n * 100)),
    };
  }

  return {
    state: S, step, run, resolve, command, available, checks: (id) => { const d = droneOf(id); return d?.order ? checks(d).list : []; }, queue: queueList, scorecard, parcelPos, droneOf, flockBirds, activeGust: () => active(gusts, S.t), activeZones: () => zones.filter((z) => S.t >= z.t0 && S.t < z.t1), activeCloud: () => active(clouds, S.t),
    knowledgeCells(id) { const d = droneOf(id), K = d?.know; if (!K) return []; const out = []; for (let k = 0; k < GRID * GRID; k++) out.push({ x0: K.ox + (k % GRID), z0: K.oz + Math.floor(k / GRID), state: K.state[k], age: S.t - K.seen[k] }); return out; },
    debugOpen(id, type) { return openEvent(droneOf(id), type); },
  };
}

export const WORLD_CONST = { V, VZ, LOWER, REEL, HOVER_BUDGET, TIME_CAP, N_DRONES, GRID, PED_ZONE, SLAB, HOVER };
