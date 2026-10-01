import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';

/* ====================================================================
   Delivery-platform semantic model — simulation + three.js view
   ORDER is the central object; CUSTOMER, RESTAURANT, COURIER and
   PLATFORM are the connected agents. Couriers drive along the roads.
   ==================================================================== */

// ---------- constants ------------------------------------------------
const COURIER_SPEED = 6;          // world units per simulated second
const COURIER_CAPACITY = 2;       // Rule 2: orders one courier can hold at once
const MAX_COURIERS = 5;           // Rule 1: courier capacity is limited
const HIGH_REVENUE = 35;          // threshold used only for the revenue statistics
const STATUS = ['pending', 'preparing', 'ready', 'assigned', 'picked_up', 'delivered'];
const STATUS_COLOR = {
  pending: 0xb8b2ab, preparing: 0xf5a623, ready: 0x3fbf8f,
  assigned: 0x3b8fe8, picked_up: 0x8b6fe0, delivered: 0x2cc7c0,
};
const REL_COLOR = {
  creates: 0x3f8f5f, prepares: 0xe8472f, evaluates: 0x9aa3ad, assigns: 0x2c4a8c, carries: 0xd9a21b,
};
const RULES = [
  'Courier capacity is limited.',
  'A courier serves a limited number of orders at one time.',
  'An order cannot be picked up before it is ready.',
  'Preparation time decides when an order becomes available for delivery.',
  'Platform assignment affects how long an order waits before pickup.',
  'Revenue may influence allocation priority (simulation hypothesis only).',
  'Total delivery time is not fixed — it varies with all of the above.',
];
// city grid: parcels (12 wide) between roads (4 wide); roads at ±8, ±24, ±40, ±56
const ROADS = [-56, -40, -24, -8, 8, 24, 40, 56];
const PARCEL = 12, SLAB = 0.4;
// Background city = white massing + green + blue water (references 1–2).
// Saturated architectural-model colours (reference 3) are reserved for the four roles:
//   restaurants = reds/oranges · customers = greens/denim · platform = navy · couriers = mustard
const CLR = {
  white: 0xf3f1ed, ledge: 0xe2dfda, coral: 0xe8472f, orange: 0xee7a3c, salmon: 0xf0a08e, mustard: 0xf1b82d, amber: 0xe3a21c,
  navy: 0x2c4a8c, denim: 0x4f7fb5, forest: 0x2f5f45, teal: 0x4a9a8a, sage: 0x6f9f6f, cream: 0xf2e6cf, wood: 0xe8d4b4, water: 0x62b6d9,
};
const TINT = [0xe3ebf2, 0xf3e6d8, 0xe2ede0, 0xeae4f1, 0xefe8d6];   // pale tints for background buildings
const TINT_ROOF = [0xc9d6e3, 0xe3c8b0, 0xc4d9bf, 0xd3c9e2, 0xdccdad];
const ROLE = { customer: CLR.forest, restaurant: CLR.coral, platform: CLR.navy, courier: CLR.mustard };
const TREE = [0x8fbf6a, 0x6aa35a, 0x4f8a4f, 0x9ccb7a];

// ---------- helpers --------------------------------------------------
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '–');
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const dark = (c, f = 0.55) => '#' + [16, 8, 0].map((sh) => Math.round(((c >> sh) & 255) * f).toString(16).padStart(2, '0')).join('');
let seed = 11;
const srand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(srand() * arr.length)];

// road routing: couriers drive along the road grid (Manhattan paths)
const nearRoad = (v) => ROADS.reduce((p, q) => (Math.abs(q - v) < Math.abs(p - v) ? q : p));
const onRoad = (v) => Math.abs(nearRoad(v) - v) < 0.05;
function bestRoad(from, to) { // road minimising detour from→road→to, nearest to `from` on ties
  return ROADS.reduce((p, q) => {
    const sp = Math.abs(p - from) + Math.abs(p - to), sq = Math.abs(q - from) + Math.abs(q - to);
    return sq < sp - 1e-6 || (Math.abs(sq - sp) < 1e-6 && Math.abs(q - from) < Math.abs(p - from)) ? q : p;
  });
}
function route(a, b) {
  const pts = []; let x = a.x, z = a.z;
  const go = (px, pz) => { if (Math.hypot(px - x, pz - z) > 0.01) { pts.push(new THREE.Vector3(px, 0, pz)); x = px; z = pz; } };
  if (!onRoad(z)) go(x, bestRoad(z, b.z));
  if (Math.abs(z - b.z) < 0.05) go(b.x, b.z);
  else { const vx = bestRoad(x, b.x); go(vx, z); go(vx, b.z); go(b.x, b.z); }
  return pts;
}
function pathLen(a, b) {
  let p = a, t = 0;
  for (const w of route(a, b)) { t += dist(p, w); p = w; }
  return t;
}

// ---------- three.js scene -------------------------------------------
const BG = 0xe6e4e1;
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
const VIEW = 26; // half-height of the isometric view, in world units
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 600);
const target = new THREE.Vector3(7, 0, -4);
camera.position.copy(target).add(new THREE.Vector3(60, 52, 60));
const controls = new OrbitControls(camera, canvas);
controls.target.copy(target);
controls.maxPolarAngle = Math.PI * 0.45;
controls.minZoom = 0.55; controls.maxZoom = 3.5;
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0xaebbd0, 1.6));
const sun = new THREE.DirectionalLight(0xfffaf2, 2.5);
sun.position.set(-40, 70, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 5; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 1, far: 220 });
scene.add(sun);

// soft "clay" materials and rounded geometry
const matCache = new Map();
const mat = (c) => {
  if (!matCache.has(c)) matCache.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, metalness: 0 }));
  return matCache.get(c);
};
function shade(m) { m.castShadow = true; m.receiveShadow = true; return m; }
/** rounded box whose bottom sits at y (relative to parent) */
function box(parent, w, h, d, color, x = 0, y = 0, z = 0, r) {
  const m = shade(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r ?? Math.min(0.16, w / 4, h / 4, d / 4)), mat(color)));
  m.position.set(x, y + h / 2, z);
  parent.add(m);
  return m;
}
const coneGeo = new THREE.ConeGeometry(0.85, 2.0, 24), ballGeo = new THREE.SphereGeometry(0.7, 20, 14);
function tree(parent, x, z, y = SLAB, s = 1) {
  const g = new THREE.Group();
  const c = pick(TREE), c2 = pick(TREE), kind = srand();
  const stem = (h) => {
    const t = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, h, 6), mat(0xc2863f)));
    t.position.y = h / 2; g.add(t);
  };
  const ball = (r, yy, col) => { const b = shade(new THREE.Mesh(ballGeo, mat(col))); b.scale.setScalar(r / 0.7); b.position.y = yy; g.add(b); };
  if (kind < 0.35) { // smooth cone
    const cone = shade(new THREE.Mesh(coneGeo, mat(c))); cone.position.y = 1.0; g.add(cone);
  } else if (kind < 0.65) { // two stacked balls (big below, small above)
    stem(0.7); ball(0.8, 1.5, c); ball(0.5, 2.35, c2);
  } else if (kind < 0.85) { // small lollipop
    stem(0.8); ball(0.62, 1.4, c);
  } else { // cypress
    stem(0.4);
    const b = shade(new THREE.Mesh(ballGeo, mat(c))); b.scale.set(0.7, 1.9, 0.7); b.position.y = 1.5; g.add(b);
  }
  g.position.set(x, y, z); g.scale.setScalar(s); parent.add(g);
}
function prism(parent, w, h, d, color, x, y, z, ry = 0) { // pitched roof: triangle (w wide, h high) extruded along d
  const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(0, h); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 });
  geo.translate(0, 0, -d / 2);
  const m = shade(new THREE.Mesh(geo, mat(color)));
  m.position.set(x, y, z); m.rotation.y = ry; parent.add(m);
  return m;
}

