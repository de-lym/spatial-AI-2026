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
  w: { len: 1, climb: 0.5, lu: 1 },   // route objective weights (classroom assumptions)
  sepM: 30,             // simulated minimum drone-to-drone separation (m)
  lookS: 6,             // look-ahead horizon (s) for predicted closest approach
};
/**
 * Land-use policy table. These are deliberate SIMULATION policies, not legal rules: every number is adjustable and the
 * airspace and route costs are regenerated from them. minAltM = floor of the permitted volume above a block of that use;
 * risk (0–10) is the soft cost accumulated per metre flown over it.
 */
export const LAND = {
  housing:   { label: 'Housing', short: 'residential', minAltM: 45, risk: 6, ground: 0xdfc3ad, policy: 'Conditional: low-altitude restriction; the higher corridor carries a privacy / noise cost' },
  cbd:       { label: 'CBD / Office', short: 'office', minAltM: 20, risk: 4, ground: 0xbcc5d0, policy: 'Conditional: collision-free altitude and passage required; moderate congestion cost' },
  park:      { label: 'Green Space / Park', short: 'park', minAltM: 20, risk: 3, ground: 0xaec3a1, policy: 'Conditional: modest wildlife / public-activity penalty' },
  logistics: { label: 'Logistics / Commercial', short: 'commercial', minAltM: 20, risk: 1, ground: 0xe6d3a3, policy: 'Preferred: launch / landing and corridor connection, low modelled cost' },
  sensitive: { label: 'Sensitive Facility', short: 'sensitive-facility', minAltM: 20, risk: 8, ground: 0xe8bdb3, policy: 'Restricted volume over the designated block up to a configurable altitude' },
};
export const world = {
  bounds: 58,           // permitted airspace extends to ±bounds (scene units)
  obstacles: [],        // {id,name,typo,x0,x1,z0,z1,h}  (h in scene units above datum)
  restricted: [],       // RESTRICTED prisms {id,name,kind:'restricted'|'hazard',x0,x1,z0,z1,zloM,zhiM,active}
  zones: [],            // named districts {name,x0,x1,z0,z1,ceilingM} — labels only
  tiles: [],            // 7×7 land-use tiles (16 × 16 units: the parcel plus half of each surrounding street) {id,i,j,landUse,risk,x0,x1,z0,z1,loM,hiM}
  volumes: [],          // PERMITTED airspace prisms {id,name,kind:'deck'|'corridor'|'transition',x0,x1,z0,z1,zloM,zhiM}
  ewStreets: [],        // {name,z}
  nsStreets: [],        // {name,x}
  landmarks: [],        // {name,x,z}
  version: 0,
};
const cache = new Map();
export function bump() { world.version++; cache.clear(); }
/** land-use tile under a plan position (positions outside the grid clamp to the nearest edge tile) */
export function tileAt(x, z) {
  const i = Math.max(-3, Math.min(3, Math.round(x / 16))), j = Math.max(-3, Math.min(3, Math.round(z / 16)));
  return world.tiles[(i + 3) * 7 + (j + 3)];
}

const u = (m) => m / SCALE_M;
export const toLocal = (p) => ({ x: p.x * SCALE_M, y: -p.z * SCALE_M, z: p.y * SCALE_M });
export const fromLocal = (l) => ({ x: l.x / SCALE_M, y: l.z / SCALE_M, z: -l.y / SCALE_M });
export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const OUTSIDE = { name: 'Outside the modelled districts', ceilingM: 0 };

