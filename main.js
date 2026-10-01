import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

/* ====================================================================
   Delivery-platform semantic model — simulation + three.js view
   ORDER is the central object; CUSTOMER, RESTAURANT, COURIER and
   PLATFORM are the connected agents.
   ==================================================================== */

// ---------- constants ------------------------------------------------
const COURIER_SPEED = 5;          // world units per simulated second
const COURIER_CAPACITY = 2;       // Rule 2: orders one courier can hold at once
const MAX_COURIERS = 5;           // Rule 1: courier capacity is limited
const HIGH_REVENUE = 35;          // threshold used only for the revenue statistics
const STATUS = ['pending', 'preparing', 'ready', 'assigned', 'picked_up', 'delivered'];
const STATUS_COLOR = {
  pending: 0xb3bab5, preparing: 0xf0b25c, ready: 0x7cc48a,
  assigned: 0x6fa8dc, picked_up: 0xb597d9, delivered: 0x57c4b6,
};
const REL_COLOR = {
  creates: 0xd9a21b, prepares: 0xe07b39, evaluates: 0x9aa5a0, assigns: 0x3d7fd1, carries: 0x8b5cc6,
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

// ---------- helpers --------------------------------------------------
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '–');
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const INK = 0x56655b;
const dark = (c, f = 0.55) => '#' + [16, 8, 0].map((sh) => Math.round(((c >> sh) & 255) * f).toString(16).padStart(2, '0')).join('');
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// ---------- three.js scene -------------------------------------------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8efe4);
const VIEW = 30; // half-height of the isometric view, in world units
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -300, 400);
camera.position.set(55, 46, 45);
const controls = new OrbitControls(camera, canvas);
controls.target.set(9, 0, -3);
controls.maxPolarAngle = Math.PI * 0.48;
controls.minZoom = 0.6;
controls.maxZoom = 3.5;
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe9db, 2.6));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(25, 45, 20);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshLambertMaterial({ color: 0xd3e0cf }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new THREE.GridHelper(120, 60, 0xc2d3bd, 0xc9d9c4);
grid.position.y = 0.01;
scene.add(grid);

function makeLabel(w, h) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(256 * (w / h)); cv.height = 256;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(w, h, 1);
  sprite.renderOrder = 10;
  sprite.userData = { cv, tex, key: '' };
  return sprite;
}
/** lines: [{t, c?, s?}] drawn centred; redraws only when content changes */
function setLabel(sprite, lines, bg = 'rgba(255,255,255,.9)') {
  const key = JSON.stringify(lines) + bg;
  if (sprite.userData.key === key) return;
  sprite.userData.key = key;
  const { cv, tex } = sprite.userData;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const pad = 10, r = 26;
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(pad, pad, cv.width - 2 * pad, cv.height - 2 * pad, r); g.fill();
  g.lineWidth = 4; g.strokeStyle = '#8fa396'; g.stroke();
  const total = lines.reduce((a, l) => a + (l.s || 56), 0) * 1.15;
  let y = (cv.height - total) / 2;
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const l of lines) {
    const s = l.s || 56;
    g.font = `500 ${s}px system-ui, sans-serif`;
    g.fillStyle = l.c || '#2c3a31';
    g.fillText(l.t, cv.width / 2, y);
    y += s * 1.15;
  }
  tex.needsUpdate = true;
}

const mat = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
const edgeMat = new THREE.LineBasicMaterial({ color: INK });
/** thin ink outline, like the line-drawn buildings of the reference style */
function shadowed(m) {
  if (m.geometry.type !== 'SphereGeometry') m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 20), edgeMat));
  return m;
}
function register(mesh, ref) {
  mesh.traverse((o) => { if (o.isMesh || o.isLineSegments) o.userData.ref = ref; });
  pickables.push(mesh);
}
const pickables = [];

// ---------- world state ----------------------------------------------
const S = {
  time: 0, running: true, speed: 1, policy: 'fifo', // 'fifo' | 'revenue'
  nextOrder: 1, nextCourier: 1,
  orders: [], couriers: [], restaurants: [], customers: [],
  selected: null,
  auto: { customer: false, restaurant: false, platform: false, courier: false },
  timers: { spawn: 2, evaluate: 0 },
  ruleHits: new Array(7).fill(0),
  log: [],
  delivered: [],
};