// ---------- labels: sized to their text, minimal margin -----------------
const WORLD_PER_PX = 0.021;
function makeLabel() {
  const cv = document.createElement('canvas');
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
  sprite.renderOrder = 10;
  sprite.userData = { cv, key: '', w: 0, h: 0 };
  return sprite;
}
/** lines: [{t, c?, s?}] — canvas is measured and resized to fit the text */
function setLabel(sprite, lines) {
  const key = JSON.stringify(lines);
  const u = sprite.userData;
  if (u.key === key) return;
  u.key = key;
  const cv = u.cv, g = cv.getContext('2d');
  const pad = 10, lh = 1.12;
  const font = (s) => `600 ${s}px system-ui, "Helvetica Neue", Arial, sans-serif`;
  let w = 0, h = 0;
  for (const l of lines) { g.font = font(l.s || 56); w = Math.max(w, g.measureText(l.t).width); h += (l.s || 56) * lh; }
  w = Math.ceil(w + pad * 2); h = Math.ceil(h + pad * 1.2);
  const resized = cv.width !== w || cv.height !== h;
  cv.width = w; cv.height = h;
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.93)';
  g.beginPath(); g.roundRect(0, 0, w, h, 14); g.fill();
  g.textAlign = 'center'; g.textBaseline = 'top';
  let y = pad * 0.45;
  for (const l of lines) {
    g.font = font(l.s || 56); g.fillStyle = l.c || '#3b3631';
    g.fillText(l.t, w / 2, y + (l.s || 56) * 0.04); y += (l.s || 56) * lh;
  }
  if (resized || !sprite.material.map) {
    sprite.material.map?.dispose();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
    sprite.material.map = tex; sprite.material.needsUpdate = true;
  } else sprite.material.map.needsUpdate = true;
  sprite.scale.set(w * WORLD_PER_PX, h * WORLD_PER_PX, 1);
}

const pickables = [];
function register(obj, ref) { obj.traverse((o) => { if (o.isMesh) o.userData.ref = ref; }); pickables.push(obj); }

// ---------- world state ----------------------------------------------
const S = {
  time: 0, running: true, speed: 1, policy: 'fifo', // 'fifo' | 'revenue'
  nextOrder: 1, nextCourier: 1,
  orders: [], couriers: [], restaurants: [], customers: [],
  selected: null,
  auto: { customer: true, restaurant: true, platform: true, courier: true }, // simulation starts on its own
  timers: { spawn: 1.5, evaluate: 0 },
  ruleHits: new Array(7).fill(0),
  log: [],
  delivered: [],
};

// ---- terrain: roads, lane marks, parcels -------------------------------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0xd5d1cd, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);
{
  const marks = [];
  for (const r of ROADS) for (let t = -60; t <= 60; t += 3.2) {
    if (ROADS.some((q) => Math.abs(t - q) < 3.4)) continue;
    marks.push([t, r, 0], [r, t, 1]);
  }
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.02, 0.2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), marks.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  marks.forEach(([a, b, vert], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), vert ? Math.PI / 2 : 0);
    m4.compose(new THREE.Vector3(a, 0.02, b), q, new THREE.Vector3(1, 1, 1));
    im.setMatrixAt(i, m4);
  });
  im.receiveShadow = true; scene.add(im);
}

// entity layout: parcel centres on a 16-unit pitch; the door faces +z onto the road at pz+8
const parcels = [];
for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) parcels.push([i * 16, j * 16]);
const takenAt = new Set();
const key = (x, z) => x + ',' + z;

const platform = { type: 'platform', name: 'PLATFORM', pos: new THREE.Vector3(0, SLAB, 0), acc: new THREE.Vector3(0, 0, 8) };
const platformTop = new THREE.Vector3(0, 9.6, 0);
function buildPlatform() {
  const g = new THREE.Group();
  const plaza = shade(new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 0.18, 40), mat(0xc6dcb2)));
  plaza.position.y = 0.09; g.add(plaza);
  box(g, 3.2, 0.7, 3.2, 0xffffff, 0, 0.18, 0, 0.3);
  const shaft = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, 7, 24), mat(0xffffff)));
  shaft.position.y = 4.4; g.add(shaft);
  const disc = shade(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 1.6, 0.9, 32), mat(CLR.navy)));
  disc.position.y = 8.6; g.add(disc);
  const dome = shade(new THREE.Mesh(new THREE.SphereGeometry(1.25, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x9fb6d9)));
  dome.position.y = 9.05; g.add(dome);
  const mast = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 2.6, 8), mat(0xffffff)));
  mast.position.y = 11.3; g.add(mast);
  const tip = shade(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat(0xffffff)));
  tip.position.y = 12.6; g.add(tip);
  const ring = shade(new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.1, 8, 64), mat(CLR.mustard)));
  ring.position.y = 8.6; ring.rotation.x = Math.PI / 2.3; g.add(ring);
  platform.ring = ring;
  for (const [x, z] of [[-4, -3.6], [4, 3.6], [-4, 3.6], [4, -3.6]]) tree(g, x, z, 0.18, 1.1);
  g.position.set(0, SLAB, 0);
  scene.add(g);
  platform.mesh = g;
  platform.label = makeLabel(); platform.label.position.set(0, 15, 0); scene.add(platform.label);
  register(g, platform);
  takenAt.add(key(0, 0));
}