// ---------- districts + airspace volumes -----------------------------------
export function zoneAt(x, z) {
  return world.zones.find((q) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) ?? OUTSIDE;
}
const E = 1e-6;
const within = (v, x, y, z, hiM) => x >= v.x0 - E && x <= v.x1 + E && z >= v.z0 - E && z <= v.z1 + E && y >= u(v.zloM) - E && y <= u(hiM) + E;
/** navigable test: inside at least one permitted prism (altitude capped by the global maximum) — closed intervals, so touching prisms connect */
export function inPermitted(x, y, z) {
  for (const v of world.volumes) if (within(v, x, y, z, v.kind === 'transition' ? v.zhiM : Math.min(v.zhiM, cfg.maxAltM))) return true;
  return false;
}
/** highest permitted altitude (m) over a plan position */
export function ceilingMAt(x, z) {
  let m = 0;
  for (const v of world.volumes) if (x >= v.x0 && x <= v.x1 && z >= v.z0 && z <= v.z1) m = Math.max(m, Math.min(v.zhiM, cfg.maxAltM));
  return m;
}
/** every labelled volume — permitted and restricted — addressable by id */
export function namedVolumes() {
  return [
    ...world.volumes.map((v) => ({ ...v, permission: 'permitted', active: true })),
    ...world.restricted.map((r) => ({ ...r, permission: 'restricted' })),
  ];
}
/** declared (uncapped) volumes that contain a scene point p = {x, y(altitude), z} */
export const volumesAt = (p) => namedVolumes().filter((v) => v.active && within(v, p.x, p.y, p.z, v.zhiM));
/** parcel block name ("Block C3": column A–G west→east, row 1–7 north→south) */
export function blockAt(x, z) {
  const i = Math.max(-3, Math.min(3, Math.round(x / 16))), j = Math.max(-3, Math.min(3, Math.round(z / 16)));
  return { name: `Block ${'ABCDEFG'[i + 3]}${j + 4}`, inside: Math.abs(x - i * 16) <= 6.2 && Math.abs(z - j * 16) <= 6.2 };
}
/** the highest building roof directly beneath/at the plan position (within `pad` units of its footprint) */
export function roofUnder(p, pad = 0) {
  let best = null;
  for (const o of world.obstacles) if (p.x >= o.x0 - pad && p.x <= o.x1 + pad && p.z >= o.z0 - pad && p.z <= o.z1 + pad && (!best || o.h > best.h)) best = o;
  return best;
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

/** parameter interval [t0, t1] ⊂ [0, 1] over which segment a→b lies inside a closed box, or null */
function segInterval(a, b, x0, x1, y0, y1, z0, z1) {
  let t0 = 0, t1 = 1;
  const d = [b.x - a.x, b.y - a.y, b.z - a.z], lo = [x0, y0, z0], hi = [x1, y1, z1], p = [a.x, a.y, a.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (p[i] < lo[i] - E || p[i] > hi[i] + E) return null; }
    else {
      let ta = (lo[i] - E - p[i]) / d[i], tb = (hi[i] + E - p[i]) / d[i];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
  }
  return [t0, t1];
}
/** exact test: the whole segment lies inside the UNION of the permitted prisms (no point sampling, so a clipped corner cannot slip between samples) */
function coveredByPermitted(a, b) {
  const iv = [];
  for (const v of world.volumes) {
    const r = segInterval(a, b, v.x0, v.x1, u(v.zloM), u(v.kind === 'transition' ? v.zhiM : Math.min(v.zhiM, cfg.maxAltM)), v.z0, v.z1);
    if (r) iv.push(r);
  }
  iv.sort((p, q) => p[0] - q[0]);
  let reach = 0;
  for (const [t0, t1] of iv) {
    if (t0 > reach + 1e-6) return false;
    reach = Math.max(reach, t1);
    if (reach >= 1 - 1e-9) return true;
  }
  return reach >= 1 - 1e-9;
}
/**
 * Tests a straight segment against the simulated airspace rules:
 * map edge, building volumes (+clearance), restricted volumes (+clearance), and membership in the permitted volumes.
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
  if (!coveredByPermitted(a, b)) return { reason: 'airspace', name: 'airspace outside the permitted volumes' };
  return null;
}

// ---------- route planning --------------------------------------------
const CELL = 2, EPS = 0.003, VERT_W = 1.5, R_MAX = 3;
const gridN = () => Math.floor((2 * world.bounds) / CELL) + 1;
const cellCentre = (i) => -world.bounds + i * CELL;
const cellOf = (v) => Math.max(0, Math.min(gridN() - 1, Math.round((v + world.bounds) / CELL)));

function blockedGrid(L) {
  const key = `${world.version}:${L.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);
  const N = gridN(), g = new Uint8Array(N * N), c = u(cfg.clearanceM), m = 0.7;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = cellCentre(i), z = cellCentre(j);
    let blk = Math.abs(x) > world.bounds - 1 || Math.abs(z) > world.bounds - 1 || !inPermitted(x, L, z);
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
/** same grid with extra circular "virtual obstacles" (used only to force a topologically different candidate) */
function gridWith(L, disks) {
  const g = blockedGrid(L);
  if (!disks.length) return g;
  const N = gridN(), h = g.slice();
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = cellCentre(i), z = cellCentre(j);
    if (disks.some((d) => Math.hypot(x - d.x, z - d.z) < d.r)) h[i * N + j] = 1;
  }
  return h;
}