const platform = { type: 'platform', name: 'PLATFORM', pos: new THREE.Vector3(0, 0, 0) };
{
  const g = new THREE.Group();
  const base = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 1.2, 24), mat(0xf4f6f2)));
  base.position.y = 0.6;
  const tower = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 5, 24), mat(0xffffff)));
  tower.position.y = 3.6;
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.1, 24, 16), new THREE.MeshLambertMaterial({ color: 0xa9c7a5, emissive: 0x4d7a52, emissiveIntensity: .35 }));
  core.position.y = 7;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, .12, 8, 48), new THREE.MeshBasicMaterial({ color: 0xf0b9a0 }));
  ring.position.y = 7; ring.rotation.x = Math.PI / 2.4;
  g.add(base, tower, core, ring);
  g.userData.ring = ring;
  scene.add(g);
  platform.mesh = g; platform.ring = ring;
  platform.label = makeLabel(11, 5.5); platform.label.position.set(0, 12, 0);
  scene.add(platform.label);
  register(g, platform);
}
const platformTop = new THREE.Vector3(0, 7, 0);

function addRestaurant(name, x, z, prep, cap, color) {
  const r = { type: 'restaurant', name, pos: new THREE.Vector3(x, 0, z), prepTime: prep, capacity: cap, color };
  const g = new THREE.Group();
  const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 3.6), mat(0xfbfbf8)));
  body.position.y = 1.3;
  const roof = shadowed(new THREE.Mesh(new THREE.BoxGeometry(5.4, .35, 4), mat(color)));
  roof.position.y = 2.8;
  const chim = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, 1.2, 12), mat(0xe8ebe6)));
  chim.position.set(1.5, 3.5, -.8);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1, 1.6, .1), mat(0xaab9ae));
  door.position.set(-1, .8, 1.82);
  g.add(body, roof, chim, door);
  g.position.copy(r.pos);
  scene.add(g);
  r.mesh = g;
  r.label = makeLabel(10, 5); r.label.position.set(x, 7, z); scene.add(r.label);
  register(g, r);
  S.restaurants.push(r);
}
function addCustomer(name, x, z) {
  const c = { type: 'customer', name, pos: new THREE.Vector3(x, 0, z), orderTime: null, selectedRestaurant: null };
  const g = new THREE.Group();
  const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 2.4), mat(0xfbfbf8)));
  body.position.y = .9;
  const roof = shadowed(new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.3, 4), mat(0xa9c7a5)));
  roof.position.y = 2.45; roof.rotation.y = Math.PI / 4;
  g.add(body, roof);
  g.position.copy(c.pos);
  scene.add(g);
  c.mesh = g;
  c.label = makeLabel(5.6, 2.8); c.label.position.set(x, 5.6, z); scene.add(c.label);
  register(g, c);
  S.customers.push(c);
}
addRestaurant('R1 Burger', -16, -10, 6, 2, 0xf1c3a3);
addRestaurant('R2 Ramen', 16, -12, 10, 2, 0xeba79a);
addRestaurant('R3 Slow-Roast', -2, 17, 14, 1, 0xc9b8dd);
[['C1', -21, 6], ['C2', -6, -19], ['C3', 9, -3], ['C4', 21, 8], ['C5', 12, 19], ['C6', -9, 5]]
  .forEach(([n, x, z]) => addCustomer(n, x, z));