function addRestaurant(name, x, z, prep, cap, color, accent) {
  const r = { type: 'restaurant', name, pos: new THREE.Vector3(x, SLAB, z), acc: new THREE.Vector3(x, 0, z + 8), prepTime: prep, capacity: cap, color, accent };
  const g = new THREE.Group();
  box(g, 8, 2.4, 5, CLR.cream, 0, 0, -1.5);
  box(g, 5.6, 2.2, 4, color, -0.8, 2.4, -1.6);
  box(g, 3, 1.6, 3.2, accent, 2, 2.4, -1.2);
  box(g, 7.4, 0.3, 2, accent, 0, 1.9, 1.5, 0.14);              // awning
  box(g, 2.6, 1.2, 0.12, 0x9fd0e8, -2, 0.5, 1.02, 0.05);       // glass
  box(g, 1.1, 1.7, 0.12, color, 2.2, 0, 1.02, 0.05);           // door
  const chim = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.4, 14), mat(accent)));
  chim.position.set(-2.6, 5.3, -2.4); g.add(chim);
  tree(g, -3.8, 3.8); tree(g, 3.8, 4.4, SLAB * 0, 0.8);
  g.position.set(x, SLAB, z); scene.add(g);
  r.mesh = g;
  r.label = makeLabel(); r.label.position.set(x, 8.2, z); scene.add(r.label);
  register(g, r);
  S.restaurants.push(r); takenAt.add(key(x, z));
}
function addCustomer(name, x, z, bodyC, roofC) {
  const c = { type: 'customer', name, pos: new THREE.Vector3(x, SLAB, z), acc: new THREE.Vector3(x, 0, z + 8), orderTime: null, selectedRestaurant: null };
  const g = new THREE.Group();
  box(g, 4.6, 2.6, 4, bodyC, 0, 0, -0.8);
  prism(g, 5.4, 2.4, 4.6, roofC, 0, 2.6, -0.8, Math.PI / 2);
  box(g, 1.0, 1.6, 0.12, roofC, 0.8, 0, 1.22, 0.05);
  box(g, 1.2, 1.0, 0.12, 0x9fd0e8, -1.2, 0.8, 1.22, 0.05);
  box(g, 0.9, 1.5, 0.9, CLR.white, 1.4, 3.4, -1.6);
  tree(g, -3.6, 3.6); tree(g, 3.8, 3.2, 0, 0.8);
  g.position.set(x, SLAB, z); scene.add(g);
  c.mesh = g;
  c.label = makeLabel(); c.label.position.set(x, 7.2, z); scene.add(c.label);
  register(g, c);
  S.customers.push(c); takenAt.add(key(x, z));
}

// filler parcels (white massing, parks and water — decor, not part of the model)
function ledged(g, w, h, d, x, z, tint, step = 1.5) {
  box(g, w, h, d, tint, x, 0, z, 0.22);
  for (let k = 1; k * step < h - 0.4; k++) box(g, w + 0.12, 0.1, d + 0.12, TINT_ROOF[TINT.indexOf(tint)] ?? CLR.ledge, x, k * step, z, 0.04);
}
function buildFiller(x, z) {
  const g = new THREE.Group(); g.position.set(x, SLAB, z);
  const ti = Math.floor(srand() * TINT.length), tint = TINT[ti], roof = TINT_ROOF[ti];
  const t = srand();
  if (t < 0.22) { // tower
    const w = 4 + srand() * 2.4, d = 4 + srand() * 2.4, h = 6 + srand() * 10;
    ledged(g, w, h, d, 0, 0, tint);
    tree(g, -4.6, 4.6, 0, 0.8);
  } else if (t < 0.34) { // one long low block
    ledged(g, 8.6, 4.4, 4.6, 0, -0.6, tint, 1.4);
    tree(g, 4.4, 4.4, 0, 0.8);
  } else if (t < 0.52) { // one house, or two side by side — never more
    const two = srand() < 0.5;
    const houses = two ? [[-3.1, 0], [3.1, 0]] : [[0, 0]];
    houses.forEach(([hx, hz], n) => {
      const sc = two ? 0.62 : 1, tn = TINT[(ti + n * 2) % TINT.length], rn = TINT_ROOF[(ti + n * 2) % TINT.length];
      const h = new THREE.Group(); h.position.set(hx, 0, hz); h.scale.setScalar(sc); g.add(h);
      box(h, 4.8, 2.8, 4.2, tn, 0, 0, -0.4, 0.2);
      prism(h, 5.8, 2.6, 5.2, rn, 0, 2.8, -0.4, Math.PI / 2);
      box(h, 1.0, 1.7, 0.12, rn, 0.9, 0, 1.72, 0.05);
    });
    tree(g, two ? 0 : -4.2, 4.4, 0, 0.8); if (!two) tree(g, 4.4, -3.6, 0, 0.8);
  } else if (t < 0.64) { // stacked rounded boxes
    box(g, 6.4, 2.6, 4.6, tint, 0, 0, 0.3, 0.32);
    box(g, 4.6, 2.4, 3.8, TINT[(ti + 2) % TINT.length], -0.7, 2.6, -0.2, 0.32);
    box(g, 3, 1.8, 2.8, TINT[(ti + 4) % TINT.length], 1.1, 5, -0.1, 0.32);
    box(g, 1.8, 1.0, 0.1, 0xffffff, 0.8, 0.8, 2.62, 0.04);
    tree(g, -4.4, 4.4); tree(g, 4.6, 4.8, 0, 0.8);
  } else if (t < 0.8) { // park: lawn disc, a few trees
    const lawn = shade(new THREE.Mesh(new THREE.CylinderGeometry(5.3, 5.3, 0.14, 48), mat(0xa9d6b3)));
    lawn.position.y = 0.07; g.add(lawn);
    const n = 5 + Math.floor(srand() * 3);
    for (let i = 0; i < n; i++) { const a = i * 2.4 + srand(), r = 1 + srand() * 3.2; tree(g, Math.cos(a) * r, Math.sin(a) * r, 0.14, 0.8 + srand() * 0.5); }
  } else if (t < 0.88) { // pond
    box(g, 10, 0.18, 9, CLR.water, 0, 0, 0, 0.8);
    box(g, 3.4, 0.2, 1.1, CLR.white, 0, 0, 0, 0.1);
    tree(g, -4.6, 4.6); tree(g, 4.6, -4.6);
  } else if (t < 0.95) { // water tank on legs
    const tank = shade(new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 2.4, 28), mat(tint)));
    tank.position.y = 6; g.add(tank);
    const cap = shade(new THREE.Mesh(new THREE.ConeGeometry(2, 0.9, 28), mat(roof))); cap.position.y = 7.65; g.add(cap);
    for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) {
      const l = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4.8, 6), mat(0xb9b0a6))); l.position.set(lx, 2.4, lz); g.add(l);
    }
    tree(g, 3.6, 3.8);
  } else { // dome
    box(g, 5.4, 1.4, 5.4, tint, 0, 0, 0, 0.3);
    const dome = shade(new THREE.Mesh(new THREE.SphereGeometry(2.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(roof)));
    dome.position.set(0, 1.4, 0); g.add(dome);
    tree(g, 4.4, 4.4, 0, 0.8);
  }
  scene.add(g);
}

// parcel slabs
for (const [x, z] of parcels) {
  const slab = shade(new THREE.Mesh(new RoundedBoxGeometry(PARCEL, SLAB, PARCEL, 3, 0.12), mat(0xf1efeb)));
  slab.position.set(x, SLAB / 2, z); scene.add(slab);
}
buildPlatform();
addRestaurant('R1 Burger', -16, -16, 6, 2, CLR.coral, CLR.salmon);
addRestaurant('R2 Ramen', 16, -16, 10, 2, CLR.orange, CLR.cream);
addRestaurant('R3 Slow-Roast', 0, 16, 14, 1, CLR.salmon, CLR.coral);
addCustomer('C1', -32, 0, CLR.wood, CLR.denim);
addCustomer('C2', -16, 16, CLR.cream, CLR.forest);
addCustomer('C3', 16, 16, CLR.white, CLR.teal);
addCustomer('C4', 32, 16, CLR.wood, CLR.sage);
addCustomer('C5', -32, -16, CLR.cream, CLR.denim);
addCustomer('C6', 32, -16, CLR.white, CLR.forest);
for (const [x, z] of parcels) if (!takenAt.has(key(x, z))) buildFiller(x, z);