function riskGrid() {
  const key = `risk:${world.version}`;
  if (cache.has(key)) return cache.get(key);
  const N = gridN(), g = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) g[i * N + j] = (tileAt(cellCentre(i), cellCentre(j))?.risk ?? 0) / 10;
  cache.set(key, g);
  return g;
}
function aStar(L, s, e, disks, lu = 0) {
  const N = gridN(), g = gridWith(L, disks), rg = lu > 0 ? riskGrid() : null;
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
      const nk = idx(ni, nj), ng = gS[k] + Math.hypot(di, dj) * CELL * (rg ? 1 + lu * rg[nk] : 1);
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

const segDist2 = (a, b, c) => { // distance from point c to segment ab (plan view)
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / l2));
  return Math.hypot(a.x + dx * t - c.x, a.z + dz * t - c.z);
};
const segCost = (a, b, lu) => { // length × (1 + lu·risk), sampled along a plan-view segment
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / 0.5));
  let c = 0;
  for (let k = 0; k < n; k++) { const f = (k + 0.5) / n, t = tileAt(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f); c += (d / n) * (1 + lu * (t?.risk ?? 0) / 10); }
  return c;
};
/**
 * horizontal path at altitude L from s to e. lu = 0: straight if free, otherwise A* + line-of-sight shortening.
 * lu > 0: the same, but A* edges are weighted by land-use risk and a shortcut is only taken if it is not costlier.
 * `disks` are virtual obstacles used to force a topologically different candidate.
 */
function planePath(L, s, e, disks = [], lu = 0) {
  const P = (q) => ({ x: q.x, y: L, z: q.z });
  const clear = (a, b) => !segCheck(P(a), P(b), EPS) && disks.every((d) => segDist2(a, b, d) >= d.r * 0.9);
  const direct = clear(s, e) ? [s, e] : null;
  if (direct && lu === 0) return direct;
  const raw = aStar(L, s, e, disks, lu);
  if (!raw) return direct;
  const out = [raw[0]]; let i = 0;
  const rawCost = (i0, j0) => { let c = 0; for (let k = i0; k < j0; k++) c += segCost(raw[k], raw[k + 1], lu); return c; };
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    while (j > i + 1 && (!clear(raw[i], raw[j]) || (lu > 0 && segCost(raw[i], raw[j], lu) > rawCost(i, j) * 1.02 + 1e-6))) j--;
    if (!clear(raw[i], raw[j])) return direct;
    out.push(raw[j]); i = j;
  }
  if (direct && lu > 0 && segCost(s, e, lu) <= planCostOf(out, lu)) return direct;
  return out;
}
const planCostOf = (p, lu) => { let c = 0; for (let k = 1; k < p.length; k++) c += segCost(p[k - 1], p[k], lu); return c; };
const planLen = (p) => { let t = 0; for (let i = 1; i < p.length; i++) t += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z); return t; };
function planAt(p, f) { // plan-view point at fraction f of the path length
  let want = planLen(p) * f;
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
    if (want <= d || i === p.length - 1) { const k = d ? want / d : 0; return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * k, z: p[i - 1].z + (p[i].z - p[i - 1].z) * k }; }
    want -= d;
  }
  return p[0];
}
/** two plan paths are "distinct" if they separate by more than `tol` units somewhere along their length */
function distinct(p, q, tol = 1.8) {
  for (let k = 1; k < 10; k++) {
    const a = planAt(p, k / 10), b = planAt(q, k / 10);
    if (Math.hypot(a.x - b.x, a.z - b.z) > tol) return true;
  }
  return false;
}
/** signed deviation (scene units) of the path's furthest point from the straight line s→e; > 0 = left of the direction of travel */
function sideOf(p, s, e) {
  let best = 0;
  for (let k = 1; k < 10; k++) {
    const m = planAt(p, k / 10), cr = -(e.x - s.x) * (m.z - s.z) + (e.z - s.z) * (m.x - s.x);
    const d = cr / Math.max(1e-6, Math.hypot(e.x - s.x, e.z - s.z));
    if (Math.abs(d) > Math.abs(best)) best = d;
  }
  return best;
}

const pathLen3 = (a, pts) => { let t = 0, p = a; for (const q of pts) { t += dist3(p, q); p = q; } return t; };
const pathCost = (a, pts) => { let t = 0, p = a; for (const q of pts) { t += Math.hypot(q.x - p.x, q.z - p.z) + VERT_W * Math.abs(q.y - p.y); p = q; } return t; };
const climbOf = (a, pts) => { let t = 0, p = a; for (const q of pts) { t += Math.max(0, q.y - p.y); p = q; } return t; };
export const routeLength = pathLen3;

