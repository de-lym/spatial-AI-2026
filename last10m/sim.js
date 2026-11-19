// Last 10m — deterministic per-scene simulation. Pure JS (no three.js), so it runs in node tests too.
// One scene = one block of the city, one (or two) delivery drones, the ground agents of that block and a scripted
// extreme event that is triggered by the drone's own state (so it always happens, always on camera).
// Units: scene units (1 u = 5 m), seconds. Ground top = SLAB.

import { SCALE_M, HUB } from './scenes.js';

export const SLAB = 0.4;
const CRUISE = 10;          // 50 m nominal cruise height
const HOVER = 1.4;          // 7 m delivery hover height (Wing-style tether delivery)
const V = 4;                // 20 m/s cruise
const VZ = 1.6;             // vertical speed
const LOWER = 0.28;         // tether pay-out, u/s (1.4 m/s)
const REEL = 0.7;           // tether reel-in, u/s
const SAFE_U = 0.4;         // 2 m: nobody may be this close to the parcel's drop column
const DETECT_U = 0.7;       // 3.5 m: a person or animal here blocks the drop
const FRESH_S = 2;          // an observation older than this does not prove the spot is clear
const RESERVE = 20;         // % battery that must remain for the way home
const N = 25, CELL = 1;     // knowledge grid around the scene centre: 25 × 25 cells of 5 m
const WAIT_DECIDE_S = 10;   // how long the drone waits on a blocked spot before it escalates

export const LEVELS = ['L0', 'L1', 'L2', 'L3', 'H', 'L4'];
export const LEVEL_TEXT = { L0: 'Normal', L1: 'Slow / adjust', L2: 'Hold / wait', L3: 'Avoid / redirect', H: 'Human decision', L4: 'Abort' };
export const levelRank = (l) => LEVELS.indexOf(l);
export const statusOf = (level, done) => (done ? 'grey' : level === 'H' || level === 'L4' ? 'red' : level === 'L2' || level === 'L3' ? 'yellow' : 'green');

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hyp = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function crossing(p, p2, q, q2) {
  const r = { x: p2.x - p.x, z: p2.z - p.z }, s = { x: q2.x - q.x, z: q2.z - q.z }, den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q.x - p.x) * s.z - (q.z - p.z) * s.x) / den, u = ((q.x - p.x) * r.z - (q.z - p.z) * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: p.x + r.x * t, z: p.z + r.z * t } : null;
}
const fmtT = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * createScene(def, params, opts)
 *  def:     an entry of SCENES
 *  params:  merged global + scene parameters
 *  opts:    { obstacles: [{x0,x1,z0,z1,h}], memory: {} (mutated: landmarks + static cells are written back) }
 */