// ---- couriers (little cars) ----------------------------------------
const CAR_COLORS = [CLR.mustard, CLR.amber, 0xf6cf5a];
function addCourier() {
  if (S.couriers.length >= MAX_COURIERS) return null;
  const idx = S.nextCourier++;
  const c = { type: 'courier', name: 'K' + idx, pos: new THREE.Vector3(-8 + idx * 4.5, 0, 8), orders: [], carry: [], task: null, heading: Math.PI / 2, rot: Math.PI / 2 };
  const g = new THREE.Group();
  const inner = new THREE.Group(); g.add(inner);
  box(inner, 1.3, 0.6, 2.6, CAR_COLORS[(idx - 1) % 3], 0, 0.25, 0, 0.22);
  box(inner, 1.1, 0.55, 1.3, CLR.navy, 0, 0.85, -0.15, 0.22);
  for (const [wx, wz] of [[-0.62, -0.8], [0.62, -0.8], [-0.62, 0.8], [0.62, 0.8]]) {
    const w = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 12), mat(0x4a4540)));
    w.rotation.z = Math.PI / 2; w.position.set(wx, 0.28, wz); inner.add(w);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshStandardMaterial({ color: 0x5fd38d, emissive: 0x5fd38d, emissiveIntensity: 0.6 }));
  lamp.position.set(0, 1.45, -0.15); inner.add(lamp);
  g.position.copy(c.pos); scene.add(g);
  c.mesh = g; c.inner = inner; c.lamp = lamp;
  c.label = makeLabel(); scene.add(c.label);
  register(g, c);
  S.couriers.push(c);
  return c;
}

// selection ring
const selRing = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.6, 40), new THREE.MeshBasicMaterial({ color: 0x3b3631, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
selRing.rotation.x = -Math.PI / 2; selRing.visible = false;
scene.add(selRing);

// relationship lines (rebuilt every frame from the model)
const MAX_SEG = 800;
const linePos = new Float32Array(MAX_SEG * 6), lineCol = new Float32Array(MAX_SEG * 6);
const lineGeo = new THREE.BufferGeometry();
lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3).setUsage(THREE.DynamicDrawUsage));
const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
lines.frustumCulled = false;
scene.add(lines);

// ---------- logging / toast ------------------------------------------
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
let logDirty = true;
function log(msg, kind = '') {
  S.log.unshift({ t: S.time, msg, kind });
  if (S.log.length > 60) S.log.pop();
  logDirty = true;
}
/** a refused action: explains which rule bound it */
function refuse(rule, msg) {
  if (rule) S.ruleHits[rule - 1]++;
  const text = (rule ? `Rule ${rule}: ` : '') + msg;
  log(text, 'bad'); toast(text);
  return false;
}

// ---------- order model ----------------------------------------------
const load = (c) => c.orders.length + c.carry.length;
const unassigned = () => S.orders.filter((o) => ['pending', 'preparing', 'ready'].includes(o.status));
const waitingTime = (o) => S.time - (o.readyAt ?? o.createdAt);

function createOrder(customer, restaurant) {
  const prepTotal = restaurant.prepTime * rand(0.8, 1.25);
  const o = {
    type: 'order', id: S.nextOrder++, revenue: Math.round(rand(10, 60)),
    createdAt: S.time, status: 'pending', customer, restaurant, courier: null,
    prepTotal, prepRemaining: prepTotal, readyAt: null, assignedAt: null, pickedAt: null, deliveredAt: null,
    accepted: false, eta: null, priority: 0, goneAt: null,
  };
  customer.orderTime = S.time; customer.selectedRestaurant = restaurant;
  const size = 0.8 + o.revenue / 60 * 0.9;
  const g = new THREE.Group();
  const bx = box(g, size, size, size, STATUS_COLOR.pending, 0, 0, 0, 0.18);
  g.position.set(restaurant.pos.x, SLAB, restaurant.pos.z + 4.8);
  scene.add(g);
  o.mesh = g; o.box = bx; o.size = size;
  o.label = makeLabel(); scene.add(o.label);
  register(g, o);
  S.orders.push(o);
  log(`${customer.name} created order #${o.id} ($${o.revenue}) at ${restaurant.name}`);
  return o;
}
function setStatus(o, s) { o.status = s; o.box.material = mat(STATUS_COLOR[s]); }
function removeOrder(o) {
  scene.remove(o.mesh, o.label);
  const i = pickables.indexOf(o.mesh); if (i >= 0) pickables.splice(i, 1);
  S.orders.splice(S.orders.indexOf(o), 1);
  if (S.selected === o) S.selected = null;
}

/** Platform delivery-time estimate (seconds from now until delivered). */
function estimate(o) {
  if (o.status === 'delivered') return 0;
  const legB = pathLen(o.restaurant.acc, o.customer.acc) / COURIER_SPEED;
  if (o.status === 'picked_up') return pathLen(o.courier.pos, o.customer.acc) / COURIER_SPEED;
  const ready = o.status === 'pending' ? o.prepTotal + 1.5
    : o.status === 'preparing' ? Math.max(0, o.prepRemaining) : 0;
  const reach = (c) => pathLen(c.pos, o.restaurant.acc) / COURIER_SPEED + load(c) * 4;
  let arrive;
  if (o.courier) arrive = reach(o.courier);
  else {
    const free = S.couriers.filter((c) => load(c) < COURIER_CAPACITY);
    arrive = free.length ? Math.min(...free.map(reach)) : 12; // no courier free: assumed wait
  }
  return Math.max(ready, arrive) + legB;
}
/** Allocation priority: FIFO by waiting time, or revenue-weighted (hypothesis, Rule 6). */
function priorityOf(o) {
  const w = waitingTime(o);
  return S.policy === 'revenue' ? o.revenue + 0.5 * w : w;
}

// ---------- actions --------------------------------------------------
// Selected entity, if applicable, takes precedence over "first applicable".
function chooseOrder(pred, relation) {
  const sel = S.selected;
  if (sel && sel.type === 'order' && pred(sel)) return sel;
  const pool = S.orders.filter(pred);
  if (sel && sel.type !== 'order' && relation) {
    const m = pool.find((o) => relation(o, sel));
    if (m) return m;
  }
  return pool[0] ?? null;
}
const byRestaurant = (o, s) => s.type === 'restaurant' && o.restaurant === s;
const byCourier = (o, s) => s.type === 'courier' && o.courier === s;
const atRestaurant = (o) => dist(o.courier.pos, o.restaurant.acc) < 1;
function startTask(c, kind, order) {
  const dest = kind === 'toRestaurant' ? order.restaurant.acc : order.customer.acc;
  c.task = { kind, order, path: route(c.pos, dest) };
}