// ---- scenery in the line-drawn isometric style: roads, trees, quiet white blocks ----
{
  const roadM = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const road = (x1, z1, x2, z2, w = 2.4) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, w), roadM);
    m.position.set((x1 + x2) / 2, 0.04, (z1 + z2) / 2);
    m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    scene.add(m);
  };
  const ring = new THREE.Mesh(new THREE.RingGeometry(5.2, 7.6, 48), roadM);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; scene.add(ring);
  for (const r of S.restaurants) road(0, 0, r.pos.x, r.pos.z + 3.4);
  for (const c of S.customers) road(0, 0, c.pos.x, c.pos.z + 2.4, 1.6);
  const keepOut = [platform, ...S.restaurants, ...S.customers];
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const free = (x, z, r) => keepOut.every((e) => Math.hypot(e.pos.x - x, e.pos.z - z) > r) && Math.hypot(x, z) > 9;
  const treeTrunk = mat(0xd9cdb6), treeLeaf = [mat(0x9cc49a), mat(0xb3d4ad), mat(0x86b58a)];
  for (let n = 0, placed = 0; n < 400 && placed < 70; n++) {
    const x = (rnd() - 0.5) * 70, z = (rnd() - 0.5) * 70;
    if (!free(x, z, 6)) continue;
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.1, .12, 1, 6), treeTrunk); trunk.position.y = .5;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(.5 + rnd() * .35, 14, 10), treeLeaf[placed % 3]); crown.position.y = 1.5;
    t.add(trunk, crown); t.position.set(x, 0, z); scene.add(t); placed++;
  }
  const block = mat(0xfbfbf8);
  for (let n = 0, placed = 0; n < 300 && placed < 16; n++) {
    const a = rnd() * Math.PI * 2, d = 32 + rnd() * 16;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!free(x, z, 6)) continue;
    const w = 2.5 + rnd() * 2, h = 3 + rnd() * 7;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * (.8 + rnd() * .5)), block);
    b.position.set(x, h / 2, z); b.add(new THREE.LineSegments(new THREE.EdgesGeometry(b.geometry), edgeMat)); scene.add(b); placed++;
  }
}

function addCourier() {
  if (S.couriers.length >= MAX_COURIERS) return null;
  const idx = S.nextCourier++;
  const a = idx * 1.9;
  const c = {
    type: 'courier', name: 'K' + idx, pos: new THREE.Vector3(Math.cos(a) * 5, 0, Math.sin(a) * 5),
    orders: [], carry: [], task: null, bob: Math.random() * 6,
  };
  const g = new THREE.Group();
  const body = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, 1.5, 12), mat(0x9fd4a8)));
  body.rotation.z = Math.PI / 2; body.position.y = .55;
  const head = shadowed(new THREE.Mesh(new THREE.SphereGeometry(.4, 12, 10), mat(0xf2cdb5)));
  head.position.set(0, 1.3, 0);
  const wheelM = mat(0x11161d);
  for (const dx of [-.7, .7]) {
    const w = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .2, 12), wheelM));
    w.rotation.x = Math.PI / 2; w.position.set(dx, .3, 0); g.add(w);
  }
  g.add(body, head);
  g.position.copy(c.pos);
  scene.add(g);
  c.mesh = g; c.body = body;
  c.label = makeLabel(5.6, 2.8); scene.add(c.label);
  register(g, c);
  S.couriers.push(c);
  return c;
}

// selection ring
const selRing = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.6, 40), new THREE.MeshBasicMaterial({ color: INK, side: THREE.DoubleSide, transparent: true, opacity: .75 }));
selRing.rotation.x = -Math.PI / 2; selRing.position.y = .05; selRing.visible = false;
scene.add(selRing);

// relationship lines (rebuilt every frame from the model)
const MAX_SEG = 800;
const linePos = new Float32Array(MAX_SEG * 6), lineCol = new Float32Array(MAX_SEG * 6);
const lineGeo = new THREE.BufferGeometry();
lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3).setUsage(THREE.DynamicDrawUsage));
const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .85 }));
lines.frustumCulled = false;
scene.add(lines);

// ---------- logging / toast ------------------------------------------
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function log(msg, kind = '') {
  S.log.unshift({ t: S.time, msg, kind });
  if (S.log.length > 60) S.log.pop();
  logDirty = true;
}
let logDirty = true;
/** a refused action: explains which rule bound it */
function refuse(rule, msg) {
  if (rule) S.ruleHits[rule - 1]++;
  const text = (rule ? `Rule ${rule}: ` : '') + msg;
  log(text, 'bad'); toast(text);
  return false;
}

