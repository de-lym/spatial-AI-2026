import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import {
  SCALE_M, cfg, world, bump, toLocal, fromLocal, dist3, zoneAt, segCheck, planRoute, planMission, routeLength,
  nearestObstacle, buildingsNear, streetsCrossed, nearestLandmark, bearingDeg, compassWord, agentsAt, agentsInBox,
  namedVolumes, volumesAt, blockAt, roofUnder, ceilingMAt, inPermitted,
} from './spatial.js';

/* ====================================================================
   AIRSPACE — a location-aware drone delivery sandbox (synthetic, classroom only)
   ORDER is the central object; CUSTOMER, RESTAURANT, COURIER (a drone) and
   PLATFORM are the connected agents. Four drones fly in a fictional block city
   where airspace is a VOLUME: translucent permitted prisms (mint), restricted
   prisms (blush red) and solid buildings. Four stages — classify airspace,
   generate candidate routes, select + smooth one, fly it — and every drone is
   described twice, as machine state (XYZ…) and as a human-readable update.
   ==================================================================== */

// ---------- constants ------------------------------------------------
const DRONE_SPEED = 4;            // scene units per simulated second (= 20 m/s, illustrative)
const VERT_SPEED = 0.7;           // climb / descent speed factor
const COURIER_CAPACITY = 2;       // Rule 2: orders one drone holds at once
const MAX_COURIERS = 4;           // Rule 1: fleet capacity is limited (exactly four drones: D-01 … D-04)
const HIGH_REVENUE = 35;          // threshold used only for the revenue statistics
const STATUS = ['pending', 'preparing', 'ready', 'assigned', 'picked_up', 'delivered'];
const STATUS_COLOR = {
  pending: 0xb8b2ab, preparing: 0xf5a623, ready: 0x3fbf8f,
  assigned: 0x3b8fe8, picked_up: 0x8b6fe0, delivered: 0x2cc7c0,
};
const REL_COLOR = {
  creates: 0x3f8f5f, prepares: 0xe8472f, evaluates: 0x9aa3ad, assigns: 0x2c4a8c, carries: 0xd9a21b,
};
const PATH_COLOR = { blocked: 0xd32f2f };
// airspace + route language (spec): mint = permitted volume, blush red = restricted, amber = temporary hazard,
// muted cyan/violet = candidate routes, cobalt = selected route
const AIR = { permitted: 0x6fcf9f, edgePermitted: 0x3fa874, restricted: 0xe0707c, edgeRestricted: 0xc8404f, hazard: 0xf0b13a, edgeHazard: 0xc8860f, cobalt: 0x1f4fd1 };
const CAND_COLOR = [0x2f9fc4, 0x7f6fd0, 0x3a9a8a];
const DRONE_TINT = [0x7b6fd0, 0x2fa89a, 0xc2569b, 0xb5882a]; // small identifying cap on each drone body
const STAGES = [
  ['Airspace', 'Where can I fly?', 'Permitted (mint) and restricted (red) volumes are drawn as 3D prisms with a floor and a ceiling. Buildings stay solid obstacles whatever the airspace says.'],
  ['Candidate Routes', 'Where could I go?', 'For each leg the planner builds a waypoint grid inside the navigable space (permitted − restricted − buildings − clearance) and keeps up to three genuinely different, fully collision-tested routes.'],
  ['Optimal Route', 'Which route is best?', 'The cheapest candidate is picked and turned into a smooth curve; the smoothed curve is re-tested against every volume and building, and corners are tightened wherever it would cut through.'],
  ['Live Flight', 'Where am I now?', 'Four drones follow their validated smooth routes on one simulation clock. Select a drone or a volume to ask “where is it?” and “who is here?”.'],
];
const RULES = [
  'Courier (drone) capacity is limited.',
  'A drone serves a limited number of orders at one time.',
  'An order cannot be picked up before it is ready.',
  'Preparation time decides when an order becomes available for delivery.',
  'Platform assignment affects how long an order waits before pickup.',
  'Revenue may influence allocation priority (simulation hypothesis only).',
  'Total delivery time is not fixed — it varies with all of the above.',
  'Drones stay inside the permitted airspace volumes (their floors, ceilings and the map edge).',
  'Buildings and restricted airspace are obstacles; routes must avoid them.',
  'A simulated clearance margin surrounds every obstacle.',
  'If blocked, a drone climbs or detours only where permitted — otherwise it hovers (NO_VALID_ROUTE).',
];
const HUMAN_STATUS = { IDLE: 'Waiting at station', TAKEOFF: 'Departed', CRUISE: 'On the way', REROUTE: 'Route adjusting', HOVER: 'Holding position', LAND: 'Arriving', COMPLETE: 'Delivered' };
// city grid: parcels (12 wide) between roads (4 wide); roads at ±8, ±24, ±40, ±56
const ROADS = [-56, -40, -24, -8, 8, 24, 40, 56];
const EW_NAMES = ['Alder St', 'Birch St', 'Cedar St', 'Dogwood St', 'Elm St', 'Fir St', 'Ginkgo St', 'Hazel St'];
const NS_NAMES = ['1st Ave', '2nd Ave', '3rd Ave', '4th Ave', '5th Ave', '6th Ave', '7th Ave', '8th Ave'];
const PARCEL = 12, SLAB = 0.4;
// Background city = near-colourless massing + green + blue water. Saturated colours are reserved for the four roles:
//   restaurants = reds/oranges · customers = greens/denim · platform = navy · drones = mustard
const CLR = {
  white: 0xf3f1ed, ledge: 0xe2dfda, coral: 0xe8472f, orange: 0xee7a3c, salmon: 0xf0a08e, mustard: 0xf1b82d, amber: 0xe3a21c,
  navy: 0x2c4a8c, denim: 0x4f7fb5, forest: 0x2f5f45, teal: 0x4a9a8a, sage: 0x6f9f6f, cream: 0xf2e6cf, wood: 0xe8d4b4, water: 0x62b6d9,
};
const TYPO = {
  tower: { body: 0xe9ecef, ledge: 0xdadee2 },
  block: { body: 0xe8e6e2, ledge: 0xd9d6d1 },
  house: { body: 0xebe9e5, roof: 0xdad8d4 },
  stack: { body: [0xe6e8ea, 0xebe9e6, 0xf0eeeb], ledge: 0xd8dbde },
  tank: { body: 0xe4e6e8, cap: 0xd4d7da },
  dome: { body: 0xe8e6e2, cap: 0xdde0e3 },
};
const ROLE = { customer: CLR.forest, restaurant: CLR.coral, platform: CLR.navy, courier: CLR.mustard };
const TREE = [0x8fbf6a, 0x6aa35a, 0x4f8a4f, 0x9ccb7a];

// ---------- helpers --------------------------------------------------
const $ = (id) => document.getElementById(id);
let simSeed = 7;
const simRand = () => ((simSeed = (simSeed * 16807) % 2147483647) / 2147483647); // deterministic simulation clock/orders
const rand = (a, b) => a + simRand() * (b - a);
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '–');
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const dark = (c, f = 0.55) => '#' + [16, 8, 0].map((sh) => Math.round(((c >> sh) & 255) * f).toString(16).padStart(2, '0')).join('');
let seed = 11;
const srand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(srand() * arr.length)];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- three.js scene -------------------------------------------
const BG = 0xe6e4e1;
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
const VIEW = 30; // half-height of the isometric view, in world units
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 600);
const target = new THREE.Vector3(12, 6, -12); // shifted so the city sits clear of the right-hand panel
camera.position.copy(target).add(new THREE.Vector3(60, 52, 60));
const controls = new OrbitControls(camera, canvas);
controls.target.copy(target);
controls.maxPolarAngle = Math.PI * 0.45;
controls.minZoom = 0.4; controls.maxZoom = 3.5;
camera.zoom = 0.62; // wide enough to see the whole city and the 120 m corridor in one frame
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0xaebbd0, 1.6));
const sun = new THREE.DirectionalLight(0xfffaf2, 2.5);
sun.position.set(-40, 70, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 5; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 1, far: 260 });
scene.add(sun);

// soft "clay" materials and rounded geometry
const matCache = new Map();
const mat = (c) => {
  if (!matCache.has(c)) matCache.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, metalness: 0 }));
  return matCache.get(c);
};
function shade(m) { m.castShadow = true; m.receiveShadow = true; return m; }
/** rounded box whose bottom sits at y (relative to parent); counts as a solid obstacle volume */
function box(parent, w, h, d, color, x = 0, y = 0, z = 0, r) {
  const m = shade(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r ?? Math.min(0.16, w / 4, h / 4, d / 4)), mat(color)));
  m.position.set(x, y + h / 2, z); m.userData.solid = true;
  parent.add(m);
  return m;
}
const flat = (m) => { m.userData.solid = false; return m; };
const solid = (m) => { m.userData.solid = true; return m; };
const coneGeo = new THREE.ConeGeometry(0.85, 2.0, 24), ballGeo = new THREE.SphereGeometry(0.7, 20, 14);
function tree(parent, x, z, y = SLAB, s = 1) {
  const g = new THREE.Group();
  const c = pick(TREE), c2 = pick(TREE), kind = srand();
  const stem = (h) => {
    const t = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, h, 6), mat(0xc2863f)));
    t.position.y = h / 2; g.add(t);
  };
  const ball = (r, yy, col) => { const b = shade(new THREE.Mesh(ballGeo, mat(col))); b.scale.setScalar(r / 0.7); b.position.y = yy; g.add(b); };
  if (kind < 0.35) { const cone = shade(new THREE.Mesh(coneGeo, mat(c))); cone.position.y = 1.0; g.add(cone); }
  else if (kind < 0.65) { stem(0.7); ball(0.8, 1.5, c); ball(0.5, 2.35, c2); }
  else if (kind < 0.85) { stem(0.8); ball(0.62, 1.4, c); }
  else { stem(0.4); const b = shade(new THREE.Mesh(ballGeo, mat(c))); b.scale.set(0.7, 1.9, 0.7); b.position.y = 1.5; g.add(b); }
  g.position.set(x, y, z); g.scale.setScalar(s); parent.add(g);
}
function prism(parent, w, h, d, color, x, y, z, ry = 0) { // pitched roof: triangle (w wide, h high) extruded along d
  const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(0, h); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 });
  geo.translate(0, 0, -d / 2);
  const m = shade(new THREE.Mesh(geo, mat(color)));
  m.position.set(x, y, z); m.rotation.y = ry; m.userData.solid = true; parent.add(m);
  return m;
}

// ---------- labels: sized to their text, minimal margin -----------------
const WORLD_PER_PX = 0.03;
function makeLabel() {
  const cv = document.createElement('canvas');
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
  sprite.renderOrder = 10;
  sprite.userData = { cv, key: '' };
  return sprite;
}
/** lines: [{t, c?, s?}] — canvas is measured and resized to fit the text */
function setLabel(sprite, lines, bg = 'rgba(255,255,255,.93)') {
  const key = JSON.stringify(lines) + bg;
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
  g.fillStyle = bg;
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
  nextOrder: 1, nextCourier: 1, nextRoute: 1,
  orders: [], couriers: [], restaurants: [], customers: [],
  selected: null, track: null,
  auto: { customer: true, restaurant: true, platform: true, courier: true }, // simulation starts on its own
  timers: { spawn: 1.5, evaluate: 0, sense: 0 },
  ruleHits: new Array(RULES.length).fill(0),
  log: [],
  delivered: [],
  showAirspace: true, showRoutes: true, showStreets: true,
  stage: 1,            // 1 Airspace · 2 Candidate Routes · 3 Optimal Route · 4 Live Flight
  volSel: null,        // selected airspace volume id
  showAlt: false,      // keep faded alternatives visible during live flight
  missions: [],        // scripted first deliveries, one per drone
  homes: {},           // drone id → parking slot at the launch hub
};

// ---- fictional airspace + streets (illustrative) -------------------------
world.zones = [ // named districts (labels for the human view)
  { name: 'South Block District', x0: -60, x1: 60, z0: -8, z1: 60, ceilingM: 90 },
  { name: 'North Tower District', x0: -60, x1: 60, z0: -60, z1: -8, ceilingM: 120 },
];
// Restricted prisms. The red prism is a volume, not a ground stamp: RZ-A reaches the ceiling, RZ-B is a low band that
// can be flown OVER (if the permitted volume above it allows), HZ-1 is a temporary hazard that can be switched on.
world.restricted = [
  { id: 'RZ-A', name: 'Restricted Zone A', kind: 'restricted', x0: 10, x1: 22, z0: -6, z1: 6, zloM: 0, zhiM: 300, active: true },
  { id: 'RZ-B', name: 'Restricted Zone B (low band)', kind: 'restricted', x0: -22, x1: -10, z0: -6, z1: 6, zloM: 0, zhiM: 70, active: true },
  { id: 'HZ-1', name: 'Temporary Hazard HZ-1', kind: 'hazard', x0: 10, x1: 22, z0: 10, z1: 22, zloM: 0, zhiM: 300, active: false },
];
world.ewStreets = ROADS.map((z, i) => ({ name: EW_NAMES[i], z }));
world.nsStreets = ROADS.map((x, i) => ({ name: NS_NAMES[i], x }));

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

// entity layout: parcel centres on a 16-unit pitch; the door faces +z; the landing pad sits at the lot front
const parcels = [];
for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) parcels.push([i * 16, j * 16]);
const takenAt = new Set();
const key = (x, z) => x + ',' + z;
const PAD_DZ = 5.1;