function describeFail(info) {
  if (!info) return 'no valid route within the modelled airspace';
  if (info.reason === 'restricted') return `${info.name} blocks every permitted route`;
  if (info.reason === 'building') return `${info.name} (${Math.round(info.hM)} m) blocks every permitted route`;
  return `${info.name} limits every route`;
}

/**
 * Rounds the corners of a validated polyline with quadratic Bézier arcs. Each arc is re-tested with segCheck
 * (permitted volumes, buildings, restricted volumes, clearance); when it fails its radius is halved, down to a sharp corner.
 * Returns the dense point list (without the start) with leg phases attached.
 */
function smoothRoute(from, wps) {
  const V = [{ x: from.x, y: from.y, z: from.z }, ...wps], n = V.length;
  const raw = () => wps.map((w) => ({ ...w }));
  if (n < 3) return raw();
  const unit = (a, b) => { const d = dist3(a, b) || 1; return { x: (b.x - a.x) / d, y: (b.y - a.y) / d, z: (b.z - a.z) / d }; };
  const arc = (i, r) => {
    const ui = unit(V[i - 1], V[i]), uo = unit(V[i], V[i + 1]), v = V[i];
    const A = { x: v.x - ui.x * r, y: v.y - ui.y * r, z: v.z - ui.z * r }, B = { x: v.x + uo.x * r, y: v.y + uo.y * r, z: v.z + uo.z * r };
    const out = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
      out.push({ x: a * A.x + b * v.x + c * B.x, y: a * A.y + b * v.y + c * B.y, z: a * A.z + b * v.z + c * B.z });
    }
    return out;
  };
  const radii = V.map((v, i) => (i === 0 || i === n - 1 ? 0 : Math.min(R_MAX, 0.45 * dist3(V[i - 1], v), 0.45 * dist3(v, V[i + 1]))));
  for (let i = 1; i < n - 1; i++) {
    let r = radii[i];
    while (r > 0.25) {
      const pts = arc(i, r);
      if (pts.every((p, k) => k === 0 || !segCheck(pts[k - 1], p, 0))) break;
      r *= 0.5;
    }
    radii[i] = r > 0.25 ? r : 0;
  }
  const out = [];
  for (let i = 1; i < n; i++) {
    if (i < n - 1 && radii[i] > 0) {
      const pts = arc(i, radii[i]);
      pts.forEach((p, k) => out.push({ ...p, phase: k === 0 ? V[i].phase : V[i + 1].phase }));
    } else out.push({ ...V[i] });
  }
  // the whole smoothed curve is re-tested, not just its waypoints
  let prev = V[0];
  for (const p of out) { if (segCheck(prev, p, 0)) return raw(); prev = p; }
  return out;
}

const mkWaypoints = (from, to, L, plane) => {
  const pts = [];
  if (Math.abs(from.y - L) > 0.05) pts.push({ x: from.x, y: L, z: from.z, phase: from.y < 0.3 ? 'takeoff' : 'cruise' });
  for (let i = 1; i < plane.length; i++) pts.push({ x: plane[i].x, y: L, z: plane[i].z, phase: 'cruise' });
  pts.push({ x: to.x, y: to.y, z: to.z, phase: 'land' });
  return pts;
};

/** metres flown per land-use class and the risk-weighted penalty (Σ metres × risk/10), accumulated along the actual curve */
export function exposureOf(from, pts) {
  const by = {}; let pen = 0, prev = from;
  for (const q of pts) {
    const d = dist3(prev, q), n = Math.max(1, Math.ceil(d / 0.5));
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n, t = tileAt(prev.x + (q.x - prev.x) * f, prev.z + (q.z - prev.z) * f), ds = (d / n) * SCALE_M;
      if (!t) continue;
      by[t.landUse] = (by[t.landUse] ?? 0) + ds; pen += (ds * t.risk) / 10;
    }
    prev = q;
  }
  return { penaltyM: pen, byClass: by };
}

export function criterionText() {
  const w = cfg.w;
  return `cost = ${w.len}·(length ÷ straight distance) + ${w.climb}·(climb ÷ 100 m) + ${w.lu}·(risk-weighted metres over land use ÷ straight distance). Congestion delay is not modelled.`;
}

