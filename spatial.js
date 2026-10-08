/* ====================================================================
   Spatial layer for the drone simulation (synthetic, classroom use only).

   Coordinate conventions
   - LOCAL (robot / report) frame, metres:  x = east, y = north, z = up.
     z is measured above one simulated ground datum (z = 0 is street/lot level).
   - SCENE frame (drawing), world units:    x = east, z = south (so y_local = -z_scene),
     altitude above the datum is stored as `.y` of drone positions (scene height = SLAB + y).
   - 1 scene unit = SCALE_M metres, horizontally and vertically.
   Every number below (clearance, ceilings, speeds, thresholds) is an
   ILLUSTRATIVE simulation parameter — not a legal or safe flight limit.
   ==================================================================== */

export const SCALE_M = 5;
export const cfg = {
  clearanceM: 6,        // simulated clearance margin around every obstacle
  maxAltM: 120,         // simulated maximum altitude (global cap)
  cruiseM: 50,          // nominal cruise altitude
  tallM: 60,            // buildings above this count as "tall" in human descriptions
  arriveM: 80,          // remaining-route distance that triggers the "approaching" message
  senseU: 6,            // look-ahead range (scene units) used for the pre-move conflict test
  preference: 'shortest', // 'shortest' | 'climb' | 'detour'
};
export const world = {
  bounds: 58,           // permitted airspace extends to ±bounds (scene units)
  obstacles: [],        // {id,name,typo,x0,x1,z0,z1,h}  (h in scene units above datum)
  restricted: [],       // {id,name,x0,x1,z0,z1,zloM,zhiM,active}
  zones: [],            // neighbourhood volumes {name,kind:'neighborhood',x0,x1,z0,z1,ceilingM}
  ewStreets: [],        // {name,z}
  nsStreets: [],        // {name,x}
  landmarks: [],        // {name,x,z}
  version: 0,
};
const cache = new Map();
export function bump() { world.version++; cache.clear(); }

const u = (m) => m / SCALE_M;
export const toLocal = (p) => ({ x: p.x * SCALE_M, y: -p.z * SCALE_M, z: p.y * SCALE_M });
export const fromLocal = (l) => ({ x: l.x / SCALE_M, y: l.z / SCALE_M, z: -l.y / SCALE_M });
export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const OUTSIDE = { name: 'Outside modelled airspace', ceilingM: 0 };

// ---------- zones ------------------------------------------------------
export function zoneAt(x, z) {
  return world.zones.find((q) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) ?? OUTSIDE;
}
const ceilingU = (x, z) => u(Math.min(cfg.maxAltM, zoneAt(x, z).ceilingM));
/** zones addressable by name in getAgentsAt */
export function namedZones() {
  return [
    ...world.zones.map((q) => ({ ...q, zloM: 0, zhiM: q.ceilingM })),
    ...world.restricted.map((r) => ({ ...r, kind: 'restricted' })),
  ];
}