/** footprint + height of every solid mesh of a building becomes a 3D obstacle volume */
function registerBuilding(g, label, typo) {
  g.updateWorldMatrix(true, true);
  const b = new THREE.Box3(); let any = false;
  g.traverse((o) => { if (o.isMesh && o.userData.solid) { b.expandByObject(o); any = true; } });
  if (!any) return null;
  const id = 'B-' + String(world.obstacles.length + 1).padStart(3, '0');
  const o = { id, name: label, typo, x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, h: b.max.y - SLAB };
  world.obstacles.push(o);
  return o;
}
function addPad(x, z, color) {
  const g = new THREE.Group();
  const base = flat(shade(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.07, 32), mat(0xffffff))));
  base.position.y = 0.035;
  const inner = flat(shade(new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.09, 32), mat(color))));
  inner.position.y = 0.045;
  g.add(base, inner); g.position.set(x, SLAB, z); scene.add(g);
}

const platform = { type: 'platform', name: 'PLATFORM', pos: new THREE.Vector3(0, SLAB, 0), acc: new THREE.Vector3(0, 0, PAD_DZ) };
const platformTop = new THREE.Vector3(0, 9.6, 0);
function buildPlatform() {
  const g = new THREE.Group();
  const plaza = flat(shade(new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 0.18, 40), mat(0xc6dcb2))));
  plaza.position.y = 0.09; g.add(plaza);
  box(g, 3.2, 0.7, 3.2, 0xffffff, 0, 0.18, 0, 0.3);
  const shaft = solid(shade(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, 7, 24), mat(0xffffff))));
  shaft.position.y = 4.4; g.add(shaft);
  const disc = solid(shade(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 1.6, 0.9, 32), mat(CLR.navy))));
  disc.position.y = 8.6; g.add(disc);
  const dome = solid(shade(new THREE.Mesh(new THREE.SphereGeometry(1.25, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x9fb6d9))));
  dome.position.y = 9.05; g.add(dome);
  const mast = solid(shade(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 2.6, 8), mat(0xffffff))));
  mast.position.y = 11.3; g.add(mast);
  const tip = solid(shade(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat(0xffffff))));
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
  registerBuilding(g, 'Dispatch Tower', 'platform');
  world.landmarks.push({ name: 'Central Plaza (launch hub)', x: 0, z: 0 });
  takenAt.add(key(0, 0));
}

function addRestaurant(name, x, z, prep, cap, color, accent) {
  const n = S.restaurants.length + 1;
  const r = { type: 'restaurant', name, stationId: 'PS-' + n, pos: new THREE.Vector3(x, SLAB, z), acc: new THREE.Vector3(x, 0, z + PAD_DZ), prepTime: prep, capacity: cap, color, accent };
  const g = new THREE.Group();
  box(g, 8, 2.4, 5, CLR.cream, 0, 0, -1.5);
  box(g, 5.6, 2.2, 4, color, -0.8, 2.4, -1.6);
  box(g, 3, 1.6, 3.2, accent, 2, 2.4, -1.2);
  box(g, 7.4, 0.3, 2, accent, 0, 1.9, 1.5, 0.14);              // awning
  box(g, 2.6, 1.2, 0.12, 0x9fd0e8, -2, 0.5, 1.02, 0.05);       // glass
  box(g, 1.1, 1.7, 0.12, color, 2.2, 0, 1.02, 0.05);           // door
  const chim = solid(shade(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.4, 14), mat(accent))));
  chim.position.set(-2.6, 5.3, -2.4); g.add(chim);
  tree(g, -3.8, 3.8); tree(g, 3.8, 4.4, 0, 0.8);
  g.position.set(x, SLAB, z); scene.add(g);
  addPad(x, z + PAD_DZ, CLR.coral);
  r.mesh = g;
  r.label = makeLabel(); r.label.position.set(x, 8.2, z); scene.add(r.label);
  register(g, r);
  registerBuilding(g, name, 'restaurant');
  world.landmarks.push({ name: `Pickup Station ${r.stationId} (${name})`, x: r.acc.x, z: r.acc.z });
  S.restaurants.push(r); takenAt.add(key(x, z));
}
function addCustomer(name, x, z, bodyC, roofC) {
  const n = S.customers.length + 1;
  const c = { type: 'customer', name, stationId: 'DS-' + n, pos: new THREE.Vector3(x, SLAB, z), acc: new THREE.Vector3(x, 0, z + PAD_DZ), orderTime: null, selectedRestaurant: null };
  const g = new THREE.Group();
  box(g, 4.6, 2.6, 4, bodyC, 0, 0, -0.8);
  prism(g, 5.4, 2.4, 4.6, roofC, 0, 2.6, -0.8, Math.PI / 2);
  box(g, 1.0, 1.6, 0.12, roofC, 0.8, 0, 1.22, 0.05);
  box(g, 1.2, 1.0, 0.12, 0x9fd0e8, -1.2, 0.8, 1.22, 0.05);
  box(g, 0.9, 1.5, 0.9, CLR.white, 1.4, 3.4, -1.6);
  tree(g, -3.6, 3.6); tree(g, 3.8, 3.2, 0, 0.8);
  g.position.set(x, SLAB, z); scene.add(g);
  addPad(x, z + PAD_DZ, CLR.forest);
  c.mesh = g;
  c.label = makeLabel(); c.label.position.set(x, 7.2, z); scene.add(c.label);
  register(g, c);
  registerBuilding(g, `${name} house`, 'customer');
  world.landmarks.push({ name: `Delivery Station ${c.stationId} (${name})`, x: c.acc.x, z: c.acc.z });
  S.customers.push(c); takenAt.add(key(x, z));
}

// filler parcels (near-colourless massing, parks and water — decor and obstacles, not part of the delivery model)
function ledged(g, w, h, d, x, z, typo, step = 1.5) {
  box(g, w, h, d, typo.body, x, 0, z, 0.22);
  for (let k = 1; k * step < h - 0.4; k++) box(g, w + 0.12, 0.1, d + 0.12, typo.ledge, x, k * step, z, 0.04);
}
const PARKS = ['Linden Park', 'Maple Green', 'Cedar Court', 'Birch Green', 'Aspen Green'];
const FIXED = { '0,-16': 'tb1', '16,0': 'dome', '-16,0': 'park' }; // deterministic test lots
let parkN = 0, pondN = 0;
function buildFiller(x, z) {
  const g = new THREE.Group(); g.position.set(x, SLAB, z); scene.add(g);
  const mid = z < -8; // North Tower District: taller, denser; South Block District: lower
  let kind = FIXED[key(x, z)];
  if (!kind) {
    const t = srand();
    kind = mid ? (t < 0.5 ? 'tower' : t < 0.68 ? 'block' : t < 0.8 ? 'stack' : t < 0.9 ? 'park' : t < 0.95 ? 'pond' : 'dome')
      : (t < 0.14 ? 'tower' : t < 0.28 ? 'block' : t < 0.5 ? 'house' : t < 0.62 ? 'stack' : t < 0.78 ? 'park' : t < 0.88 ? 'pond' : t < 0.95 ? 'tank' : 'dome');
  }
  const addLandmark = (name) => world.landmarks.push({ name, x, z });
  if (kind === 'tb1') { // the guaranteed tall obstacle used by the test scenario (95 m)
    ledged(g, 5.2, 19, 6.4, 0, 2.4, TYPO.tower);
    tree(g, -4.6, 4.6, 0, 0.8);
    registerBuilding(g, 'Spire Tower', 'tower'); addLandmark('Spire Tower');
  } else if (kind === 'tower') {
    ledged(g, 4 + srand() * 2.4, (mid ? 9 : 3) + srand() * (mid ? 9 : 4), 4 + srand() * 2.4, 0, 0, TYPO.tower);
    tree(g, -4.6, 4.6, 0, 0.8);
    registerBuilding(g, mid ? 'High-rise' : 'Low tower', 'tower');
  } else if (kind === 'block') {
    ledged(g, 8.6, (mid ? 5 : 3) + srand() * (mid ? 3 : 1.5), 4.6, 0, -0.6, TYPO.block, 1.4);
    tree(g, 4.4, 4.4, 0, 0.8);
    registerBuilding(g, 'Block', 'block');
  } else if (kind === 'house') { // one house, or two side by side — never more
    const two = srand() < 0.5;
    for (const [hx, hz] of two ? [[-3.1, 0], [3.1, 0]] : [[0, 0]]) {
      const h = new THREE.Group(); h.position.set(hx, 0, hz); h.scale.setScalar(two ? 0.62 : 1); g.add(h);
      box(h, 4.8, 2.8, 4.2, TYPO.house.body, 0, 0, -0.4, 0.2);
      prism(h, 5.8, 2.6, 5.2, TYPO.house.roof, 0, 2.8, -0.4, Math.PI / 2);
      box(h, 1.0, 1.7, 0.12, TYPO.house.roof, 0.9, 0, 1.72, 0.05);
      registerBuilding(h, 'House', 'house');
    }
    tree(g, two ? 0 : -4.2, 4.4, 0, 0.8); if (!two) tree(g, 4.4, -3.6, 0, 0.8);
  } else if (kind === 'stack') {
    const [c0, c1, c2] = TYPO.stack.body;
    box(g, 6.4, 2.6, 4.6, c0, 0, 0, 0.3, 0.32);
    box(g, 4.6, 2.4, 3.8, c1, -0.7, 2.6, -0.2, 0.32);
    box(g, 3, 1.8, 2.8, c2, 1.1, 5, -0.1, 0.32);
    box(g, 1.8, 1.0, 0.1, TYPO.stack.ledge, 0.8, 0.8, 2.62, 0.04);
    tree(g, -4.4, 4.4); tree(g, 4.6, 4.8, 0, 0.8);
    registerBuilding(g, 'Stepped building', 'stack');
  } else if (kind === 'park') {
    const lawn = flat(shade(new THREE.Mesh(new THREE.CylinderGeometry(5.3, 5.3, 0.14, 48), mat(0xa9d6b3))));
    lawn.position.y = 0.07; g.add(lawn);
    const n = 5 + Math.floor(srand() * 3);
    for (let i = 0; i < n; i++) { const a = i * 2.4 + srand(), r = 1 + srand() * 3.2; tree(g, Math.cos(a) * r, Math.sin(a) * r, 0.14, 0.8 + srand() * 0.5); }
    addLandmark(PARKS[parkN++ % PARKS.length]);
  } else if (kind === 'pond') {
    flat(box(g, 10, 0.18, 9, CLR.water, 0, 0, 0, 0.8));
    flat(box(g, 3.4, 0.2, 1.1, CLR.white, 0, 0, 0, 0.1));
    tree(g, -4.6, 4.6); tree(g, 4.6, -4.6);
    addLandmark(['Mirror Pond', 'Heron Pond', 'Reed Pond'][pondN++ % 3]);
  } else if (kind === 'tank') {
    const tank = solid(shade(new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 2.4, 28), mat(TYPO.tank.body))));
    tank.position.y = 6; g.add(tank);
    const cap = solid(shade(new THREE.Mesh(new THREE.ConeGeometry(2, 0.9, 28), mat(TYPO.tank.cap)))); cap.position.y = 7.65; g.add(cap);
    for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) {
      const l = solid(shade(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4.8, 6), mat(0xc9c6c2)))); l.position.set(lx, 2.4, lz); g.add(l);
    }
    tree(g, 3.6, 3.8);
    registerBuilding(g, 'Water tank', 'tank'); addLandmark('Water Tank');
  } else { // dome
    box(g, 5.4, 1.4, 5.4, TYPO.dome.body, 0, 0, 0, 0.3);
    const dome = solid(shade(new THREE.Mesh(new THREE.SphereGeometry(2.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(TYPO.dome.cap))));
    dome.position.set(0, 1.4, 0); g.add(dome);
    tree(g, 4.4, 4.4, 0, 0.8);
    registerBuilding(g, 'Domed hall', 'dome'); addLandmark('Domed Hall');
  }
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

// ---- airspace: permitted prisms, restricted prisms, landing columns ------------------
// Permitted airspace is a set of 3D prisms with explicit floors and ceilings. The two decks tile the city, the corridor
// sits ABOVE the northern deck (same plan area, different altitude), and every pad has a short landing column that
// connects the ground to the deck floor — so takeoff and landing are valid transitions, not gaps.
world.volumes = [
  { id: 'V-01', name: 'South Block Deck', kind: 'deck', x0: -56, x1: 56, z0: -8, z1: 56, zloM: 20, zhiM: 90 },
  { id: 'V-02', name: 'North Tower Deck', kind: 'deck', x0: -56, x1: 56, z0: -56, z1: -8, zloM: 20, zhiM: 90 },
  { id: 'V-03', name: 'Central Air Corridor', kind: 'corridor', x0: -56, x1: 56, z0: -24, z1: -8, zloM: 90, zhiM: 120 },
  { id: 'T-00', name: 'Launch hub column', kind: 'transition', x0: -4.4, x1: 4.4, z0: 3.0, z1: 7.6, zloM: 0, zhiM: 20 },
];
for (const e of [...S.restaurants, ...S.customers]) {
  world.volumes.push({ id: 'T-' + e.stationId.replace('-', ''), name: `${e.stationId} landing column`, kind: 'transition', x0: e.acc.x - 2.4, x1: e.acc.x + 2.4, z0: e.acc.z - 2.4, z1: e.acc.z + 2.4, zloM: 0, zhiM: 20 });
}
bump();

const airspace = new THREE.Group(); scene.add(airspace);
const volViz = new Map();       // id → {v, fill, edges, label}
const volMeshes = [];           // pickable fills
const VOL_PRI = { restricted: 0, hazard: 0, transition: 1, corridor: 2, deck: 3 };
function volColors(v) {
  const k = v.permission ?? (v.kind === 'restricted' || v.kind === 'hazard' ? 'restricted' : 'permitted');
  if (v.kind === 'hazard') return { fill: AIR.hazard, edge: AIR.edgeHazard };
  return k === 'restricted' ? { fill: AIR.restricted, edge: AIR.edgeRestricted } : { fill: AIR.permitted, edge: AIR.edgePermitted };
}
function addVolume(v, restricted) {
  const col = volColors(restricted ? { ...v, permission: 'restricted' } : v);
  const fill = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: col.fill, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
  fill.renderOrder = 2; fill.userData.volume = v; fill.userData.pri = VOL_PRI[v.kind] ?? 3;
  const edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: col.edge, dashSize: 0.8, gapSize: 0.5, transparent: true, opacity: 0.85, depthWrite: false }));
  edges.renderOrder = 3;
  airspace.add(fill, edges); volMeshes.push(fill);
  let label = null;
  if (v.kind !== 'transition') { label = makeLabel(); airspace.add(label); }
  volViz.set(v.id, { v, fill, edges, label, restricted });
}
for (const v of world.volumes) addVolume(v, false);
for (const r of world.restricted) addVolume(r, true);
function layoutVolume(z) {
  const v = z.v, lo = v.zloM / SCALE_M, hi = Math.max(lo + 0.05, Math.min(v.zhiM, z.restricted ? cfg.maxAltM + 15 : (v.kind === 'transition' ? v.zhiM : cfg.maxAltM)) / SCALE_M);
  const w = v.x1 - v.x0, h = hi - lo, d = v.z1 - v.z0;
  const cx = (v.x0 + v.x1) / 2, cy = SLAB + lo + h / 2, cz = (v.z0 + v.z1) / 2;
  z.fill.scale.set(w, h, d); z.fill.position.set(cx, cy, cz);
  const box = new THREE.BoxGeometry(w, h, d);
  z.edges.geometry.dispose(); z.edges.geometry = new THREE.EdgesGeometry(box); box.dispose();
  z.edges.computeLineDistances(); z.edges.position.set(cx, cy, cz);
  z.top = SLAB + hi;
  if (z.label) {
    const hz = z.restricted;
    const pos = v.id === 'V-01' ? [v.x0 + 14, v.z1 - 3] : v.id === 'V-02' ? [v.x0 + 14, v.z0 + 4] : v.id === 'V-03' ? [v.x1 - 16, v.z1 + 0.5] : [cx, cz];
    z.label.position.set(pos[0], z.top + 1.2, pos[1]);
    const lo_ = v.zloM, hi_ = Math.round(hi * SCALE_M);
    setLabel(z.label, [{ t: `${v.id} · ${v.name}`, c: hz ? (v.kind === 'hazard' ? '#8a5d08' : '#a2303c') : '#2f7d55', s: 30 },
      { t: `${lo_}–${hi_ >= 130 && hz ? 'ceiling' : hi_ + ' m'} · ${hz ? (v.kind === 'hazard' ? 'temporary hazard' : 'restricted') : 'permitted'}`, c: '#7a736b', s: 22 }]);
  }
}
function refreshAirspace() {
  airspace.visible = S.showAirspace;
  for (const z of volViz.values()) {
    layoutVolume(z);
    const on = !z.restricted || z.v.active;
    z.fill.visible = z.edges.visible = on; if (z.label) z.label.visible = on;
  }
}
const qBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x2f9be0, transparent: true, opacity: 0.16, depthWrite: false }));
const qSphere = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), qBox.material);
qBox.visible = qSphere.visible = false; qBox.renderOrder = qSphere.renderOrder = 3;
scene.add(qBox, qSphere);