const act = {
  create() {
    const sel = S.selected;
    const customer = sel?.type === 'customer' ? sel : S.customers[Math.floor(Math.random() * S.customers.length)];
    const restaurant = sel?.type === 'restaurant' ? sel : S.restaurants[Math.floor(Math.random() * S.restaurants.length)];
    createOrder(customer, restaurant);
    return true;
  },
  accept(auto = false) {
    const active = (r) => S.orders.filter((o) => o.restaurant === r && o.status === 'preparing').length;
    const o = chooseOrder((x) => x.status === 'pending' && active(x.restaurant) < x.restaurant.capacity, byRestaurant);
    if (!o) {
      if (auto) return false;
      const blocked = S.orders.find((x) => x.status === 'pending');
      return blocked ? refuse(0, `${blocked.restaurant.name} is at production capacity (${blocked.restaurant.capacity}) — order #${blocked.id} must wait.`)
        : refuse(0, 'No pending order to accept.');
    }
    setStatus(o, 'preparing');
    log(`${o.restaurant.name} accepted #${o.id} — preparing for ${fmt(o.prepTotal)}s`);
    return true;
  },
  ready(auto = false) {
    const pool = S.orders.filter((o) => o.status === 'preparing');
    const sel = S.selected;
    const o = (sel?.type === 'order' && sel.status === 'preparing') ? sel
      : pool.find((x) => x.prepRemaining <= 0 && (!sel || sel.type !== 'restaurant' || x.restaurant === sel))
        ?? pool.find((x) => x.prepRemaining <= 0);
    if (!o) {
      if (auto) return false;
      const early = (sel?.type === 'order' && sel.status === 'preparing') ? sel : pool[0];
      return early ? refuse(4, `#${early.id} still needs ${fmt(early.prepRemaining)}s of preparation — it is not available for delivery yet.`)
        : refuse(0, 'No order is being prepared.');
    }
    if (o.prepRemaining > 0) return refuse(4, `#${o.id} still needs ${fmt(o.prepRemaining)}s of preparation.`);
    o.readyAt = S.time;
    setStatus(o, 'ready');
    log(`${o.restaurant.name} marked #${o.id} ready`);
    return true;
  },
  evaluate() {
    const q = unassigned();
    q.forEach((o) => { o.priority = priorityOf(o); });
    if (!q.length) { log('Platform evaluated: no pending orders'); return true; }
    q.sort((a, b) => b.priority - a.priority);
    log(`Platform evaluated ${q.length} order(s) — top: #${q[0].id} (${S.policy} priority ${fmt(q[0].priority)})`);
    return true;
  },
  estimate() {
    const live = S.orders.filter((o) => o.status !== 'delivered');
    live.forEach((o) => { o.eta = estimate(o); });
    log(`Platform updated delivery-time estimates for ${live.length} order(s)`);
    return true;
  },
  togglePolicy() {
    S.policy = S.policy === 'fifo' ? 'revenue' : 'fifo';
    unassigned().forEach((o) => { o.priority = priorityOf(o); });
    log(`Platform updated priority logic → ${S.policy === 'fifo' ? 'FIFO (waiting time)' : 'revenue-weighted (hypothesis)'}`);
    return true;
  },
  assign(auto = false) {
    // Only ready orders can be assigned (pending → preparing → ready → assigned).
    const sel = S.selected;
    const cands = S.orders.filter((o) => o.status === 'ready' && !o.courier);
    if (!cands.length) return auto ? false : refuse(0, 'No ready order awaits a courier.');
    cands.forEach((o) => { o.priority = priorityOf(o); });
    const byPrio = [...cands].sort((a, b) => b.priority - a.priority);
    let o = byPrio[0];
    if (sel?.type === 'order' && cands.includes(sel)) o = sel;
    const fifo = [...cands].sort((a, b) => waitingTime(b) - waitingTime(a))[0];
    const free = S.couriers.filter((c) => load(c) < COURIER_CAPACITY);
    if (!free.length) {
      if (auto) return false;
      return refuse(S.couriers.some((c) => load(c) > 0) ? 2 : 1, `All ${S.couriers.length} couriers are at capacity (${COURIER_CAPACITY} orders each) — #${o.id} must wait.`);
    }
    free.sort((a, b) => pathLen(a.pos, o.restaurant.acc) + load(a) * 8 - (pathLen(b.pos, o.restaurant.acc) + load(b) * 8));
    const c = free[0];
    o.courier = c; o.assignedAt = S.time; o.accepted = false;
    c.orders.push(o);
    setStatus(o, 'assigned');
    if (S.policy === 'revenue' && fifo !== byPrio[0] && o === byPrio[0]) S.ruleHits[5]++;
    S.ruleHits[4]++; // Rule 5: every assignment sets the pickup wait
    log(`Platform assigned ${c.name} to #${o.id} ($${o.revenue}, waited ${fmt(waitingTime(o))}s)`, 'good');
    o.eta = estimate(o);
    return true;
  },
  cAccept(auto = false) {
    const o = chooseOrder((x) => x.status === 'assigned' && !x.accepted, byCourier);
    if (!o) return auto ? false : refuse(0, 'No assigned order is waiting for a courier to accept it.');
    o.accepted = true;
    log(`${o.courier.name} accepted assignment #${o.id}`);
    return true;
  },
  cTravel(auto = false) {
    const o = chooseOrder((x) => x.status === 'assigned' && x.accepted && !x.courier.task && x.courier.carry.length === 0, byCourier);
    if (!o) return auto ? false : refuse(0, 'No idle courier with an accepted assignment (accept first).');
    startTask(o.courier, 'toRestaurant', o);
    log(`${o.courier.name} driving to ${o.restaurant.name} for #${o.id}`);
    return true;
  },
  cPickup(auto = false) {
    const sel = S.selected;
    if (!auto && sel?.type === 'order' && STATUS.indexOf(sel.status) < 3)
      return refuse(3, `#${sel.id} is ${sel.status} — it cannot be picked up before it is ready (and assigned).`);
    const o = chooseOrder((x) => x.status === 'assigned' && x.accepted && !x.courier.task && atRestaurant(x), byCourier);
    if (!o) return auto ? false : refuse(0, 'No courier is waiting at a restaurant with an assigned order.');
    if (o.readyAt == null) return refuse(3, `#${o.id} is not ready.`); // guard; unreachable by construction
    pickupFor(o.courier, o);
    return true;
  },
  cDeliver(auto = false) {
    const o = chooseOrder((x) => x.status === 'picked_up' && !x.courier.task, byCourier);
    if (!o) return auto ? false : refuse(0, 'No courier holds a picked-up order (and is idle).');
    startTask(o.courier, 'toCustomer', o);
    log(`${o.courier.name} delivering #${o.id} to ${o.customer.name}`);
    return true;
  },
  addCourier() {
    if (S.couriers.length >= MAX_COURIERS) return refuse(1, `Courier capacity is limited to ${MAX_COURIERS} couriers.`);
    const c = addCourier(); log(`${c.name} joined the fleet`); return true;
  },
  delCourier() {
    if (S.couriers.length <= 1) return refuse(0, 'At least one courier is needed.');
    const c = [...S.couriers].reverse().find((x) => load(x) === 0 && !x.task);
    if (!c) return refuse(0, 'Every courier is busy — only an idle courier can be removed.');
    removeCourier(c);
    log(`${c.name} left the fleet`); return true;
  },
};
function removeCourier(c) {
  scene.remove(c.mesh, c.label);
  pickables.splice(pickables.indexOf(c.mesh), 1);
  S.couriers.splice(S.couriers.indexOf(c), 1);
  if (S.selected === c) S.selected = null;
}
function pickupFor(c, o) {
  o.pickedAt = S.time;
  c.orders.splice(c.orders.indexOf(o), 1); c.carry.push(o);
  setStatus(o, 'picked_up');
  log(`${c.name} picked up #${o.id} (order waited ${fmt(o.pickedAt - o.readyAt)}s for pickup)`);
}