// ---------- geometry ---------------------------------------------------
function segHitsBox(a, b, x0, x1, y0, y1, z0, z1) {
  let t0 = 0, t1 = 1;
  const d = [b.x - a.x, b.y - a.y, b.z - a.z], lo = [x0, y0, z0], hi = [x1, y1, z1], p = [a.x, a.y, a.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (p[i] < lo[i] || p[i] > hi[i]) return false; }
    else {
      let ta = (lo[i] - p[i]) / d[i], tb = (hi[i] - p[i]) / d[i];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/**
 * Tests a straight segment against the simulated airspace rules:
 * map edge, building volumes (+clearance), restricted volumes (+clearance), altitude ceiling.
 * Returns null when free, otherwise {reason, id?, name, hM?, marginOnly?}.
 */
export function segCheck(a, b, extra = 0) {
  const c = u(cfg.clearanceM) + extra, B = world.bounds;
  if (Math.abs(a.x) > B || Math.abs(a.z) > B || Math.abs(b.x) > B || Math.abs(b.z) > B)
    return { reason: 'bounds', name: 'the edge of the modelled airspace' };
  for (const o of world.obstacles) {
    if (segHitsBox(a, b, o.x0 - c, o.x1 + c, -1, o.h + c, o.z0 - c, o.z1 + c)) {
      const raw = segHitsBox(a, b, o.x0, o.x1, -1, o.h, o.z0, o.z1);
      return { reason: 'building', id: o.id, name: o.name, hM: o.h * SCALE_M, marginOnly: !raw, obstacle: o };
    }
  }
  for (const r of world.restricted) {
    if (!r.active) continue;
    if (segHitsBox(a, b, r.x0 - c, r.x1 + c, u(r.zloM) - c, u(r.zhiM) + c, r.z0 - c, r.z1 + c)) {
      const raw = segHitsBox(a, b, r.x0, r.x1, u(r.zloM), u(r.zhiM), r.z0, r.z1);
      return { reason: 'restricted', id: r.id, name: r.name, marginOnly: !raw, obstacle: r };
    }
  }
  const len = dist3(a, b), n = Math.max(1, Math.ceil(len / 1.5));
  for (let i = 0; i <= n; i++) {
    const k = i / n, x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, z = a.z + (b.z - a.z) * k;
    if (y > ceilingU(x, z) + 1e-6) return { reason: 'ceiling', name: 'the permitted altitude ceiling' };
  }
  return null;
}

// ---------- route planning --------------------------------------------
const CELL = 2, EPS = 0.003, VERT_W = 1.5;
const gridN = () => Math.floor((2 * world.bounds) / CELL) + 1;
const cellCentre = (i) => -world.bounds + i * CELL;
const cellOf = (v) => Math.max(0, Math.min(gridN() - 1, Math.round((v + world.bounds) / CELL)));

function blockedGrid(L) {
  const key = `${world.version}:${L.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);
  const N = gridN(), g = new Uint8Array(N * N), c = u(cfg.clearanceM), m = 0.7;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = cellCentre(i), z = cellCentre(j);
    let blk = Math.abs(x) > world.bounds - 1 || Math.abs(z) > world.bounds - 1 || ceilingU(x, z) < L;
    if (!blk) for (const o of world.obstacles) {
      if (L <= o.h + c && x >= o.x0 - c - m && x <= o.x1 + c + m && z >= o.z0 - c - m && z <= o.z1 + c + m) { blk = true; break; }
    }
    if (!blk) for (const r of world.restricted) {
      if (r.active && L >= u(r.zloM) - c && L <= u(r.zhiM) + c && x >= r.x0 - c - m && x <= r.x1 + c + m && z >= r.z0 - c - m && z <= r.z1 + c + m) { blk = true; break; }
    }
    g[i * N + j] = blk ? 1 : 0;
  }
  cache.set(key, g);
  return g;
}

function aStar(L, s, e) {
  const N = gridN(), g = blockedGrid(L);
  const si = cellOf(s.x), sj = cellOf(s.z), ei = cellOf(e.x), ej = cellOf(e.z);
  const idx = (i, j) => i * N + j, goal = idx(ei, ej);
  const open = [], gS = new Float32Array(N * N).fill(Infinity), from = new Int32Array(N * N).fill(-1), closed = new Uint8Array(N * N);
  const h = (i, j) => Math.hypot(i - ei, j - ej) * CELL;
  const push = (f, k) => { open.push([f, k]); let c = open.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (open[p][0] <= open[c][0]) break; [open[p], open[c]] = [open[c], open[p]]; c = p; } };
  const pop = () => {
    const top = open[0], last = open.pop();
    if (open.length) { open[0] = last; let c = 0; for (;;) { let l = 2 * c + 1, r = l + 1, m = c; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === c) break; [open[m], open[c]] = [open[c], open[m]]; c = m; } }
    return top;
  };
  const free = (i, j) => i >= 0 && j >= 0 && i < N && j < N && (!g[idx(i, j)] || idx(i, j) === goal || (i === si && j === sj));
  gS[idx(si, sj)] = 0; push(h(si, sj), idx(si, sj));
  while (open.length) {
    const [, k] = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === goal) break;
    const ci = Math.floor(k / N), cj = k % N;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (!free(ni, nj)) continue;
      if (di && dj && (!free(ci + di, cj) || !free(ci, cj + dj))) continue; // no corner cutting
      const nk = idx(ni, nj), ng = gS[k] + Math.hypot(di, dj) * CELL;
      if (ng < gS[nk]) { gS[nk] = ng; from[nk] = k; push(ng + h(ni, nj), nk); }
    }
  }
  if (from[goal] < 0 && goal !== idx(si, sj)) return null;
  const cells = []; for (let k = goal; k >= 0; k = from[k]) { cells.push(k); if (k === idx(si, sj)) break; }
  cells.reverse();
  const pts = cells.map((k) => ({ x: cellCentre(Math.floor(k / N)), z: cellCentre(k % N) }));
  pts[0] = { x: s.x, z: s.z }; pts[pts.length - 1] = { x: e.x, z: e.z };
  return pts;
}

/** horizontal path at altitude L from s to e: straight if free, otherwise A* + line-of-sight smoothing */
function planePath(L, s, e) {
  const P = (q) => ({ x: q.x, y: L, z: q.z });
  if (!segCheck(P(s), P(e), EPS)) return [s, e];
  const raw = aStar(L, s, e);
  if (!raw) return null;
  const out = [raw[0]]; let i = 0;
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    while (j > i + 1 && segCheck(P(raw[i]), P(raw[j]), EPS)) j--;
    if (segCheck(P(raw[i]), P(raw[j]), EPS)) return null;
    out.push(raw[j]); i = j;
  }
  return out;
}

const pathLen3 = (a, pts) => { let t = 0, p = a; for (const q of pts) { t += dist3(p, q); p = q; } return t; };
const pathCost = (a, pts) => { let t = 0, p = a; for (const q of pts) { t += Math.hypot(q.x - p.x, q.z - p.z) + VERT_W * Math.abs(q.y - p.y); p = q; } return t; };
export const routeLength = pathLen3;

function describeFail(info) {
  if (!info) return 'no valid route within the modelled airspace';
  if (info.reason === 'restricted') return `${info.name} blocks every permitted route`;
  if (info.reason === 'building') return `${info.name} (${Math.round(info.hM)} m) blocks every permitted route`;
  return `${info.name} limits every route`;
}

/** Nominal route: climb to cruise altitude, fly straight, descend. Not checked against obstacles. */
export function nominalRoute(from, to) {
  const L = Math.min(u(cfg.cruiseM), u(cfg.maxAltM));
  const pts = [];
  if (Math.abs(from.y - L) > 0.05) pts.push({ x: from.x, y: L, z: from.z, phase: from.y < 0.3 ? 'takeoff' : 'cruise' });
  pts.push({ x: to.x, y: L, z: to.z, phase: 'cruise' }, { x: to.x, y: to.y, z: to.z, phase: 'land' });
  return pts;
}

/**
 * Plans a route that climbs and/or detours as needed, honouring the clearance margin,
 * restricted volumes and altitude ceilings. Returns {ok,pts,len,level,climbed,detoured} or {ok:false,reason}.
 */
export function planRoute(from, to) {
  const ceilU = u(cfg.maxAltM), base = Math.min(u(cfg.cruiseM), ceilU);
  const levels = new Set([+base.toFixed(3)]);
  for (let L = base + 2; L <= ceilU + 1e-6; L += 2) levels.add(+L.toFixed(3));
  if (from.y > 1) levels.add(+from.y.toFixed(3));
  const cands = []; let lastFail = null;
  const RANK = { restricted: 4, building: 3, ceiling: 2, bounds: 1 };
  const note = (f) => { if (!lastFail || (RANK[f.reason] ?? 0) > (RANK[lastFail.reason] ?? 0)) lastFail = f; };
  for (const L of [...levels].sort((a, b) => a - b)) {
    const p0 = { x: from.x, y: L, z: from.z }, pe = { x: to.x, y: L, z: to.z };
    const up = Math.abs(from.y - L) > 0.05 ? segCheck(from, p0, EPS) : null;
    if (up) { note(up); continue; }
    const down = segCheck(pe, to, EPS);
    if (down) { note(down); continue; }
    const plane = planePath(L, { x: from.x, z: from.z }, { x: to.x, z: to.z });
    if (!plane) { note({ reason: 'building', name: 'the surrounding buildings' }); continue; }
    const pts = [];
    if (Math.abs(from.y - L) > 0.05) pts.push({ x: from.x, y: L, z: from.z, phase: from.y < 0.3 ? 'takeoff' : 'cruise' });
    for (let i = 1; i < plane.length; i++) pts.push({ x: plane[i].x, y: L, z: plane[i].z, phase: 'cruise' });
    pts.push({ x: to.x, y: to.y, z: to.z, phase: 'land' });
    if (!pts.length) continue;
    cands.push({ L, pts, len: pathLen3(from, pts), cost: pathCost(from, pts), detoured: plane.length > 2, climbed: L > base + 0.05, over: L > base + 0.05 && plane.length <= 2 });
  }
  if (!cands.length) return { ok: false, reason: describeFail(lastFail), info: lastFail };
  const byCost = (a, b) => a.cost - b.cost;
  let pool = cands;
  if (cfg.preference === 'climb') pool = cands.filter((c) => c.over).length ? cands.filter((c) => c.over) : cands;
  if (cfg.preference === 'detour') pool = cands.filter((c) => !c.climbed).length ? cands.filter((c) => !c.climbed) : cands;
  const best = [...pool].sort(byCost)[0];
  return { ok: true, pts: best.pts, len: best.len, level: best.L, climbed: best.climbed, detoured: best.detoured };
}

// ---------- state-derived spatial facts ---------------------------------
const boxDist = (p, x0, x1, y0, y1, z0, z1) => Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(y0 - p.y, 0, p.y - y1), Math.max(z0 - p.z, 0, p.z - z1));
/** nearest building or active restricted volume (distance to the raw volume, scene units) */
export function nearestObstacle(p) {
  let best = { id: null, name: '—', d: Infinity, kind: 'none' };
  for (const o of world.obstacles) {
    const d = boxDist(p, o.x0, o.x1, 0, o.h, o.z0, o.z1);
    if (d < best.d) best = { id: o.id, name: o.name, d, kind: 'building' };
  }
  for (const r of world.restricted) {
    if (!r.active) continue;
    const d = boxDist(p, r.x0, r.x1, u(r.zloM), u(r.zhiM), r.z0, r.z1);
    if (d < best.d) best = { id: r.id, name: r.name, d, kind: 'restricted' };
  }
  return best;
}
/** buildings whose footprint lies within a horizontal radius of p */
export function buildingsNear(p, radiusU) {
  return world.obstacles.filter((o) => Math.hypot(Math.max(o.x0 - p.x, 0, p.x - o.x1), Math.max(o.z0 - p.z, 0, p.z - o.z1)) <= radiusU);
}
export function streetsCrossed(a, b) {
  const out = [];
  for (const s of world.ewStreets) if ((a.z - s.z) * (b.z - s.z) < 0) out.push(s.name);
  for (const s of world.nsStreets) if ((a.x - s.x) * (b.x - s.x) < 0) out.push(s.name);
  return out;
}
export function nearestLandmark(p) {
  let best = { name: '—', d: Infinity };
  for (const l of world.landmarks) { const d = Math.hypot(l.x - p.x, l.z - p.z); if (d < best.d) best = { name: l.name, d }; }
  for (const s of world.ewStreets) { const d = Math.abs(p.z - s.z); if (d < best.d) best = { name: s.name, d }; }
  for (const s of world.nsStreets) { const d = Math.abs(p.x - s.x); if (d < best.d) best = { name: s.name, d }; }
  return { name: best.name, distM: best.d * SCALE_M };
}
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** compass bearing (degrees clockwise from north) of the local vector (east, north) */
export const bearingDeg = (east, north) => (((Math.atan2(east, north) * 180) / Math.PI) + 360) % 360;
export const compassWord = (deg) => COMPASS[Math.round(deg / 45) % 8];

// ---------- bidirectional query: location -> agents -----------------------
/**
 * getAgentsAt(drones, location) — location is one of
 *   {zone, z_min?, z_max?}                 named zone + optional altitude band (m)
 *   {box:{x:[a,b], y:[a,b], z:[a,b]}}      3D volume in local metres
 *   {point:[x,y,z], radius}                declared-radius proximity (m), no exact equality
 * Always computed from the drones' current live positions.
 */
export function agentsAt(drones, loc) {
  const ids = [];
  const zone = loc.zone ? namedZones().find((q) => q.name === loc.zone) : null;
  for (const d of drones) {
    const l = toLocal(d.pos);
    let hit = false;
    if (zone) {
      const inside = d.pos.x >= zone.x0 && d.pos.x <= zone.x1 && d.pos.z >= zone.z0 && d.pos.z <= zone.z1;
      const lo = loc.z_min ?? zone.zloM, hi = loc.z_max ?? zone.zhiM;
      hit = inside && l.z >= lo - 1e-6 && l.z <= hi + 1e-6;
    } else if (loc.box) {
      const { x, y, z } = loc.box;
      hit = l.x >= x[0] && l.x <= x[1] && l.y >= y[0] && l.y <= y[1] && l.z >= z[0] && l.z <= z[1];
    } else if (loc.point) {
      hit = Math.hypot(l.x - loc.point[0], l.y - loc.point[1], l.z - loc.point[2]) <= (loc.radius ?? 25);
    }
    if (hit) ids.push(d.id);
  }
  return ids;
}