/**
 * Stage 3 for one leg. Generates up to three genuinely different, fully validated routes
 * (direct / left detour / right detour / climb over), scores them with the land-use-aware objective,
 * smooths each one with collision re-testing, and selects one.
 * opts.avoid = [{loM, hiM}] cruise-altitude bands to skip (used for drone-separation re-routing).
 * Returns {ok, candidates, best, shortest, avoided, criterion} or {ok:false, reason, info}.
 */
export function planMission(from, to, opts = {}) {
  const ceilU = u(cfg.maxAltM), base = Math.min(u(opts.base ?? cfg.cruiseM), ceilU);   // opts.base: this drone's cruise lane (m)
  const levels = new Set([+base.toFixed(3)]);
  for (let L = base + 2; L <= ceilU + 1e-6; L += 2) levels.add(+L.toFixed(3));
  if (from.y > 1) levels.add(+from.y.toFixed(3));
  if (opts.only != null) { levels.clear(); levels.add(+opts.only.toFixed(3)); } // keep a given altitude band (used after a separation sidestep)
  let lastFail = null;
  const RANK = { restricted: 4, building: 3, airspace: 2, bounds: 1 };
  const note = (f) => { if (!lastFail || (RANK[f.reason] ?? 0) > (RANK[lastFail.reason] ?? 0)) lastFail = f; };
  const s2 = { x: from.x, z: from.z }, e2 = { x: to.x, z: to.z };
  const lu = cfg.w.lu / Math.max(1e-6, cfg.w.len);
  const found = []; // {L, plane}
  const add = (L, plane) => { if (plane && found.every((c) => c.L !== L || distinct(c.plane, plane))) { found.push({ L, plane }); return true; } return false; };
  let low = null;
  for (const L of [...levels].sort((a, b) => a - b)) {
    if (opts.avoid?.some((a) => L * SCALE_M >= a.loM && L * SCALE_M <= a.hiM)) continue;
    const p0 = { x: from.x, y: L, z: from.z }, pe = { x: to.x, y: L, z: to.z };
    const up = Math.abs(from.y - L) > 0.05 ? segCheck(from, p0, EPS) : null;
    if (up) { note(up); continue; }
    const down = segCheck(pe, to, EPS);
    if (down) { note(down); continue; }
    const plane = planePath(L, s2, e2);
    if (!plane) { note({ reason: 'building', name: 'the surrounding buildings' }); continue; }
    if (low === null) {
      low = L; add(L, plane);
      if (lu > 0) add(L, planePath(L, s2, e2, [], lu)); // the land-use-aware route
      // alternates at the lowest feasible altitude: block the middle of the latest path with a virtual disk and plan again
      const r = Math.max(2.5, Math.min(6, planLen(plane) * 0.18));
      for (const start of lu > 0 ? [plane, found[found.length - 1].plane] : [plane]) {
        const disks = []; let last = start;
        for (let k = 0; k < 2; k++) {
          const m = planAt(last, 0.5);
          if (Math.hypot(m.x - s2.x, m.z - s2.z) < r + 2 || Math.hypot(m.x - e2.x, m.z - e2.z) < r + 2) break;
          disks.push({ x: m.x, z: m.z, r });
          const alt = planePath(L, s2, e2, disks, lu);
          if (!alt || !add(L, alt)) break;
          last = alt;
        }
      }
    } else if (plane.length === 2 && found[0].plane.length > 2 && found.every((c) => c.L <= low + 1e-6)) {
      found.push({ L, plane }); // lowest altitude that clears the obstruction in a straight line: "climb over"
    }
  }
  if (!found.length) return { ok: false, reason: describeFail(lastFail), info: lastFail };
  const D = Math.max(1, dist3(from, to) * SCALE_M), w = cfg.w, labels = new Set();
  const shortestPlane = found[0];
  let cands = found.map((c) => {
    const wps = mkWaypoints(from, to, c.L, c.plane), pts = smoothRoute(from, wps);
    const climbed = c.L > base + 0.05, straight = c.plane.length === 2, side = sideOf(c.plane, s2, e2);
    let label = climbed && straight ? `Climb over · ${Math.round(c.L * SCALE_M)} m` : straight ? 'Direct' : side > 0 ? 'Left detour' : 'Right detour';
    if (labels.has(label)) label += ' (wide)';
    labels.add(label);
    const len = pathLen3(from, pts), climbM = climbOf(from, pts) * SCALE_M, ex = exposureOf(from, pts);
    const terms = { len: (len * SCALE_M) / D, climb: climbM / 100, lu: ex.penaltyM / D };
    return { label, level: c.L, climbed, detoured: !straight, over: climbed && straight, pts, len, lenM: len * SCALE_M, climbM, penaltyM: ex.penaltyM, exposure: ex.byClass, terms,
      cost: w.len * terms.len + w.climb * terms.climb + w.lu * terms.lu, isShortestPlane: c === shortestPlane };
  });
  const shortest = cands.find((c) => c.isShortestPlane);
  cands.sort((a, b) => a.cost - b.cost);
  // keep up to three DIFFERENT kinds of route (direct / left / right / climb over) before any second variant of the same kind
  const kind = (c) => (c.over ? 'over' : c.label.startsWith('Left') ? 'left' : c.label.startsWith('Right') ? 'right' : 'direct');
  const firstOfKind = cands.filter((c, i) => cands.findIndex((q) => kind(q) === kind(c)) === i);
  cands = [...firstOfKind, ...cands.filter((c) => !firstOfKind.includes(c))].slice(0, 3).sort((a, b) => a.cost - b.cost);
  cands.forEach((c, i) => { c.id = 'ABC'[i]; });
  let pool = cands;
  if (cfg.preference === 'climb' && cands.some((c) => c.over)) pool = cands.filter((c) => c.over);
  if (cfg.preference === 'detour' && cands.some((c) => !c.climbed)) pool = cands.filter((c) => !c.climbed);
  const best = pool[0];
  cands.forEach((c) => { c.chosen = c === best; });
  // did the planner really go around a land use? (only then may the human view say so)
  let avoided = null;
  if (shortest && best.lenM > shortest.lenM + 3) {
    let top = 0;
    for (const k of Object.keys(LAND)) {
      const red = (shortest.exposure[k] ?? 0) - (best.exposure[k] ?? 0);
      if (red > 25 && red > top) { top = red; avoided = { landUse: k, metres: Math.round(red), extraM: Math.round(best.lenM - shortest.lenM) }; }
    }
  }
  return { ok: true, from: { ...from }, to: { ...to }, candidates: cands, best, shortest: shortest ? { lenM: shortest.lenM, exposure: shortest.exposure, penaltyM: shortest.penaltyM } : null, avoided, criterion: criterionText(), D };
}

