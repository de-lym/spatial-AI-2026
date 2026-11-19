// Last 10m — 3D side: puts every scene's actors into the shared city scene and renders the camera views.
// Uses the city that main.js builds (window.__sim.scene) and the same monochrome ink pass, so all views match.
import * as THREE from 'three';
import { createInkPass } from '../ink.js?v=17';
import { createPeopleKit } from '../people.js?v=11';
import { CONST } from './sim.js';

const { SLAB, HOVER } = CONST;
const ISO = new THREE.Vector3(60, 52, 60).normalize();
const FACING = Math.atan2(ISO.x, ISO.z);                  // billboards face the isometric cameras
const RIGHT_X = Math.cos(FACING), RIGHT_Z = -Math.sin(FACING);

export function createStage({ scene, couriers, mainCamera, obstacles = () => [] }) {
  const kit = createPeopleKit(91);
  const root = new THREE.Group(); root.name = 'last10m'; scene.add(root);
  const ink = (() => {
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, ...o });
    return { dark: mat(0x1b1b1b), mid: mat(0x8d8d8d), light: mat(0xf2f0ec), parcel: mat(0xd9c39a), red: mat(0xd93a26) };
  })();
  const droneTemplate = couriers?.[0]?.mesh;

  function makeDrone() {
    let g;
    if (droneTemplate) {   // userData of the AIRSPACE drone points back at its simulation object: strip it while cloning
      const saved = []; droneTemplate.traverse((o) => { saved.push([o, o.userData]); o.userData = {}; });
      try { g = droneTemplate.clone(true); } finally { saved.forEach(([o, u]) => { o.userData = u; }); }
      g.scale.setScalar(0.55); g.visible = true; g.traverse((o) => { if (o.isSprite) o.visible = false; });
    }
    else { g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.9), ink.light); b.position.y = 0.4; g.add(b); }
    const parcel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.34), ink.parcel); parcel.castShadow = true;
    const tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x141414 }));
    root.add(g, parcel, tether);
    return { g, parcel, tether };
  }
  function ring(r0, r1, mat) { const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 48), mat); m.rotation.x = -Math.PI / 2; m.renderOrder = 2; root.add(m); return m; }
  const ringMat = { target: new THREE.MeshBasicMaterial({ color: 0x141414, side: THREE.DoubleSide }), backup: new THREE.MeshBasicMaterial({ color: 0x9a9a9a, side: THREE.DoubleSide }),
    sensor: new THREE.MeshBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }) };

  const views = new Map();   // scene id -> visual handles

  function ensure(sim) {
    const S = sim.state, id = S.def.id;
    let v = views.get(id);
    if (v && v.sim === sim) return v;
    if (v) dispose(v);
    v = { sim, drones: S.drones.map(() => makeDrone()), agents: new Map(), extra: [] };
    v.target = ring(0.5, 0.62, ringMat.target); v.target.position.set(S.def.target.x, SLAB + 0.03, S.def.target.z);
    v.backup = ring(0.42, 0.5, ringMat.backup); v.backup.position.set(S.def.backup.x, SLAB + 0.03, S.def.backup.z);
    v.alt = S.def.alt ? ring(0.42, 0.5, ringMat.backup) : null; if (v.alt) v.alt.position.set(S.def.alt.x, SLAB + 0.03, S.def.alt.z);
    v.sensor = ring(0.97, 1, ringMat.sensor);
    if (S.balloon) {
      const b = new THREE.Group(); const ball = new THREE.Mesh(new THREE.SphereGeometry(S.balloon.r, 28, 18), ink.light); ball.castShadow = true; b.add(ball);
      const str = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -S.balloon.r, 0), new THREE.Vector3(0.2, -S.balloon.r - 3, 0)]), new THREE.LineBasicMaterial({ color: 0x141414 })); b.add(str);
      root.add(b); v.balloon = b;
    }
    // confetti: a few hundred flecks inside the cloud volume
    if (S.def.kind === 'confetti') {
      const n = 360, pos = new Float32Array(n * 3), seed = []; for (let i = 0; i < n; i++) seed.push([Math.random() * 2 - 1, Math.random(), Math.random() * 2 - 1, Math.random()]);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x141414, size: 0.09 })); pts.visible = false; root.add(pts); v.confetti = { pts, seed };
    }
    views.set(id, v);
    return v;
  }
  function dispose(v) {
    for (const d of v.drones) root.remove(d.g, d.parcel, d.tether);
    for (const a of v.agents.values()) root.remove(a);
    for (const k of ['target', 'backup', 'alt', 'sensor', 'balloon']) if (v[k]) root.remove(v[k]);
    if (v.confetti) root.remove(v.confetti.pts);
  }

  function agentMesh(a) {
    if (a.kind === 'dog') return kit.figure(kit.dog, 0.55);
    if (a.kind === 'person') return kit.figure(kit.walkers[(a.id.charCodeAt(a.id.length - 1) + 3) % kit.walkers.length], a.small ? 0.62 : 0.9);
    if (a.kind === 'bird') { const m = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 4), ink.dark); m.rotation.z = Math.PI / 2; return m; }
    if (a.kind === 'car') {
      const g = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(a.w, a.h * 0.55, a.d), ink.mid); body.position.y = a.h * 0.35; body.castShadow = true;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(a.w * 0.55, a.h * 0.45, a.d * 0.9), ink.light); cab.position.set(-a.w * 0.05, a.h * 0.8, 0); g.add(body, cab); return g;
    }
    return new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), ink.dark);
  }

  function sync(sims) {
    for (const sim of sims) {
      const S = sim.state, v = ensure(sim);
      S.drones.forEach((d, i) => {
        const h = v.drones[i], vis = d.visible && d.phase !== 'done';
        h.g.visible = vis; h.g.position.set(d.x, d.y - 0.15, d.z);
        h.g.rotation.y = Math.atan2(d.target.x - d.x, d.target.z - d.z) || 0;
        const p = d.primary ? sim.parcelPos(d) : { x: d.x, y: d.y - 0.25 - d.drop, z: d.z };
        const onGround = d.delivered && d.primary;
        h.parcel.visible = vis || (onGround && !!S.parcelAt);
        h.parcel.position.set(p.x, Math.max(SLAB + 0.13, p.y), p.z);
        const showT = vis && d.drop > 0.02;
        h.tether.visible = showT;
        if (showT) { const a = h.tether.geometry.attributes.position; a.setXYZ(0, d.x, d.y - 0.2, d.z); a.setXYZ(1, p.x, p.y + 0.13, p.z); a.needsUpdate = true; h.tether.geometry.computeBoundingSphere(); }
      });
      const dr = S.drones[0];
      v.target.material = S.target.original ? ringMat.target : ringMat.backup;
      v.backup.material = S.target.backup ? ringMat.target : ringMat.backup;
      const r = Math.max(0.5, sensorR(dr)); v.sensor.visible = dr.visible && dr.phase !== 'done'; v.sensor.scale.setScalar(r); v.sensor.position.set(dr.x, SLAB + 0.04, dr.z);
      // ground + air agents
      const seen = new Set();
      for (const a of S.agents) {
        seen.add(a.id);
        let m = v.agents.get(a.id); if (!m) { m = agentMesh(a); v.agents.set(a.id, m); root.add(m); }
        m.visible = a.visible !== false;
        if (a.kind === 'bird') { m.position.set(a.x, a.y + Math.sin(a.flap) * 0.08, a.z); m.rotation.y = Math.atan2(S.flock?.px ?? 1, S.flock?.pz ?? 0); }
        else m.position.set(a.x, SLAB, a.z);
        if (m.userData?.set) { kit.orient(m, Math.sin(a.heading ?? 0), Math.cos(a.heading ?? 0), FACING, RIGHT_X, RIGHT_Z, false); kit.setFrame(m, (a.phase ?? S.t) * 0.9); }
      }
      for (const [id, m] of v.agents) if (!seen.has(id)) m.visible = false;
      if (v.balloon) { v.balloon.position.set(S.balloon.x, S.balloon.y, S.balloon.z); }
      if (v.confetti) {
        const c = S.cloud, on = !!(c && c.active); v.confetti.pts.visible = on;
        if (on) { const a = v.confetti.pts.geometry.attributes.position; v.confetti.seed.forEach(([sx, sy, sz, ph], i) => { const y = ((sy - (S.t * 0.25 + ph)) % 1 + 1) % 1; a.setXYZ(i, c.x + sx * c.r, SLAB + y * c.top, c.z + sz * c.r); }); a.needsUpdate = true; }
      }
    }
  }
  function sensorR(d) { const h = d.y - SLAB; return Math.max(2, Math.min(6, 1.8 + h * 0.32)); }

  // ---------- off-screen renderers for the monitor cells and the zoomed scene ----------
  function makeView(w, h, dpr) {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); renderer.shadowMap.enabled = true;
    const ip = createInkPass(renderer, { cell: 2 }); ip.setBackdrop({ y: -1.4, scale: 24 });
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 600);
    return { canvas, renderer, ink: ip, cam, w, h };
  }
  let cellView = null, bigView = null;
  function aim(cam, center, halfH, aspect, yOff = 1.2, dir = ISO) {
    Object.assign(cam, { left: -halfH * aspect, right: halfH * aspect, top: halfH, bottom: -halfH }); cam.updateProjectionMatrix();
    const look = new THREE.Vector3(center.x, SLAB + yOff, center.z);
    cam.position.copy(look).addScaledVector(dir, 120); cam.lookAt(look); cam.updateMatrixWorld();
  }
  // each scene gets the isometric corner from which no tall building stands between camera and drop pad
  const DIRS = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, z]) => new THREE.Vector3(60 * x, 52, 60 * z).normalize());
  const dirCache = new Map();
  function dirFor(def) {
    if (dirCache.has(def.id)) return dirCache.get(def.id);
    const obs = obstacles(); let best = DIRS[0], bestHits = Infinity;
    for (const d of DIRS) {
      let hits = 0; const hz = Math.hypot(d.x, d.z), k = d.y / hz;
      for (const [ox, oz] of [[0, 0], [-3, 0], [3, 0], [0, -3], [0, 3], [-3, -3], [3, 3], [-3, 3], [3, -3]]) {
        for (let s = 0.8; s < 30; s += 0.4) { const x = def.target.x + ox + d.x / hz * s, z = def.target.z + oz + d.z / hz * s, y = SLAB + 0.5 + s * k;
          for (const o of obs) if (x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1 && y < o.h) { hits++; break; } }
      }
      if (hits < bestHits - 2) { best = d; bestHits = hits; }
    }
    dirCache.set(def.id, best); return best;
  }
  function faceFigures(dir) {      // turn our cut-out figures toward the camera that is about to draw
    const facing = Math.atan2(dir.x, dir.z), rx = Math.cos(facing), rz = -Math.sin(facing);
    for (const v of views.values()) for (const m of v.agents.values()) if (m.userData?.set) kit.orient(m, 1, 0, facing, rx, rz, false);
  }
  function focusOf(sim) {           // keep the drone and its target in frame
    const S = sim.state, d = S.drones[0];
    const fx = d.visible && d.phase !== 'done' ? (S.target.x * 0.65 + d.x * 0.35) : S.target.x, fz = d.visible && d.phase !== 'done' ? (S.target.z * 0.65 + d.z * 0.35) : S.target.z;
    return { x: fx, z: fz };
  }
  function fit(view, W, H) { if (view.w !== W || view.h !== H) { view.renderer.setSize(W, H, false); view.w = W; view.h = H; } }
  function renderCell(sim, ctx2d) {
    const W = ctx2d.canvas.width, H = ctx2d.canvas.height;
    cellView ??= makeView(W, H, 1); fit(cellView, W, H);
    const dir = dirFor(sim.state.def); faceFigures(dir);
    aim(cellView.cam, focusOf(sim), 8.6, W / H, 1.6, dir);
    const hide = hideMainOnly(); cellView.ink.render(scene, cellView.cam); hide();
    ctx2d.drawImage(cellView.canvas, 0, 0, W, H);
  }
  function renderBig(sim, ctx2d, halfH = 7.6) {
    const W = ctx2d.canvas.width, H = ctx2d.canvas.height;
    bigView ??= makeView(W, H, 1); fit(bigView, W, H);
    const dir = dirFor(sim.state.def); faceFigures(dir);
    aim(bigView.cam, focusOf(sim), halfH, W / H, 1.4, dir);
    const hide = hideMainOnly(); bigView.ink.render(scene, bigView.cam); hide();
    ctx2d.drawImage(bigView.canvas, 0, 0, W, H);
    return bigView.cam;
  }
  let mainOnly = [];
  function hideMainOnly() { const prev = mainOnly.map((o) => o.visible); mainOnly.forEach((o) => { o.visible = false; }); return () => mainOnly.forEach((o, i) => { o.visible = prev[i]; }); }
  function setMainOnly(list) { mainOnly = list.filter(Boolean); }
  const projectWith = (cam, p, w, h) => { const v = new THREE.Vector3(p.x, p.y ?? SLAB, p.z).project(cam); return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, front: v.z < 1 }; };

  return { sync, renderCell, renderBig, projectWith, setMainOnly, root, ISO };
}