// street name signs (synthetic names)
const streetLabels = new THREE.Group(); scene.add(streetLabels);
for (const s of world.ewStreets.filter((q) => Math.abs(q.z) <= 40)) {
  const lb = makeLabel(); lb.position.set(-52, 0.8, s.z); setLabel(lb, [{ t: s.name, c: '#7a736b', s: 24 }], 'rgba(255,255,255,.75)'); streetLabels.add(lb);
}
for (const s of world.nsStreets.filter((q) => Math.abs(q.x) <= 40)) {
  const lb = makeLabel(); lb.position.set(s.x, 0.8, 57); setLabel(lb, [{ t: s.name, c: '#7a736b', s: 24 }], 'rgba(255,255,255,.75)'); streetLabels.add(lb);
}

// ---- drones (couriers) ------------------------------------------------
function addCourier() {
  if (S.couriers.length >= MAX_COURIERS) return null;
  const idx = S.nextCourier++;
  const id = 'D-' + String(idx).padStart(2, '0');
  let slot = 0; while (slot < 4 && S.couriers.some((d) => !d.task && Math.hypot(d.pos.x - (-2.7 + slot * 1.8), d.pos.z - 5.3) < 0.5)) slot++;
  const c = {
    type: 'courier', id, name: id, pos: new THREE.Vector3(-2.7 + slot * 1.8, 0, 5.3), prev: new THREE.Vector3(),
    orders: [], carry: [], task: null, status: 'IDLE', hold: null, dwell: 0, blocked: null,
    heading: 0, rot: 0, headingDeg: 0, speedU: 0, bob: simRand() * 6, nearest: null, lastStreet: null, rerouteWhy: '',
    tint: DRONE_TINT[(idx - 1) % DRONE_TINT.length], viz: null,
  };
  S.homes[id] = new THREE.Vector3(-2.7 + slot * 1.8, 0, 5.3);
  c.prev.copy(c.pos);
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const body = box(inner, 1.5, 0.55, 1.5, CLR.mustard, 0, 0.75, 0, 0.25);
  box(inner, 0.7, 0.3, 0.5, CLR.navy, 0, 0.98, 0.65, 0.12).userData.solid = false;   // nose
  body.userData.solid = false; inner.children.forEach((m) => { m.userData.solid = false; });
  const arm = (rz) => { const a = shade(new THREE.Mesh(new RoundedBoxGeometry(3.4, 0.1, 0.22, 2, 0.04), mat(0x8c857c))); a.position.y = 1.05; a.rotation.y = rz; inner.add(a); };
  arm(Math.PI / 4); arm(-Math.PI / 4);
  c.rotors = [];
  for (const [rx, rz] of [[1.2, 1.2], [-1.2, 1.2], [1.2, -1.2], [-1.2, -1.2]]) {
    const r = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 20), new THREE.MeshStandardMaterial({ color: 0x5f5a54, transparent: true, opacity: 0.55, roughness: 0.9 })));
    r.position.set(rx, 1.15, rz); inner.add(r); c.rotors.push(r);
  }
  for (const [lx, lz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) {
    const l = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), mat(0x8c857c))); l.position.set(lx, 0.3, lz); inner.add(l);
  }
  const cap = shade(new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(c.tint))); // identifying colour cap
  cap.position.set(0, 1.03, 0); inner.add(cap);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshStandardMaterial({ color: 0x5fd38d, emissive: 0x5fd38d, emissiveIntensity: 0.6 }));
  lamp.position.set(0, 0.62, 0.75); inner.add(lamp);
  c.lamp = lamp;
  g.position.set(c.pos.x, SLAB, c.pos.z); scene.add(g);
  c.mesh = g; c.inner = inner;
  c.label = makeLabel(); scene.add(c.label);
  c.halo = new THREE.Mesh(new THREE.SphereGeometry(2.3, 20, 14), new THREE.MeshBasicMaterial({ color: 0x2f9be0, transparent: true, opacity: 0.22, depthWrite: false }));
  c.halo.visible = false; scene.add(c.halo);
  c.blockMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: PATH_COLOR.blocked, transparent: true, opacity: 0.28, depthWrite: false }));
  c.blockMesh.visible = false; scene.add(c.blockMesh);
  register(g, c);
  S.couriers.push(c);
  if (!S.track) S.track = c;
  return c;
}

// selection ring
const selRing = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.6, 40), new THREE.MeshBasicMaterial({ color: 0x3b3631, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
selRing.rotation.x = -Math.PI / 2; selRing.visible = false;
scene.add(selRing);

// relationship lines + flight lines (rebuilt every frame from the model)
function dynLines(max, opacity) {
  const pos = new Float32Array(max * 6), col = new Float32Array(max * 6), geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity }));
  obj.frustumCulled = false; obj.renderOrder = 4; scene.add(obj);
  const api = { n: 0, max, pos, col, geo, obj, reset() { api.n = 0; }, add(a, b, color) {
    if (api.n >= max) return; const i = api.n++ * 6, c = new THREE.Color(color);
    pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i); col.set([c.r, c.g, c.b, c.r, c.g, c.b], i);
  }, flush() { geo.setDrawRange(0, api.n * 2); geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; } };
  return api;
}
const relLines = dynLines(800, 0.9), flightLines = dynLines(600, 0.95);

// ---------- logging / toast ------------------------------------------
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
let logDirty = true;
function log(msg, kind = '') {
  S.log.unshift({ t: S.time, msg, kind });
  if (S.log.length > 80) S.log.pop();
  logDirty = true;
}
/** a refused action: explains which rule bound it */
function refuse(rule, msg) {
  if (rule) S.ruleHits[rule - 1]++;
  const text = (rule ? `Rule ${rule}: ` : '') + msg;
  log(text, 'bad'); toast(text);
  return false;
}

// ---------- flight model -----------------------------------------------
const load = (c) => c.orders.length + c.carry.length;
const destOf = (task) => (task.kind === 'toRestaurant' ? task.order.restaurant : task.order.customer);
const pts3 = (c) => (c.task ? c.task.route.pts.slice(c.task.route.idx) : []);
const remainingU = (c) => routeLength(c.pos, pts3(c));
function remainingTime(c) { // route length ÷ speed, with the slower vertical legs counted
  let t = 0, p = c.pos;
  for (const q of pts3(c)) { const vert = Math.hypot(q.x - p.x, q.z - p.z) < 0.01; t += dist3(p, q) / (DRONE_SPEED * (vert ? VERT_SPEED : 1)); p = q; }
  return t;
}
/** Stage 2 + 3 at dispatch time: candidates are generated and validated BEFORE the drone moves; it flies the smoothed winner. */
function startTask(c, kind, order) {
  const dest = kind === 'toRestaurant' ? order.restaurant.acc : order.customer.acc;
  const plan = planMission(c.pos, dest);
  c.task = { kind, order, route: { id: 'RT-' + String(S.nextRoute++).padStart(3, '0'), pts: plan.ok ? plan.best.pts : [], plan, idx: 0, rerouted: false, travelled: 0 }, start: c.pos.clone() };
  c.hold = null; c.rerouteWhy = ''; c.dwell = 0;
  if (plan.ok) {
    const n = plan.candidates.length;
    log(`${c.name} route: ${n} feasible candidate${n > 1 ? 's' : ''} → chose ${plan.best.label} (${Math.round(plan.best.len * SCALE_M)} m)`);
  } else {
    S.ruleHits[10]++;
    c.hold = { reason: plan.reason, timer: 1 };
    log(`${c.name} NO_VALID_ROUTE — ${plan.reason}; hovering (retrying every second)`, 'bad');
  }
}