/** planner summary used by the platform's ETA estimate and by re-planning */
export function planRoute(from, to, opts) {
  const m = planMission(from, to, opts);
  if (!m.ok) return m;
  const b = m.best;
  return { ok: true, pts: b.pts, len: b.len, level: b.level, climbed: b.climbed, detoured: b.detoured, mission: m };
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
 *   "V-03" | {volume:"V-03"}               a labelled airspace volume (permitted or restricted), full XYZ test
 *   {block:"C3"}                          every drone above that land-use tile (any altitude)
 *   {zone, z_min?, z_max?}                 named district + optional altitude band (m)
 *   {box:{x:[a,b], y:[a,b], z:[a,b]}}      3D volume in local metres
 *   {point:[x,y,z], radius}                declared-radius proximity (m), no exact equality
 * Always computed from the drones' current live positions (X, Y and Z — never plan view alone).
 */
export function agentsAt(drones, location) {
  const loc = typeof location === 'string' ? { volume: location } : location;
  const ids = [];
  const vol = loc.volume ? namedVolumes().find((q) => q.id === loc.volume) : null;
  const zone = loc.zone ? world.zones.find((q) => q.name === loc.zone) : null;
  const tile = loc.block ? world.tiles.find((q) => q.id === loc.block) : null;
  for (const d of drones) {
    const l = toLocal(d.pos);
    let hit = false;
    if (vol) {
      hit = vol.active && within(vol, d.pos.x, d.pos.y, d.pos.z, vol.zhiM);
    } else if (tile) {
      hit = d.pos.x >= tile.x0 && d.pos.x <= tile.x1 && d.pos.z >= tile.z0 && d.pos.z <= tile.z1;
    } else if (zone) {
      const inside = d.pos.x >= zone.x0 && d.pos.x <= zone.x1 && d.pos.z >= zone.z0 && d.pos.z <= zone.z1;
      hit = inside && l.z >= (loc.z_min ?? 0) - 1e-6 && l.z <= (loc.z_max ?? 1e9) + 1e-6;
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
export const agentsInBox = (drones, xMin, xMax, yMin, yMax, zMin, zMax) => agentsAt(drones, { box: { x: [xMin, xMax], y: [yMin, yMax], z: [zMin, zMax] } });
