// Last 10m v2 — 3D side: puts the shared world's actors (nine drones, pedestrians, dogs, pigeons, parked cars, confetti clouds,
// no-fly zones, delivered parcels) into the city scene that main.js builds, and renders the drone-camera views with the same ink pass.
import * as THREE from 'three';
import { createInkPass } from '../ink.js?v=17';
import { createPeopleKit } from '../people.js?v=11';
import { CONST } from './sim.js';

const { SLAB } = CONST;
const ISO = new THREE.Vector3(60, 52, 60).normalize();
const FACING = Math.atan2(ISO.x, ISO.z);
const RIGHT_X = Math.cos(FACING), RIGHT_Z = -Math.sin(FACING);

export function createStage({ scene, couriers, obstacles = () => [] }) {
  const kit = createPeopleKit(91);
  const root = new THREE.Group(); root.name = 'last10m'; scene.add(root);
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, ...o });
  const M = { dark: mat(0x1b1b1b), mid: mat(0x8d8d8d), light: mat(0xf2f0ec), parcel: mat(0xd9c39a) };
  const droneTemplate = couriers?.[0]?.mesh;

  function makeDrone() {
    let g;
    if (droneTemplate) {
      const saved = []; droneTemplate.traverse((o) => { saved.push([o, o.userData]); o.userData = {}; });
      try { g = droneTemplate.clone(true); } finally { saved.forEach(([o, u]) => { o.userData = u; }); }
      g.scale.setScalar(0.55); g.visible = true; g.traverse((o) => { if (o.isSprite) o.visible = false; });
    } else { g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.9), M.light); b.position.y = 0.4; g.add(b); }
    const parcel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.34), M.parcel); parcel.castShadow = true;
    const tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x141414 }));
    root.add(g, parcel, tether);
    return { g, parcel, tether };
  }
  const ring = (r0, r1, m) => { const o = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 56), m); o.rotation.x = -Math.PI / 2; o.renderOrder = 2; o.visible = false; root.add(o); return o; };
  const ringM = { target: new THREE.MeshBasicMaterial({ color: 0x141414, side: THREE.DoubleSide }), backup: new THREE.MeshBasicMaterial({ color: 0x9a9a9a, side: THREE.DoubleSide }),
    sensor: new THREE.MeshBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    zone: new THREE.MeshBasicMaterial({ color: 0x141414, side: THREE.DoubleSide }), zoneFill: new THREE.MeshBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }) };
  const target = ring(0.5, 0.62, ringM.target), backup = ring(0.42, 0.5, ringM.backup), sensorRing = ring(0.97, 1, ringM.sensor);

  let drones = null;
  const agentMeshes = new Map(), cars = new Map(), parcels = new Map(), zones = new Map(), clouds = new Map(), birds = [];

  function carMesh() {
    const g = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.25, 0.65), M.mid); body.position.y = 0.16; body.castShadow = true;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.58), M.light); cab.position.set(-0.05, 0.36, 0); g.add(body, cab); root.add(g); return g;
  }
  function birdMesh() { const m = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 4), M.dark); m.rotation.z = Math.PI / 2; root.add(m); return m; }
  function confetti() {
    const n = 300, pos = new Float32Array(n * 3), seed = []; for (let i = 0; i < n; i++) seed.push([Math.random() * 2 - 1, Math.random(), Math.random() * 2 - 1, Math.random()]);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x141414, size: 0.09 })); pts.visible = false; pts.frustumCulled = false; root.add(pts); return { pts, seed };
  }

  function sync(world, selId) {
    const S = world.state; drones ??= S.drones.map(() => makeDrone());
    S.drones.forEach((d, i) => {
      const h = drones[i];
      h.g.position.set(d.x + d.px, d.y - 0.15, d.z + d.pz);
      const tg = d.phase === 'leave' || d.phase === 'return' || d.phase === 'land' ? d.home : d.target;
      if (tg && (Math.abs(tg.x - d.x) > 0.01 || Math.abs(tg.z - d.z) > 0.01)) h.g.rotation.y = Math.atan2(tg.x - d.x, tg.z - d.z);
      const carrying = d.order && !d.delivered && !['idle', 'land'].includes(d.phase);
      const p = world.parcelPos(d);
      h.parcel.visible = !!carrying; if (carrying) h.parcel.position.set(p.x, Math.max(SLAB + 0.13, p.y), p.z);
      const tether = carrying && d.drop > 0.02; h.tether.visible = tether;
      if (tether) { const a = h.tether.geometry.attributes.position; a.setXYZ(0, d.x + d.px, d.y - 0.2, d.z + d.pz); a.setXYZ(1, p.x, p.y + 0.13, p.z); a.needsUpdate = true; h.tether.geometry.computeBoundingSphere(); }
    });
    // delivered parcels stay where they were left
    for (const o of S.orders) if (o.outcome === 'delivered' || o.outcome === 'delivered-alt') {
      if (!parcels.has(o.id)) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.34), M.parcel); m.position.set(o.addr.x + (o.outcome === 'delivered-alt' ? -3.2 : 0), SLAB + 0.13, o.addr.z); m.castShadow = true; root.add(m); parcels.set(o.id, m); }
    }
    // parked cars (only where a car is actually blocking a pad a drone is serving)
    for (const o of S.orders) { const on = o.car && S.t < o.carUntil && o.status === 'active'; let c = cars.get(o.id); if (on && !c) { c = carMesh(); c.position.set(o.addr.x + 0.2, SLAB, o.addr.z); cars.set(o.id, c); } if (c) c.visible = !!on; }
    // people and dogs
    const seen = new Set();
    for (const a of [...S.agents.peds, ...S.agents.dogs]) {
      seen.add(a.id); let m = agentMeshes.get(a.id);
      if (!m) { m = a.kind === 'dog' ? kit.figure(kit.dog, 0.55) : kit.figure(kit.walkers[(a.id.charCodeAt(a.id.length - 1) + 3) % kit.walkers.length], 0.9); agentMeshes.set(a.id, m); root.add(m); }
      m.visible = true; m.position.set(a.x, SLAB, a.z);
      if (m.userData?.set) { kit.orient(m, Math.sin(a.heading ?? 0), Math.cos(a.heading ?? 0), FACING, RIGHT_X, RIGHT_Z, false); kit.setFrame(m, (a.phase ?? S.t) * 0.9); }
    }
    // pigeons
    const bb = world.flockBirds(S.t); while (birds.length < bb.length) birds.push(birdMesh());
    birds.forEach((m, i) => { const b = bb[i]; m.visible = !!b; if (b) { m.position.set(b.x, b.y + Math.sin(b.flap) * 0.08, b.z); m.rotation.y = Math.atan2(S.flocks.find((f) => f.id === b.flock)?.dz ?? 0, S.flocks.find((f) => f.id === b.flock)?.dx ?? 1) * -1; } });
    // confetti clouds + no-fly zones
    for (const c of S.clouds) {
      const on = S.t >= c.t0 && S.t < c.t1; let v = clouds.get(c.id);
      if (!on && !v) continue; if (!v) { v = confetti(); clouds.set(c.id, v); }
      v.pts.visible = on; if (on) { const a = v.pts.geometry.attributes.position; v.seed.forEach(([sx, sy, sz, ph], i) => { const y = ((sy - (S.t * 0.25 + ph)) % 1 + 1) % 1; a.setXYZ(i, c.x + sx * c.r, SLAB + y * c.top, c.z + sz * c.r); }); a.needsUpdate = true; }
    }
    for (const z of S.zones) {
      const on = S.t >= z.t0 && S.t < z.t1; let v = zones.get(z.id);
      if (!on && !v) continue;
      if (!v) { v = { ring: ring(z.r - 0.12, z.r, ringM.zone), fill: ring(0, z.r - 0.12, ringM.zoneFill) }; v.ring.position.set(z.x, SLAB + 0.05, z.z); v.fill.position.set(z.x, SLAB + 0.04, z.z); zones.set(z.id, v); }
      v.ring.visible = v.fill.visible = on;
    }
    // selected drone: target, backup, sensor disc
    const d = selId ? world.droneOf(selId) : null;
    target.visible = !!(d?.order && d.target); backup.visible = !!(d?.order); sensorRing.visible = !!(d?.order && d.phase !== 'idle');
    if (d?.order) {
      target.position.set(d.order.addr.x, SLAB + 0.03, d.order.addr.z); target.material = d.target?.backup ? ringM.backup : ringM.target;
      backup.position.set(d.order.addr.x - 3.2, SLAB + 0.03, d.order.addr.z); backup.material = d.target?.backup ? ringM.target : ringM.backup;
      const r = Math.max(0.5, Math.min(6, Math.max(3, 2.6 + (d.y - SLAB) * 0.3))); sensorRing.scale.setScalar(r); sensorRing.position.set(d.x, SLAB + 0.04, d.z);
    }
  }

  // ---------- off-screen renderers (monitor cells and the zoomed scene) ----------
  function makeView(w, h) {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(1); renderer.setSize(w, h, false); renderer.shadowMap.enabled = true;
    const ip = createInkPass(renderer, { cell: 2 }); ip.setBackdrop({ y: -1.4, scale: 24 });
    return { canvas, renderer, ink: ip, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 600), w, h };
  }
  let cellView = null, bigView = null;
  function aim(cam, f, halfH, aspect, dir) {
    Object.assign(cam, { left: -halfH * aspect, right: halfH * aspect, top: halfH, bottom: -halfH }); cam.updateProjectionMatrix();
    const look = new THREE.Vector3(f.x, f.y, f.z); cam.position.copy(look).addScaledVector(dir, 120); cam.lookAt(look); cam.updateMatrixWorld();
  }
  const DIRS = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, z]) => new THREE.Vector3(60 * x, 52, 60 * z).normalize());
  const dirCache = new Map();
  function dirFor(p) {              // the isometric corner with the least tall building between the camera and the point
    const key = `${Math.round(p.x / 3)},${Math.round(p.z / 3)}`; if (dirCache.has(key)) return dirCache.get(key);
    const obs = obstacles(); let best = DIRS[0], bestHits = Infinity;
    for (const d of DIRS) {
      let hits = 0; const hz = Math.hypot(d.x, d.z), k = d.y / hz;
      for (const [ox, oz] of [[0, 0], [-3, 0], [3, 0], [0, -3], [0, 3]]) for (let s = 0.8; s < 30; s += 0.6) {
        const x = p.x + ox + d.x / hz * s, z = p.z + oz + d.z / hz * s, y = SLAB + 0.5 + s * k;
        for (const o of obs) if (x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1 && y < o.h) { hits++; break; }
      }
      if (hits < bestHits - 2) { best = d; bestHits = hits; }
    }
    dirCache.set(key, best); return best;
  }
  function faceFigures(dir) { const facing = Math.atan2(dir.x, dir.z), rx = Math.cos(facing), rz = -Math.sin(facing); for (const m of agentMeshes.values()) if (m.userData?.set) kit.orient(m, 1, 0, facing, rx, rz, false); }
  /** what a drone's camera is looking at: the drone itself and the ground (or the pad) below it */
  function focusOf(world, d) {
    if (!d.order || d.phase === 'idle') return { x: d.x, y: SLAB + 1.2, z: d.z };
    const near = ['locate', 'confirm', 'descend', 'scan', 'verify', 'wait', 'lower', 'reel', 'release', 'reelup', 'shift', 'climb'].includes(d.phase);
    const tg = d.target ?? d.order.addr, w = near ? 0.65 : 0;
    return { x: tg.x * w + d.x * (1 - w), y: SLAB + clampN((d.y - SLAB) * 0.45, 1.2, 6), z: tg.z * w + d.z * (1 - w) };
  }
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  let mainOnly = [];
  const hideMain = () => { const prev = mainOnly.map((o) => o.visible); mainOnly.forEach((o) => { o.visible = false; }); return () => mainOnly.forEach((o, i) => { o.visible = prev[i]; }); };
  function renderCell(world, d, ctx2d) {
    const W = ctx2d.canvas.width, H = ctx2d.canvas.height; cellView ??= makeView(W, H);
    if (cellView.w !== W || cellView.h !== H) { cellView.renderer.setSize(W, H, false); cellView.w = W; cellView.h = H; }
    const f = focusOf(world, d), dir = dirFor(f); faceFigures(dir); aim(cellView.cam, f, 9.5, W / H, dir);
    const restore = hideMain(); cellView.ink.render(scene, cellView.cam); restore(); ctx2d.drawImage(cellView.canvas, 0, 0, W, H);
  }
  function renderBig(world, d, ctx2d, halfH = 8) {
    const W = ctx2d.canvas.width, H = ctx2d.canvas.height; bigView ??= makeView(W, H);
    if (bigView.w !== W || bigView.h !== H) { bigView.renderer.setSize(W, H, false); bigView.w = W; bigView.h = H; }
    const f = focusOf(world, d), dir = dirFor(f); faceFigures(dir); aim(bigView.cam, f, halfH, W / H, dir);
    const restore = hideMain(); bigView.ink.render(scene, bigView.cam); restore(); ctx2d.drawImage(bigView.canvas, 0, 0, W, H); return bigView.cam;
  }
  const setMainOnly = (list) => { mainOnly = list.filter(Boolean); };
  const projectWith = (cam, p, w, h) => { const v = new THREE.Vector3(p.x, p.y ?? SLAB, p.z).project(cam); return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, front: v.z < 1 }; };
  const resetCache = () => dirCache.clear();
  return { sync, renderCell, renderBig, projectWith, setMainOnly, resetCache, root, ISO };
}