/** pre-move conflict test on the next stretch of the route (look-ahead = simulated sensor range) */
function lookahead(c) {
  const R = c.task.route;
  let cur = { x: c.pos.x, y: c.pos.y, z: c.pos.z }, remain = cfg.senseU;
  for (let i = R.idx; i < R.pts.length && remain > 1e-6; i++) {
    const w = R.pts[i], d = dist3(cur, w);
    let end = w;
    if (d > remain) { const k = remain / d; end = { x: cur.x + (w.x - cur.x) * k, y: cur.y + (w.y - cur.y) * k, z: cur.z + (w.z - cur.z) * k }; }
    const f = segCheck(cur, end, 0);
    if (f) return { ...f, a: cur, b: end };
    remain -= Math.min(d, remain); cur = end;
  }
  return null;
}
function reasonWhy(bad, plan) {
  const what = bad.reason === 'restricted' ? bad.name : bad.reason === 'building' ? `${bad.name} ${bad.id} (${Math.round(bad.hM)} m)` : bad.name;
  const lvl = Math.round(plan.level * SCALE_M);
  const how = plan.climbed && plan.detoured ? `climbing to ${lvl} m and detouring` : plan.climbed ? `climbing over it to ${lvl} m` : plan.detoured ? 'detouring around it' : 'adjusting altitude';
  const human = plan.climbed && !plan.detoured ? 'to fly over tall buildings' : bad.reason === 'restricted' ? 'to avoid restricted airspace' : bad.reason === 'building' ? 'to go around tall buildings' : 'to stay within permitted airspace';
  return { log: `${what} ahead — ${how}`, human };
}
/** try to find a permitted route from the current position; returns true on success */
function replan(c, bad) {
  const dest = destOf(c.task).acc;
  const plan = planRoute(c.pos, dest);
  if (plan.ok) {
    const R = c.task.route;
    R.pts = plan.pts; R.idx = 0; R.rerouted = true; R.plan = plan.mission;
    const why = bad ? reasonWhy(bad, plan) : { log: 'route found again', human: '' };
    c.rerouteWhy = why.human || c.rerouteWhy;
    if (c.hold) log(`${c.name} resumed: ${why.log}`, 'good');
    else log(`${c.name} REROUTE — ${why.log}`, 'good');
    c.hold = null;
    return true;
  }
  if (!c.hold) {
    S.ruleHits[10]++;
    c.hold = { reason: plan.reason, timer: 1 };
    log(`${c.name} NO_VALID_ROUTE — ${plan.reason}; hovering (retrying every second)`, 'bad');
  } else c.hold.reason = plan.reason;
  return false;
}
function flyStep(c, dt) {
  const task = c.task, R = task.route;
  if (c.hold) {
    c.hold.timer -= dt;
    if (c.hold.timer > 0) return false;
    c.hold.timer = 1;
    if (!replan(c, null)) return false;
  } else {
    const bad = lookahead(c);
    if (bad) {
      if (bad.reason === 'building' || bad.reason === 'restricted') S.ruleHits[8]++; else S.ruleHits[7]++;
      if (bad.marginOnly) S.ruleHits[9]++;
      c.blocked = { a: bad.a, b: bad.b, until: S.time + 4, obstacle: bad.obstacle ?? null };
      if (!replan(c, bad)) return false;
    }
  }
  // move along the waypoint list
  let t = dt, moved = 0;
  while (t > 1e-9 && R.idx < R.pts.length) {
    const w = R.pts[R.idx], d = dist3(c.pos, w), vert = Math.hypot(w.x - c.pos.x, w.z - c.pos.z) < 0.01;
    const v = DRONE_SPEED * (vert ? VERT_SPEED : 1), need = d / v;
    if (Math.hypot(w.x - c.pos.x, w.z - c.pos.z) > 0.01) c.heading = Math.atan2(w.x - c.pos.x, w.z - c.pos.z);
    if (need <= t) { c.pos.set(w.x, w.y, w.z); t -= need; moved += d; R.idx++; }
    else { const k = (v * t) / d; c.pos.x += (w.x - c.pos.x) * k; c.pos.y += (w.y - c.pos.y) * k; c.pos.z += (w.z - c.pos.z) * k; moved += v * t; t = 0; }
  }
  R.travelled += moved;
  c.speedU += (moved / dt - c.speedU) * Math.min(1, dt * 6);
  return R.idx >= R.pts.length;
}
function updateStatus(c) {
  if (c.dwell > 0 && c.dwellKind === 'COMPLETE') c.status = 'COMPLETE';
  else if (c.hold) c.status = 'HOVER';
  else if (c.task) {
    const ph = c.task.route.pts[c.task.route.idx]?.phase;
    c.status = ph === 'takeoff' ? 'TAKEOFF' : ph === 'land' ? 'LAND' : c.task.route.rerouted ? 'REROUTE' : 'CRUISE';
  } else c.status = 'IDLE';
}
function droneStep(c, dt) {
  c.prev.copy(c.pos);
  if (c.dwell > 0) c.dwell = Math.max(0, c.dwell - dt);
  if (c.task) {
    const arrived = flyStep(c, dt);
    if (arrived) {
      const o = c.task.order;
      if (c.task.kind === 'toRestaurant') { log(`${c.name} landed at ${o.restaurant.stationId} (${o.restaurant.name})`); c.dwell = 0.8; c.dwellKind = 'DOCK'; }
      else {
        o.deliveredAt = S.time; setStatus(o, 'delivered');
        c.carry.splice(c.carry.indexOf(o), 1);
        S.delivered.push(o);
        o.goneAt = S.time + 5;
        c.dwell = 3; c.dwellKind = 'COMPLETE';
        log(`${c.name} COMPLETE — #${o.id} delivered to ${o.customer.stationId} (${o.customer.name}) in ${fmt(o.deliveredAt - o.createdAt)}s`, 'good');
      }
      c.task = null; c.speedU = 0;
    }
  } else c.speedU *= Math.max(0, 1 - dt * 6);
  updateStatus(c);
  // street crossings from the actual trajectory
  const crossed = streetsCrossed(c.prev, c.pos);
  if (crossed.length) c.lastStreet = { name: crossed[crossed.length - 1], t: S.time };
  if (c.headingDeg !== undefined) c.headingDeg = (bearingDeg(Math.sin(c.heading), -Math.cos(c.heading)) + 360) % 360;
}

// ---------- order model ----------------------------------------------
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
  const bx = box(g, size, size, size, STATUS_COLOR.pending, 0, 0, 0, 0.18); bx.userData.solid = false;
  g.position.set(restaurant.pos.x, SLAB, restaurant.pos.z + 3.4);
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

/**
 * Platform delivery-time estimate (seconds): planned station-to-station route length ÷ speed,
 * plus preparation and the drone's approach. Holds are not predicted — the estimate ignores them.
 */