export function createScene(def, params, { obstacles = [], memory = {} } = {}) {
  const R = rng((params.seed ?? 2026) + def.index * 1013);
  const mem = (memory[def.id] ??= { landmarks: {}, statics: [] });
  const retained = params.memory !== 'fresh';
  const S = {
    def, params, t: 0, done: false, outcome: null, level: 'L0', maxLevel: 'L0', levelReason: 'Departed', events: [], prompt: null,
    agents: [], drones: [], cloud: null, balloon: null, gust: null, metrics: { decisionTimes: [], minClearM: Infinity, hoverS: 0, series: [], intrusions: 0 },
    knowledge: { state: new Uint8Array(N * N), seen: new Float32Array(N * N).fill(-99), ox: def.center.x - N / 2, oz: def.center.z - N / 2 },
    landmarks: [], target: { ...def.target, name: def.landmarks[1] ?? 'Drop pad', original: true }, approved: false, lastChecks: [],
    hold: false,
  };
  if (!retained) { mem.landmarks = {}; mem.statics = []; }

  // ---- landmarks: named things the drone can recognise; 3 sightings make a landmark, memory keeps it between runs
  const lmPos = [def.center, def.target, def.alt ?? { x: def.center.x + 3, z: def.center.z + 2.5 }];
  S.landmarks = def.landmarks.map((name, i) => ({ name, ...lmPos[Math.min(i, 2)], count: 0, known: !!(retained && mem.landmarks[name]), fromMemory: !!(retained && mem.landmarks[name]) }));
  if (retained) for (const i of mem.statics) S.knowledge.state[i] = 2;

  // ---- static obstacles relevant to this block (city geometry + scene props)
  const near = obstacles.filter((o) => o.x1 > S.knowledge.ox - 2 && o.x0 < S.knowledge.ox + N + 2 && o.z1 > S.knowledge.oz - 2 && o.z0 < S.knowledge.oz + N + 2);
  const statics = [...near];
  const backupAvail = (params.backupSpots ?? 1) > 0 && def.kind !== 'battery';
  const backupAuthorized = def.kind === 'pet' ? !!params.backupAuthorized : true;

  // ---- events / levels
  function log(code, text, extra = {}) { S.events.push({ t: S.t, time: fmtT(S.t), code, text, level: S.level, ...extra }); if (S.events.length > 200) S.events.shift(); }
  function setLevel(level, reason) {
    if (S.level === level && S.levelReason === reason) return;
    S.level = level; S.levelReason = reason;
    if (levelRank(level) > levelRank(S.maxLevel)) S.maxLevel = level;
  }
  function ask(code, text, options, defaultId, detail) {
    S.prompt = { code, text, options, defaultId, opened: S.t, deadline: S.t + (params.autoS ?? 10), detail };
    setLevel('H', text); log(code, text, { kind: 'decision', detail });
  }

  // ---- drones
  function cruiseHeightFor(a, b) {          // plan ahead: climb over every known building on the straight leg
    let top = 0;
    for (const o of obstacles) {
      for (let k = 0; k <= 20; k++) { const x = a.x + (b.x - a.x) * k / 20, z = a.z + (b.z - a.z) * k / 20; if (x > o.x0 - 1 && x < o.x1 + 1 && z > o.z0 - 1 && z < o.z1 + 1) top = Math.max(top, o.h); }
    }
    return clamp(top + 2, CRUISE, 23);
  }
  function makeDrone(id, spawn, target, primary, delay = 0) {
    const cruise = cruiseHeightFor(spawn, target);
    const battery = def.kind === 'battery' ? (params.batteryPct ?? 80) - 45 : (params.batteryPct ?? 80);
    return { id, primary, x: spawn.x, y: SLAB + cruise, z: spawn.z, spawn: { ...spawn }, cruise, target: { ...target }, phase: delay > 0 ? 'queued' : 'enter', delay, timer: 0,
      drop: 0, speedK: 1, battery, swing: 0, waitT: 0, escalated: false, yieldFor: null, visible: delay <= 0, hover: 0, delivered: false };
  }
  function spawnFor(target) { const d = { x: HUB.x - target.x, z: HUB.z - target.z }, L = Math.hypot(d.x, d.z) || 1; const k = Math.min(26, L); return { x: target.x + d.x / L * k, z: target.z + d.z / L * k }; }
  const primary = makeDrone(def.kind === 'balloon' ? 'D-01' : `D-${def.id}`, def.spawn ?? spawnFor(def.target), def.target, true);
  S.drones.push(primary);
  if (def.second) S.drones.push(makeDrone(def.second.id, def.second.spawn, def.second.target, false, 1.2));
  log('DEPART', `${primary.id} enters the block at ${Math.round(primary.cruise * SCALE_M)} m, planned over known buildings.`);

  // ---- scene props
  if (def.kind === 'car' && params.carOnPad) { const car = { id: 'car', kind: 'car', x: def.target.x + 0.2, z: def.target.z, w: 1.3, d: 0.65, h: 0.45, static: true }; S.agents.push(car); statics.push({ x0: car.x - car.w / 2, x1: car.x + car.w / 2, z0: car.z - car.d / 2, z1: car.z + car.d / 2, h: car.h }); }
  if (def.kind === 'battery' && (params.crowdStayS ?? 120) > 0) for (let k = 0; k < 3; k++) S.agents.push({ id: `kid${k}`, kind: 'person', x: def.target.x + (k - 1) * 0.45, z: def.target.z + (k % 2 ? 0.35 : -0.25), until: params.crowdStayS ?? 120, phase: R() * 6, small: true });
  if (def.kind === 'balloon') {      // the balloon drifts across the point where the two drones' paths cross
    const a = S.drones[0], b = S.drones[1], p = crossing(a.spawn, a.target, b.spawn, b.target) ?? { x: (a.target.x + b.target.x) / 2, z: (a.target.z + b.target.z) / 2 };
    const dir = { x: 0.96, z: -0.28 }, v = (params.balloonDrift ?? 1.5) / SCALE_M;
    S.balloon = { x: p.x - dir.x * v * 6, y: SLAB + CRUISE, z: p.z - dir.z * v * 6, dir, v, r: 1.1 };
  }

  // ---- knowledge grid
  const idx = (x, z) => { const i = Math.floor(x - S.knowledge.ox), j = Math.floor(z - S.knowledge.oz); return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i; };
  const cellCenter = (k) => ({ x: S.knowledge.ox + (k % N) + 0.5, z: S.knowledge.oz + Math.floor(k / N) + 0.5 });
  const insideStatic = (p) => statics.some((o) => p.x > o.x0 && p.x < o.x1 && p.z > o.z0 && p.z < o.z1);
  function sensorRadius(d) {
    const h = d.y - SLAB;
    if (S.cloud && S.cloud.active && hyp(d, S.cloud) < S.cloud.r + 0.5 && h < S.cloud.top + 0.3) return 0.6;
    return clamp(1.8 + h * 0.32, 2, 6);
  }
  function sense(d, dt) {
    const r = sensorRadius(d), K = S.knowledge;
    for (let k = 0; k < N * N; k++) {
      const c = cellCenter(k); if (hyp(c, d) > r) continue;
      K.seen[k] = S.t;
      if (insideStatic(c)) { if (K.state[k] !== 2) { K.state[k] = 2; if (!mem.statics.includes(k)) mem.statics.push(k); } }
      else K.state[k] = 1;
    }
    for (const a of S.agents) if (a.visible !== false && hyp(a, d) <= r) { const k = idx(a.x, a.z); if (k >= 0) { K.state[k] = a.static ? 2 : 3; K.seen[k] = S.t; } }
    for (const l of S.landmarks) if (hyp(l, d) <= r + 1) { l.count += dt; if (!l.known && l.count >= 3) { l.known = true; mem.landmarks[l.name] = true; log('LANDMARK', `New landmark: ${l.name}.`); } }
  }

  // ---- verification (five checks) — reads only the drone's knowledge, never the world directly
  function checks(d) {
    const T = S.target, K = S.knowledge, k = idx(T.x, T.z);
    const around = []; for (let k2 = 0; k2 < N * N; k2++) { if (hyp(cellCenter(k2), T) <= 1.2) around.push(k2); }
    const fresh = around.every((k2) => S.t - K.seen[k2] <= FRESH_S);
    const seenAgents = S.agents.filter((a) => a.visible !== false && !a.static && hyp(a, d) <= sensorRadius(d) && hyp(a, T) <= DETECT_U);
    const tlm = S.landmarks.find((l) => l.name === T.name);
    const loc = !!(tlm ? (tlm.known || tlm.count > 0.5) : k >= 0 && K.seen[k] > 0);
    const blockedStatic = k >= 0 && K.state[k] === 2;
    const air = !(S.balloon && hyp(S.balloon, d) < 2.5) && !S.agents.some((a) => a.kind === 'bird' && a.visible !== false && Math.hypot(a.x - d.x, a.y - d.y, a.z - d.z) < 1.5);
    const authorized = T.original || (T.backup && (backupAuthorized || S.approved)) || T.chosen;
    const list = [
      { key: 'loc', label: 'Correct location', ok: loc, detail: loc ? (tlm?.fromMemory ? 'known landmark (memory)' : 'matched instruction') : 'not recognised yet' },
      { key: 'safe', label: 'Space is safe', ok: fresh && !seenAgents.length, detail: !fresh ? 'not observed recently' : seenAgents.length ? `${seenAgents[0].kind} ${Math.max(0.5, hyp(seenAgents[0], T) * SCALE_M).toFixed(1)} m from target` : 'clear, seen <2 s ago' },
      { key: 'column', label: 'Descent path clear', ok: air, detail: air ? 'tether column free' : 'object in the column' },
      { key: 'pad', label: 'Facility available', ok: !blockedStatic, detail: blockedStatic ? 'pad occupied by a static object' : 'pad free' },
      { key: 'auth', label: 'Within authorization', ok: !!authorized, detail: T.original ? 'customer’s spot' : authorized ? 'authorized backup' : 'backup needs approval' },
    ];
    S.lastChecks = list;
    return { ok: list.every((c) => c.ok), list, dynamic: seenAgents, blockedStatic, fresh };
  }

  // ---- mission helpers
  function goTo(d, p, y, dt, speed = V) {
    const dx = p.x - d.x, dz = p.z - d.z, L = Math.hypot(dx, dz), s = speed * d.speedK * dt;
    if (L > 1e-4) { const k = Math.min(1, s / L); d.x += dx * k; d.z += dz * k; }
    const dy = y - d.y; d.y += clamp(dy, -VZ * dt * 1.5, VZ * dt * 1.5);
    return L < 0.05 && Math.abs(y - d.y) < 0.05;
  }
  function switchToBackup(reason) {
    S.target = { ...def.backup, name: 'Backup spot', backup: true };
    setLevel('L3', reason); log('ADAPT', reason, { kind: 'decision', detail: { found: lastFound(), why: lastWhy(), tried: 'waited and rescanned', choice: 'switch to the authorized backup spot' } });
    primary.phase = 'shift'; primary.escalated = false; primary.waitT = 0;
  }
  function abort(reason) {
    if (primary.phase === 'return' || S.done) return;
    setLevel('L4', reason); log('ABORT', `${reason} Returning to hub; redelivery required.`, { kind: 'decision' });
    S.prompt = null; primary.phase = 'return';
  }
  const lastFound = () => { const c = S.lastChecks.find((x) => !x.ok); return c ? c.detail : 'nothing unusual'; };
  const lastWhy = () => { const c = S.lastChecks.find((x) => !x.ok); return c ? `${c.label} failed` : '—'; };

  function escalate(v) {    // the drone has waited on a blocked spot long enough: decide what to do next
    primary.escalated = true;
    if (v.blockedStatic || v.dynamic.length || !v.fresh) {
      if (backupAvail && backupAuthorized) return switchToBackup('Primary spot stays blocked: moving to the authorized backup spot.');
      if (backupAvail) return ask('ASK_BACKUP', 'Backup spot needs approval', [
        { id: 'approve', label: 'Approve backup spot', primary: true }, { id: 'wait', label: 'Keep waiting' }, { id: 'return', label: 'Return to hub' }],
      'wait', { found: lastFound(), why: lastWhy(), tried: `waited ${Math.round(primary.waitT)} s · rescanned`, proposes: 'backup spot on the same yard' });
      setLevel('L2', 'No authorized alternative: waiting within the hover budget.'); log('WAIT', 'No alternative spot: keep waiting while the hover budget lasts.');
    }
  }

  // ---- scene hooks: ground agents and environment
  function updateAgents(dt) {
    const d = primary;
    // A1 dog: appears when the parcel is lowered to `dogAtM`
    if (def.kind === 'pet') {
      let dog = S.agents.find((a) => a.kind === 'dog');
      const hAbove = HOVER - d.drop;
      if (!dog && d.phase === 'lower' && hAbove * SCALE_M <= (params.dogAtM ?? 3) && !S.dogDone) {
        dog = { id: 'dog', kind: 'dog', x: def.center.x + 4.5, z: def.center.z + 2, from: { x: def.center.x + 4.5, z: def.center.z + 2 }, to: { x: def.target.x + 0.35, z: def.target.z + 0.2 }, t0: S.t, stay: params.dogStayS ?? 40 };
        S.agents.push(dog); log('EVENT', 'A dog runs onto the lawn.');
      }
      if (dog) {
        const e = S.t - dog.t0, walk = 1;
        const p = e < walk ? e / walk : e < walk + dog.stay ? 1 : Math.max(0, 1 - (e - walk - dog.stay) / walk);
        dog.x = dog.from.x + (dog.to.x - dog.from.x) * p + (p === 1 ? Math.sin(S.t * 0.9) * 0.18 : 0);
        dog.z = dog.from.z + (dog.to.z - dog.from.z) * p + (p === 1 ? Math.cos(S.t * 0.7) * 0.12 : 0);
        dog.heading = Math.atan2(dog.to.x - dog.from.x, dog.to.z - dog.from.z) + (e > walk + dog.stay ? Math.PI : 0);
        if (e > walk * 2 + dog.stay) { S.agents.splice(S.agents.indexOf(dog), 1); S.dogDone = true; log('EVENT', 'The dog leaves the lawn.'); }
      }
    }
    // A3 people crossing the plaza: each pedestrian crosses once, one every `crossEveryS`, starting when lowering starts
    if (def.kind === 'crossing') {
      if (d.phase === 'lower' && S.crossStart == null) S.crossStart = S.t;
      const n = params.pedestrians ?? 3, every = params.crossEveryS ?? 7;
      if (S.crossStart != null) for (let k = 0; k < n; k++) {
        const id = `p${k}`, t0 = S.crossStart - 1 + k * every; let a = S.agents.find((x) => x.id === id);
        const L = 4.6, v = 0.5, e = S.t - t0;
        if (e < 0 || e > L / v) { if (a) a.visible = false; continue; }
        if (!a) { a = { id, kind: 'person', side: k % 2 ? 1 : -1 }; S.agents.push(a); }
        a.visible = true; a.x = def.target.x + a.side * (L / 2 - e * v); a.z = def.target.z + (k % 3 - 1) * 0.15; a.phase = e * 6; a.heading = a.side > 0 ? -Math.PI / 2 : Math.PI / 2;
      }
    }
    // B1 pigeons: a flock crosses the drone's path when it is `flockAtU` metres from the target
    if (def.kind === 'pigeons') {
      const out = (params.flockAtU ?? 60) / SCALE_M;
      if (!S.flock && d.phase === 'enter' && hyp(d, def.target) <= out && (params.pigeons ?? 6) > 0) {
        const hx = def.target.x - d.x, hz = def.target.z - d.z, L = Math.hypot(hx, hz) || 1, ux = hx / L, uz = hz / L;
        const cx = d.x + ux * 7, cz = d.z + uz * 7, px = -uz, pz = ux;
        S.flock = { t0: S.t, px, pz };
        for (let k = 0; k < params.pigeons; k++) S.agents.push({ id: `bird${k}`, kind: 'bird', x0: cx - px * 5 + (R() - 0.5) * 1.2, z0: cz - pz * 5 + (R() - 0.5) * 1.2, y: d.y + (R() - 0.5) * 0.8, x: 0, z: 0, flap: R() * 6 });
        log('EVENT', `A flock of ${params.pigeons} pigeons crosses ahead.`);
      }
      if (S.flock) for (const b of S.agents.filter((a) => a.kind === 'bird')) {
        const e = S.t - S.flock.t0; b.x = b.x0 + S.flock.px * e * 2.2; b.z = b.z0 + S.flock.pz * e * 2.2; b.flap += dt * 14; b.visible = e < 9;
      }
    }
    // C3 kids leave after `crowdStayS`
    if (def.kind === 'battery') for (const a of S.agents) if (a.until != null) { a.visible = S.t < a.until; a.phase += dt * 2; }
    // B2 balloon drift
    if (S.balloon) { S.balloon.x += S.balloon.dir.x * S.balloon.v * dt; S.balloon.z += S.balloon.dir.z * S.balloon.v * dt; }
    // C1 confetti cloud over the yard while the drone descends
    if (def.kind === 'confetti') {
      if (!S.cloud && (d.phase === 'descend' || d.phase === 'scan') && (params.confettiS ?? 20) > 0) { S.cloud = { x: def.target.x, z: def.target.z, r: 3, top: 3, t0: S.t, until: S.t + (params.confettiS ?? 20), active: true }; log('EVENT', 'Parade confetti drifts over the yard.'); }
      if (S.cloud && S.cloud.active && S.t > S.cloud.until) { S.cloud.active = false; log('EVENT', 'The confetti settles.'); }
    }
  }

  // ---- B2: two drones and a balloon — who yields?
  function airConflict() {
    if (!S.balloon || S.b2resolved) return;
    const [a, b] = S.drones; if (!a || !b || b.phase === 'queued') return;
    const ahead = (d, s) => { const hx = d.target.x - d.x, hz = d.target.z - d.z, L = Math.hypot(hx, hz) || 1; return { x: d.x + hx / L * Math.min(L, V * s), z: d.z + hz / L * Math.min(L, V * s) }; };
    const pa = ahead(a, 2.5), pb = ahead(b, 2.5);
    const near = hyp(pa, S.balloon) < 3 || hyp(pb, S.balloon) < 3 || hyp(pa, pb) < 3;
    if (near && !S.prompt && a.phase === 'enter' && b.phase === 'enter') {
      a.held = b.held = true;
      ask('ASK_YIELD', 'Balloon drifting between D-01 and D-03: who yields?', [
        { id: 'yield-D-03', label: 'D-03 yields (holds ~8 s)', primary: true }, { id: 'yield-D-01', label: 'D-01 yields (holds ~8 s)' }],
      'yield-D-03', { found: `balloon ${(hyp(S.balloon, a) * SCALE_M).toFixed(0)} m from D-01`, why: 'both paths cross the drifting balloon', tried: 'both drones holding', proposes: 'fixed rule: D-03 yields' });
    }
  }

  // ---- one drone, one tick
  function stepDrone(d, dt) {
    if (d.phase === 'queued') { d.delay -= dt; if (d.delay <= 0) { d.phase = 'enter'; d.visible = true; } return; }
    if (d.phase === 'done') return;
    const hovering = ['locate', 'descend', 'scan', 'verify', 'lower', 'wait', 'reel', 'shift', 'climb', 'ask', 'release'].includes(d.phase);
    d.battery -= dt * (hovering ? 0.45 : 0.3);
    if (d.primary && hovering) { d.hover += dt; S.metrics.hoverS = d.hover; }
    if (d.primary && !S.done && d.phase !== 'return' && d.phase !== 'leave') {
      if (d.battery <= RESERVE) return abort(`Battery reached the ${RESERVE}% reserve.`);
      if (d.hover > (params.hoverBudgetS ?? 75)) return abort(`Hover budget of ${params.hoverBudgetS ?? 75} s used up.`);
    }
    if ((d.primary && S.hold) || d.held) return;
    const T = d.primary ? S.target : d.target, ground = SLAB;
    switch (d.phase) {
      case 'enter': {
        if (d.yieldUntil && S.t < d.yieldUntil) return;
        if (d.primary && def.kind === 'pigeons') {     // look ahead 2 s against the flock
          const birds = S.agents.filter((a) => a.kind === 'bird' && a.visible !== false);
          const close = birds.length ? Math.min(...birds.map((b) => Math.hypot(b.x - d.x, b.y - d.y, b.z - d.z))) : 99;
          if (close < 1.6) { setLevel('L2', 'Pigeons within 8 m: holding position.'); d.speedK = 0; if (!S.birdHold) { S.birdHold = true; log('HOLD', 'Pigeons cross within 8 m: hold until they pass.', { kind: 'decision', detail: { found: `${birds.length} pigeons ahead`, why: 'closest approach under the 8 m buffer', tried: 'slowed down', proposes: 'hold, then continue' } }); } return; }
          if (close < 4) { setLevel('L1', 'Pigeons ahead: slowing down.'); d.speedK = 0.35; if (!S.birdSlow) { S.birdSlow = true; log('SLOW', 'Pigeons predicted within 20 m: slow to 7 m/s.'); } }
          else { d.speedK = 1; if (S.birdSlow) setLevel('L0', 'Pigeons passed.'); }
        }
        if (d.climbOver) d.y = Math.min(d.y + VZ * dt, SLAB + d.cruise + 3);
        if (goTo(d, T, d.climbOver ? d.y : SLAB + d.cruise, dt)) {
          d.phase = 'locate'; d.timer = 0; d.speedK = 1;
          if (d.primary) { const known = S.landmarks.find((l) => l.name === S.target.name)?.known; S.locateNeeds = known ? 1 : 4; log('LOCATE', known ? `Recognised ${S.target.name} from memory.` : `Searching for ${S.target.name}…`); }
          else S.locateNeeds = S.locateNeeds ?? 2;
        }
        return;
      }
      case 'locate': {
        d.timer += dt;
        if (d.timer >= (d.primary ? S.locateNeeds : 1.5)) {
          if (d.primary && def.kind === 'ambiguous' && !S.target.chosen && !S.c2asked) {
            S.c2asked = true;
            ask('ASK_LAWN', 'Two lawns match “in front of my garage”', [
              { id: 'lawn-east', label: 'East lawn', primary: true }, { id: 'lawn-west', label: 'West lawn' }, { id: 'wait', label: 'Wait for customer' }],
            'wait', { found: 'two lawns in front of two garages', why: 'instruction is ambiguous', tried: 'messaged the customer', proposes: 'wait for the customer’s reply' });
            S.c2open = S.t; d.phase = 'wait'; d.waitT = 0; return;
          }
          d.phase = 'descend';
        }
        return;
      }
      case 'climb': { if (goTo(d, T, ground + 6.5, dt)) { if (!S.cloud?.active) { d.phase = 'descend'; log('RESCAN', 'Confetti gone: descending to rescan.'); setLevel('L0', 'Rescanning'); } } return; }
      case 'shift': { if (goTo(d, T, ground + HOVER, dt, 1.2)) { d.phase = 'scan'; d.timer = 0; log('SCAN', 'Scanning the backup spot.'); } return; }
      case 'descend': { if (goTo(d, T, ground + HOVER, dt)) { d.phase = 'scan'; d.timer = 0; } return; }
      case 'scan': {
        d.timer += dt;
        if (d.primary && S.cloud?.active && sensorRadius(d) < 1) {
          setLevel('L2', 'Sensor occluded by confetti: climbing above it.');
          log('OCCLUDED', 'Sensor sees under 3 m. Memory can locate the pad but cannot prove it is clear.', { kind: 'decision', detail: { found: 'sensor range under 3 m', why: 'cannot observe the drop zone', tried: 'landmark memory (location only)', proposes: 'climb above the confetti and rescan' } });
          d.phase = 'climb'; return;
        }
        const need = d.primary ? (retained && S.landmarks[1]?.fromMemory ? 1 : 2.5) : 1;
        if (d.timer >= need) d.phase = 'verify';
        return;
      }
      case 'verify': {
        if (!d.primary) { d.phase = 'lower'; return; }
        const v = checks(d);
        if (v.ok) { setLevel(S.target.original ? 'L0' : 'L3', 'Verified: lowering the parcel.'); log('VERIFY_OK', `All five checks pass at ${S.target.name}: lowering.`); d.phase = 'lower'; d.waitT = 0; return; }
        const failed = v.list.filter((c) => !c.ok).map((c) => c.label.toLowerCase()).join(', ');
        log('VERIFY_FAIL', `Verify failed: ${failed}.`, { kind: 'decision', detail: { found: lastFound(), why: lastWhy() } });
        if (v.blockedStatic && !d.escalated) { escalate(v); if (d.phase === 'verify') d.phase = 'wait'; return; }
        setLevel('L2', `Waiting: ${lastFound()}.`); d.phase = 'wait'; return;
      }
      case 'wait': {
        d.waitT += dt; d.timer += dt;
        if (d.primary && def.kind === 'ambiguous' && !S.target.chosen) {
          const reply = params.replyS ?? 0;
          if (reply > 0 && S.t - S.c2open >= reply) { if (S.prompt) { S.metrics.decisionTimes.push(S.t - S.prompt.opened); S.prompt = null; } chooseLawn('east', 'Customer replied: east lawn.'); }
          return;
        }
        if (d.primary && def.kind === 'crossing' && S.metrics.intrusions >= 2 && !d.escalated && backupAvail) { d.escalated = true; switchToBackup('Plaza too busy (2 interruptions): moving to the backup spot.'); return; }
        if (d.timer >= 1) {      // re-verify once a second
          d.timer = 0;
          const v = checks(d);
          if (v.ok) { d.phase = 'lower'; setLevel(S.target.original ? 'L0' : 'L3', 'Spot clear again: lowering.'); log('VERIFY_OK', 'Spot clear again: lowering.'); d.waitT = 0; return; }
          if (!d.escalated && !S.prompt && d.waitT >= (v.blockedStatic ? 0 : WAIT_DECIDE_S)) escalate(v);
        }
        return;
      }
      case 'lower': {
        if (d.primary) {
          const intr = S.agents.find((a) => a.visible !== false && !a.static && a.kind !== 'bird' && hyp(a, S.target) <= DETECT_U);
          if (intr) {
            S.metrics.intrusions++;
            const clear = hyp(intr, S.target) * SCALE_M; S.metrics.minClearM = Math.min(S.metrics.minClearM, clear);
            setLevel('L2', `${intr.kind === 'dog' ? 'Dog' : 'Person'} entered the drop zone: reeling in.`);
            log('REEL_IN', `${intr.kind === 'dog' ? 'Dog' : 'Person'} ${clear.toFixed(1)} m from the parcel: stop and reel in.`, { kind: 'decision', detail: { found: `${intr.kind} ${clear.toFixed(1)} m from the drop`, why: 'space not safe', tried: '—', proposes: 'reel in and wait until clear' } });
            d.phase = 'reel'; return;
          }
          if (def.kind === 'gust' && !S.gust && d.drop >= HOVER * 0.5) {
            const peak = params.gustMs ?? 13, sustained = params.windMs ?? 6;
            S.gust = { t0: S.t, until: S.t + (params.gustS ?? 9), swingM: Math.max(0, (peak - 6) * 0.12) };
            log('EVENT', `Gust of ${peak} m/s: tether swings ${S.gust.swingM.toFixed(1)} m.`);
            if (sustained >= 12) return abort(`Sustained wind ${sustained} m/s is above the 12 m/s limit.`);
            if (S.gust.swingM > 0.5) { setLevel('L2', 'Gust: tether swinging, paused and shortened.'); log('PAUSE', 'Swing above 0.5 m: pause lowering, reel up to shorten the tether.', { kind: 'decision', detail: { found: `tether swing ${S.gust.swingM.toFixed(1)} m`, why: 'parcel could hit the house or a person', tried: '—', proposes: 'shorten tether, wait for the gust to pass' } }); d.phase = 'reel'; S.gustPause = true; return; }
          }
          if (S.gust && S.t < S.gust.until && S.gustPause) return;
        }
        d.drop = Math.min(HOVER, d.drop + LOWER * dt);
        if (d.drop >= HOVER - 1e-3) { d.phase = 'release'; d.timer = 0; }
        return;
      }
      case 'reel': {
        const keep = S.gustPause ? HOVER * 0.25 : 0;
        d.drop = Math.max(keep, d.drop - REEL * dt);
        if (d.drop <= keep + 1e-3) {
          if (S.gustPause) { if (S.t >= S.gust.until) { S.gustPause = false; setLevel('L0', 'Gust passed: lowering again.'); log('RESUME', 'Gust passed: lowering again.'); d.phase = 'lower'; } return; }
          d.phase = 'wait'; d.timer = 0;
        }
        return;
      }
      case 'release': {
        d.timer += dt;
        if (d.timer > 1) {
          d.delivered = true;
          if (d.primary) {
            S.parcelAt = { x: S.target.x, z: S.target.z };
            const off = hyp(S.target, def.target) * SCALE_M;
            log('DELIVERED', off > 1 ? `Delivered at ${S.target.name} (${off.toFixed(0)} m from the requested spot).` : 'Delivered at the requested spot.');
            S.outcome = off > 1 ? 'delivered-alt' : 'delivered'; setLevel('L0', 'Delivered.');
          }
          d.phase = 'reelup';
        }
        return;
      }
      case 'reelup': { d.drop = Math.max(0, d.drop - REEL * dt * 1.5); if (d.drop <= 0) d.phase = 'leave'; return; }
      case 'leave': { if (goTo(d, d.spawn, SLAB + d.cruise, dt)) { d.phase = 'done'; d.visible = false; maybeFinish(); } return; }
      case 'return': {
        d.drop = Math.max(0, d.drop - REEL * dt * 1.5);
        if (d.drop > 0) return;
        if (goTo(d, { x: HUB.x, z: HUB.z }, SLAB + d.cruise, dt) || hyp(d, def.target) > 30) { d.phase = 'done'; d.visible = false; if (d.primary) S.outcome = 'aborted'; maybeFinish(); }
        return;
      }
    }
  }
  function maybeFinish() { if (S.drones.every((x) => x.phase === 'done')) finish(); }
  function finish() { S.done = true; if (!S.outcome) S.outcome = 'delivered'; log('END', S.outcome === 'aborted' ? 'Mission ended: aborted, redelivery required.' : 'Mission ended: delivered.'); }
  function chooseLawn(side, text) {
    S.target = side === 'west' ? { ...def.alt, name: 'West lawn', chosen: true } : { ...def.target, name: def.landmarks[1], original: true, chosen: true };
    S.prompt = null; setLevel('L0', text); log('CHOSEN', text); primary.phase = 'shift'; primary.waitT = 0;
  }

  // ---- operator commands and prompt answers
  function command(id, auto = false) {
    const p = S.prompt;
    if (p && p.options.some((o) => o.id === id)) {
      S.metrics.decisionTimes.push(S.t - p.opened);
      S.prompt = null;
      log(auto ? 'AUTO' : 'OPERATOR', `${auto ? 'No reply in time — fixed rule: ' : 'Operator: '}${p.options.find((o) => o.id === id).label}.`, { kind: 'decision' });
      if (p.code === 'ASK_BACKUP') { if (id === 'approve') { S.approved = true; switchToBackup('Operator approved the backup spot.'); } else if (id === 'return') abort('Operator sent the drone home.'); else { setLevel('L2', 'Waiting on the primary spot.'); } }
      if (p.code === 'ASK_YIELD') {
        const [a, b] = S.drones; const yielder = id === 'yield-D-01' ? a : b, goer = yielder === a ? b : a;
        a.held = b.held = false; S.b2resolved = true; yielder.yieldUntil = S.t + 8; goer.climbOver = true;
        setLevel('L3', `${yielder.id} yields; ${goer.id} climbs over the balloon.`);
      }
      if (p.code === 'ASK_LAWN') { if (id === 'lawn-east') chooseLawn('east', 'Operator chose the east lawn.'); else if (id === 'lawn-west') chooseLawn('west', 'Operator chose the west lawn.'); else { S.c2t = S.t; setLevel('L2', 'Waiting for the customer to reply.'); } }
      return true;
    }
    switch (id) {
      case 'hold': S.hold = true; setLevel('L2', 'Held by operator.'); log('OPERATOR', 'Operator: hold position.'); return true;
      case 'resume': S.hold = false; setLevel('L0', 'Resumed by operator.'); log('OPERATOR', 'Operator: resume.'); return true;
      case 'return': S.hold = false; abort('Operator sent the drone home.'); return true;
      case 'reel': if (primary.phase === 'lower') { primary.phase = 'reel'; setLevel('L2', 'Reeled in by operator.'); log('OPERATOR', 'Operator: reel in.'); return true; } return false;
      case 'wait15': primary.hover -= 15; log('OPERATOR', 'Operator: extend the wait by 15 s.'); return true;
    }
    return false;
  }
  function available() {
    const d = primary, dyn = S.agents.some((a) => a.visible !== false && !a.static && a.kind !== 'bird' && hyp(a, S.target) <= DETECT_U);
    const active = !S.done && d.phase !== 'return';
    return [
      { id: 'hold', label: 'Hold here', enabled: active && !S.hold },
      { id: 'resume', label: 'Resume', enabled: active && S.hold },
      { id: 'reel', label: 'Reel in', enabled: active && d.phase === 'lower' },
      { id: 'wait15', label: 'Wait +15 s', enabled: active && ['wait', 'ask', 'reel'].includes(d.phase) },
      { id: 'return', label: 'Return to hub', enabled: active },
      { id: 'force', label: 'Force lower', enabled: false, reason: dyn ? 'blocked: someone within 3.5 m' : 'not offered: verification is required' },
    ];
  }

  function step(dt) {
    if (S.done) return;
    S.t += dt;
    updateAgents(dt);
    airConflict();
    if (S.prompt && S.t >= S.prompt.deadline) command(S.prompt.defaultId, true);
    for (const d of S.drones) stepDrone(d, dt);
    if (primary.visible && primary.phase !== 'done') sense(primary, dt);
    // Distance to You: parcel to the requested spot
    const parcel = parcelPos(primary);
    const dist = Math.hypot(parcel.x - def.target.x, (parcel.y - SLAB), parcel.z - def.target.z) * SCALE_M;
    S.distanceM = dist;
    if (!S.series_t || S.t - S.series_t >= 0.5) { S.series_t = S.t; S.metrics.series.push([+S.t.toFixed(1), +dist.toFixed(1)]); if (S.metrics.series.length > 600) S.metrics.series.shift(); }
    for (const a of S.agents) if (a.visible !== false && !a.static && a.kind !== 'bird' && primary.drop > 0.2) S.metrics.minClearM = Math.min(S.metrics.minClearM, Math.hypot(a.x - parcel.x, a.z - parcel.z) * SCALE_M);
  }
  function parcelPos(d) {
    if (S.parcelAt && d.delivered) return { x: S.parcelAt.x, y: SLAB, z: S.parcelAt.z };
    const swing = S.gust && S.t < S.gust.until ? Math.sin(S.t * 3.1) * (S.gust.swingM / SCALE_M) * (d.drop / HOVER) : 0;
    return { x: d.x + swing, y: d.y - 0.25 - d.drop, z: d.z + swing * 0.4 };
  }

  function run(seconds, dt = 0.1) { for (let t = 0; t < seconds && !S.done; t += dt) step(dt); return S; }

  return {
    state: S, step, run, command, available, parcelPos, checks: () => S.lastChecks,
    knowledgeCells() { const K = S.knowledge, out = []; for (let k = 0; k < N * N; k++) { const c = cellCenter(k); out.push({ x0: c.x - 0.5, z0: c.z - 0.5, state: K.state[k], age: S.t - K.seen[k] }); } return out; },
    summary() {
      return { id: def.id, outcome: S.outcome, done: S.done, t: +S.t.toFixed(1), maxLevel: S.maxLevel, level: S.level, hoverS: +S.metrics.hoverS.toFixed(1),
        decisionS: S.metrics.decisionTimes.map((x) => +x.toFixed(1)), intrusions: S.metrics.intrusions, minClearM: Number.isFinite(S.metrics.minClearM) ? +S.metrics.minClearM.toFixed(1) : null,
        battery: +primary.battery.toFixed(0), distanceM: +(S.distanceM ?? 0).toFixed(1), landmarksKnown: S.landmarks.filter((l) => l.known).map((l) => l.name) };
    },
  };
}

export const CONST = { SLAB, CRUISE, HOVER, N, CELL, SAFE_U, DETECT_U };