// ---------- order model ----------------------------------------------
function load(c) { return c.orders.length + c.carry.length; }
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
  const size = 0.7 + o.revenue / 60 * 0.9;
  const g = new THREE.Group();
  const box = shadowed(new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat(STATUS_COLOR.pending)));
  box.position.y = size / 2;
  g.add(box);
  g.position.copy(restaurant.pos).add(new THREE.Vector3(0, 0.3, 2.8));
  scene.add(g);
  o.mesh = g; o.box = box; o.size = size;
  o.label = makeLabel(6.4, 2.8); scene.add(o.label);
  register(g, o);
  S.orders.push(o);
  log(`${customer.name} created order #${o.id} ($${o.revenue}) at ${restaurant.name}`);
  return o;
}
function setStatus(o, s) {
  o.status = s;
  o.box.material.color.setHex(STATUS_COLOR[s]);
}
function removeOrder(o) {
  scene.remove(o.mesh, o.label);
  const i = pickables.indexOf(o.mesh); if (i >= 0) pickables.splice(i, 1);
  S.orders.splice(S.orders.indexOf(o), 1);
  if (S.selected === o) S.selected = null;
}

/** Platform delivery-time estimate (seconds from now until delivered). */
function estimate(o) {
  if (o.status === 'delivered') return 0;
  const legB = dist(o.restaurant.pos, o.customer.pos) / COURIER_SPEED;
  if (o.status === 'picked_up') return dist(o.courier.pos, o.customer.pos) / COURIER_SPEED;
  const ready = o.status === 'pending' ? o.prepTotal + 1.5
    : o.status === 'preparing' ? Math.max(0, o.prepRemaining) : 0;
  let arrive;
  if (o.courier) arrive = dist(o.courier.pos, o.restaurant.pos) / COURIER_SPEED + load(o.courier) * 3;
  else {
    const free = S.couriers.filter((c) => load(c) < COURIER_CAPACITY);
    arrive = free.length
      ? Math.min(...free.map((c) => dist(c.pos, o.restaurant.pos) / COURIER_SPEED + load(c) * 3))
      : 12; // no courier free: assumed wait
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
const byCourier = (o, s) => s.type === 'courier' && (o.courier === s);

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
    S.orders.forEach((o) => { if (o.status !== 'delivered') o.eta = estimate(o); });
    log(`Platform updated delivery-time estimates for ${S.orders.filter((o) => o.status !== 'delivered').length} order(s)`);
    return true;
  },
  togglePolicy() {
    S.policy = S.policy === 'fifo' ? 'revenue' : 'fifo';
    unassigned().forEach((o) => { o.priority = priorityOf(o); });
    log(`Platform updated priority logic → ${S.policy === 'fifo' ? 'FIFO (waiting time)' : 'revenue-weighted (hypothesis)'}`);
    return true;
  },
  assign(auto = false) {
    // Candidates: only ready orders can be assigned (pending→preparing→ready→assigned).
    const sel = S.selected;
    let cands = S.orders.filter((o) => o.status === 'ready' && !o.courier);
    if (!cands.length) {
      if (auto) return false;
      return refuse(0, 'No ready order awaits a courier.');
    }
    cands.forEach((o) => { o.priority = priorityOf(o); });
    const byPrio = [...cands].sort((a, b) => b.priority - a.priority);
    let o = byPrio[0];
    if (sel?.type === 'order' && cands.includes(sel)) o = sel;
    // Rule 6: did revenue change the choice relative to FIFO?
    const fifo = [...cands].sort((a, b) => waitingTime(b) - waitingTime(a))[0];
    const free = S.couriers.filter((c) => load(c) < COURIER_CAPACITY);
    if (!free.length) {
      if (auto) return false;
      return S.couriers.length >= MAX_COURIERS || S.couriers.every((c) => load(c) >= COURIER_CAPACITY)
        ? refuse(S.couriers.some((c) => load(c) > 0) ? 2 : 1, `All ${S.couriers.length} couriers are at capacity (${COURIER_CAPACITY} orders each) — #${o.id} must wait.`)
        : refuse(1, 'No courier available.');
    }
    free.sort((a, b) => dist(a.pos, o.restaurant.pos) + load(a) * 6 - (dist(b.pos, o.restaurant.pos) + load(b) * 6));
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
    const idle = (c) => !c.task;
    const o = chooseOrder((x) => x.status === 'assigned' && x.accepted && idle(x.courier) && x.courier.carry.length === 0, byCourier);
    if (!o) return auto ? false : refuse(0, 'No idle courier with an accepted assignment (accept first).');
    o.courier.task = { kind: 'toRestaurant', order: o };
    log(`${o.courier.name} travelling to ${o.restaurant.name} for #${o.id}`);
    return true;
  },
  cPickup(auto = false) {
    const sel = S.selected;
    if (!auto && sel?.type === 'order' && sel.status !== 'assigned' && STATUS.indexOf(sel.status) < 3)
      return refuse(3, `#${sel.id} is ${sel.status} — it cannot be picked up before it is ready (and assigned).`);
    const o = chooseOrder((x) => x.status === 'assigned' && x.accepted && !x.courier.task
      && dist(x.courier.pos, x.restaurant.pos) < 1.8, byCourier);
    if (!o) return auto ? false : refuse(0, 'No courier is waiting at a restaurant with an assigned order.');
    if (o.readyAt == null) return refuse(3, `#${o.id} is not ready.`); // guard; unreachable by construction
    o.pickedAt = S.time;
    o.courier.orders.splice(o.courier.orders.indexOf(o), 1);
    o.courier.carry.push(o);
    setStatus(o, 'picked_up');
    log(`${o.courier.name} picked up #${o.id} (order waited ${fmt(o.pickedAt - o.readyAt)}s for pickup)`);
    return true;
  },
  cDeliver(auto = false) {
    const o = chooseOrder((x) => x.status === 'picked_up' && !x.courier.task, byCourier);
    if (!o) return auto ? false : refuse(0, 'No courier holds a picked-up order (and is idle).');
    o.courier.task = { kind: 'toCustomer', order: o };
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
    scene.remove(c.mesh, c.label);
    pickables.splice(pickables.indexOf(c.mesh), 1);
    S.couriers.splice(S.couriers.indexOf(c), 1);
    if (S.selected === c) S.selected = null;
    log(`${c.name} left the fleet`); return true;
  },
};