const legCache = new Map();
function stationLegU(a, b) {
  const k = `${world.version}:${a.stationId}>${b.stationId}`;
  if (!legCache.has(k)) { const p = planRoute(a.acc, b.acc); legCache.set(k, p.ok ? routeLength(a.acc, p.pts) : Infinity); }
  return legCache.get(k);
}
function estimate(o) {
  if (o.status === 'delivered') return 0;
  if (o.status === 'picked_up') return o.courier.task ? remainingTime(o.courier) + (o.courier.hold ? Infinity : 0) : stationLegU(o.restaurant, o.customer) / DRONE_SPEED;
  const legB = stationLegU(o.restaurant, o.customer) / DRONE_SPEED;
  const ready = o.status === 'pending' ? o.prepTotal + 1.5 : o.status === 'preparing' ? Math.max(0, o.prepRemaining) : 0;
  const reach = (c) => (c.task?.kind === 'toRestaurant' && c.task.order === o ? remainingTime(c) : dist3(c.pos, o.restaurant.acc) / DRONE_SPEED) + load(c) * 6;
  let arrive;
  if (o.courier) arrive = reach(o.courier);
  else {
    const free = S.couriers.filter((c) => load(c) < COURIER_CAPACITY);
    arrive = free.length ? Math.min(...free.map(reach)) : 12; // no drone free: assumed wait
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
const atPad = (c, pad) => dist3(c.pos, pad) < 0.6;
const atRestaurant = (o) => atPad(o.courier, o.restaurant.acc);

const act = {
  create() {
    const sel = S.selected;
    const customer = sel?.type === 'customer' ? sel : S.customers[Math.floor(simRand() * S.customers.length)];
    const restaurant = sel?.type === 'restaurant' ? sel : S.restaurants[Math.floor(simRand() * S.restaurants.length)];
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
    if (!cands.length) return auto ? false : refuse(0, 'No ready order awaits a drone.');
    cands.forEach((o) => { o.priority = priorityOf(o); });
    const byPrio = [...cands].sort((a, b) => b.priority - a.priority);
    // the scripted first deliveries are pinned to their drone; other orders skip drones that are reserved for one
    const reserved = new Set(S.orders.filter((x) => x.pin && !x.courier).map((x) => x.pin));
    const freeFor = (o) => S.couriers.filter((c) => load(c) < COURIER_CAPACITY && (o.pin ? c.id === o.pin : !reserved.has(c.id)));
    const ranked = sel?.type === 'order' && cands.includes(sel) ? [sel, ...byPrio.filter((x) => x !== sel)] : byPrio;
    const o = ranked.find((x) => freeFor(x).length) ?? ranked[0];
    const fifo = [...cands].sort((a, b) => waitingTime(b) - waitingTime(a))[0];
    const free = freeFor(o);
    if (!free.length) {
      if (auto) return false;
      return refuse(S.couriers.some((c) => load(c) > 0) ? 2 : 1, `All ${S.couriers.length} drones are at capacity (${COURIER_CAPACITY} orders each) — #${o.id} must wait.`);
    }
    free.sort((a, b) => dist3(a.pos, o.restaurant.acc) + load(a) * 8 - (dist3(b.pos, o.restaurant.acc) + load(b) * 8));
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
    if (!o) return auto ? false : refuse(0, 'No assigned order is waiting for a drone to accept it.');
    o.accepted = true;
    log(`${o.courier.name} accepted assignment #${o.id}`);
    return true;
  },
  cTravel(auto = false) {
    const o = chooseOrder((x) => x.status === 'assigned' && x.accepted && !x.courier.task && x.courier.carry.length === 0, byCourier);
    if (!o) return auto ? false : refuse(0, 'No idle drone with an accepted assignment (accept first).');
    startTask(o.courier, 'toRestaurant', o);
    log(`${o.courier.name} TAKEOFF → ${o.restaurant.stationId} (${o.restaurant.name}) for #${o.id}`);
    return true;
  },
  cPickup(auto = false) {
    const sel = S.selected;
    if (!auto && sel?.type === 'order' && STATUS.indexOf(sel.status) < 3)
      return refuse(3, `#${sel.id} is ${sel.status} — it cannot be picked up before it is ready (and assigned).`);
    const o = chooseOrder((x) => x.status === 'assigned' && x.accepted && !x.courier.task && atRestaurant(x), byCourier);
    if (!o) return auto ? false : refuse(0, 'No drone is landed at a pickup station with an assigned order.');
    if (o.readyAt == null) return refuse(3, `#${o.id} is not ready.`); // guard; unreachable by construction
    pickupFor(o.courier, o);
    return true;
  },
  cDeliver(auto = false) {
    const o = chooseOrder((x) => x.status === 'picked_up' && !x.courier.task, byCourier);
    if (!o) return auto ? false : refuse(0, 'No idle drone holds a picked-up order.');
    startTask(o.courier, 'toCustomer', o);
    log(`${o.courier.name} TAKEOFF → ${o.customer.stationId} (${o.customer.name}) with #${o.id}`);
    return true;
  },
};
function removeCourier(c) {
  disposeViz(c.viz); c.viz = null;
  scene.remove(c.mesh, c.label, c.halo, c.blockMesh);
  pickables.splice(pickables.indexOf(c.mesh), 1);
  S.couriers.splice(S.couriers.indexOf(c), 1);
  if (S.selected === c) S.selected = null;
  if (S.track === c) S.track = S.couriers[0] ?? null;
}
function pickupFor(c, o) {
  o.pickedAt = S.time;
  c.orders.splice(c.orders.indexOf(o), 1); c.carry.push(o);
  setStatus(o, 'picked_up');
  c.dwell = 0.8; c.dwellKind = 'DOCK';
  log(`${c.name} picked up #${o.id} (order waited ${fmt(o.pickedAt - o.readyAt)}s for pickup)`);
}

// ---------- simulation step ------------------------------------------
function autoCourier(c) {
  if (c.task || c.dwell > 0) return;
  for (const o of c.orders) if (!o.accepted) { o.accepted = true; log(`${c.name} accepted assignment #${o.id}`); }
  const here = c.orders.find((o) => atPad(c, o.restaurant.acc));
  if (here) { pickupFor(c, here); return; }
  if (c.carry.length) {
    const o = c.carry.slice().sort((a, b) => dist(c.pos, a.customer.acc) - dist(c.pos, b.customer.acc))[0];
    startTask(c, 'toCustomer', o);
    log(`${c.name} TAKEOFF → ${o.customer.stationId} (${o.customer.name}) with #${o.id}`);
    return;
  }
  const o = c.orders[0];
  if (o) { startTask(c, 'toRestaurant', o); log(`${c.name} TAKEOFF → ${o.restaurant.stationId} (${o.restaurant.name}) for #${o.id}`); }
}

function step(dt) {
  S.time += dt;
  // restaurants: preparation clocks run for orders being prepared (Rule 4)
  for (const o of S.orders) if (o.status === 'preparing' && o.prepRemaining > 0) o.prepRemaining = Math.max(0, o.prepRemaining - dt);

  for (const c of S.couriers) droneStep(c, dt);
  if ((S.timers.sense -= dt) <= 0) { // nearest-obstacle readout (robot panel)
    S.timers.sense = 0.2;
    for (const c of S.couriers) c.nearest = nearestObstacle(c.pos);
  }

  // autonomous agents (each can be switched off in the panel)
  const A = S.auto;
  if (A.customer && (S.timers.spawn -= dt) <= 0) {
    S.timers.spawn = rand(7, 12);
    if (S.orders.filter((o) => o.status !== 'delivered').length < 8) act.create();
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

// ---------- spatial queries (both directions) -----------------------------
const r1 = (n) => Math.round(n * 10) / 10;
/** A. given an agent, where is it? — derived from the drone's live state */
function getLocation(droneId) {
  const c = S.couriers.find((d) => d.id === droneId);
  if (!c) return null;
  const l = toLocal(c.pos), vols = volumesAt(c.pos), lm = nearestLandmark(c.pos), hv = humanView(c), blk = blockAt(c.pos.x, c.pos.z);
  return {
    drone_id: c.id,
    xyz: [r1(l.x), r1(l.y), r1(l.z)],
    altitude_datum: 'metres above the simulated street-level datum (z = 0)',
    volumes: vols.map((v) => v.id),
    in_volume: vols.length ? vols.map((v) => `${v.id} ${v.name} (${v.permission})`).join(' + ') : 'none — outside all labelled airspace volumes',
    district: zoneAt(c.pos.x, c.pos.z).name,
    block: blk.inside ? blk.name : `over a street near ${blk.name}`,
    nearby_landmark: lm.name,
    status: c.hold ? 'HOVER (NO_VALID_ROUTE)' : c.status,
    description: hv.lines[0] ?? '',
    heading_deg: Math.round(c.headingDeg),
    speed_mps: r1(c.speedU * SCALE_M),
    nearest_obstacle: c.nearest ? { id: c.nearest.id, distance_m: r1(c.nearest.d * SCALE_M) } : null,
    route: c.task ? { id: c.task.route.id, waypoint_index: c.task.route.idx, waypoints: c.task.route.pts.length, destination_id: destOf(c.task).stationId } : null,
  };
}
/** B. given a location ("V-03", {volume}, {zone, z_min, z_max}, {box}, {point, radius}), which agents are there? */
function getAgentsAt(location) {
  return { query: location, agents: agentsAt(S.couriers, location) };
}
/** B'. the same question for an arbitrary local-metre box (x east, y north, z up) */
function getAgentsInBox(xMin, xMax, yMin, yMax, zMin, zMax) {
  return { query: { box: { x: [xMin, xMax], y: [yMin, yMax], z: [zMin, zMax] } }, agents: agentsInBox(S.couriers, xMin, xMax, yMin, yMax, zMin, zMax) };
}
Object.assign(window, { getLocation, getAgentsAt, getAgentsInBox });

// ---------- human-readable translation -----------------------------------
const stationLabel = (e) => `${e.stationId} (${e.name})`;
const droneWord = (c) => `Drone ${c.id.slice(2)}`;
/** relational phrase for the drone's current position: derived from the model each time, never a fixed script */
function whereText(c) {
  const p = c.pos, blk = blockAt(p.x, p.z), alt = Math.round(p.y * SCALE_M);
  if (p.y <= 0.4) {
    const at = [...S.restaurants, ...S.customers].find((e) => dist3(p, e.acc) < 0.6);
    return `${droneWord(c)} is parked ${at ? 'on ' + stationLabel(at) : 'at the launch hub (Central Plaza)'}`;
  }
  const roof = roofUnder(p, 0), place = blk.inside ? blk.name : `the street near ${blk.name}`;
  let s;
  if (roof && p.y > roof.h) s = `${droneWord(c)} is ${Math.round((p.y - roof.h) * SCALE_M)} m above the roof of ${roof.name} in ${blk.name}`;
  else s = `${droneWord(c)} is ${alt} m above ${place}`;
  const tall = buildingsNear(p, 5).filter((o) => o.h * SCALE_M >= cfg.tallM && o.h > p.y);
  if (tall.length) s += `, alongside ${tall[0].name} (${Math.round(tall[0].h * SCALE_M)} m)`;
  return s;
}
function humanView(c) {
  const st = c.status, airborne = c.pos.y > 0.4, task = c.task;
  const lines = [], who = droneWord(c);
  const dest = task ? destOf(task) : null;
  const remM = task ? remainingU(c) * SCALE_M : 0;
  if (st === 'COMPLETE') lines.push('The package has arrived at the delivery station.');
  if (st === 'HOVER') lines.push(`${who} is holding position — no valid route is available right now.`);
  if (st === 'REROUTE') lines.push(`${who} is taking a different route${c.rerouteWhy ? ' ' + c.rerouteWhy : ''}.`);
  lines.push(whereText(c) + '.');
  if (airborne) {
    const vols = volumesAt(c.pos).filter((v) => v.permission === 'permitted' && v.kind !== 'transition');
    const trans = volumesAt(c.pos).find((v) => v.kind === 'transition');
    const top = vols.find((v) => v.kind === 'corridor') ?? vols[0];
    if (top) lines.push(`Flying through the ${top.name} (${top.id}), ${Math.round(top.zloM)}–${Math.round(top.zhiM)} m.`);
    else if (trans) lines.push(`${st === 'LAND' ? 'Descending' : 'Climbing'} in the ${trans.name} (${trans.id}).`);
    else lines.push(`${who} is outside the labelled airspace volumes.`);
  }
  if (st === 'TAKEOFF') lines.push(`${who} has just departed.`);
  if (st === 'LAND') lines.push(`${who} is landing.`);
  if (task && task.kind === 'toCustomer' && remM < cfg.arriveM && st !== 'LAND' && st !== 'TAKEOFF') lines.push('The delivery is approaching the receiving station.');
  else if (c.lastStreet && S.time - c.lastStreet.t < 6 && airborne) lines.push(`${who} has just passed ${c.lastStreet.name}.`);
  let rel = '';
  if (dest) {
    const e = (dest.acc.x - c.pos.x) * SCALE_M, n = -(dest.acc.z - c.pos.z) * SCALE_M, d = Math.hypot(e, n);
    const hd = c.headingDeg;
    rel = d < 3 ? `Above ${stationLabel(dest)}.` : `Heading ${compassWord(hd)} toward ${task.kind === 'toRestaurant' ? 'pickup' : 'delivery'} station ${stationLabel(dest)}, about ${Math.round(d)} m to the ${compassWord(bearingDeg(e, n))}.`;
  }
  const R = task?.route;
  const progress = R ? R.travelled / Math.max(1e-6, R.travelled + remainingU(c)) : null;
  const eta = !task ? null : c.hold ? 'unavailable while holding' : `≈ ${Math.ceil(remainingTime(c))} s (route length ÷ speed; holds not predicted)`;
  return { headline: HUMAN_STATUS[st] ?? st, lines: lines.slice(0, 5), rel, progress, eta, leg: task ? (task.kind === 'toRestaurant' ? 'to pickup station' : 'to delivery station') : '', order: (task?.order ?? c.carry[0] ?? c.orders[0]) };
}
const trackedDrone = () => (S.selected?.type === 'courier' ? S.selected : (S.track && S.couriers.includes(S.track) ? S.track : S.couriers[0]));

// ---------- routes: candidates (fine dashed) + the selected smooth cobalt curve ------------
const routeLayer = new THREE.Group(); scene.add(routeLayer);
const sceneXYZ = (p) => new THREE.Vector3(p.x, SLAB + p.y, p.z);
function densify(from, pts, step) { // insert points so a spline through them follows the validated polyline closely
  const out = [from]; let prev = from;
  for (const q of pts) {
    const d = dist3(prev, q); if (d < 1e-6) continue;
    const n = Math.max(1, Math.ceil(d / step));
    for (let i = 1; i <= n; i++) out.push({ x: prev.x + (q.x - prev.x) * i / n, y: prev.y + (q.y - prev.y) * i / n, z: prev.z + (q.z - prev.z) * i / n });
    prev = q;
  }
  return out;
}
/** thin tube whose fragments are discarded in a dash pattern along its length — a dashed curve that stays visible (GL lines are 1 px) */
function dashedMaterial(color, dashes) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 }, uCount: { value: dashes } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor;\nuniform float uOpacity;\nuniform float uCount;\nvarying vec2 vUv;\nvoid main() {\n  if (fract(vUv.x * uCount) > 0.6) discard;\n  gl_FragColor = vec4(uColor, uOpacity);\n  #include <colorspace_fragment>\n}',
  });
}
function buildViz(plan) {
  const group = new THREE.Group(), lines = [];
  plan.candidates.forEach((c, i) => {
    const pts = densify(plan.from, c.pts, 0.8).map(sceneXYZ);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const line = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(900, pts.length * 3), 0.075, 4, false), dashedMaterial(CAND_COLOR[i % CAND_COLOR.length], Math.max(6, Math.round(c.len / 1.1))));
    line.renderOrder = 5; line.visible = false; group.add(line); lines.push(line);
  });
  const pts = densify(plan.from, plan.best.pts, 0.9).map(sceneXYZ);
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(900, pts.length * 3), 0.11, 6, false), new THREE.MeshBasicMaterial({ color: AIR.cobalt, transparent: true, opacity: 0 }));
  tube.renderOrder = 6; tube.visible = false; group.add(tube);
  routeLayer.add(group);
  return { group, lines, tube, plan, bi: plan.candidates.indexOf(plan.best) };
}
function disposeViz(v) {
  if (!v) return;
  routeLayer.remove(v.group);
  v.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
}
/** eased fade; hidden objects skip rendering */
function fade(obj, target, k) {
  const m = obj.material, u = m.uniforms?.uOpacity;
  const cur = u ? u.value : m.opacity, next = cur + (target - cur) * k;
  if (u) u.value = next; else m.opacity = next;
  obj.visible = next > 0.01 || target > 0.01;
}
/** mode: 'cands' (Stage 2) · 'optimal' (Stage 3) · 'live' · 'off' */
function styleViz(v, mode, emph, k) {
  v.lines.forEach((l, i) => {
    const best = i === v.bi;
    const t = mode === 'cands' ? 1 * emph : mode === 'optimal' ? (best ? 0 : 0.22 * emph) : mode === 'live' && S.showAlt && !best ? 0.28 : 0;
    fade(l, t, k);
  });
  fade(v.tube, mode === 'off' || mode === 'cands' ? 0 : mode === 'optimal' ? 1 : 0.95, k);
}
const previews = { ver: -1, items: [] };
/** the four scripted missions, planned before anyone flies: hub → pickup station, pickup → delivery station */
function ensurePreviews() {
  if (previews.ver === world.version) return;
  previews.items.forEach((i) => disposeViz(i.viz)); previews.items = [];
  for (const m of S.missions) {
    for (const [leg, from, to] of [['pickup', S.homes[m.drone], m.restaurant.acc], ['delivery', m.restaurant.acc, m.customer.acc]]) {
      const plan = planMission(from, to);
      previews.items.push({ drone: m.drone, leg, from, to, plan, viz: plan.ok ? buildViz(plan) : null });
    }
  }
  previews.ver = world.version;
}
function syncRoutes(dt) {
  const k = 1 - Math.exp(-dt * 6);
  routeLayer.visible = S.showRoutes;
  ensurePreviews();
  const sel = S.selected?.type === 'courier' ? S.selected.id : null;
  for (const it of previews.items) {
    if (!it.viz) continue;
    const emph = sel && sel !== it.drone ? 0.35 : 1;
    styleViz(it.viz, S.stage === 2 ? 'cands' : S.stage === 3 ? 'optimal' : 'off', emph, k);
  }
  for (const c of S.couriers) {
    const plan = c.task?.route.plan;
    if (plan?.ok) {
      if (!c.viz || c.viz.plan !== plan) { disposeViz(c.viz); c.viz = buildViz(plan); }
    } else if (c.viz && !c.task) { disposeViz(c.viz); c.viz = null; }
    if (c.viz) styleViz(c.viz, S.stage === 4 && c.task ? 'live' : 'off', 1, k);
  }
}
function styleVolumes(dt) {
  const k = 1 - Math.exp(-dt * 6), st = S.stage;
  for (const z of volViz.values()) {
    const v = z.v;
    if (z.restricted && !v.active) continue;
    const sel = S.volSel === v.id, tr = v.kind === 'transition';
    let fillT, edgeT;
    if (z.restricted) { fillT = st === 1 ? 0.16 : 0.11; edgeT = st === 1 ? 0.95 : 0.75; }
    else if (tr) { fillT = st === 1 ? 0.16 : 0.08; edgeT = st === 1 ? 0.85 : 0.5; }
    else { fillT = st === 1 ? 0.06 : 0.025; edgeT = st === 1 ? 0.95 : 0.5; }
    if (sel) { fillT += 0.1; edgeT = 1; }
    z.fill.material.opacity += (fillT - z.fill.material.opacity) * k;
    z.edges.material.opacity += (edgeT - z.edges.material.opacity) * k;
    if (z.label) z.label.visible = sel || (st === 1 ? true : z.restricted);
  }
}

