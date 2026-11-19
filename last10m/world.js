// Last 10m v2 — ONE shared city, nine fixed drones (D-01 … D-09), a stream of orders, nine event types and a human
// operator who has to triage. Pure JS (no three.js): runs in node tests as well as in the browser. Deterministic for a
// given seed + settings: every random draw comes from a seeded stream and none of them depends on operator input,
// except what the operator decides to do about it.
// Units: scene units (1 u = 5 m), seconds. Ground top = SLAB. x east, z south, y up.
//
// The nine v1 scenes became nine event types:
//   A1 dog on drop zone · A2 car on pad · A3 pedestrian in descent zone · B1 pigeon flock · B2 two-drone conflict
//   B3 gust toward building · C1 sensor occluded · C2 customer silent · C3 sudden no-fly zone
// and they are sorted into three urgency tiers (see TIER):
//   ① Critical  — the drone protects people on its own (stops, reels up, holds, yields) and carries on when the danger has gone.
//                 The operator is told and may override (backup spot, send home, swap the conflict rule), but nothing waits for them.
//   ② Urgent / ③ Can wait — the drone stops in a safe hover and STAYS ON HOLD until the operator decides. Nothing is decided for
//                 them; waiting time is what it costs. (Only the battery reserve can still send a forgotten drone home.)

import { SCALE_M, HUB } from './scenes.js';
import { CONST, levelRank, LEVEL_TEXT } from './sim.js';
import { PARADE_ROUTE, PARADE, balloonAt } from '../parade-environment.js';

const { SLAB, CRUISE, HOVER, DETECT_U } = CONST;
export { LEVEL_TEXT };

// ------------------------------------------------------------------ board / settings
export const PRESETS = [
  { id: 'high', label: 'High-rise heavy' },
  { id: 'low', label: 'Low-rise heavy' },
  { id: 'mixed', label: 'Mixed / interleaved' },
];
export const BOARD = [
  { group: 'Orders', key: 'orders', label: 'Orders count', unit: '/10 min', min: 9, max: 60, step: 1, def: 30 },
  { group: 'Orders', key: 'urgentPct', label: 'Urgent ratio', unit: '%', min: 0, max: 100, step: 5, def: 25 },
  { group: 'Orders', key: 'radiusM', label: 'Delivery radius', unit: 'm', min: 80, max: 300, step: 10, def: 200 },
  { group: 'Agents', key: 'flocks', label: 'Pigeon flocks', unit: '', min: 0, max: 6, step: 1, def: 2 },
  { group: 'Agents', key: 'pedestrians', label: 'Pedestrians', unit: '', min: 0, max: 12, step: 1, def: 4 },
  { group: 'Agents', key: 'dogs', label: 'Dogs', unit: '', min: 0, max: 8, step: 1, def: 3 },
  { group: 'Agents', key: 'replyPct', label: 'Customer reply rate', unit: '%', min: 0, max: 100, step: 5, def: 70 },
  { group: 'Weather', key: 'gustPerMin', label: 'Gust frequency', unit: '/min', min: 0, max: 6, step: 0.5, def: 2 },
  { group: 'Shift', key: 'shiftMin', label: 'Shift length', unit: 'min', min: 5, max: 20, step: 1, def: 10 },
];
export const DEFAULT_SETTINGS = { ...Object.fromEntries(BOARD.map((b) => [b.key, b.def])), preset: 'mixed', memory: 'retained', seed: 2026 };

// ------------------------------------------------------------------ event hierarchy
export const TIER = { ped: 1, conflict: 1, nofly: 1, gust: 1, dog: 2, pigeon: 2, occluded: 2, car: 3, silent: 3 };
export const TIER_NAME = { 1: 'Critical', 2: 'Urgent', 3: 'Can wait' };
export const TITLE = { ped: 'Pedestrian in descent zone', conflict: 'Two-drone conflict', nofly: 'Sudden no-fly zone', gust: 'Gust toward building',
  dog: 'Dog on drop zone', pigeon: 'Pigeon flock in path', occluded: 'Sensor occluded', car: 'Car parked on pad', silent: 'Customer silent' };
export const SCENE_OF = { dog: 'A1', car: 'A2', ped: 'A3', pigeon: 'B1', conflict: 'B2', gust: 'B3', occluded: 'C1', silent: 'C2', nofly: 'C3' };
export const EVENT_TYPES = Object.keys(TIER);

// ------------------------------------------------------------------ constants (formerly board parameters)
const V = 4, VZ = 1.6, LOWER = 0.28, REEL = 0.7;           // 20 m/s cruise, 1.4 m/s tether pay-out
const HOVER_BUDGET = 75, TIME_CAP = 900, DEPART_GAP = 5, LAND_GAP = 5, HOLD_Y = 2.4, BAL_CORE = 5.8, BAL_HOLD = 8, MAX_TRIES = 2, BACKUP_DX = -3.2, PAD_DZ = 5.1;
const SILENT_GIVE_UP = 300, SHIFT_DEFAULT = 10;   // a customer who has not answered for 5 min is not coming; a shift lasts 10 min unless the board says otherwise
const PED_ZONE = 2.6, DOG_ZONE = 2.2, FRESH_S = 2, BATTERY_RESERVE = 20, N_DRONES = 9, GRID = 13;
const HOVER_PHASES = new Set(['pickup', 'locate', 'confirm', 'descend', 'scan', 'verify', 'lower', 'wait', 'reel', 'shift', 'climb', 'release']);
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
 *   obstacles: [{x0,x1,z0,z1,h}] buildings   low: [{x,z,r,h}] trees, lamp posts, signals   roads: road centre lines (both axes)
 *   tiles: [{cx,cz,landUse,name}]   memory: { landmarks: {addressKey: true} } (mutated)
 */