// ---------- simulation step ------------------------------------------
function autoCourier(c) {
  if (c.task) return;
  for (const o of c.orders) if (!o.accepted) { o.accepted = true; log(`${c.name} accepted assignment #${o.id}`); }
  const here = c.orders.find((o) => dist(c.pos, o.restaurant.acc) < 1);
  if (here) { pickupFor(c, here); return; }
  if (c.carry.length) {
    const o = c.carry.slice().sort((a, b) => pathLen(c.pos, a.customer.acc) - pathLen(c.pos, b.customer.acc))[0];
    startTask(c, 'toCustomer', o);
    log(`${c.name} delivering #${o.id} to ${o.customer.name}`);
    return;
  }
  const o = c.orders[0];
  if (o) { startTask(c, 'toRestaurant', o); log(`${c.name} driving to ${o.restaurant.name} for #${o.id}`); }
}

function step(dt) {
  S.time += dt;
  // restaurants: preparation clocks run for orders being prepared (Rule 4)
  for (const o of S.orders) if (o.status === 'preparing' && o.prepRemaining > 0) o.prepRemaining = Math.max(0, o.prepRemaining - dt);

  // couriers drive along their road path
  for (const c of S.couriers) {
    if (!c.task) continue;
    let mv = COURIER_SPEED * dt;
    const path = c.task.path;
    while (mv > 0 && path.length) {
      const w = path[0], d = dist(c.pos, w);
      c.heading = Math.atan2(w.x - c.pos.x, w.z - c.pos.z);
      if (d <= mv) { c.pos.copy(w); mv -= d; path.shift(); }
      else { c.pos.x += (w.x - c.pos.x) / d * mv; c.pos.z += (w.z - c.pos.z) / d * mv; mv = 0; }
    }
    if (!path.length) {
      const o = c.task.order;
      if (c.task.kind === 'toRestaurant') log(`${c.name} arrived at ${o.restaurant.name}`);
      else {
        o.deliveredAt = S.time; setStatus(o, 'delivered');
        c.carry.splice(c.carry.indexOf(o), 1);
        S.delivered.push(o);
        o.goneAt = S.time + 5;
        log(`${c.name} delivered #${o.id} to ${o.customer.name} in ${fmt(o.deliveredAt - o.createdAt)}s`, 'good');
      }
      c.task = null;
    }
  }

  // autonomous agents (each can be switched off in the panel)
  const A = S.auto;
  if (A.customer && (S.timers.spawn -= dt) <= 0) {
    S.timers.spawn = rand(3, 7);
    if (S.orders.filter((o) => o.status !== 'delivered').length < 14) act.create();
  }
  if (A.restaurant) { while (act.accept(true)); while (act.ready(true)); }
  if (A.platform) {
    while (act.assign(true));
    if ((S.timers.evaluate -= dt) <= 0) {
      S.timers.evaluate = 1;
      unassigned().forEach((o) => { o.priority = priorityOf(o); });
      S.orders.forEach((o) => { if (o.status !== 'delivered') o.eta = estimate(o); });
    }
  }
  if (A.courier) S.couriers.forEach(autoCourier);

  for (const o of [...S.orders]) if (o.goneAt && S.time > o.goneAt) removeOrder(o);
}