// ---------- visual sync ----------------------------------------------
const tmp = new THREE.Vector3();
function targetFor(o, slot) {
  const r = o.restaurant.pos;
  switch (o.status) {
    case 'picked_up': {
      const c = o.courier, i = c.carry.indexOf(o), off = (i - (c.carry.length - 1) / 2) * 0.55;
      return tmp.set(c.pos.x + off, SLAB + c.pos.y + 0.12, c.pos.z);
    }
    case 'delivered': return tmp.set(o.customer.pos.x + 2.6, SLAB + 0.3, o.customer.pos.z + 3.4);
    default: return tmp.set(r.x + (slot - 1.5) * 1.55, SLAB, r.z + 3.4);
  }
}
const up = (v, y) => new THREE.Vector3(v.x, y, v.z);
const sceneP = (p) => new THREE.Vector3(p.x, SLAB + p.y, p.z);
let qState = { mode: 'zone', result: [] };

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
    const base = o.status === 'picked_up' ? 0.5 : 1;
    o.mesh.scale.setScalar(base * (0.4 + 0.6 * Math.min(1, life * 2)));
    o.label.position.set(o.mesh.position.x, o.mesh.position.y + o.size * base + 1.1, o.mesh.position.z);
    let sub;
    if (o.status === 'preparing') sub = o.prepRemaining > 0 ? `cooking ${Math.ceil(o.prepRemaining)}s` : 'done — mark ready';
    else if (o.status === 'delivered') sub = `${fmt(o.deliveredAt - o.createdAt)}s total`;
    else sub = o.eta != null && Number.isFinite(o.eta) ? `${o.status} · ETA ${Math.ceil(o.eta)}s` : o.status;
    setLabel(o.label, [{ t: `#${o.id}  $${o.revenue}`, c: '#3b3631', s: 40 }, { t: sub, c: dark(STATUS_COLOR[o.status], 0.62), s: 30 }]);
  }
  for (const r of S.restaurants) {
    const n = S.orders.filter((o) => o.restaurant === r && o.status === 'preparing').length;
    setLabel(r.label, [{ t: `${r.stationId} · ${r.name}`, c: dark(r.color, 0.8), s: 40 },
      { t: `prep ${r.prepTime}s · cooking ${n}/${r.capacity}`, c: n >= r.capacity ? '#c0392b' : '#7a736b', s: 28 }]);
  }
  for (const c of S.customers) {
    const n = S.orders.filter((o) => o.customer === c && o.status !== 'delivered').length;
    setLabel(c.label, [{ t: `${c.stationId} · ${c.name}`, c: '#2f5f45', s: 38 }, { t: n ? `waiting: ${n}` : 'idle', c: '#7a736b', s: 28 }]);
  }
  const live = new Set(qState.result);
  for (const c of S.couriers) {
    c.bob += dt * 3;
    const airborne = c.pos.y > 0.05;
    const hy = airborne ? Math.sin(c.bob) * 0.08 : 0;
    c.mesh.position.set(c.pos.x, SLAB + c.pos.y + hy, c.pos.z);
    c.rot += wrap(c.heading - c.rot) * Math.min(1, dt * 8);
    c.inner.rotation.y = c.rot;
    const spin = airborne || c.task ? 28 : 0;
    c.rotors.forEach((r, i) => { r.rotation.y += dt * spin * (i % 2 ? 1 : -1); });
    const l = load(c);
    const lc = c.hold ? 0xf26b6b : l >= COURIER_CAPACITY ? 0xf2a03d : l > 0 ? 0x3b8fe8 : 0x5fd38d;
    c.lamp.material.color.setHex(lc); c.lamp.material.emissive.setHex(lc);
    c.label.position.set(c.pos.x, SLAB + c.pos.y + 3.4, c.pos.z);
    const alt = Math.round(c.pos.y * SCALE_M);
    const parked = !c.task && c.pos.y < 0.3 && !c.hold;
    if (parked) setLabel(c.label, [{ t: c.id, c: dark(c.tint, 0.8), s: 34 }]); // parked drones: just the ID, so the hub stays legible
    else setLabel(c.label, [{ t: `${c.id} · ${c.hold ? 'HOVER' : c.status}`, c: c.hold ? '#c0392b' : dark(c.tint, 0.8), s: 36 },
      { t: `z ${alt} m · ${l}/${COURIER_CAPACITY} orders`, c: '#7a736b', s: 26 }]);
    c.halo.visible = live.has(c.id); c.halo.position.copy(c.mesh.position).y += 0.8;
    // highlighted blocked obstacle (a few seconds after a conflict is detected)
    const b = c.blocked;
    if (b && S.time < b.until && b.obstacle) {
      const o = b.obstacle, hi = (o.h ?? Math.min(o.zhiM, cfg.maxAltM + 15) / SCALE_M), lo = o.zloM !== undefined ? o.zloM / SCALE_M : 0;
      c.blockMesh.visible = true; c.blockMesh.scale.set(o.x1 - o.x0 + 0.1, hi - lo, o.z1 - o.z0 + 0.1);
      c.blockMesh.position.set((o.x0 + o.x1) / 2, SLAB + lo + (hi - lo) / 2, (o.z0 + o.z1) / 2);
    } else c.blockMesh.visible = false;
  }
  platform.ring.rotation.z += dt * 1.1;
  const q = unassigned().length;
  setLabel(platform.label, [{ t: 'PLATFORM', c: '#2c4a8c', s: 46 },
    { t: `pending ${q} · free drones ${S.couriers.filter((c) => load(c) < COURIER_CAPACITY).length}/${S.couriers.length}`, c: '#7a736b', s: 28 },
    { t: S.policy === 'fifo' ? 'allocation: FIFO' : 'allocation: revenue-weighted', c: S.policy === 'fifo' ? '#7a736b' : '#a2740a', s: 28 }]);
  const s = S.selected;
  selRing.visible = !!s;
  if (s) {
    const p = s.type === 'order' ? s.mesh.position : s.type === 'courier' ? new THREE.Vector3(s.pos.x, SLAB, s.pos.z) : s.pos;
    selRing.position.set(p.x, s.type === 'order' ? p.y + 0.05 : SLAB + 0.06, p.z);
    selRing.scale.setScalar(s.type === 'restaurant' ? 2.4 : s.type === 'platform' ? 2.4 : s.type === 'customer' ? 1.9 : s.type === 'order' ? 0.7 : 0.9);
  }
  streetLabels.visible = S.showStreets;

  // relationship lines
  relLines.reset();
  for (const o of S.orders) {
    const op = o.mesh.position;
    if (o.status !== 'delivered') {
      relLines.add(up(o.customer.pos, 4.2), op, REL_COLOR.creates);                      // CUSTOMER creates ORDER
      if (['pending', 'preparing', 'ready'].includes(o.status)) {
        relLines.add(up(o.restaurant.pos, 5.4), op, REL_COLOR.prepares);                 // RESTAURANT prepares ORDER
        relLines.add(platformTop, op, REL_COLOR.evaluates);                              // PLATFORM evaluates ORDER
      }
    }
    if (o.status === 'assigned' && o.courier) {                                          // PLATFORM assigns drone to ORDER
      const cp = o.courier.mesh.position;
      relLines.add(platformTop, cp, REL_COLOR.assigns); relLines.add(cp, op, REL_COLOR.assigns);
    }
    if (o.status === 'picked_up' || o.status === 'delivered') relLines.add(op, up(o.customer.pos, 4.2), REL_COLOR.carries); // DRONE picks up / delivers
  }
  relLines.flush();

  // flight lines: planned path (nominal / rerouted), blocked stretch, altitude drop lines
  flightLines.reset();
  for (const c of S.couriers) {
    const cp = sceneP(c.pos);
    if (c.pos.y > 0.3) flightLines.add(cp, new THREE.Vector3(c.pos.x, SLAB + 0.05, c.pos.z), 0xaab2ba);
    if (c.blocked && S.time < c.blocked.until) flightLines.add(sceneP(c.blocked.a), sceneP(c.blocked.b), PATH_COLOR.blocked);
  }
  flightLines.flush();
  syncRoutes(dt); styleVolumes(dt);

  // query volume
  const qv = qState.vol;
  qBox.visible = !!qv && qv.kind === 'box'; qSphere.visible = !!qv && qv.kind === 'sphere';
  if (qv?.kind === 'box') { qBox.scale.set(...qv.size); qBox.position.set(...qv.centre); }
  if (qv?.kind === 'sphere') { qSphere.scale.setScalar(qv.r); qSphere.position.set(...qv.centre); }
}