export function createWorld(input = {}, { obstacles = [], low = [], roads = null, tiles = [], memory = {}, plan = null } = {}) {
  const P = { ...DEFAULT_SETTINGS, ...input };
  const seedOf = (k) => rng(((P.seed >>> 0) * 31 + k * 7919) >>> 0);
  const Rord = seedOf(1), Rped = seedOf(2), Rdog = seedOf(3), Rfl = seedOf(4), Rgust = seedOf(5), Rzone = seedOf(6), Rconf = seedOf(7);
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
  const clearPad = (x, z) => !obstacles.some((o) => x > o.x0 - 1.3 && x < o.x1 + 1.3 && z > o.z0 - 1.3 && z < o.z1 + 1.3);   // a pad (and its backup spot) is never inside or hard against a building
  // ---- low obstacles: trees, lamp posts, signals. Lower than any cruise level, but taller than a drone hovering at 7 m
  const DRONE_R = 0.75;                                   // half span of the drone + the most a gust can push it sideways
  const lowNear = (x, z, pad) => low.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + pad);
  const clearSpot = (x, z) => clearPad(x, z) && !lowNear(x, z, DRONE_R + 0.15);   // a drone can hover right above it and lower a parcel
  /** height (u above ground) a drone must keep on the straight move a → b so that it passes over every tree / lamp near that line */
  const lowNeed = (ax, az, bx, bz) => { let n = 0; for (const t of low) if (t.h + 0.45 > n && segDist(t, { x: ax, z: az }, { x: bx, z: bz }) < t.r + DRONE_R) n = t.h + 0.45; return n; };
  const BACKUP_TRY = [[BACKUP_DX, 0], [-BACKUP_DX, 0], [-2.4, -1.4], [2.4, -1.4], [0, -2.6], [-2, 0], [2, 0]];
  const backupSpot = (x, z) => { for (const [dx, dz] of BACKUP_TRY) if (clearSpot(x + dx, z + dz)) return { x: x + dx, z: z + dz }; return null; };
  const isShop = (t) => /commercial block/i.test(t.name || '');
  const shops = tiles.filter(isShop).map((t) => ({ id: String(t.name).match(/^(R\d+)/)?.[1] ?? t.id, name: String(t.name).replace(/\s*\(commercial block\)/i, ''), key: `${t.cx},${t.cz}`, x: t.cx, z: t.cz + PAD_DZ }));   // restaurants / shops: where the goods are picked up
  let all = tiles.filter((t) => !(t.cx === 0 && t.cz === 0) && t.landUse !== 'sensitive' && !isShop(t) && !/pond/i.test(t.name || '') && clearSpot(t.cx, t.cz + PAD_DZ))
    .map((t) => ({ key: `${t.cx},${t.cz}`, x: t.cx, z: t.cz + PAD_DZ, tile: t, name: t.name || t.id, id: t.id, backup: backupSpot(t.cx, t.cz + PAD_DZ) }));
  all.sort((a, b) => hyp(a, HUB) - hyp(b, HUB));
  let addresses = all.filter((a) => hyp(a, HUB) <= radiusU);
  if (addresses.length < 4) addresses = all.slice(0, 4);   // the parcel grid is 80 m apart: with a very small radius the four nearest addresses are used
  for (const a of addresses) a.ctx = ctxOf(a);

  // ---- orders (all random draws of an order come from its own stream, so board changes never reshuffle other orders)
  // The city never sleeps: the board's order count is the number of orders arriving per 10 minutes (seeded, slightly irregular). Orders
  // keep coming for as long as the simulation runs, so the drones keep circulating until the user pauses it.
  const orders = []; let orderNo = 0;
  function makeOrder() {
    const i = orderNo++, rr = rng(((P.seed >>> 0) * 13 + i * 97 + 5) >>> 0), a = addresses[Math.floor(rr() * addresses.length)];
    const urgent = rr() < P.urgentPct / 100, shop = shops.length ? shops[Math.floor(rr() * shops.length)] : null;
    const o = { id: i + 1, addr: a, shop, prepS: 2 + rr() * 4, urgent, confettiRoll: rr(), confettiDur: 20 + rr() * 10, status: 'queued', tries: 0, drone: null, tAssigned: null, tDone: null, outcome: null, redelivered: false,
      car: rr() < 0.02 + 0.45 * a.ctx.lowShare, carStay: 60 + rr() * 110, carUntil: Infinity, needConfirm: rr() < 0.6, replyRoll: rr(), replyRoll2: rr(), replyDelay: 4 + rr() * 22, dogAttn: rr() < 0.1 + 0.85 * a.ctx.lowShare, backupOK: !!a.backup && rr() < 0.3 };
    o.collectDelay = 30 + rr() * 60;                      // the customer comes out and takes the parcel in after this long
    orders.push(o); return o;
  }
  const S0 = { t: 0 };
  /** an earlier parcel that is still lying at this spot (the customer has not taken it in yet) */
  const parcelAt = (p, except) => orders.find((x) => x !== except && x.dropAt && S.t < x.tDone + x.collectDelay && Math.hypot(x.dropAt.x - p.x, x.dropAt.z - p.z) < 0.45) ?? null;
  const Rarr = seedOf(9), GAP = 600 / P.orders;
  let nextArrival = 0;
  function arrivals() { while (S.t >= nextArrival) { makeOrder(); nextArrival += nextArrival === 0 ? GAP * 0.3 : GAP * (0.55 + 0.9 * Rarr()); } }

  // ---- ground and air agents (they have their own simple behaviour; they are not scenery)
  const pickAddr = (R, weight) => { const w = addresses.map(weight), s = w.reduce((x, y) => x + y, 0); let u = R() * s; for (let i = 0; i < w.length; i++) { u -= w[i]; if (u <= 0) return addresses[i]; } return addresses.at(-1); };
  // walkers use the street network: road centre lines on both axes (from the city, or derived from the parcel grid: roads run 8 u off
  // every parcel centre). They keep to a lane 1.7 u off the centre line — on the road, clear of every lot — and only leave it to
  // walk the last few metres straight in to a pad, across the front strip that is kept clear of buildings and trees.
  const LANE = 1.7;
  const uniq = (a) => [...new Set(a.map((v) => Math.round(v * 100) / 100))].sort((x, y) => x - y);
  const ROADS_X = uniq(roads ?? tiles.flatMap((t) => [t.cx - 8, t.cx + 8])), ROADS_Z = uniq(roads ?? tiles.flatMap((t) => [t.cz - 8, t.cz + 8]));
  const nearest = (arr, v) => arr.reduce((b, r) => (Math.abs(r - v) < Math.abs(b - v) ? r : b), arr[0] ?? 0);
  const laneFront = (a) => ({ x: a.x, z: nearest(ROADS_Z.filter((r) => r > a.z), a.z + 2.9) - LANE });   // the pavement lane in front of a pad
  function walkPath(from, a) {
    const g = laneFront(a), pts = [];
    const rx = nearest(ROADS_X, from.x), rz = nearest(ROADS_Z, from.z);
    if (Math.abs(from.x - rx) < Math.abs(from.z - rz)) {               // nearer a north–south road: step onto it, walk to the goal's row
      const lx = rx + Math.sign(from.x - rx || 1) * LANE;
      pts.push({ x: lx, z: from.z }, { x: lx, z: g.z });
    } else {                                                            // nearer an east–west road: step onto it, go to a north–south road near the goal
      const lz = rz + Math.sign(from.z - rz || 1) * LANE; pts.push({ x: from.x, z: lz });
      if (Math.abs(lz - g.z) > 0.05) { const vx = nearest(ROADS_X, a.x), lx = vx + Math.sign(from.x - vx || 1) * LANE; pts.push({ x: lx, z: lz }, { x: lx, z: g.z }); }
    }
    pts.push(g, { x: a.x, z: a.z });
    return pts.filter((p, i) => i === 0 ? Math.hypot(p.x - from.x, p.z - from.z) > 0.02 : Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 0.02);
  }
  const peds = Array.from({ length: P.pedestrians }, (_, k) => { const a = pickAddr(Rped, (x) => 0.4 + x.ctx.paradeNear + 0.6 * x.ctx.tallShare), f = laneFront(a), off = (Rped() - 0.5) * 6; return { id: `P${k + 1}`, kind: 'person', x: f.x + off, z: f.z, goal: a, path: null, wait: Rped() * 4, phase: Rped() * 6, heading: 0, speed: 0.7 + Rped() * 0.3 }; });
  const dogYard = (a) => a.backup ?? { x: a.x, z: a.z - 1.6 };            // a dog lives in the yard next to the drop spot
  const dogs = Array.from({ length: P.dogs }, (_, k) => { const a = pickAddr(Rdog, (x) => 0.5 + x.ctx.lowShare * 2), y = dogYard(a); return { id: `G${k + 1}`, kind: 'dog', home: a, x: y.x, z: y.z + 0.4, state: 'roam', t0: 0, stay: 0, heading: 0, k, forOrder: null }; });
  const flocks = Array.from({ length: P.flocks }, (_, k) => { const th = Math.floor(Rfl() * 4) * Math.PI / 2 + (Rfl() - 0.5) * 0.5; return { id: `F${k + 1}`, n: 4 + Math.floor(Rfl() * 3), dx: Math.cos(th), dz: Math.sin(th), lat: (Rfl() - 0.5) * 2 * Math.min(44, radiusU * 0.85), off: Rfl() * 120, speed: 2.2 + Rfl() * 0.8, y: SLAB + 9 + Rfl() * 7 }; });
  const flockBirds = (t) => { const out = []; for (const f of flocks) { const s = ((t * f.speed + f.off) % 120) - 60; for (let i = 0; i < f.n; i++) out.push({ id: `${f.id}b${i}`, flock: f.id, x: f.dx * s - f.dz * f.lat + (i % 3 - 1) * 1.6, z: f.dz * s + f.dx * f.lat + (Math.floor(i / 3) - 0.5) * 1.6, y: f.y + Math.sin(t * 5 + i) * 0.15, flap: t * 14 + i }); } return out; };

  // ---- environment schedules (fixed by the seed; the board only changes how many / how often)
  const gusts = [], zones = [], clouds = [];
  let gT = 0, zT = 25 + Rzone() * 20, cT = 30 + Rconf() * 30;
  function extendSchedules(until) {                       // generated on demand, so the world can run for ever
    const rate = P.gustPerMin / 60;
    if (rate > 0) while (gT < until) { gT += -Math.log(1 - Rgust()) / rate; const d = 6 + Rgust() * 4; gusts.push({ t0: +gT.toFixed(2), t1: +(gT + d).toFixed(2), ang: Rgust() * Math.PI * 2, v: 9 + Rgust() * 7 }); gT += d; }
    while (zT < until) { const onRoute = Rzone() < 0.6, c = onRoute ? routePoint(Rzone()) : (() => { const a = addresses[Math.floor(Rzone() * addresses.length)]; return { x: a.x, z: a.z - 2 }; })(); const dur = 20 + Rzone() * 15; zones.push({ id: `Z${++zoneNo}`, t0: +zT.toFixed(1), t1: +(zT + dur).toFixed(1), x: c.x, z: c.z, r: 3.5 + Rzone() * 2 }); zT += 18 + Rzone() * 14; }
    // confetti: a burst fired from the parade route now and then (about one minute apart); it rises, flutters down and settles
    while (cT < until) { const c = routePoint(Rconf()), dur = 14 + Rconf() * 8; clouds.push({ id: `C${++cloudNo}`, t0: +cT.toFixed(1), t1: +(cT + dur).toFixed(1), x: c.x, z: c.z, r: 4, top: 5 }); cT += dur + 45 + Rconf() * 45; }
    for (const list of [gusts, zones, clouds]) while (list.length > 24 && list[0].t1 < until - 200) list.shift();   // old entries are forgotten
  }
  let zoneNo = 0, cloudNo = 0;
  const active = (list, t) => list.find((g) => t >= g.t0 && t < g.t1) ?? null;
  let dynClouds = 0;

  // ---- state
  const S = {
    P, t: 0, done: false, endedBy: null, orders, drones: [], events: [], agents: { peds, dogs }, flocks, gusts, zones, clouds, addresses,
    log: [], queuePeak: 0, series: [], completed: 0, seq: 0, nextDeparture: 0, landLock: 0, shops,
  };
  extendSchedules(120); arrivals();
  // home slots: on the plaza land around the Dispatch Tower (never on a road), outside the tower's clearance box and clear of the plaza trees, ≥ 2.8 u apart
  const HOME_SLOTS = [[-2.8, -5.2], [0, -5.2], [2.8, -5.2], [-2.8, 5.2], [0, 5.2], [2.8, 5.2], [-5.2, -1.4], [-5.2, 1.4], [5.2, 0]];
  const home = (i) => ({ x: HOME_SLOTS[i % 9][0], z: HOME_SLOTS[i % 9][1] });
  for (let i = 0; i < N_DRONES; i++) {
    const h = home(i);
    S.drones.push({ id: `D-0${i + 1}`, idx: i, x: h.x, y: SLAB, z: h.z, home: h, phase: 'idle', visible: true, order: null, target: null, cruise: CRUISE, drop: 0, speedK: 1, battery: 100,
      held: false, hold: false, event: null, timer: 0, waitT: 0, hover: 0, px: 0, pz: 0, readyAt: 0, level: 'L0', maxLevel: 'L0', levelReason: 'At hub', route: [], routeLog: 0,
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
  // ---- routes. The flying boundary system of the AIRSPACE model decides where a drone may be: map edge, building volumes + clearance,
  // restricted volumes and the permitted airspace (land-use floors, reachable only through landing columns). `plan` is that planner
  // (spatial.js planRoute, injected by the app); without it a conservative fallback is used: straight up, over the tallest building
  // of the leg plus a margin, straight down. A drone only ever follows a planned polyline — it never cuts a corner through a building.
  const MARGIN_U = 1.4;
  function fallbackPlan(from, to, baseU) {
    let top = 0;
    const len = Math.hypot(to.x - from.x, to.z - from.z), n = Math.max(2, Math.ceil(len / 0.3));
    for (let k = 0; k <= n; k++) {
      const x = from.x + (to.x - from.x) * k / n, z = from.z + (to.z - from.z) * k / n;
      for (const o of obstacles) if (x > o.x0 - MARGIN_U && x < o.x1 + MARGIN_U && z > o.z0 - MARGIN_U && z < o.z1 + MARGIN_U) top = Math.max(top, o.h);
    }
    const L = clamp(Math.max(baseU, top + 2), CRUISE, 23.5);
    const pts = [{ x: from.x, y: L, z: from.z }, { x: to.x, y: L, z: to.z }, { x: to.x, y: to.y, z: to.z }];
    return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z, p.y - pts[i - 1].y) > 1e-3);
  }
  function planLeg(d, to) {
    const from = { x: d.x, y: Math.max(0, d.y - SLAB), z: d.z }, baseM = 50 + (d.climbOver ? 15 : 0);
    let pts = null;
    if (plan) { try { const r = plan(from, to, { base: baseM }); if (r?.ok && r.pts?.length) pts = r.pts.map((p) => ({ x: p.x, y: p.y, z: p.z })); } catch { pts = null; } }
    if (!pts) pts = fallbackPlan(from, to, baseM / SCALE_M);
    d.path = pts; d.goal = to; d.needPlan = false; d.cruise = Math.max(CRUISE, ...pts.map((p) => p.y));
  }
  function followPath(d, dt) {                                   // returns true when the whole polyline has been flown
    if (d.needPlan && d.goal) planLeg(d, d.goal);
    const p = d.path?.[0]; if (!p) return true;
    const sp = V * d.speedK; if (sp < 1e-6) return false;
    const dx = p.x - d.x, dz = p.z - d.z, dy = SLAB + p.y - d.y, t = Math.max(Math.hypot(dx, dz) / sp, Math.abs(dy) / (VZ * 1.6));
    if (t < 1e-6) { d.path.shift(); return d.path.length === 0; }
    if (lowGuard(d, p, dt)) return false;                      // a tree or lamp post ahead at this height: rise above it first
    const k = Math.min(1, dt / t); d.x += dx * k; d.z += dz * k; d.y = Math.max(d.y + dy * k, Math.min(d.y, SLAB + lowNeed(d.x, d.z, d.x, d.z)));
    if (k >= 1) d.path.shift();
    return d.path.length === 0;
  }
  const cloudOver = (p, h = 0) => clouds.find((c) => S.t >= c.t0 && S.t < c.t1 && hyp(p, c) < c.r + 0.5 && h < c.top + 0.3) ?? null;
  const inCloud = (p) => clouds.find((c) => S.t >= c.t0 && S.t < c.t1 && hyp(p, c) < c.r + 0.5) ?? null;
  const sensorRadius = (d) => (cloudOver(d, d.y - SLAB) ? 0.6 : clamp(2.6 + (d.y - SLAB) * 0.3, 3, 6));
  const zoneAt = (p, margin = 0) => zones.find((z) => S.t >= z.t0 && S.t < z.t1 && hyp(p, z) < z.r + margin) ?? null;
  const watchedBy = (d, a) => hyp(a, d) <= sensorRadius(d);
  const backupOf = (o) => (o.addr.backup ? { x: o.addr.backup.x, z: o.addr.backup.z, name: 'Backup spot', backup: true } : null);

  // ---------------------------------------------------------------- the five checks (read only what the drone can sense)
  function checks(d) {
    const T = d.target, o = d.order; if (!T || !o) return { ok: false, list: [], blockers: {} };
    if (T.shop) return { ok: true, list: [], blockers: { dyn: [], carBlock: false, fresh: true } };   // at the shop there is nothing to verify
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
    if (ev.type === 'conflict') { const other = droneOf(ev.with); return [{ id: 'rule', label: `${d.id} yields (priority rule)`, primary: true }, { id: 'swap', label: `${other.id} yields instead` }]; }
    return OPTIONS[ev.type].filter(([id]) => id !== 'backup' || backupOf(d.order)).map(([id, label, primary]) => ({ id, label, primary: !!primary }));
  }

  function openEvent(d, type, extra = {}) {
    if (d.event || !d.order || d.delivered || d.abortedOrder) return null;   // a drone that has handed over (or is going home) has nothing left to decide
    const base = TIER[type], urgent = d.order.urgent, tier = urgent ? Math.max(1, base - 1) : base;      // an urgent order raises the tier by one
    // status: 'auto' = critical, handled by the drone itself (it carries on when the danger has gone; the operator may override)
    //         'open' = urgent / can wait: the drone holds in a safe hover until the operator decides — nothing is decided for them
    const ev = { id: `E${S.events.length + 1}`, type, base, tier, urgent, drone: d.id, order: d.order.id, opened: S.t, status: tier === 1 ? 'auto' : 'open',
      resolvedBy: null, resolvedAt: null, reaction: null, option: null, pos: { x: d.x, z: d.z }, closestM: null, autoSafe: tier === 1, safeAction: null, clearNow: false, ...extra };
    ev.options = optionsFor(ev, d);
    S.events.push(ev); d.event = ev;
    ev.safeAction = safetyAction(d, ev);                  // safety is never left to the human: the drone acts first
    if (tier === 1) {
      if (type === 'conflict') applyOption(d, ev, 'rule');                // the priority rule applies at once: one drone yields, the other passes
      else { ev.waiting = true; if (['pigeon', 'gust', 'nofly'].includes(type)) { d.held = true; d.heldBy = ev.id; } }
      setLevel(d, 'L3', `${TITLE[type]} — handled automatically`);
      log(d, 'EVENT', `${TITLE[type]} — ① critical; ${ev.safeAction}. It continues by itself when it is safe.`, { eventId: ev.id, tier });
    } else {
      setLevel(d, 'H', TITLE[type]);
      log(d, 'EVENT', `${TITLE[type]} — tier ${tier} (${TIER_NAME[tier]}); ${ev.safeAction}. On hold until the operator decides.`, { eventId: ev.id, tier });
    }
    return ev;
  }
  function safetyAction(d, ev) {
    switch (ev.type) {
      case 'ped': case 'dog': if (d.drop > 0.05) { d.phase = 'reel'; return 'reeled the parcel up and hovered'; } if (['descend', 'scan', 'verify', 'lower'].includes(d.phase)) d.phase = 'wait'; return 'stopped lowering and hovered';
      case 'conflict': d.held = true; d.heldBy = ev.id; { const o = droneOf(ev.with); o.climbOver = true; o.needPlan = true; } return 'stopped and holding; the other drone climbs 15 m to pass';
      case 'nofly': d.held = true; d.heldBy = ev.id; return 'stopped outside the zone';
      case 'gust': if (d.drop > 0.05) { d.phase = 'reel'; return 'reeled up and hovered'; } d.held = true; d.heldBy = ev.id; return 'holding position away from the building';
      case 'pigeon': d.held = true; d.heldBy = ev.id; return 'holding until the flock passes';
      case 'occluded': if (['descend', 'scan', 'verify', 'lower'].includes(d.phase)) d.phase = 'climb'; return 'climbing above the cloud';
      default: return 'hovering';
    }
  }
  function closeEvent(ev, by, status = 'cleared') {
    const d = droneOf(ev.drone); ev.status = status; ev.resolvedBy ??= by; ev.resolvedAt ??= S.t; ev.closedAt = S.t;
    if (d.event === ev) d.event = null;
    if (d.heldBy === ev.id) { d.held = false; d.heldBy = null; }
    if ((levelRank(d.level) >= levelRank('H') || d.level === 'L3') && d.phase !== 'return' && !d.target?.backup) setLevel(d, 'L0', 'Cleared');
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
      case 'climb': d.climbOver = true; d.needPlan = true; setLevel(d, 'L3', 'Climbing over'); if (ev.type === 'occluded') d.phase = 'climb'; break;
      case 'resume': d.gustIgnore = active(gusts, S.t)?.t1 ?? 0; setLevel(d, 'L1', 'Continuing in gust'); break;
      case 'assume': d.confirmed = true; setLevel(d, 'L2', 'Assuming the instructed spot'); if (d.phase === 'confirm') d.phase = 'descend'; break;
      case 'rule': case 'swap': {
        const other = droneOf(ev.with), yielder = id === 'rule' ? d : other, goer = yielder === d ? other : d;
        yielder.held = true; yielder.heldBy = null; yielder.yieldFor = goer.id; yielder.yieldCap = S.t + 45; goer.held = false; goer.heldBy = null; goer.yieldFor = null; goer.climbOver = true; goer.needPlan = true;
        setLevel(yielder, 'L3', `${yielder.id} yields to ${goer.id}`); setLevel(goer, 'L1', 'Proceeding'); break;
      }
    }
  }
  /** the operator answers an event: an open one (② / ③, the drone is on hold) or a critical one the drone is handling ('auto', override) */
  function resolve(evId, optionId, by = 'operator') {
    const ev = S.events.find((e) => e.id === evId); if (!ev || !['open', 'auto'].includes(ev.status) || ev.option) return false;
    if (!ev.options.some((o) => o.id === optionId)) return false;
    const d = droneOf(ev.drone), wasHeld = ['pigeon', 'gust', 'nofly'].includes(ev.type), wasAuto = ev.status === 'auto';
    ev.resolvedBy = by; ev.resolvedAt = S.t; ev.option = optionId;
    ev.reaction = +(S.t - ev.opened).toFixed(2);
    log(d, 'OPERATOR', `Operator: ${ev.options.find((o) => o.id === optionId).label}.`, { eventId: ev.id, tier: ev.tier });
    if (wasAuto && (optionId === 'wait' || optionId === 'rule')) return true;                     // confirms what the drone is already doing
    if (optionId === 'wait') { ev.status = 'acknowledged'; ev.waiting = true; d.event = ev; d.hover = Math.min(d.hover, HOVER_BUDGET - 40); if (wasHeld) { d.held = true; d.heldBy = ev.id; } setLevel(d, 'L2', 'Waiting until clear'); return true; }   // the operator delegates: carry on by yourself once it is clear
    ev.status = 'resolved'; if (d.event === ev) d.event = null;
    if (ev.type === 'conflict') { const other = droneOf(ev.with); if (other.conflictEvent === ev) other.conflictEvent = null; }
    applyOption(d, ev, optionId);
    return true;
  }

  // ---------------------------------------------------------------- orders and drones
  // a shop pad serves one drone at a time: the others queue above it, each on its own level, first come first served
  const sameShop = (a, b) => a.target?.shop && b.target?.shop && Math.hypot(a.target.x - b.target.x, a.target.z - b.target.z) < 0.5;
  const shopQueueRank = (d) => S.drones.filter((e) => e !== d && e.order && e.phase === 'pickup' && sameShop(e, d) && e.shopArrive < d.shopArrive).length;   // first come, first served at the pad
  const shopRank = (d) => S.drones.filter((e) => e !== d && e.order && (e.leg === 'toShop' || e.phase === 'pickup') && sameShop(e, d) && e.shopSeq < d.shopSeq).length;
  function nextOrder() { const q = orders.filter((o) => o.status === 'queued'); q.sort((a, b) => (b.urgent - a.urgent) || a.id - b.id); return q[0] ?? null; }
  function assign(d, o) {
    o.status = 'active'; o.drone = d.id; o.tAssigned = S.t; if (o.tries > 0) o.redelivered = true;
    d.shopSeq = ++S.seq; d.order = o; d.carrying = !o.shop; d.pickStep = null; d.leg = o.shop ? 'toShop' : 'toCustomer';
    d.target = o.shop ? { x: o.shop.x, z: o.shop.z, name: o.shop.name, shop: true } : { x: o.addr.x, z: o.addr.z, name: o.addr.name, original: true };
    d.phase = 'enter'; d.drop = 0; d.hover = 0; d.waitT = 0; d.escalated = false; d.approved = false; d.confirmed = false; d.confettiDone = false; d.lmCount = 0; d.delivered = false; d.abortedOrder = false;
    d.climbOver = false; d.zoneSeen = new Set(); d.route = [{ x: d.x, y: d.y, z: d.z }]; d.routeLog = S.t; d.series = []; d.scanned = false; d.seenAt = -99; d.gustIgnore = 0; d.speedK = 1;
    d.know = { ox: o.addr.x - GRID / 2, oz: o.addr.z - GRID / 2, state: new Uint8Array(GRID * GRID), seen: new Float32Array(GRID * GRID).fill(-99) };
    { const r = o.shop ? shopRank(d) : 0, h = r > 0 ? holdPoint(d, d.target) : null;      // a shop already has a drone coming: fly straight to the holding ring
      planLeg(d, h ? { x: h.x, y: Math.max(h.y - SLAB, CRUISE + 1.6 * r), z: h.z } : { x: d.target.x, y: CRUISE, z: d.target.z }); }
    setLevel(d, 'L0', 'Departed'); d.maxLevel = 'L0';
    log(d, 'DEPART', `${d.id} takes order #${o.id}${o.urgent ? ' (URGENT)' : ''}: ${o.shop ? `pick up at ${o.shop.name}, deliver to ${o.addr.name}` : `deliver to ${o.addr.name}`}, cruising at ${Math.round(d.cruise * SCALE_M)} m.`);
  }
  /** low obstacles: before a horizontal move below the treetops, look ~1 u ahead; if a tree / lamp is in the way, climb (and do not
   *  move sideways) until the drone is above it. Returns true while it is climbing. */
  function lowGuard(d, p, dt) {
    const dx = p.x - d.x, dz = p.z - d.z, L = Math.hypot(dx, dz); if (L < 1e-3 || !low.length) return false;
    const la = Math.min(L, 1.0), need = lowNeed(d.x, d.z, d.x + dx / L * la, d.z + dz / L * la);
    if (d.y - SLAB >= need - 1e-3) return false;
    d.y = Math.min(d.y + VZ * dt * 1.5, SLAB + need); return true;
  }
  /** where a drone waits its turn for a busy pad: not on top of it, but on a ring 3.4 u (17 m) around it, its own slot by ID,
   *  at a height that clears the buildings there. Two waiting drones are never in the same column. */
  function holdPoint(d, pad) {
    const a = d.idx * (Math.PI * 2 / N_DRONES) + 0.35, x = pad.x + Math.cos(a) * 3.4, z = pad.z + Math.sin(a) * 3.4;
    let top = 0;                                           // the whole way out from the pad must be clear, not only the holding point
    for (let k = 0; k <= 8; k++) { const px = pad.x + (x - pad.x) * k / 8, pz = pad.z + (z - pad.z) * k / 8; for (const o of obstacles) if (px > o.x0 - MARGIN_U && px < o.x1 + MARGIN_U && pz > o.z0 - MARGIN_U && pz < o.z1 + MARGIN_U) top = Math.max(top, o.h); }
    return { x, z, y: SLAB + Math.max(CRUISE, top + 2) };
  }
  /** wait on the holding ring: climb first if needed, then move out level */
  function holdAt(d, pad, dt) { const h = holdPoint(d, pad); if (d.y < h.y - 0.02) { d.y = Math.min(h.y, d.y + VZ * dt * 1.5); return; } goTo(d, h, d.y, dt, 2); }
  /** back from the ring to the pad: level, at the ring height, then down */
  const backOver = (d, T, dt) => { if (hyp(d, T) > 0.05) { goTo(d, T, d.y, dt, 2); return false; } return true; };
  function goTo(d, p, y, dt, speed = V) {
    const dx = p.x - d.x, dz = p.z - d.z, L = Math.hypot(dx, dz), s = speed * d.speedK * dt;
    if (L > 1e-4) { if (lowGuard(d, p, dt)) return false; const k = Math.min(1, s / L); d.x += dx * k; d.z += dz * k; }
    const floor = L > 0.05 ? SLAB + lowNeed(d.x, d.z, d.x, d.z) : 0;   // never sink into a crown on the way; the spot itself is always clear
    d.y += clamp(Math.max(y, Math.min(floor, d.y)) - d.y, -VZ * dt * 1.5, VZ * dt * 1.5);
    return L < 0.05 && Math.abs(y - d.y) < 0.05;
  }
  const finishOrder = (d, outcome) => {
    const o = d.order; if (o.outcome) return; o.status = outcome; o.outcome = outcome; o.tDone = S.t; S.completed++;
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
    // a landmark is learned by looking at it from right above, not by flying past
    if (['locate', 'confirm', 'descend', 'scan', 'verify', 'wait', 'lower'].includes(d.phase) && hyp(d, d.order.addr) <= Math.min(r + 1, 2.5) && !isKnown(d.order)) { d.lmCount += dt; if (d.lmCount >= 3) { memory.landmarks[lmKey(d.order)] = true; log(d, 'LANDMARK', `New landmark: ${d.order.addr.name}.`); } }
  }

  function stepDrone(d, dt) {
    if (d.phase === 'idle') {
      if (S.t >= d.readyAt && S.t >= S.nextDeparture) { const o = nextOrder(); if (o) { assign(d, o); S.nextDeparture = S.t + DEPART_GAP; } }   // one drone leaves the hub at a time
      return;
    }
    const hovering = HOVER_PHASES.has(d.phase);
    d.battery -= dt * (hovering ? 0.12 : 0.08);
    if (hovering) d.hover += dt;
    const flying = FLIGHT.has(d.phase);
    if (d.order && !['return', 'land'].includes(d.phase)) {
      if (d.battery <= BATTERY_RESERVE) return abort(d, `Battery reached the ${BATTERY_RESERVE}% reserve.`);
      if (d.hover > HOVER_BUDGET && !['open', 'auto'].includes(d.event?.status) && d.event?.type !== 'silent') return abort(d, `Hover budget of ${HOVER_BUDGET} s used up.`);   // a drone on hold for the operator is the operator's call
    }
    if (flying) {                                         // route trace for the map
      if (S.t - d.routeLog >= 0.6) { d.routeLog = S.t; d.route.push({ x: d.x, y: d.y, z: d.z, ret: d.phase !== 'enter' }); if (d.route.length > 160) d.route.shift(); }
    }
    // the parade: the balloon is a moving obstacle at 70 m. A drone never flies through it — it backs off and holds until it has passed.
    if (d.phase !== 'land') {
      const bl = balloonAt(S.t, true), db = Math.hypot(d.x - bl.x, (d.y - SLAB - bl.y) * 0.7, d.z - bl.z);
      if (db < BAL_HOLD) {
        if (db < BAL_CORE) { const hx = d.x - bl.x, hz = d.z - bl.z, L = Math.hypot(hx, hz) || 1, nx = d.x + hx / L * V * 0.5 * dt, nz = d.z + hz / L * V * 0.5 * dt; if (!obstacles.some((q) => nx > q.x0 && nx < q.x1 && nz > q.z0 && nz < q.z1 && d.y - SLAB < q.h + 0.5) && d.y - SLAB >= lowNeed(d.x, d.z, nx, nz)) { d.x = nx; d.z = nz; if (d.goal && FLIGHT.has(d.phase)) d.needPlan = true; } }   // pushed off the planned line: re-plan from here
        if (!d.balloonNear) { d.balloonNear = true; log(d, 'PARADE', 'Parade balloon ahead: backing off and holding until it has passed.'); if (levelRank(d.level) < levelRank('L1')) setLevel(d, 'L1', 'Parade balloon nearby'); }
        return;
      }
      if (d.balloonNear) { d.balloonNear = false; if (d.level === 'L1') setLevel(d, 'L0', 'Clear of the balloon'); }
    }
    if (d.yieldFor && ['return', 'land', 'leave'].includes(d.phase)) { d.yieldFor = null; d.held = false; }      // leaving the area is always allowed
    if (d.held && !d.heldBy && !d.yieldFor) d.held = false;                                   // safety net: a hold always has an owner (an event or a yield)
    if (d.yieldFor) {                                     // yielding: wait until the other drone has gone by (or finished at the pad), at most 45 s
      const g = droneOf(d.yieldFor), gone = !g.order || ['idle', 'land', 'leave', 'return'].includes(g.phase);
      const clear = gone || (hyp(d, g) > 3.6 && hyp(aheadOf(d, 2.5), g) > 3.6 && hyp(aheadOf(d, 2.5), aheadOf(g, 2.5)) > 3.6);
      if (!clear && S.t < d.yieldCap) { if (!FLIGHT.has(d.phase) && d.target && d.y - SLAB > HOVER + 1) holdAt(d, d.target, dt); return; }   // at a pad: clear the column for the other drone
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
        if (followPath(d, dt)) {
          d.speedK = 1;
          if (d.leg === 'toShop') { d.phase = 'pickup'; d.pickStep = 'down'; d.timer = 0; d.shopArrive = S.t + (++S.seq) * 1e-6; log(d, 'ARRIVE_SHOP', `Arrived at ${T.name}: collecting the order.`); return; }
          if (o.car && o.carUntil === Infinity) o.carUntil = S.t + o.carStay;   // the car leaves some time after the drone gets there
          d.phase = 'locate'; d.timer = 0; log(d, 'LOCATE', isKnown(o) ? `Recognised ${o.addr.name} from memory.` : `Searching for ${o.addr.name}…`);
        }
        return;
      }
      case 'pickup': {                                          // at the shop: hover over its pad, wait until the order is ready, lift off with it
        if (d.pickStep === 'down') {
          const rank = shopQueueRank(d);
          if (rank > 0) { holdAt(d, T, dt); return; }   // waiting in line on the holding ring around the shop
          if (backOver(d, T, dt) && goTo(d, T, ground + HOVER, dt)) { d.pickStep = 'wait'; d.timer = 0; } return;
        }
        if (d.pickStep === 'wait') { d.timer += dt; if (d.timer >= o.prepS + 1) { d.carrying = true; d.pickStep = 'up'; log(d, 'PICKUP', `Order #${o.id} collected at ${T.name}.`); } return; }
        if (goTo(d, T, ground + CRUISE, dt)) {
          d.leg = 'toCustomer'; d.hover = 0; d.pickStep = null; d.target = { x: o.addr.x, z: o.addr.z, name: o.addr.name, original: true };
          d.know = { ox: o.addr.x - GRID / 2, oz: o.addr.z - GRID / 2, state: new Uint8Array(GRID * GRID), seen: new Float32Array(GRID * GRID).fill(-99) };
          planLeg(d, { x: o.addr.x, y: CRUISE, z: o.addr.z }); d.phase = 'enter'; log(d, 'DELIVERING', `Flying to ${o.addr.name}.`);
        }
        return;
      }
      case 'locate': {
        if (columnBusy(d)) holdAt(d, T, dt); else backOver(d, T, dt);   // look from the ring while the pad is busy
        d.timer += dt; o.locateS = (o.locateS ?? 0) + dt;
        if (d.timer >= (isKnown(o) ? 1 : 4)) { if (o.needConfirm && !d.confirmed) { d.phase = 'confirm'; d.confirmStart = S.t; log(d, 'ASK_CUSTOMER', 'Asked the customer to confirm the drop spot.'); } else d.phase = 'descend'; }
        return;
      }
      case 'confirm': {
        if (columnBusy(d)) holdAt(d, T, dt); else backOver(d, T, dt);
        if (custReplies(o) && S.t - d.confirmStart >= o.replyDelay && !d.event) { d.confirmed = true; d.phase = 'descend'; log(d, 'CONFIRMED', 'Customer confirmed the spot.'); return; }
        if (!custReplies(o) && S.t - d.confirmStart >= 8 && !d.event) openEvent(d, 'silent');
        if (S.t - d.confirmStart >= SILENT_GIVE_UP && !d.confirmed && d.event?.type === 'silent') {   // nobody answered for 5 min: the customer is not coming
          const ev = d.event; ev.resolvedBy = 'timeout'; o.noRetry = true; o.reason = 'customer unreachable';
          abort(d, 'The customer did not answer for 5 minutes.'); ev.status = 'timeout'; return;
        }
        return;
      }
      case 'descend': { if (columnBusy(d) && d.y - SLAB > HOVER + 1) { holdAt(d, T, dt); return; }   // another drone is working that pad: wait on the holding ring, not on top of it
        // only a yard right on the parade route (≤ 20 m) gets a burst of its own
        if (!d.confettiDone && o.tries === 0 && paradeDistance(o.addr) < 4 && o.confettiRoll < 0.5) { d.confettiDone = true; const dur = Math.min(18, o.confettiDur); clouds.push({ id: `Cd${++dynClouds}`, t0: S.t, t1: S.t + dur, x: o.addr.x, z: o.addr.z, r: 3.5, top: 5, dynamic: true }); log(d, 'EVENT', 'Parade confetti drifts over the yard.'); }
        const cl = cloudOver(d, d.y - SLAB); if (cl && d.y - SLAB < cl.top && hyp(d, cl) < cl.r - 0.5 && !d.event) { openEvent(d, 'occluded', { cloud: cl.id }); return; } if (backOver(d, T, dt) && goTo(d, T, ground + HOVER, dt)) { d.phase = 'scan'; d.timer = 0; } return; }
      case 'shift': { if (goTo(d, T, ground + HOVER, dt, 1.2)) { d.phase = 'scan'; d.timer = 0; log(d, 'SCAN', 'Scanning the backup spot.'); } return; }
      case 'climb': { if (goTo(d, T, ground + 7.2, dt) && !inCloud(d) && d.event?.status !== 'open') { if (d.event?.type === 'occluded') closeEvent(d.event, 'self'); d.phase = 'descend'; log(d, 'RESCAN', 'Cloud gone: descending to rescan.'); } return; }
      case 'scan': {
        d.timer += dt;
        const cl = cloudOver(d, d.y - SLAB);
        if (cl && sensorRadius(d) < 1 && !d.event) { openEvent(d, 'occluded', { cloud: cl.id }); return; }
        if (d.timer >= (isKnown(o) ? 1 : 2.5)) {
          if (parcelAt(T, o) && !T.beside) {                 // an earlier parcel is still lying there: put this one next to it
            const spot = [[0.7, 0], [-0.7, 0], [0, -0.7], [0.5, -0.5], [-0.5, -0.5]].map(([dx, dz]) => ({ x: T.x + dx, z: T.z + dz })).find((q) => !parcelAt(q, o) && !lowNear(q.x, q.z, 0.35));
            if (spot) { d.target = { ...T, x: spot.x, z: spot.z, beside: true }; log(d, 'ADAPT', 'An earlier parcel is still on the pad: dropping this one next to it.'); d.phase = 'descend'; return; }
          }
          d.phase = 'verify';
        }
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
          if (v.ok && !d.event) { d.phase = 'lower'; setLevel(d, T.backup ? 'L3' : 'L0', 'Spot clear again: lowering.'); log(d, 'VERIFY_OK', 'Spot clear again: lowering.'); d.waitT = 0; }
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
        if (d.timer > 1) { d.parcelAt = { x: T.x, z: T.z }; o.dropAt = d.parcelAt; finishOrder(d, T.backup ? 'delivered-alt' : 'delivered'); d.phase = 'reelup'; }
        return;
      }
      case 'reelup': { d.drop = Math.max(0, d.drop - REEL * dt * 1.5); if (d.drop <= 0) d.phase = 'leave'; return; }
      case 'leave': {
        const close = nearestBird(d); if (close < 2.4) { d.speedK = 0; if (!d.event) openEvent(d, 'pigeon'); return; } d.speedK = close < 5 ? 0.35 : 1;
        if (!d.path?.length && !d.goal?.hub) planLeg(d, { x: d.home.x, y: HOLD_Y, z: d.home.z, hub: true });
        if (followPath(d, dt)) { d.speedK = 1; d.phase = 'land'; d.goal = null; } return;
      }
      case 'return': {
        d.drop = Math.max(0, d.drop - REEL * dt * 1.5); if (d.drop > 0) return;
        const close = nearestBird(d); d.speedK = close < 2.4 ? 0 : close < 5 ? 0.35 : 1;
        if (!d.goal?.hub) planLeg(d, { x: d.home.x, y: HOLD_Y, z: d.home.z, hub: true });
        if (followPath(d, dt)) { d.speedK = 1; d.phase = 'land'; d.goal = null; }
        return;
      }
      case 'land': {                                            // arrivals one at a time: hover above the own slot until the landing lock is free
        if (!d.landing) { if (S.t < S.landLock) return; d.landing = true; S.landLock = S.t + LAND_GAP; }
        if (goTo(d, d.home, ground, dt)) {
          d.landing = false;
          d.phase = 'idle'; d.readyAt = S.t + 2; d.battery = 100; d.route = []; d.parcelAt = null; d.delivered = false;
          const o2 = d.order;
          if (d.abortedOrder && o2 && o2.status === 'active') { o2.tries++; o2.status = o2.tries < MAX_TRIES && !o2.noRetry ? 'queued' : 'aborted'; if (o2.status === 'aborted') { o2.outcome = 'aborted'; o2.tDone = S.t; S.completed++; } }
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
      const retarget = () => { const w = wants(); p.goal = w.length && Rped() < 0.7 ? w[Math.floor(Rped() * w.length)].order.addr : pickAddr(Rped, (x) => 0.4 + x.ctx.paradeNear + 0.6 * x.ctx.tallShare); p.look = 8 + Rped() * 8; p.path = null; };
      if (p.wait > 0) { p.wait -= dt; p.phase += dt * 0.5; continue; }
      p.look = (p.look ?? 10) - dt; if (p.look <= 0 && !p.inLot) retarget();      // changes of mind happen on the street, not inside a yard
      if (!p.path) p.path = walkPath(p, p.goal);
      const q = p.path[0];
      if (!q) { p.wait = 2 + Rped() * 3; p.inLot = true; retarget(); continue; }   // arrived at the pad: stand for a moment, then walk off
      const dx = q.x - p.x, dz = q.z - p.z, L = Math.hypot(dx, dz), s = p.speed * dt;
      if (L <= s) { p.x = q.x; p.z = q.z; p.path.shift(); } else { p.x += dx / L * s; p.z += dz / L * s; }
      if (L > 1e-4) p.heading = Math.atan2(dx, dz);
      p.inLot = p.path.length <= 1 && Math.hypot(p.x - p.goal.x, p.z - p.goal.z) < 3.5; p.phase += dt * 6;
    }
    for (const g of dogs) {
      if (g.state === 'roam') {
        const y = dogYard(g.home); g.x = y.x + Math.sin(S.t * 0.4 + g.k) * 0.6; g.z = y.z + 0.4 + Math.cos(S.t * 0.3 + g.k) * 0.4;
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
      if (sameShop(a, b)) continue;                                                                   // drones bound for the same shop are staggered by level and queue at the pad: not an event
      if (a.yieldFor === b.id || b.yieldFor === a.id) continue;                      // one of them is already yielding to the other
      const dy = Math.abs(a.y - b.y), pa = aheadOf(a, 2.5), pb = aheadOf(b, 2.5);
      const flightNear = dy < 1.3 && (hyp(a, b) < 2.4 || hyp(pa, pb) < 2.4);
      const padOverlap = (atPad(a) || atPad(b)) && hyp(a.target, b.target) < 2.6 && hyp(a, b) < 3.2 && dy < 6;
      if (!flightNear && !padOverlap) continue;
      pairCool.set(key, S.t + 6);
      const y = lowerPriority(a, b), g = y === a ? b : a;                              // the rule: urgent first, then the lower ID; the other yields
      if (y.event) { y.held = true; y.yieldFor = g.id; y.yieldCap = S.t + 45; g.climbOver = true; g.needPlan = true; log(y, 'YIELD', `${y.id} yields to ${g.id} (priority rule; it is already handling another event).`); continue; }   // no second event on a busy drone
      const ev = openEvent(y, 'conflict', { with: g.id, withUrgent: !!g.order?.urgent, kind2: padOverlap ? 'descent overlap' : 'path overlap' });
      if (ev) g.conflictEvent = ev;
    }
  }
  /** last line of defence, independent of events and of the operator: two airborne drones never get closer than ~7 m */
  /** last line of defence, independent of events and of the operator: two airborne drones keep at least 10 m apart horizontally
   *  or 8 m vertically. The drone that is closing in stops (both closing: the lower priority one); two hovering drones that ended up
   *  too close drift apart; a drone that has been stopped for 4 s re-plans its leg 15 m higher and passes over. */
  const SEP_H = 2.0, SEP_V = 1.6, HARD_Q = 0.8;   // keep 10 m / 8 m; never closer than 8 m horizontally and 6.4 m vertically at the same time
  const sepQ = (p, r) => Math.max(Math.hypot(p.x - r.x, p.z - r.z) / SEP_H, Math.abs(p.y - r.y) / SEP_V);
  const airborne = (d) => d.order && !['idle', 'land'].includes(d.phase) && d.y - SLAB > 0.6;
  /** true if the move from (px,py,pz) to the drone's new position brought it closer than the separation to another airborne drone */
  function sepViolates(d, px, py, pz) {
    if (!airborne(d) || (d.x === px && d.y === py && d.z === pz)) return false;
    const before = { x: px, y: py, z: pz };
    for (const e of S.drones) { if (e === d || !airborne(e)) continue; const q1 = sepQ(d, e); if (q1 < HARD_Q && q1 < sepQ(before, e) - 1e-9) return true; }
    return false;
  }
  function separationGuard(dt) {
    const live = S.drones.filter((d) => d.order && !['idle', 'land'].includes(d.phase) && d.y - SLAB > 0.6);
    const stopped = new Set();
    const stop = (d) => { d.sepStop = S.t + 0.35; stopped.add(d); };
    const moving = (d) => Math.hypot(d.vx ?? 0, d.vz ?? 0, d.vy ?? 0) > 0.1;
    function sidestep(y, g, dt) {                          // the lower priority one moves out of the way (sideways, or up if there is no room)
      const L = hyp(y, g), ux = L > 1e-3 ? (y.x - g.x) / L : Math.cos(y.idx), uz = L > 1e-3 ? (y.z - g.z) / L : Math.sin(y.idx);
      const nx = y.x + ux * 1.2 * dt, nz = y.z + uz * 1.2 * dt;
      if (!obstacles.some((o) => nx > o.x0 - 0.5 && nx < o.x1 + 0.5 && nz > o.z0 - 0.5 && nz < o.z1 + 0.5 && y.y - SLAB < o.h + 0.5) && y.y - SLAB >= lowNeed(y.x, y.z, nx, nz)) { y.x = nx; y.z = nz; }
      else y.y += VZ * dt;
      if (y.goal && FLIGHT.has(y.phase)) y.needPlan = true;
    }
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      // separation measure: < 1 means closer than 10 m horizontally AND 8 m vertically
      const q = (p, r) => Math.max(Math.hypot(p.x - r.x, p.z - r.z) / SEP_H, Math.abs(p.y - r.y) / SEP_V);
      const pa = { x: a.x + (a.vx ?? 0), y: a.y + (a.vy ?? 0), z: a.z + (a.vz ?? 0) }, pb = { x: b.x + (b.vx ?? 0), y: b.y + (b.vy ?? 0), z: b.z + (b.vz ?? 0) };   // where each will be in 1 s at its velocity
      const q0 = q(a, b); if (Math.min(q0, q(pa, pb), q(pa, b), q(a, pb)) >= 1) continue;
      const k = 0.2, sa = { x: a.x + (a.vx ?? 0) * k, y: a.y + (a.vy ?? 0) * k, z: a.z + (a.vz ?? 0) * k }, sb = { x: b.x + (b.vx ?? 0) * k, y: b.y + (b.vy ?? 0) * k, z: b.z + (b.vz ?? 0) * k };
      const closeA = q(sa, b) < q0 - 1e-4, closeB = q(a, sb) < q0 - 1e-4, y = lowerPriority(a, b), g = y === a ? b : a;   // closing in = the gap shrinks right now
      if (closeA && closeB) { stop(a); stop(b); sidestep(y, g, dt); continue; }              // head-on: both stop, the lower priority one steps aside
      if (closeA || closeB) { stop(closeA ? a : b); continue; }                          // the one closing in stops
      if (q0 < 1) { if (moving(y)) stop(y); else if (!moving(g)) sidestep(y, g, dt); }   // too close side by side: let the other pull away; both still: step aside
    }
    for (const d of S.drones) {
      if (stopped.has(d)) { d.sepT = (d.sepT ?? 0) + dt; if (d.sepT > 4 && d.goal && FLIGHT.has(d.phase) && !d.climbOver) { d.climbOver = true; d.needPlan = true; d.sepT = 0; log(d, 'SEPARATION', 'Blocked by another drone: re-planning 15 m higher.'); } }
      else d.sepT = Math.max(0, (d.sepT ?? 0) - dt * 0.5);
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
      if (!d.event && gu && gu.v >= 9 && S.t >= (d.gustIgnore ?? 0) && d.y - SLAB > 1.5) {   // airborne only: a drone still on its slot is not pushed anywhere
        for (const o of obstacles) {
          const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2, dx = cx - d.x, dz = cz - d.z, L = Math.hypot(dx, dz) || 1;
          const gap = Math.max(o.x0 - d.x, 0, d.x - o.x1) + Math.max(o.z0 - d.z, 0, d.z - o.z1);
          if (gap < 3 && o.h >= 8 && o.h + SLAB > d.y - 0.5 && (dx / L * Math.cos(gu.ang) + dz / L * Math.sin(gu.ang)) > 0.3) { openEvent(d, 'gust', { gust: gu.t0 }); break; }
        }
      }
    }
    // pedestrians / dogs reaching the descent zone while a parcel is down are handled by the drone state machine; track closest approach
    for (const ev of S.events) {
      if (ev.tier !== 1 || !['open', 'acknowledged', 'auto'].includes(ev.status)) continue;
      const d = droneOf(ev.drone); let m = Infinity; const me = { x: d.x, y: d.y - d.drop, z: d.z };
      if (ev.type === 'conflict') m = dist3(d, droneOf(ev.with)) * SCALE_M;
      else if (ev.type === 'ped' || ev.type === 'dog') for (const a of [...peds, ...dogs]) if (hyp(a, d) < 4) { const pp = { x: a.x, y: SLAB + 0.4, z: a.z }; m = Math.min(m, dist3(pp, d) * SCALE_M); if (d.drop > 0.05) m = Math.min(m, dist3(pp, me) * SCALE_M); }
      if (Number.isFinite(m)) ev.closestM = ev.closestM == null ? +m.toFixed(1) : Math.min(ev.closestM, +m.toFixed(1));
    }
  }
  function selfClose() {
    const gu = active(gusts, S.t);
    for (const ev of S.events) {
      if (!['open', 'acknowledged', 'auto'].includes(ev.status)) continue;
      const d = droneOf(ev.drone); let clear = false;
      switch (ev.type) {
        case 'ped': case 'dog': { const T = d.target; clear = !T || ![...peds, ...dogs].some((a) => hyp(a, T) <= (a.kind === 'dog' ? DOG_ZONE : PED_ZONE) + 0.8); break; }
        case 'pigeon': clear = nearestBird(d) > 5.5; break;
        case 'occluded': { const c = clouds.find((x) => x.id === ev.cloud); clear = !c || S.t >= c.t1; break; }
        case 'gust': clear = !gu || gu.t0 !== ev.gust; break;
        case 'nofly': { const z = zones.find((x) => x.id === ev.zone); clear = !z || S.t >= z.t1; break; }
        case 'silent': clear = d.confirmed; break;
        case 'car': clear = !!d.target?.backup || S.t >= d.order.carUntil; break;
        case 'conflict': { const o = droneOf(ev.with); clear = d.yieldFor !== o.id && o.yieldFor !== d.id && S.t - ev.opened > 2; break; }   // only this pair's yield matters, not another one further down the line
      }
      ev.clearNow = clear;
      if (ev.status === 'open') continue;                                   // ② / ③: stays on hold until the operator decides
      if (clear) {
        closeEvent(ev, 'self');
        if (ev.type === 'occluded' && d.phase === 'climb') { d.phase = 'descend'; }
        if ((ev.type === 'ped' || ev.type === 'dog') && d.phase === 'wait') d.timer = 1;
      }
    }
  }
  // the operator's list: critical events the drones are handling (for information / override) first, then everything on hold,
  // by tier, then the one that has been waiting longest
  const queueList = () => S.events.filter((e) => e.status === 'open' || e.status === 'auto').sort((a, b) => a.tier - b.tier || (a.status === 'auto') - (b.status === 'auto') || a.opened - b.opened);
  const onHold = () => S.events.filter((e) => e.status === 'open');

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
  const shiftS = (P.shiftMin ?? SHIFT_DEFAULT) * 60;      // 0 = no shift end (the world runs for ever)
  // what each drone is doing, one letter per second, for the shift report:
  // i idle · f flying · p at the shop · w working at the drop spot · h on hold for the operator · a handling a critical event · r going home
  const stateLetter = (d) => d.phase === 'idle' ? 'i' : d.event?.status === 'open' ? 'h' : d.event?.status === 'auto' ? 'a' : ['return', 'leave', 'land'].includes(d.phase) ? 'r' : d.phase === 'pickup' ? 'p' : FLIGHT.has(d.phase) ? 'f' : 'w';
  function step(dt) {
    if (S.done) return;
    if (shiftS > 0 && S.t >= shiftS - 1e-9) { S.done = true; S.endedBy = 'shift'; return; }
    S.t += dt;
    if (Math.floor(S.t) > (S.ganttT ?? -1)) { S.ganttT = Math.floor(S.t); S.gantt ??= S.drones.map(() => ''); S.drones.forEach((d, i) => { S.gantt[i] += stateLetter(d); }); }
    if (S.t - (S.trackT ?? -9) >= 2) { S.trackT = S.t; S.tracks ??= S.drones.map(() => []); S.drones.forEach((d, i) => { if (d.phase !== 'idle') S.tracks[i].push([+d.x.toFixed(1), +d.z.toFixed(1)]); else if (S.tracks[i].at(-1) !== null) S.tracks[i].push(null); }); }   // where every drone flew, for the report map
    S0.t = S.t; extendSchedules(S.t + 90); arrivals();
    updateAgents(dt);
    conflictScan();
    separationGuard(dt);
    detectors();
    selfClose();
    for (const d of S.drones) {
      const px = d.x, pz = d.z, py = d.y;
      stepDrone(d, dt);
      if (sepViolates(d, px, py, pz)) { d.x = px; d.y = py; d.z = pz; d.sepT = (d.sepT ?? 0) + dt; }   // hard rule: a move may never bring two drones closer than the separation
      // velocity (its intention): a drone held by the separation guard keeps its last heading for a moment, so it is not let go
      // just to creep closer one step at a time
      if (Math.hypot(d.x - px, d.z - pz) > 1e-4) { d.vx = (d.x - px) / dt; d.vz = (d.z - pz) / dt; d.vT = S.t; } else if (S.t - (d.vT ?? -9) > 1.5 || !d.order) { d.vx = 0; d.vz = 0; }
      if (Math.abs(d.y - py) > 1e-4) { d.vy = (d.y - py) / dt; d.vyT = S.t; } else if (S.t - (d.vyT ?? -9) > 1.5 || !d.order) d.vy = 0;
      if (d.order && d.phase !== 'idle') sense(d, dt);
      if (d.order && S.t - (d.lastSeries ?? -9) >= 0.5) {
        d.lastSeries = S.t; const p = parcelPos(d), dm = Math.hypot(p.x - d.order.addr.x, p.y - SLAB, p.z - d.order.addr.z) * SCALE_M; d.distanceM = dm;
        d.series.push([+(S.t - d.order.tAssigned).toFixed(1), +dm.toFixed(1)]); if (d.series.length > 400) d.series.shift();
      }
    }
    const held = onHold().length; S.queuePeak = Math.max(S.queuePeak, held); S.holdS = (S.holdS ?? 0) + held * dt;
    if (S.t - (S.lastSample ?? -9) >= 5) { S.lastSample = S.t; S.series.push([+S.t.toFixed(0), held]); }
  }
  function run(seconds, dt = 0.1) { for (let t = 0; t < seconds; t += dt) step(dt); return S; }

  // ---------------------------------------------------------------- scorecard
  function scorecard() {
    const ev = S.events, mean = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null);
    const fin = orders.filter((x) => x.outcome), n = Math.max(1, fin.length), by = (o) => fin.filter((x) => x.outcome === o).length;
    const aborted = by('aborted'), minutes = Math.max(1 / 6, S.t / 60);
    const t1 = ev.filter((e) => e.tier === 1), closest = t1.map((e) => e.closestM).filter((x) => x != null);
    // ② / ③ events: how long the drone stood on hold before the operator answered (still open = counted up to now)
    const held = ev.filter((e) => e.tier > 1), waitOf = (e) => (e.resolvedAt ?? (e.status === 'open' ? S.t : e.closedAt ?? S.t)) - e.opened;
    const wait = (t) => mean(held.filter((e) => e.tier === t).map(waitOf));
    const weighted = held.reduce((x, e) => x + waitOf(e) * (e.tier === 2 ? 2 : 1), 0);
    const dels = orders.filter((o) => o.outcome && o.outcome !== 'aborted' && o.tDone != null && o.tAssigned != null).map((o) => o.tDone - o.tAssigned);
    return {
      time: +S.t.toFixed(0), orders: fin.length, received: orders.length, unfinished: orders.length - fin.length, unreachable: fin.filter((x) => x.reason === 'customer unreachable').length,
      deliveredN: by('delivered'), deliveredAltN: by('delivered-alt'), abortedN: aborted, conflicts: ev.filter((e) => e.type === 'conflict').length, endedBy: S.endedBy, shiftS,
      wait: { 2: wait(2), 3: wait(3) }, longestWaitS: held.length ? +Math.max(...held.map(waitOf)).toFixed(0) : null, onHoldNow: onHold().length, unanswered: held.filter((e) => e.status === 'open').length,
      holdSharePct: +((S.holdS ?? 0) / (N_DRONES * Math.max(1, S.t)) * 100).toFixed(1),
      autoHandled: t1.length, overrides: t1.filter((e) => e.resolvedBy === 'operator' && !['wait', 'rule'].includes(e.option)).length,
      delivered: +(by('delivered') / n * 100).toFixed(0), deliveredAlt: +(by('delivered-alt') / n * 100).toFixed(0), aborted: +(aborted / n * 100).toFixed(0), redelivered: orders.filter((o) => o.redelivered).length,
      closestTier1M: closest.length ? Math.min(...closest) : null, eventsTotal: ev.length, tier1: t1.length, eventsPerMin: +(ev.length / minutes).toFixed(1), peakQueue: S.queuePeak, avgDeliveryS: mean(dels),
      avgLocateS: mean(fin.filter((x) => x.locateS != null).map((x) => x.locateS)), byType: Object.fromEntries(EVENT_TYPES.map((t) => [t, ev.filter((e) => e.type === t).length])),
      score: Math.max(0, Math.round(100 - Math.min(60, weighted / minutes * 0.12) - 0.5 * aborted / n * 100)),
    };
  }

  return {
    state: S, shiftS, step, run, resolve, command, available, checks: (id) => { const d = droneOf(id); return d?.order ? checks(d).list : []; }, queue: queueList, onHold, scorecard, backupOf: (o) => backupOf(o), parcelPos, droneOf, flockBirds, activeGust: () => active(gusts, S.t), activeZones: () => zones.filter((z) => S.t >= z.t0 && S.t < z.t1), activeCloud: () => active(clouds, S.t),
    knowledgeCells(id) { const d = droneOf(id), K = d?.know; if (!K) return []; const out = []; for (let k = 0; k < GRID * GRID; k++) out.push({ x0: K.ox + (k % GRID), z0: K.oz + Math.floor(k / GRID), state: K.state[k], age: S.t - K.seen[k] }); return out; },
    balloon: (t) => balloonAt(t, true),
    debugOpen(id, type) { return openEvent(droneOf(id), type); },
  };
}

export const WORLD_CONST = { V, VZ, LOWER, REEL, HOVER_BUDGET, TIME_CAP, N_DRONES, GRID, PED_ZONE, SLAB, HOVER };