// ---------- visual sync ----------------------------------------------
const tmp = new THREE.Vector3();
function targetFor(o, slot) {
  const r = o.restaurant.pos;
  switch (o.status) {
    case 'picked_up': {
      const c = o.courier, i = c.carry.indexOf(o);
      return tmp.set(c.pos.x + (i - (c.carry.length - 1) / 2) * 0.1, 1.5, c.pos.z + (i - (c.carry.length - 1) / 2) * 0.8);
    }
    case 'delivered': return tmp.set(o.customer.pos.x + 1.5, SLAB + 1.4, o.customer.pos.z + 4.6);
    default: return tmp.set(r.x + (slot - 1.5) * 1.7, SLAB, r.z + 4.8);
  }
}
let segN = 0;
function seg(a, b, color) {
  if (segN >= MAX_SEG) return;
  const i = segN++ * 6, c = new THREE.Color(color);
  linePos.set([a.x, a.y, a.z, b.x, b.y, b.z], i);
  lineCol.set([c.r, c.g, c.b, c.r, c.g, c.b], i);
}
const up = (v, y) => new THREE.Vector3(v.x, y, v.z);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function syncVisuals(dt) {
  const k = 1 - Math.exp(-dt * 9);
  const slots = new Map();
  for (const o of S.orders) {
    let slot = 0;
    if (['pending', 'preparing', 'ready', 'assigned'].includes(o.status)) {
      slot = slots.get(o.restaurant) ?? 0; slots.set(o.restaurant, slot + 1);
    }
    o.mesh.position.lerp(targetFor(o, slot), k);
    const life = o.status === 'delivered' ? Math.max(0, (o.goneAt - S.time) / 5) : 1;
    o.mesh.scale.setScalar(0.4 + 0.6 * Math.min(1, life * 2));
    o.label.position.set(o.mesh.position.x, o.mesh.position.y + o.size + 1.1, o.mesh.position.z);
    let sub;
    if (o.status === 'preparing') sub = o.prepRemaining > 0 ? `cooking ${Math.ceil(o.prepRemaining)}s` : 'done — mark ready';
    else if (o.status === 'delivered') sub = `${fmt(o.deliveredAt - o.createdAt)}s total`;
    else sub = o.eta != null ? `${o.status} · ETA ${Math.ceil(o.eta)}s` : o.status;
    setLabel(o.label, [{ t: `#${o.id}  $${o.revenue}`, c: '#3b3631', s: 40 }, { t: sub, c: dark(STATUS_COLOR[o.status], 0.62), s: 30 }]);
  }
  for (const r of S.restaurants) {
    const n = S.orders.filter((o) => o.restaurant === r && o.status === 'preparing').length;
    setLabel(r.label, [{ t: r.name, c: dark(r.color, 0.8), s: 42 },
      { t: `prep ${r.prepTime}s · cooking ${n}/${r.capacity}`, c: n >= r.capacity ? '#c0392b' : '#7a736b', s: 28 }]);
  }
  for (const c of S.customers) {
    const n = S.orders.filter((o) => o.customer === c && o.status !== 'delivered').length;
    setLabel(c.label, [{ t: c.name, c: '#2f5f45', s: 40 }, { t: n ? `waiting: ${n}` : 'idle', c: '#7a736b', s: 28 }]);
  }
  for (const c of S.couriers) {
    c.mesh.position.set(c.pos.x, 0.06, c.pos.z);
    c.rot += wrap(c.heading - c.rot) * Math.min(1, dt * 10);
    c.inner.rotation.y = c.rot;
    const l = load(c);
    const lc = l >= COURIER_CAPACITY ? 0xf26b6b : l > 0 ? 0x3b8fe8 : 0x5fd38d;
    c.lamp.material.color.setHex(lc); c.lamp.material.emissive.setHex(lc);
    c.label.position.set(c.pos.x, 3.6, c.pos.z);
    setLabel(c.label, [{ t: c.name, c: '#8a6a0a', s: 38 },
      { t: `${l}/${COURIER_CAPACITY} orders · ${c.task ? 'driving' : l ? 'stopped' : 'available'}`, c: l >= COURIER_CAPACITY ? '#c0392b' : '#7a736b', s: 26 }]);
  }
  platform.ring.rotation.z += dt * 1.1;
  const q = unassigned().length;
  setLabel(platform.label, [{ t: 'PLATFORM', c: '#2c4a8c', s: 46 },
    { t: `pending ${q} · free couriers ${S.couriers.filter((c) => load(c) < COURIER_CAPACITY).length}/${S.couriers.length}`, c: '#7a736b', s: 28 },
    { t: S.policy === 'fifo' ? 'allocation: FIFO' : 'allocation: revenue-weighted', c: S.policy === 'fifo' ? '#7a736b' : '#a2740a', s: 28 }]);
  const s = S.selected;
  selRing.visible = !!s;
  if (s) {
    const p = s.type === 'order' ? s.mesh.position : s.pos;
    selRing.position.set(p.x, s.type === 'courier' ? 0.12 : s.type === 'order' ? p.y + 0.05 : SLAB + 0.06, p.z);
    selRing.scale.setScalar(s.type === 'restaurant' ? 2.4 : s.type === 'platform' ? 2.4 : s.type === 'customer' ? 1.9 : s.type === 'order' ? 0.7 : 0.8);
  }
  // relationship lines
  segN = 0;
  for (const o of S.orders) {
    const op = o.mesh.position;
    if (o.status !== 'delivered') {
      seg(up(o.customer.pos, 4.2), op, REL_COLOR.creates);                      // CUSTOMER creates ORDER
      if (['pending', 'preparing', 'ready'].includes(o.status)) {
        seg(up(o.restaurant.pos, 5.4), op, REL_COLOR.prepares);                 // RESTAURANT prepares ORDER
        seg(platformTop, op, REL_COLOR.evaluates);                              // PLATFORM evaluates ORDER
      }
    }
    if (o.status === 'assigned' && o.courier) {                                 // PLATFORM assigns courier to ORDER
      seg(platformTop, up(o.courier.pos, 2), REL_COLOR.assigns);
      seg(up(o.courier.pos, 2), op, REL_COLOR.assigns);
    }
    if (o.status === 'picked_up' || o.status === 'delivered') seg(op, up(o.customer.pos, 4.2), REL_COLOR.carries); // COURIER picks up / delivers
  }
  lineGeo.setDrawRange(0, segN * 2);
  lineGeo.attributes.position.needsUpdate = true;
  lineGeo.attributes.color.needsUpdate = true;
}