// ---------- DOM panels -------------------------------------------------
const tag = (s) => `<span class="pill" style="background:${hex(STATUS_COLOR[s])}">${s}</span>`;
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
const locOf = (e) => `(${fmt(e.pos.x * SCALE_M, 0)}, ${fmt(-e.pos.z * SCALE_M, 0)}) m`;
function infoHTML() {
  const s = S.selected;
  if (!s) return 'Click an order, customer, restaurant, drone or the platform. Actions use the selection when it applies.';
  if (s.type === 'order') {
    const total = s.deliveredAt != null ? s.deliveredAt - s.createdAt : S.time - s.createdAt;
    return `<div class="name">ORDER #${s.id}</div><table>
      ${row('revenue', '$' + s.revenue)}${row('status', tag(s.status))}
      ${row('creation time', fmt(s.createdAt) + 's')}
      ${row('total delivery time', s.deliveredAt != null ? fmt(total) + 's (final)' : fmt(total) + 's so far' + (s.eta != null && Number.isFinite(s.eta) ? ` · est. +${fmt(s.eta, 0)}s` : ''))}
      ${row('customer', `${s.customer.name} · ${s.customer.stationId}`)}${row('restaurant', `${s.restaurant.name} · ${s.restaurant.stationId}`)}
      ${row('drone', s.courier?.id ?? '—')}
      ${row('preparation', s.status === 'pending' ? `${fmt(s.prepTotal)}s (not started)` : s.prepRemaining > 0 ? `${fmt(s.prepRemaining)}s left` : 'done')}
      ${row('waited for pickup', s.pickedAt != null ? fmt(s.pickedAt - s.readyAt) + 's' : s.readyAt != null ? fmt(S.time - s.readyAt) + 's…' : '—')}
      ${row('priority', unassigned().includes(s) ? fmt(priorityOf(s)) : '—')}</table>`;
  }
  if (s.type === 'customer') {
    return `<div class="name">CUSTOMER ${s.name} · delivery station ${s.stationId}</div><table>
      ${row('location', locOf(s))}
      ${row('order time', s.orderTime != null ? fmt(s.orderTime) + 's' : '—')}
      ${row('selected restaurant', s.selectedRestaurant?.name ?? '—')}
      ${row('open orders', S.orders.filter((o) => o.customer === s && o.status !== 'delivered').map((o) => '#' + o.id).join(' ') || '—')}</table>`;
  }
  if (s.type === 'restaurant') {
    const act_ = S.orders.filter((o) => o.restaurant === s && o.status === 'preparing');
    return `<div class="name">RESTAURANT ${s.name} · pickup station ${s.stationId}</div><table>
      ${row('location', locOf(s))}
      ${row('preparation time', s.prepTime + 's (avg)')}
      ${row('active orders', act_.map((o) => '#' + o.id).join(' ') || '—')}
      ${row('production capacity', `${act_.length}/${s.capacity} at once`)}</table>`;
  }
  if (s.type === 'courier') {
    const dest = s.task ? destOf(s.task) : null;
    return `<div class="name">COURIER · drone ${s.id}</div><table>
      ${row('location', `(${fmt(s.pos.x * SCALE_M, 0)}, ${fmt(-s.pos.z * SCALE_M, 0)}, ${fmt(s.pos.y * SCALE_M, 0)}) m`)}
      ${row('availability', load(s) < COURIER_CAPACITY ? `available (${COURIER_CAPACITY - load(s)} slot${COURIER_CAPACITY - load(s) > 1 ? 's' : ''})` : 'full')}
      ${row('current assignment', [...s.orders, ...s.carry].map((o) => `#${o.id} (${o.status})`).join(', ') || '—')}
      ${row('travel time', dest ? `${fmt(remainingTime(s))}s to ${dest.stationId}` : 'not flying')}</table>
      <div class="dim" style="margin-top:4px">Full XYZ and human-readable views are in “Drone location”.</div>`;
  }
  const q = unassigned();
  return `<div class="name">PLATFORM</div><table>
    ${row('available drones', S.couriers.filter((c) => load(c) < COURIER_CAPACITY).map((c) => c.id).join(' ') || 'none')}
    ${row('pending orders', q.map((o) => '#' + o.id).join(' ') || '—')}
    ${row('allocation logic', S.policy === 'fifo' ? 'FIFO (longest wait first)' : 'revenue-weighted: revenue + ½·wait')}
    ${row('delivery-time estimate', q.length ? `avg ${fmt(q.reduce((a, o) => a + (Number.isFinite(o.eta ?? estimate(o)) ? (o.eta ?? estimate(o)) : 0), 0) / q.length)}s (pending)` : '—')}</table>`;
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
    ${k(fmt(S.time, 0) + 's', 'simulation time')}${k(`${busy}/${S.couriers.length}`, 'drones busy')}
    ${k(d.length, 'delivered')}${k('$' + d.reduce((a, o) => a + o.revenue, 0), 'delivered revenue')}
    ${k(fmt(avg(d.map(tt))) + 's', 'avg delivery time')}${k(fmt(avg(d.map((o) => o.pickedAt - o.readyAt))) + 's', 'avg pickup wait')}
    ${k(fmt(avg(hi.map(tt))) + 's', `avg · revenue ≥ $${HIGH_REVENUE} (${hi.length})`)}${k(fmt(avg(lo.map(tt))) + 's', `avg · revenue < $${HIGH_REVENUE} (${lo.length})`)}
  </div>`;
}
const rulesHTML = () => RULES.map((r, i) => `<li><b>${r}</b>${S.ruleHits[i] ? ` <span class="hit">×${S.ruleHits[i]}</span>` : ''}</li>`).join('');
const logHTML = () => S.log.map((e) => `<div class="${e.kind}">[${fmt(e.t, 0)}s] ${e.msg}</div>`).join('');

// robot perspective (machine-readable)
function robotHTML(c) {
  if (!c) return '';
  const l = toLocal(c.pos), zone = zoneAt(c.pos.x, c.pos.z), lm = nearestLandmark(c.pos), n = c.nearest ?? nearestObstacle(c.pos);
  const ceilM = ceilingMAt(c.pos.x, c.pos.z), vols = volumesAt(c.pos), blk = blockAt(c.pos.x, c.pos.z);
  const volTxt = vols.length ? vols.map((v) => `<b>${v.id}</b>${v.permission === 'restricted' ? ' <span class="bad">restricted</span>' : ''}`).join(' + ') : '<span class="bad">none — outside all volumes</span>';
  const P = c.task?.route.plan;
  const R = c.task?.route;
  const stat = c.hold ? `HOVER <span class="bad">NO_VALID_ROUTE</span>` : c.status;
  return `<table>
    ${row('id', `<b>${c.id}</b>`)}
    ${row('x, y, z (m)', `<b>${fmt(l.x)}, ${fmt(l.y)}, ${fmt(l.z)}</b>`)}
    ${row('altitude datum', `z above street level (z=0) · ceiling here ${ceilM} m`)}
    ${row('heading · speed', `${fmt(c.headingDeg, 0)}° (${compassWord(c.headingDeg)}) · ${fmt(c.speedU * SCALE_M)} m/s`)}
    ${row('flight_status', `<b>${stat}</b>`)}
    ${row('route · waypoint', R ? `${R.id} · ${Math.min(R.idx + 1, R.pts.length)}/${R.pts.length}${R.rerouted ? ' (rerouted)' : ''}` : '—')}
    ${row('candidates → chosen', P?.ok ? `${P.candidates.length} feasible → <b>${P.best.id}</b> ${P.best.label}` : '—')}
    ${row('destination', c.task ? stationLabel(destOf(c.task)) : '—')}
    ${row('airspace volume(s)', volTxt)}
    ${row('district · block', `${zone.name} · ${blk.name}`)}
    ${row('nearest obstacle', `${fmt(n.d * SCALE_M)} m · ${n.id ?? '—'}${n.kind === 'restricted' ? ' (restricted)' : ''}`)}
    ${row('clearance margin', `${cfg.clearanceM} m`)}
    ${row('nearest landmark', `${lm.name} (${fmt(lm.distM, 0)} m)`)}
  </table>`;
}
// human perspective (readable)
function humanHTML(c) {
  if (!c) return '';
  const h = humanView(c);
  const pct = h.progress != null ? Math.round(h.progress * 100) : null;
  return `<div class="hhead"><span class="hstatus">${h.headline}</span>${h.order ? `<span class="dim">Order #${h.order.id} · ${h.order.customer.name}</span>` : ''}</div>
    ${h.lines.map((t) => `<p class="hline">${t}</p>`).join('') || '<p class="hline dim">No active delivery.</p>'}
    ${h.rel ? `<p class="hline dim">${h.rel}</p>` : ''}
    ${pct != null ? `<div class="bar"><i style="width:${pct}%"></i></div><div class="dim small">${pct}% of this leg flown (${h.leg}) · ETA ${h.eta}</div>` : ''}`;
}
// side elevation: altitude vs distance along the straight line to the destination
function elevationSource(c) {
  if (c?.task) return { A: c.task.start, B: destOf(c.task).acc, cur: c.pos, pts: pts3(c), col: '#1f4fd1', title: null };
  if (c && S.stage < 4) { // before flight: show the drone's first planned (selected) leg
    ensurePreviews();
    const it = previews.items.find((i) => i.drone === c.id && i.leg === 'delivery' && i.plan.ok);
    if (it) return { A: it.from, B: it.to, cur: it.from, pts: it.plan.best.pts, col: '#1f4fd1', title: `${c.id} delivery leg · planned` };
  }
  return null;
}
function drawElevation(c) {
  const cv = $('elev'); if (!cv) return;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, padL = 26, padB = 14, padT = 6;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#f7f4f0'; g.fillRect(0, 0, W, H);
  const src = elevationSource(c);
  if (!src) { g.fillStyle = '#8a8279'; g.font = '12px system-ui'; g.fillText('No active route — step to “Live Flight” or pick a drone.', 10, H / 2); return; }
  const { A, B } = src, L = Math.max(1, dist(A, B)), ux = (B.x - A.x) / L, uz = (B.z - A.z) / L;
  const zTop = cfg.maxAltM + 20, X = (s) => padL + (s / L) * (W - padL - 6), Y = (zm) => H - padB - (zm / zTop) * (H - padB - padT);
  const sCoord = (p) => (p.x - A.x) * ux + (p.z - A.z) * uz;
  const N = 120, w = Math.ceil((W - padL) / N) + 1;
  for (let i = 0; i <= N; i++) { // permitted volumes, buildings and restricted prisms beneath the straight line A→B
    const s = (i / N) * L, x = A.x + ux * s, z = A.z + uz * s, x0 = X(s);
    for (const v of world.volumes) if (x >= v.x0 && x <= v.x1 && z >= v.z0 && z <= v.z1) {
      const hi = Math.min(v.zhiM, v.kind === 'transition' ? v.zhiM : cfg.maxAltM);
      g.fillStyle = 'rgba(111,207,159,.22)'; g.fillRect(x0, Y(hi), w, Y(v.zloM) - Y(hi));
    }
    let h = 0, rz = null;
    for (const o of world.obstacles) if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1) h = Math.max(h, o.h * SCALE_M);
    for (const r of world.restricted) if (r.active && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) rz = r;
    if (h) { g.fillStyle = '#cfcac4'; g.fillRect(x0, Y(h), w, Y(0) - Y(h)); }
    if (rz) { g.fillStyle = 'rgba(224,112,124,.34)'; g.fillRect(x0, Y(Math.min(rz.zhiM, zTop)), w, Y(rz.zloM) - Y(Math.min(rz.zhiM, zTop))); }
  }
  g.strokeStyle = '#8a8279'; g.beginPath(); g.moveTo(padL, Y(0)); g.lineTo(W - 6, Y(0)); g.stroke();
  g.fillStyle = '#8a8279'; g.font = '10px system-ui'; g.fillText(`${cfg.maxAltM} m`, 2, Y(cfg.maxAltM) + 3); g.fillText('0', 14, Y(0) + 3);
  g.fillText('start', padL, H - 2); g.fillText('destination', W - 56, H - 2);
  g.strokeStyle = src.col; g.lineWidth = 2; g.beginPath(); g.moveTo(X(Math.max(0, Math.min(L, sCoord(src.cur)))), Y(src.cur.y * SCALE_M));
  for (const p of src.pts) g.lineTo(X(Math.max(0, Math.min(L, sCoord(p)))), Y(p.y * SCALE_M));
  g.stroke(); g.lineWidth = 1;
  g.fillStyle = '#2c4a8c'; g.beginPath(); g.arc(X(Math.max(0, Math.min(L, sCoord(src.cur)))), Y(src.cur.y * SCALE_M), 4, 0, 7); g.fill();
  if (src.title) { g.fillStyle = '#5f5a54'; g.fillText(src.title, padL + 4, 12); }
}

const nameOpt = (a) => a.map((s) => `<option>${s}</option>`).join('');
let lastDroneKey = '';
function readQuery() {
  const mode = $('q-mode').value, num = (id, d = 0) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : d; };
  if (mode === 'volume') return { volume: $('q-vol').value };
  if (mode === 'box') return { box: { x: [num('q-x0', -300), num('q-x1', 300)], y: [num('q-y0', -300), num('q-y1', 300)], z: [num('q-z0', 0), num('q-z1', 120)] } };
  return { point: [num('q-px'), num('q-py'), num('q-pz', 50)], radius: num('q-pr', 40) };
}
function queryVolume(loc) {
  if (loc.box) {
    const a = fromLocal({ x: loc.box.x[0], y: loc.box.y[0], z: loc.box.z[0] }), b = fromLocal({ x: loc.box.x[1], y: loc.box.y[1], z: loc.box.z[1] });
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    return { kind: 'box', size: [x1 - x0, Math.max(0.2, y1 - y0), z1 - z0], centre: [(x0 + x1) / 2, SLAB + (y0 + y1) / 2, (z0 + z1) / 2] };
  }
  const p = fromLocal({ x: loc.point[0], y: loc.point[1], z: loc.point[2] });
  return { kind: 'sphere', r: loc.radius / SCALE_M, centre: [p.x, SLAB + p.y, p.z] };
}
const ext = (a, b) => `${Math.round(a)} … ${Math.round(b)} m`;
function volumeCardHTML(id, ids) {
  const v = namedVolumes().find((q) => q.id === id);
  if (!v) return '';
  const perm = v.permission === 'permitted';
  const status = v.active ? '' : ' · <span class="dim">inactive</span>';
  return `<div class="vcard ${perm ? 'ok' : 'no'}"><div class="vhead"><b>${v.id}</b> ${v.name}<span class="pill" style="background:${perm ? '#3fa874' : v.kind === 'hazard' ? '#c8860f' : '#c8404f'}">${v.kind === 'hazard' ? 'hazard' : v.permission}</span></div>
    <table><tr><td>x (east)</td><td>${ext(v.x0 * SCALE_M, v.x1 * SCALE_M)}</td></tr>
    <tr><td>y (north)</td><td>${ext(-v.z1 * SCALE_M, -v.z0 * SCALE_M)}</td></tr>
    <tr><td>z (altitude)</td><td>${ext(v.zloM, v.zhiM)}${status}</td></tr>
    <tr><td>drones inside</td><td>${ids.length ? ids.map((i) => `<span class="pill drone" style="background:${hex(S.couriers.find((d) => d.id === i)?.tint ?? 0xf1b82d)}">${i}</span>`).join(' ') : '<span class="dim">none right now</span>'}</td></tr></table></div>`;
}
function updateQuery() {
  const loc = readQuery(), res = getAgentsAt(loc);
  qState.result = res.agents;
  const mode = $('q-mode').value;
  S.volSel = mode === 'volume' ? loc.volume : null;
  qState.vol = mode !== 'volume' && $('q-show').checked ? queryVolume(loc) : null;
  $('q-card').innerHTML = mode === 'volume' ? volumeCardHTML(loc.volume, res.agents) : '';
  $('q-out').textContent = JSON.stringify(res, null, 1).replace(/\n\s+/g, ' ').replace(/\{ /g, '{').replace(/ \}/g, '}');
  $('q-ids').innerHTML = mode === 'volume' ? '' : res.agents.length ? res.agents.map((i) => `<span class="pill drone">${i}</span>`).join(' ') : '<span class="dim">no drones in this volume</span>';
}
/** select a volume in the query panel (from a click on the prism or from the list) */
function selectVolume(id) {
  $('q-mode').value = 'volume'; $('q-vol').value = id;
  $('sec-query').open = true;
  modeSwitch();
}
// ---------- stage + fleet panels ------------------------------------------------
function legTableHTML(plan, title) {
  if (!plan) return '';
  if (!plan.ok) return `<div class="legt"><div class="lh">${title}</div><div class="bad">No feasible route — ${plan.reason}.</div></div>`;
  const shown = S.stage >= 3;
  return `<div class="legt"><div class="lh">${title} · ${plan.candidates.length} feasible candidate${plan.candidates.length > 1 ? 's' : ''}</div><table>
    ${plan.candidates.map((c, i) => `<tr class="${shown && c.chosen ? 'win' : ''}"><td><i class="cd" style="background:${hex(CAND_COLOR[i % CAND_COLOR.length])}"></i>${c.id}</td><td>${c.label}</td><td>${Math.round(c.len * SCALE_M)} m</td><td>+${Math.round(c.climbM)} m</td><td>${fmt(c.cost * SCALE_M, 0)}</td><td>${shown && c.chosen ? '✓' : ''}</td></tr>`).join('')}
    </table></div>`;
}
function stageHTML() {
  const [, q, desc] = STAGES[S.stage - 1];
  let html = `<div class="stq"><b>${q}</b> ${desc}</div>`;
  const c = trackedDrone();
  if (S.stage === 4 && c) {
    const P = c.task?.route.plan;
    html += `<div class="dim small" style="margin-top:6px"><b style="color:${dark(c.tint, 0.8)}">${c.id}</b> · ${P?.ok ? `${P.candidates.length} feasible candidate${P.candidates.length > 1 ? 's' : ''} → flying <b>${P.best.label}</b> (${Math.round(P.best.len * SCALE_M)} m)${c.task.route.rerouted ? ', re-planned in flight' : ''}` : c.hold ? `no valid route — ${c.hold.reason}` : 'on the ground — no active leg'}.</div>`;
  } else if (S.stage >= 2 && c) {
    ensurePreviews();
    const its = previews.items.filter((i) => i.drone === c.id);
    html += `<div class="dim small" style="margin-top:6px">Planned legs for <b style="color:${dark(c.tint, 0.8)}">${c.id}</b> — length · climb · cost</div>`;
    for (const it of its) html += legTableHTML(it.plan, it.leg === 'pickup' ? `Hub → ${S.missions.find((m) => m.drone === c.id).restaurant.stationId} (pickup)` : `${S.missions.find((m) => m.drone === c.id).restaurant.stationId} → ${S.missions.find((m) => m.drone === c.id).customer.stationId} (delivery)`);
    html += `<div class="dim small" style="margin-top:4px">Criterion actually used: <b>${its[0]?.plan.criterion ?? '—'}</b>. Selection mode: ${cfg.preference}.</div>`;
  }
  return html;
}
function fleetHTML() {
  const cur = trackedDrone();
  return S.couriers.map((c) => {
    const m = S.missions.find((q) => q.drone === c.id), h = humanView(c), pct = h.progress != null ? Math.round(h.progress * 100) : 0;
    const dest = c.task ? destOf(c.task).stationId : c.carry[0] ? c.carry[0].customer.stationId : c.orders[0] ? c.orders[0].restaurant.stationId : '—';
    const stat = c.hold ? 'HOVER' : c.status;
    return `<div class="fcard ${cur === c ? 'sel' : ''}" data-drone="${c.id}" style="--tint:${hex(c.tint)}">
      <i class="sw"></i><b>${c.id}</b><span class="fst ${c.hold ? 'bad' : ''}">${stat}</span>
      <span class="fz">z ${Math.round(c.pos.y * SCALE_M)} m</span>
      <span class="fm dim">${m ? `${m.restaurant.stationId} → ${m.customer.stationId}` : ''} · now → ${dest} · ${load(c)}/${COURIER_CAPACITY}</span>
      <div class="bar"><i style="width:${pct}%;background:${hex(c.tint)}"></i></div></div>`;
  }).join('');
}
function missionBar() {
  const done = S.missions.filter((m) => m.order.status === 'delivered' || !S.orders.includes(m.order)).length;
  const frac = S.missions.reduce((a, m) => a + (S.orders.includes(m.order) ? STATUS.indexOf(m.order.status) / 5 : 1), 0) / Math.max(1, S.missions.length);
  $('t-clock').textContent = `${fmt(S.time, 0)} s`;
  $('t-bar').style.width = Math.round(frac * 100) + '%';
  $('t-note').textContent = `first deliveries ${done}/${S.missions.length}`;
}
function stageButtons() {
  document.querySelectorAll('#stages button').forEach((b) => b.classList.toggle('on', +b.dataset.stage === S.stage));
  $('stage-q').textContent = `Stage ${S.stage} · ${STAGES[S.stage - 1][0]}`;
}
function setStage(n) {
  n = Math.max(1, Math.min(4, n));
  if (n === S.stage) return;
  S.stage = n;
  if (n === 4) S.running = true;
  log(`Stage ${n}: ${STAGES[n - 1][0]} — ${STAGES[n - 1][1]}`);
  updatePanels(true);
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
  $('btn-play').textContent = S.stage < 4 ? '▶ Start flight' : S.running ? '⏸ Pause' : '▶ Run';
  stageButtons(); missionBar();
  $('alt-row').hidden = S.stage !== 4;
  $('stage-body').innerHTML = stageHTML();
  $('fleet').innerHTML = fleetHTML();
  // drone selector
  const k = S.couriers.map((c) => c.id).join();
  const c = trackedDrone();
  if (k !== lastDroneKey) { $('sel-drone').innerHTML = nameOpt(S.couriers.map((d) => d.id)); lastDroneKey = k; }
  if (c) { $('sel-drone').value = c.id; S.track = c; }
  $('robot').innerHTML = robotHTML(c);
  $('robot-json').textContent = JSON.stringify(getLocation(c?.id), null, 1).replace(/\[\s+([^\]]*?)\s+\]/g, (m, inner) => '[' + inner.replace(/\s+/g, ' ') + ']');
  $('human').innerHTML = humanHTML(c);
  drawElevation(c);
  updateQuery();
}
const sw = (bg, t, extra = '') => `<div><i style="background:${bg};${extra}"></i>${t}</div>`;
const lg = (title, body) => `<section><b>${title}</b>${body}</section>`;
$('legend').innerHTML =
  lg('Airspace', sw('rgba(111,207,159,.45)', 'permitted volume (3D prism)', `border:1px dashed ${hex(AIR.edgePermitted)}`)
    + sw('rgba(224,112,124,.45)', 'restricted volume', `border:1px dashed ${hex(AIR.edgeRestricted)}`)
    + sw('rgba(240,177,58,.5)', 'temporary hazard (HZ-1)', `border:1px dashed ${hex(AIR.edgeHazard)}`)
    + sw('#e8e6e2', 'building (solid obstacle)'))
  + lg('Routes', sw(hex(CAND_COLOR[0]), 'candidate routes (dashed)') + sw(hex(AIR.cobalt), 'selected smooth route') + sw(hex(PATH_COLOR.blocked), 'blocked stretch'))
  + lg('Drones', DRONE_TINT.map((t, i) => sw(hex(t), 'D-0' + (i + 1))).join(''))
  + lg('Roles', [['customer', 'customer · delivery station'], ['restaurant', 'restaurant · pickup station'], ['platform', 'platform · launch hub'], ['courier', 'drone body']]
    .map(([k, t]) => sw(hex(ROLE[k]), t)).join(''))
  + lg('Order status', STATUS.map((s) => sw(hex(STATUS_COLOR[s]), s)).join('') + '<div class="dim">Box size = revenue · N ↗</div>');

// ---------- panel wiring ---------------------------------------------
const bind = (id, fn) => $(id).addEventListener('click', () => { fn(); updatePanels(true); });
bind('btn-play', () => { if (S.stage < 4) setStage(4); else S.running = !S.running; });
document.querySelectorAll('#stages button').forEach((b) => b.addEventListener('click', () => setStage(+b.dataset.stage)));
$('btn-stage-prev').addEventListener('click', () => setStage(S.stage - 1));
$('btn-stage-next').addEventListener('click', () => setStage(S.stage + 1));
$('chk-alt').addEventListener('change', (e) => { S.showAlt = e.target.checked; });
$('fleet').addEventListener('pointerdown', (e) => { // pointerdown: the cards are re-rendered every 250 ms, which would swallow a slow click
  const card = e.target.closest('[data-drone]'); if (!card) return;
  const c = S.couriers.find((d) => d.id === card.dataset.drone); if (c) { S.selected = c; S.track = c; updatePanels(true); }
});
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
$('sel-speed').addEventListener('change', (e) => { S.speed = parseFloat(e.target.value); });
for (const k of ['customer', 'restaurant', 'platform', 'courier']) {
  $('auto-' + k).checked = S.auto[k];
  $('auto-' + k).addEventListener('change', (e) => { S.auto[k] = e.target.checked; log(`Auto ${k}: ${e.target.checked ? 'on' : 'off'}`); });
}
$('btn-panel').addEventListener('click', () => {
  const c = $('panel').classList.toggle('collapsed');
  $('btn-panel').textContent = c ? '▸' : '▾';
});
$('sel-drone').addEventListener('change', (e) => { const c = S.couriers.find((d) => d.id === e.target.value); if (c) { S.selected = c; S.track = c; updatePanels(true); } });

// flight parameters (illustrative) and airspace display
const params = [
  ['p-clear', 'clearanceM', 'm'], ['p-maxalt', 'maxAltM', 'm'], ['p-cruise', 'cruiseM', 'm'], ['p-tall', 'tallM', 'm'], ['p-arrive', 'arriveM', 'm'],
];
for (const [id, k, unit] of params) {
  const el = $(id); el.value = cfg[k]; $(id + '-v').textContent = cfg[k] + ' ' + unit;
  el.addEventListener('input', () => {
    cfg[k] = parseFloat(el.value); $(id + '-v').textContent = cfg[k] + ' ' + unit;
    if (k === 'clearanceM' || k === 'maxAltM' || k === 'cruiseM') { bump(); legCache.clear(); refreshAirspace(); }
  });
}
$('p-pref').addEventListener('change', (e) => { cfg.preference = e.target.value; bump(); legCache.clear(); });
$('p-airspace').addEventListener('change', (e) => { S.showAirspace = e.target.checked; refreshAirspace(); });
$('p-routes').addEventListener('change', (e) => { S.showRoutes = e.target.checked; });
$('p-streets').addEventListener('change', (e) => { S.showStreets = e.target.checked; });

// scripted test situations (they create a normal order and let the simulation fly it)
function scenario(r, c, why, pref) {
  const R = S.restaurants.find((x) => x.stationId === r), C = S.customers.find((x) => x.stationId === c);
  if (pref) { cfg.preference = pref; $('p-pref').value = pref; bump(); legCache.clear(); }
  const o = createOrder(C, R);
  log(`Scenario: order #${o.id} ${R.stationId} → ${C.stationId} — ${why}`, 'good');
  if (!S.auto.restaurant || !S.auto.platform || !S.auto.courier) toast('Auto is off for some agents: accept, mark ready, assign and fly the order manually.');
}
bind('sc-open', () => scenario('PS-3', 'DS-4', 'open lane in the low South Block District'));
bind('sc-tall', () => scenario('PS-1', 'DS-6', 'the 95 m Spire Tower lies on the straight path', 'shortest'));
bind('sc-tall-climb', () => scenario('PS-1', 'DS-6', 'same route, but the drone prefers climbing over the tower', 'climb'));
bind('sc-restricted', () => scenario('PS-2', 'DS-3', 'Restricted Zone A (a full-height prism) blocks the shortest route at every altitude'));
bind('sc-closed', () => {
  const rz = world.restricted.find((r) => r.id === 'HZ-1');
  rz.active = !rz.active; bump(); legCache.clear(); refreshAirspace();
  $('sc-closed').textContent = rz.active ? 'Clear hazard HZ-1' : 'Raise hazard HZ-1 over DS-3';
  log(rz.active ? 'Temporary hazard HZ-1 raised over DS-3 — affected routes are re-planned; DS-3 itself becomes unreachable' : 'Temporary hazard HZ-1 cleared', rz.active ? 'bad' : 'good');
  if (rz.active) scenario('PS-3', 'DS-3', 'destination inside restricted airspace → expect HOVER / NO_VALID_ROUTE');
});

// spatial query panel
{
  const rank = (v) => (v.kind === 'transition' ? 2 : v.permission === 'restricted' ? 1 : 0);
  $('q-vol').innerHTML = namedVolumes().sort((a, b) => rank(a) - rank(b)).map((v) => `<option value="${v.id}">${v.id} · ${v.name}</option>`).join('');
  $('q-vol').value = 'V-03';
}
const modeSwitch = () => { const m = $('q-mode').value; for (const el of document.querySelectorAll('[data-qm]')) el.hidden = !el.dataset.qm.split(' ').includes(m); updatePanels(true); };
$('q-mode').addEventListener('change', modeSwitch);
for (const el of document.querySelectorAll('#sec-query input, #sec-query select')) el.addEventListener('input', () => updateQuery());
$('q-example').addEventListener('click', () => { $('q-mode').value = 'box'; $('q-x0').value = -80; $('q-x1').value = 80; $('q-y0').value = 40; $('q-y1').value = 120; $('q-z0').value = 90; $('q-z1').value = 120; modeSwitch(); });
$('q-here').addEventListener('click', () => {
  const c = trackedDrone(); if (!c) return; const l = toLocal(c.pos);
  $('q-mode').value = 'point'; modeSwitch(); $('q-px').value = Math.round(l.x); $('q-py').value = Math.round(l.y); $('q-pz').value = Math.round(l.z); $('q-pr').value = 40; updateQuery();
});
modeSwitch();

function resetWorld(silent = false) {
  [...S.orders].forEach(removeOrder);
  [...S.couriers].forEach(removeCourier);
  S.delivered.length = 0; S.log.length = 0; S.track = null; S.homes = {}; S.missions = [];
  S.time = 0; S.nextOrder = 1; S.nextCourier = 1; S.nextRoute = 1; S.selected = null; S.policy = 'fifo'; simSeed = 7;
  S.ruleHits.fill(0); S.timers = { spawn: 40, evaluate: 0, sense: 0 };
  S.customers.forEach((c) => { c.orderTime = null; c.selectedRestaurant = null; });
  const rz = world.restricted.find((r) => r.id === 'HZ-1');
  if (rz.active) { rz.active = false; bump(); legCache.clear(); refreshAirspace(); $('sc-closed').textContent = 'Raise hazard HZ-1 over DS-3'; }
  for (let i = 0; i < MAX_COURIERS; i++) addCourier();
  // the four scripted first deliveries: each drone's first order is pinned to it, so the previewed routes are the flown routes
  const plan = [['D-01', 'PS-1', 'DS-6'], ['D-02', 'PS-2', 'DS-3'], ['D-03', 'PS-3', 'DS-4'], ['D-04', 'PS-1', 'DS-5']];
  for (const [d, r, c] of plan) {
    const R = S.restaurants.find((x) => x.stationId === r), C = S.customers.find((x) => x.stationId === c);
    const o = createOrder(C, R); o.pin = d;
    S.missions.push({ drone: d, restaurant: R, customer: C, order: o });
  }
  previews.ver = -1;
  S.running = true;
  controls.reset();
  if (!silent) log('World reset — four drones back at the launch hub');
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
  if (hit) S.selected = hit.object.userData.ref;
  else {
    S.selected = null;
    // nothing solid under the cursor: pick an airspace prism (restricted first, then columns, corridor, decks)
    const hits = S.showAirspace ? ray.intersectObjects(volMeshes.filter((m) => m.visible), false) : [];
    if (hits.length) {
      const pri = Math.min(...hits.map((h) => h.object.userData.pri));
      selectVolume(hits.find((h) => h.object.userData.pri === pri).object.userData.volume.id);
    }
  }
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

controls.update(); controls.saveState();
refreshAirspace();
resetWorld(true);
log('AIRSPACE ready — step through the four stages, or press Start flight. All geometry and parameters are synthetic.');
resize();
let lastT = performance.now();
function frame() {
  const now = performance.now(), dt = Math.min((now - lastT) / 1000, 0.1); lastT = now;
  if (S.running && S.stage === 4) { let t = dt * S.speed; while (t > 1e-6) { const s = Math.min(0.1, t); step(s); t -= s; } }
  controls.update();
  syncVisuals(dt);
  if ((panelClock += dt) > 0.25) updatePanels();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
updatePanels(true);
frame();
// exposed for debugging / automated checks
window.__sim = { segCheck, inPermitted, volumesAt, S, act, step, world, cfg, planRoute, planMission, getLocation, getAgentsAt, getAgentsInBox, setStage, previews, selectVolume, resetWorld };