// ---------- simulation step ------------------------------------------
function autoCourier(c) {
  if (c.task) return;
  const here = c.orders.find((o) => o.accepted && dist(c.pos, o.restaurant.pos) < 1.8);
  for (const o of c.orders) if (!o.accepted) { o.accepted = true; log(`${c.name} accepted assignment #${o.id}`); }
  if (here) { pickupFor(c, here); return; }
  if (c.carry.length) {
    const o = c.carry.slice().sort((a, b) => dist(c.pos, a.customer.pos) - dist(c.pos, b.customer.pos))[0];
    c.task = { kind: 'toCustomer', order: o };
    log(`${c.name} delivering #${o.id} to ${o.customer.name}`);
    return;
  }
  const o = c.orders[0];
  if (o) { c.task = { kind: 'toRestaurant', order: o }; log(`${c.name} travelling to ${o.restaurant.name} for #${o.id}`); }
}
function pickupFor(c, o) {
  o.pickedAt = S.time;
  c.orders.splice(c.orders.indexOf(o), 1); c.carry.push(o);
  setStatus(o, 'picked_up');
  log(`${c.name} picked up #${o.id} (order waited ${fmt(o.pickedAt - o.readyAt)}s for pickup)`);
}

function step(dt) {
  S.time += dt;
  // restaurants: preparation clocks run for orders being prepared (Rule 4)
  for (const o of S.orders) if (o.status === 'preparing' && o.prepRemaining > 0) o.prepRemaining = Math.max(0, o.prepRemaining - dt);

  // couriers move
  for (const c of S.couriers) {
    if (!c.task) continue;
    const o = c.task.order;
    const target = c.task.kind === 'toRestaurant' ? o.restaurant.pos : o.customer.pos;
    const d = dist(c.pos, target);
    const mv = COURIER_SPEED * dt;
    if (d <= mv) {
      c.pos.x = target.x; c.pos.z = target.z;
      if (c.task.kind === 'toRestaurant') log(`${c.name} arrived at ${o.restaurant.name}`);
      else {
        o.deliveredAt = S.time; setStatus(o, 'delivered');
        c.carry.splice(c.carry.indexOf(o), 1);
        S.delivered.push(o);
        o.goneAt = S.time + 5;
        log(`${c.name} delivered #${o.id} to ${o.customer.name} in ${fmt(o.deliveredAt - o.createdAt)}s`, 'good');
      }
      c.task = null;
    } else {
      c.pos.x += (target.x - c.pos.x) / d * mv;
      c.pos.z += (target.z - c.pos.z) / d * mv;
      c.heading = Math.atan2(target.x - c.pos.x, target.z - c.pos.z);
    }
  }

  // autonomous agents
  const A = S.auto;
  if (A.customer && (S.timers.spawn -= dt) <= 0) {
    S.timers.spawn = rand(3, 7);
    if (S.orders.filter((o) => o.status !== 'delivered').length < 14) act.create();
  }
  if (A.restaurant) { while (act.accept(true)); while (act.ready(true)); }
  if (A.platform) {
    while (act.assign(true));
    if ((S.timers.evaluate -= dt) <= 0) { S.timers.evaluate = 1; unassigned().forEach((o) => { o.priority = priorityOf(o); }); S.orders.forEach((o) => { if (o.status !== 'delivered') o.eta = estimate(o); }); }
  }
  if (A.courier) S.couriers.forEach(autoCourier);

  // cleanup delivered orders after a short display time
  for (const o of [...S.orders]) if (o.goneAt && S.time > o.goneAt) removeOrder(o);
}