// ---------- DOM panels -------------------------------------------------
const tag = (s) => `<span class="pill" style="background:${hex(STATUS_COLOR[s])}">${s}</span>`;
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
const locOf = (e) => `(${fmt(e.pos.x, 0)}, ${fmt(e.pos.z, 0)})`;
function infoHTML() {
  const s = S.selected;
  if (!s) return 'Click an order, customer, restaurant, courier or the platform. Actions use the selection when it applies.';
  if (s.type === 'order') {
    const total = s.deliveredAt != null ? s.deliveredAt - s.createdAt : S.time - s.createdAt;
    return `<div class="name">ORDER #${s.id}</div><table>
      ${row('revenue', '$' + s.revenue)}${row('status', tag(s.status))}
      ${row('creation time', fmt(s.createdAt) + 's')}
      ${row('total delivery time', s.deliveredAt != null ? fmt(total) + 's (final)' : fmt(total) + 's so far' + (s.eta != null ? ` · est. +${fmt(s.eta, 0)}s` : ''))}
      ${row('customer', s.customer.name)}${row('restaurant', s.restaurant.name)}
      ${row('courier', s.courier?.name ?? '—')}
      ${row('preparation', s.status === 'pending' ? `${fmt(s.prepTotal)}s (not started)` : s.prepRemaining > 0 ? `${fmt(s.prepRemaining)}s left` : 'done')}
      ${row('waited for pickup', s.pickedAt != null ? fmt(s.pickedAt - s.readyAt) + 's' : s.readyAt != null ? fmt(S.time - s.readyAt) + 's…' : '—')}
      ${row('priority', unassigned().includes(s) ? fmt(priorityOf(s)) : '—')}</table>`;
  }
  if (s.type === 'customer') {
    return `<div class="name">CUSTOMER ${s.name}</div><table>
      ${row('location', locOf(s))}
      ${row('order time', s.orderTime != null ? fmt(s.orderTime) + 's' : '—')}
      ${row('selected restaurant', s.selectedRestaurant?.name ?? '—')}
      ${row('open orders', S.orders.filter((o) => o.customer === s && o.status !== 'delivered').map((o) => '#' + o.id).join(' ') || '—')}</table>`;
  }
  if (s.type === 'restaurant') {
    const act_ = S.orders.filter((o) => o.restaurant === s && o.status === 'preparing');
    return `<div class="name">RESTAURANT ${s.name}</div><table>
      ${row('location', locOf(s))}
      ${row('preparation time', s.prepTime + 's (avg)')}
      ${row('active orders', act_.map((o) => '#' + o.id).join(' ') || '—')}
      ${row('production capacity', `${act_.length}/${s.capacity} at once`)}</table>`;
  }
  if (s.type === 'courier') {
    const dest = s.task ? (s.task.kind === 'toRestaurant' ? s.task.order.restaurant : s.task.order.customer) : null;
    return `<div class="name">COURIER ${s.name}</div><table>
      ${row('location', `(${fmt(s.pos.x, 0)}, ${fmt(s.pos.z, 0)})`)}
      ${row('availability', load(s) < COURIER_CAPACITY ? `available (${COURIER_CAPACITY - load(s)} slot${COURIER_CAPACITY - load(s) > 1 ? 's' : ''})` : 'full')}
      ${row('current assignment', [...s.orders, ...s.carry].map((o) => `#${o.id} (${o.status})`).join(', ') || '—')}
      ${row('travel time', dest ? `${fmt(pathLen(s.pos, dest.acc) / COURIER_SPEED)}s to ${dest.name}` : 'not driving')}</table>`;
  }
  const q = unassigned();
  return `<div class="name">PLATFORM</div><table>
    ${row('available couriers', S.couriers.filter((c) => load(c) < COURIER_CAPACITY).map((c) => c.name).join(' ') || 'none')}
    ${row('pending orders', q.map((o) => '#' + o.id).join(' ') || '—')}
    ${row('allocation logic', S.policy === 'fifo' ? 'FIFO (longest wait first)' : 'revenue-weighted: revenue + ½·wait')}
    ${row('delivery-time estimate', q.length ? `avg ${fmt(q.reduce((a, o) => a + (o.eta ?? estimate(o)), 0) / q.length)}s (pending)` : '—')}</table>`;
}
function queueHTML() {
  const q = unassigned().sort((a, b) => priorityOf(b) - priorityOf(a));
  if (!q.length) return '<span class="dim">empty</span>';
  return '<table>' + q.map((o, i) => `<tr><td style="width:auto">${i + 1}. #${o.id} $${o.revenue}</td><td>${tag(o.status)}</td><td style="text-align:right">p=${fmt(priorityOf(o))}</td></tr>`).join('') + '</table>';
}
function statsHTML() {
  const d = S.delivered;
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const tt = (o) => o.deliveredAt - o.createdAt;
  const hi = d.filter((o) => o.revenue >= HIGH_REVENUE), lo = d.filter((o) => o.revenue < HIGH_REVENUE);
  const busy = S.couriers.filter((c) => load(c) > 0).length;
  const k = (b, s) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`;
  return `<div class="kpis">
    ${k(fmt(S.time, 0) + 's', 'simulation time')}${k(`${busy}/${S.couriers.length}`, 'couriers busy')}
    ${k(d.length, 'delivered')}${k('$' + d.reduce((a, o) => a + o.revenue, 0), 'delivered revenue')}
    ${k(fmt(avg(d.map(tt))) + 's', 'avg delivery time')}${k(fmt(avg(d.map((o) => o.pickedAt - o.readyAt))) + 's', 'avg pickup wait')}
    ${k(fmt(avg(hi.map(tt))) + 's', `avg · revenue ≥ $${HIGH_REVENUE} (${hi.length})`)}${k(fmt(avg(lo.map(tt))) + 's', `avg · revenue < $${HIGH_REVENUE} (${lo.length})`)}
  </div>`;
}
const rulesHTML = () => RULES.map((r, i) => `<li><b>${r}</b>${S.ruleHits[i] ? ` <span class="hit">×${S.ruleHits[i]}</span>` : ''}</li>`).join('');
const logHTML = () => S.log.map((e) => `<div class="${e.kind}">[${fmt(e.t, 0)}s] ${e.msg}</div>`).join('');
let panelClock = 0;
function updatePanels(force) {
  panelClock = 0;
  $('stats').innerHTML = statsHTML();
  $('info').innerHTML = infoHTML();
  $('queue').innerHTML = queueHTML();
  $('rules').innerHTML = rulesHTML();
  if (logDirty || force) { $('log').innerHTML = logHTML(); logDirty = false; }
  $('btn-policy').textContent = 'Priority: ' + (S.policy === 'fifo' ? 'FIFO' : 'Revenue');
  $('btn-play').textContent = S.running ? '⏸ Pause' : '▶ Run';
}
$('legend').innerHTML = '<b>Order status</b>' + STATUS.map((s) => `<div><i style="background:${hex(STATUS_COLOR[s])}"></i>${s}</div>`).join('')
  + '<hr><b>Relationships</b>'
  + [['creates', 'customer → order'], ['prepares', 'restaurant → order'], ['evaluates', 'platform → order'], ['assigns', 'platform → courier → order'], ['carries', 'courier picks up / delivers']]
    .map(([k, t]) => `<div><i style="background:${hex(REL_COLOR[k])}"></i>${t}</div>`).join('')
  + '<hr><b>Roles</b>'
  + [['customer', 'customer'], ['restaurant', 'restaurant'], ['platform', 'platform'], ['courier', 'courier']]
    .map(([k, t]) => `<div><i style="background:${hex(ROLE[k])}"></i>${t}</div>`).join('')
  + '<hr><div class="dim">Box size = revenue</div>';

// ---------- panel wiring ---------------------------------------------
const bind = (id, fn) => $(id).addEventListener('click', () => { fn(); updatePanels(true); });
bind('btn-play', () => { S.running = !S.running; });
bind('btn-reset', () => resetWorld());
bind('btn-create', () => act.create());
bind('btn-accept-order', () => act.accept());
bind('btn-mark-ready', () => act.ready());
bind('btn-evaluate', () => act.evaluate());
bind('btn-estimate', () => act.estimate());
bind('btn-assign', () => act.assign());
bind('btn-policy', () => act.togglePolicy());
bind('btn-c-accept', () => act.cAccept());
bind('btn-c-travel', () => act.cTravel());
bind('btn-c-pickup', () => act.cPickup());
bind('btn-c-deliver', () => act.cDeliver());
bind('btn-add-courier', () => act.addCourier());
bind('btn-del-courier', () => act.delCourier());
$('sel-speed').addEventListener('change', (e) => { S.speed = parseFloat(e.target.value); });
for (const k of ['customer', 'restaurant', 'platform', 'courier']) {
  $('auto-' + k).checked = S.auto[k];
  $('auto-' + k).addEventListener('change', (e) => { S.auto[k] = e.target.checked; log(`Auto ${k}: ${e.target.checked ? 'on' : 'off'}`); });
}
$('btn-panel').addEventListener('click', () => {
  const c = $('panel').classList.toggle('collapsed');
  $('btn-panel').textContent = c ? '▸' : '▾';
});

function resetWorld() {
  [...S.orders].forEach(removeOrder);
  [...S.couriers].forEach(removeCourier);
  S.delivered.length = 0; S.log.length = 0;
  S.time = 0; S.nextOrder = 1; S.nextCourier = 1; S.selected = null; S.policy = 'fifo';
  S.ruleHits.fill(0); S.timers = { spawn: 1.5, evaluate: 0 };
  S.customers.forEach((c) => { c.orderTime = null; c.selectedRestaurant = null; });
  for (let i = 0; i < 3; i++) addCourier();
  log('World reset');
}

// ---------- picking --------------------------------------------------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(pickables, true)[0];
  S.selected = hit ? hit.object.userData.ref : null;
  updatePanels(true);
});

// ---------- main loop ------------------------------------------------
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  const a = innerWidth / innerHeight;
  Object.assign(camera, { left: -VIEW * a, right: VIEW * a, top: VIEW, bottom: -VIEW });
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

for (let i = 0; i < 3; i++) addCourier();
log('Simulation started — agents are running on auto. Untick an agent\'s "auto" to take over manually.');
resize();
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (S.running) step(dt * S.speed);
  controls.update();
  syncVisuals(dt);
  if ((panelClock += dt) > 0.25) updatePanels();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
updatePanels(true);
frame();
// exposed for debugging / automated checks
window.__sim = { S, act, step };