// ---------- visual sync ----------------------------------------------
const tmp = new THREE.Vector3();
function targetFor(o, slot) {
  const r = o.restaurant.pos;
  switch (o.status) {
    case 'picked_up': {
      const c = o.courier, i = c.carry.indexOf(o);
      return tmp.set(c.pos.x + (i - (c.carry.length - 1) / 2) * 0.9, 2.0 + o.size / 2, c.pos.z);
    }
    case 'delivered': return tmp.set(o.customer.pos.x, 0.4 + o.size / 2 + 1.2, o.customer.pos.z + 1.8);
    default: return tmp.set(r.x + (slot - 1.5) * 1.5, 0.3, r.z + 2.9);
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

function syncVisuals(dt) {
  const k = 1 - Math.exp(-dt * 9);
  // orders
  const slots = new Map();
  for (const o of S.orders) {
    let slot = 0;
    if (['pending', 'preparing', 'ready', 'assigned'].includes(o.status)) {
      slot = slots.get(o.restaurant) ?? 0; slots.set(o.restaurant, slot + 1);
    }
    const tg = targetFor(o, slot);
    o.mesh.position.lerp(tg, k);
    o.box.rotation.y += dt * (o.status === 'picked_up' ? 1.5 : 0.2);
    const col = STATUS_COLOR[o.status];
    o.box.material.emissive.setHex(o === S.selected ? 0x555555 : 0x000000);
    const life = o.status === 'delivered' ? Math.max(0, (o.goneAt - S.time) / 5) : 1;
    o.mesh.scale.setScalar(0.4 + 0.6 * Math.min(1, life * 2));
    o.label.position.set(o.mesh.position.x, o.mesh.position.y + o.size + 1.5, o.mesh.position.z);
    let sub;
    if (o.status === 'preparing') sub = o.prepRemaining > 0 ? `cooking ${Math.ceil(o.prepRemaining)}s` : 'done — mark ready';
    else if (o.status === 'delivered') sub = `${fmt(o.deliveredAt - o.createdAt)}s total`;
    else sub = o.eta != null ? `${o.status} · ETA ${Math.ceil(o.eta)}s` : o.status;
    setLabel(o.label, [{ t: `#${o.id}  $${o.revenue}`, c: '#26332b', s: 70 }, { t: sub, c: dark(col, .6), s: 46 }]);
  }
  // restaurants
  for (const r of S.restaurants) {
    const act_ = S.orders.filter((o) => o.restaurant === r && o.status === 'preparing').length;
    setLabel(r.label, [{ t: r.name, c: dark(r.color, .5), s: 58 },
      { t: `prep ${r.prepTime}s · cooking ${act_}/${r.capacity}`, c: act_ >= r.capacity ? '#c0392b' : '#66746b', s: 40 }]);
  }
  for (const c of S.customers) {
    const n = S.orders.filter((o) => o.customer === c && o.status !== 'delivered').length;
    setLabel(c.label, [{ t: c.name, c: '#8a6d12', s: 64 }, { t: n ? `waiting: ${n}` : 'idle', c: '#66746b', s: 42 }]);
  }
  // couriers
  for (const c of S.couriers) {
    c.bob += dt * 8;
    c.mesh.position.set(c.pos.x, Math.abs(Math.sin(c.bob)) * (c.task ? .12 : 0), c.pos.z);
    if (c.heading !== undefined) c.mesh.rotation.y = c.heading - Math.PI / 2;
    const l = load(c);
    c.body.material.color.setHex(l >= COURIER_CAPACITY ? 0xea9a9a : l > 0 ? 0x8dbbe8 : 0x9fd4a8);
    c.label.position.set(c.pos.x, 3.6, c.pos.z);
    setLabel(c.label, [{ t: c.name, c: '#2c5f9e', s: 62 },
      { t: `${l}/${COURIER_CAPACITY} orders · ${c.task ? 'moving' : l ? 'stopped' : 'available'}`, c: l >= COURIER_CAPACITY ? '#c0392b' : '#66746b', s: 34 }]);
  }
  // platform
  platform.ring.rotation.z += dt * 1.2;
  const q = unassigned().length;
  setLabel(platform.label, [{ t: 'PLATFORM', c: '#26332b', s: 64 },
    { t: `pending ${q} · free couriers ${S.couriers.filter((c) => load(c) < COURIER_CAPACITY).length}/${S.couriers.length}`, c: '#66746b', s: 36 },
    { t: S.policy === 'fifo' ? 'allocation: FIFO' : 'allocation: revenue-weighted', c: S.policy === 'fifo' ? '#66746b' : '#a2740a', s: 36 }]);
  // selection ring
  const s = S.selected;
  selRing.visible = !!s;
  if (s) {
    const p = s.type === 'order' ? s.mesh.position : s.pos;
    selRing.position.set(p.x, 0.06, p.z);
    selRing.scale.setScalar(s.type === 'restaurant' ? 1.5 : s.type === 'platform' ? 1.7 : s.type === 'order' ? 0.7 : 1);
  }
  // relationship lines
  segN = 0;
  for (const o of S.orders) {
    const op = o.mesh.position;
    if (o.status !== 'delivered') {
      seg(up(o.customer.pos, 2.4), op, REL_COLOR.creates);                    // CUSTOMER creates ORDER
      if (['preparing', 'ready'].includes(o.status) || o.status === 'pending') // RESTAURANT prepares ORDER
        seg(up(o.restaurant.pos, 2.6), op, REL_COLOR.prepares);
      if (['pending', 'preparing', 'ready'].includes(o.status))               // PLATFORM evaluates ORDER
        seg(platformTop, op, REL_COLOR.evaluates);
    }
    if (o.status === 'assigned' && o.courier) {                               // PLATFORM assigns courier to ORDER
      seg(platformTop, up(o.courier.pos, 1.2), REL_COLOR.assigns);
      seg(up(o.courier.pos, 1.2), op, REL_COLOR.assigns);
    }
    if (o.status === 'picked_up' || o.status === 'delivered') seg(op, up(o.customer.pos, 2.4), REL_COLOR.carries); // COURIER picks up / delivers
  }
  lineGeo.setDrawRange(0, segN * 2);
  lineGeo.attributes.position.needsUpdate = true;
  lineGeo.attributes.color.needsUpdate = true;
}

// ---------- DOM panels -------------------------------------------------
const tag = (s) => `<span class="pill" style="background:${hex(STATUS_COLOR[s])}">${s}</span>`;
function row(k, v) { return `<tr><td>${k}</td><td>${v}</td></tr>`; }
function infoHTML() {
  const s = S.selected;
  if (!s) return 'Click an order, customer, restaurant, courier or the platform. Toolbar actions use the selection when it applies.';
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
      ${row('location', `(${fmt(s.pos.x, 0)}, ${fmt(s.pos.z, 0)})`)}
      ${row('order time', s.orderTime != null ? fmt(s.orderTime) + 's' : '—')}
      ${row('selected restaurant', s.selectedRestaurant?.name ?? '—')}
      ${row('open orders', S.orders.filter((o) => o.customer === s && o.status !== 'delivered').map((o) => '#' + o.id).join(' ') || '—')}</table>`;
  }
  if (s.type === 'restaurant') {
    const act_ = S.orders.filter((o) => o.restaurant === s && o.status === 'preparing');
    return `<div class="name">RESTAURANT ${s.name}</div><table>
      ${row('location', `(${fmt(s.pos.x, 0)}, ${fmt(s.pos.z, 0)})`)}
      ${row('preparation time', s.prepTime + 's (avg)')}
      ${row('active orders', act_.map((o) => '#' + o.id).join(' ') || '—')}
      ${row('production capacity', `${act_.length}/${s.capacity} at once`)}</table>`;
  }
  if (s.type === 'courier') {
    const eta = s.task ? dist(s.pos, s.task.kind === 'toRestaurant' ? s.task.order.restaurant.pos : s.task.order.customer.pos) / COURIER_SPEED : null;
    return `<div class="name">COURIER ${s.name}</div><table>
      ${row('location', `(${fmt(s.pos.x, 0)}, ${fmt(s.pos.z, 0)})`)}
      ${row('availability', load(s) < COURIER_CAPACITY ? `available (${COURIER_CAPACITY - load(s)} slot${COURIER_CAPACITY - load(s) > 1 ? 's' : ''})` : 'full')}
      ${row('current assignment', [...s.orders, ...s.carry].map((o) => `#${o.id} (${o.status})`).join(', ') || '—')}
      ${row('travel time', eta != null ? `${fmt(eta)}s to ${s.task.kind === 'toRestaurant' ? s.task.order.restaurant.name : s.task.order.customer.name}` : 'not travelling')}</table>`;
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
  if (!q.length) return '<span style="color:var(--dim)">empty</span>';
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
function rulesHTML() {
  return RULES.map((r, i) => `<li><b>${r}</b>${S.ruleHits[i] ? ` <span class="hit">×${S.ruleHits[i]}</span>` : ''}</li>`).join('');
}
function logHTML() {
  return S.log.map((e) => `<div class="${e.kind}">[${fmt(e.t, 0)}s] ${e.msg}</div>`).join('');
}
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
  + '<hr><div style="color:var(--dim)">Box size = revenue</div>';

// ---------- toolbar wiring -------------------------------------------
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
for (const k of ['customer', 'restaurant', 'platform', 'courier'])
  $('auto-' + k).addEventListener('change', (e) => { S.auto[k] = e.target.checked; log(`Auto ${k}: ${e.target.checked ? 'on' : 'off'}`); logDirty = true; });

function resetWorld() {
  [...S.orders].forEach(removeOrder);
  [...S.couriers].forEach((c) => { scene.remove(c.mesh, c.label); pickables.splice(pickables.indexOf(c.mesh), 1); });
  S.couriers.length = 0; S.delivered.length = 0; S.log.length = 0;
  S.time = 0; S.nextOrder = 1; S.nextCourier = 1; S.selected = null; S.policy = 'fifo';
  S.ruleHits.fill(0); S.timers = { spawn: 2, evaluate: 0 };
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
  document.documentElement.style.setProperty('--tb', $('toolbar').offsetHeight + 'px');
}
addEventListener('resize', resize);

for (let i = 0; i < 3; i++) addCourier();
log('Ready. Create an order, then walk it through the actions (or switch agents to auto).');
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
