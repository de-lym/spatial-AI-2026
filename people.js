// Solid-black cut-out figures (architectural "scale people"): slender, slightly angular silhouettes drawn procedurally
// on canvas — walkers with a stride cycle, a dog and a cyclist — used as upright, camera-facing billboards.
import * as THREE from 'three';

const FW = 96, FH = 192, FRAMES = 8;          // walker frame size, frames per cycle
const TAU = Math.PI * 2;
const rngOf = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// tapered limb through points with widths (round joints)
function limb(g, pts, ws) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    g.beginPath(); g.moveTo(x0 + nx * ws[i] / 2, y0 + ny * ws[i] / 2); g.lineTo(x1 + nx * ws[i + 1] / 2, y1 + ny * ws[i + 1] / 2);
    g.lineTo(x1 - nx * ws[i + 1] / 2, y1 - ny * ws[i + 1] / 2); g.lineTo(x0 - nx * ws[i] / 2, y0 - ny * ws[i] / 2); g.closePath(); g.fill();
  }
  for (let i = 0; i < pts.length; i++) { g.beginPath(); g.arc(pts[i][0], pts[i][1], ws[i] / 2, 0, TAU); g.fill(); }
}

/** one walking-person frame, facing right. v: {kind, hair, bag, lean, tall}; ph: 0..1 stride phase */
function drawWalker(g, v, ph) {
  const cx = 44, ground = 186, hipY = ground - 82 * v.tall, L1 = 41 * v.tall, L2 = 41 * v.tall;
  const a = ph * TAU, bob = Math.abs(Math.sin(a)) * 2.2 * (v.still ? 0 : 1), hy = hipY - bob;
  g.fillStyle = '#000';
  // legs
  const stride = v.still ? 0.06 : 0.58;
  const leg = (s) => {
    const φ = a + s * Math.PI, al = stride * Math.sin(φ), flex = v.still ? 0 : 0.85 * Math.max(0, Math.cos(φ + 0.35));
    const H = [cx, hy], K = [H[0] + L1 * Math.sin(al), H[1] + L1 * Math.cos(al)], be = al - flex, A = [K[0] + L2 * Math.sin(be), K[1] + L2 * Math.cos(be)];
    const trousers = v.kind === 'trousers' || v.kind === 'shorts';
    limb(g, [H, K, A], trousers ? [12, 9.5, 6.5] : [9.5, 7, 4.5]);
    g.beginPath(); g.moveTo(A[0] - 3, A[1] - 2); g.lineTo(A[0] + 12, A[1] + 1); g.lineTo(A[0] + 12, A[1] + 4.5); g.lineTo(A[0] - 4, A[1] + 4.5); g.closePath(); g.fill();   // shoe
  };
  leg(0); leg(1);
  // torso / clothing
  const sh = [cx + 3 * v.lean, hy - 58], sway = v.still ? 0 : Math.sin(a) * 3;
  const torso = (pts) => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.closePath(); g.fill(); };
  if (v.kind === 'dress') {
    torso([[sh[0] - 8, sh[1]], [sh[0] + 8, sh[1] + 1], [cx + 8, hy - 20], [cx + 21 + sway, hy + 34], [cx - 21 + sway, hy + 38], [cx - 8, hy - 20]]);
  } else if (v.kind === 'coat') {
    torso([[sh[0] - 9, sh[1]], [sh[0] + 9, sh[1] + 1], [cx + 11, hy + 6], [cx + 17 + sway, hy + 52], [cx - 17 + sway, hy + 56], [cx - 11, hy + 6]]);
  } else if (v.kind === 'skirt') {
    torso([[sh[0] - 8, sh[1]], [sh[0] + 8, sh[1] + 1], [cx + 8, hy - 18], [cx + 15 + sway, hy + 16], [cx - 15 + sway, hy + 18], [cx - 8, hy - 18]]);
  } else {
    torso([[sh[0] - 9, sh[1]], [sh[0] + 9, sh[1] + 1], [cx + 8.5, hy + 8], [cx - 8.5, hy + 8]]);
  }
  // arms (swing against the legs)
  const arm = (s, len) => {
    const φ = a + (1 - s) * Math.PI, sw = (v.still ? 0.08 : 0.5) * Math.sin(φ), S = [sh[0], sh[1] + 4];
    const E = [S[0] + 27 * Math.sin(sw), S[1] + 27 * Math.cos(sw)], fw = sw + 0.35 + 0.25 * (v.still ? 0 : Math.max(0, Math.sin(φ))), W = [E[0] + len * Math.sin(fw), E[1] + len * Math.cos(fw)];
    limb(g, [S, E, W], [7, 5.5, 4]); g.beginPath(); g.arc(W[0], W[1], 3.2, 0, TAU); g.fill(); return W;
  };
  const w1 = arm(0, 24); arm(1, 24);
  if (v.bag === 'hand') { g.fillRect(w1[0] - 7, w1[1] + 2, 14, 17); g.fillRect(w1[0] - 0.8, w1[1], 1.6, 3); }
  if (v.bag === 'shoulder') { g.beginPath(); g.moveTo(sh[0] - 3, sh[1] + 2); g.lineTo(cx + 10, hy + 4); g.lineWidth = 2.4; g.strokeStyle = '#000'; g.stroke(); g.fillRect(cx + 5, hy - 4, 15, 15); }
  if (v.bag === 'pack') { g.beginPath(); g.roundRect(sh[0] - 22, sh[1] + 4, 14, 38, 5); g.fill(); }
  // neck + head + hair
  g.beginPath(); g.rect(sh[0] - 2.5, sh[1] - 12, 5.5, 14); g.fill();
  const hx = sh[0] + 2.5, hyy = sh[1] - 22;
  g.beginPath(); g.ellipse(hx, hyy, 7.6, 10, 0.1, 0, TAU); g.fill();
  if (v.hair === 'bun') { g.beginPath(); g.arc(hx - 6, hyy - 8, 5.2, 0, TAU); g.fill(); }
  else if (v.hair === 'pony') { const sw2 = v.still ? 0 : Math.sin(a * 2) * 4; limb(g, [[hx - 6, hyy - 3], [hx - 12 + sw2 * 0.4, hyy + 8], [hx - 15 + sw2, hyy + 22]], [6, 5, 1.5]); }
  else if (v.hair === 'long') { limb(g, [[hx - 6, hyy - 4], [hx - 9, hyy + 12], [hx - 7 + (v.still ? 0 : Math.sin(a) * 3), hyy + 30]], [9, 8, 5]); }
  else if (v.hair === 'cap') { g.beginPath(); g.rect(hx - 1, hyy - 8, 14, 3.4); g.fill(); }
  else if (v.hair === 'tuft') { g.beginPath(); g.moveTo(hx - 1, hyy - 9); g.lineTo(hx + 4, hyy - 17); g.lineTo(hx + 6, hyy - 8); g.closePath(); g.fill(); }
}

function drawDog(g, ph) {
  const a = ph * TAU; g.fillStyle = '#000'; g.strokeStyle = '#000';
  g.beginPath(); g.ellipse(44, 52, 24, 11, -0.05, 0, TAU); g.fill();                         // body
  g.beginPath(); g.ellipse(72, 38, 9.5, 8, 0.2, 0, TAU); g.fill();                              // head
  g.beginPath(); g.moveTo(79, 38); g.lineTo(90, 42); g.lineTo(79, 45); g.fill();                // muzzle
  g.beginPath(); g.moveTo(66, 31); g.lineTo(62, 18); g.lineTo(72, 29); g.fill();                // ear
  limb(g, [[22, 48], [12 + Math.sin(a) * 3, 36], [6 + Math.sin(a) * 5, 28]], [5, 4, 1.5]);        // tail
  for (const [x, s] of [[62, 0], [56, 1], [28, 1], [22, 0]]) { const sw = Math.sin(a + s * Math.PI) * 0.7; limb(g, [[x, 58], [x + 16 * Math.sin(sw) * 0.6, 74], [x + 24 * Math.sin(sw) * 0.7 + 1, 90]], [5.5, 4, 3.2]); }
}

function drawCyclist(g, ph) {
  const a = ph * TAU; g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineCap = 'round';
  g.translate(0, 22); g.scale(0.88, 0.88);
  const bw = [28, 158], by = 150, r = 30;
  g.lineWidth = 4.2; for (const x of bw) { g.beginPath(); g.arc(x, by, r, 0, TAU); g.stroke(); }
  const seat = [74, 98], bar = [138, 96], bb = [88, 150];
  g.lineWidth = 4.2; g.beginPath(); g.moveTo(...bw[0] === 28 ? [28, by] : [0, 0]); g.lineTo(...bb); g.lineTo(...seat); g.lineTo(seat[0] + 2, 92); g.moveTo(...bb); g.lineTo(130, 112); g.lineTo(...seat); g.moveTo(130, 112); g.lineTo(...bar); g.moveTo(130, 112); g.lineTo(158, by); g.moveTo(...bb); g.lineTo(28, by); g.stroke();
  g.fillRect(bar[0] - 6, bar[1] - 4, 14, 4.5); g.fillRect(seat[0] - 8, seat[1] - 6, 16, 5);
  const ped = (s) => { const φ = a + s * Math.PI, px = bb[0] + 16 * Math.cos(φ), py = bb[1] + 16 * Math.sin(φ); const k = [(seat[0] + px) / 2 + 8, (seat[1] + py) / 2 - 4]; limb(g, [[seat[0], seat[1] - 2], k, [px, py]], [12, 9, 6]); g.fillRect(px - 2, py - 1.5, 12, 4); };
  ped(0); ped(1);
  limb(g, [[seat[0] - 2, seat[1] - 6], [104, 70], [118, 52]], [20, 17, 14]);                      // torso leaning forward
  limb(g, [[116, 56], [130, 76], [bar[0], bar[1] - 2]], [7, 5.5, 4]);                              // arm to the bars
  g.beginPath(); g.ellipse(126, 40, 8.6, 10, 0.3, 0, TAU); g.fill();                              // head
  g.beginPath(); g.moveTo(116, 36); g.lineTo(128, 28); g.lineTo(137, 36); g.closePath(); g.fill();  // cap
}

export function createPeopleKit(seed = 41) {
  const R = rngOf(seed);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const KINDS = ['trousers', 'trousers', 'coat', 'dress', 'skirt', 'trousers', 'shorts', 'coat'];
  const variants = [];
  for (let i = 0; i < 12; i++) variants.push({ kind: KINDS[i % KINDS.length], hair: pick(['bun', 'pony', 'long', 'cap', 'tuft', 'none', 'long']), bag: pick(['none', 'none', 'hand', 'shoulder', 'pack']), lean: R() * 1.2, tall: 0.94 + R() * 0.12 });
  const atlas = (w, h, n, draw) => {
    const cv = document.createElement('canvas'); cv.width = w * n; cv.height = h;
    const g = cv.getContext('2d');
    for (let f = 0; f < n; f++) { g.save(); g.translate(f * w, 0); g.beginPath(); g.rect(0, 0, w, h); g.clip(); draw(g, f / n); g.restore(); }
    const t = new THREE.CanvasTexture(cv); t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; return { tex: t, canvas: cv };
  };
  const mk = (tex) => new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, alphaTest: 0.35, alphaToCoverage: true, side: THREE.DoubleSide });
  const kit = { walkers: variants.map((v) => { const a = atlas(FW, FH, FRAMES, (g, ph) => drawWalker(g, v, ph)); return { ...a, mat: mk(a.tex), frames: FRAMES, aspect: FW / FH }; }) };
  const dog = atlas(96, 96, 8, (g, ph) => drawDog(g, ph)); kit.dog = { ...dog, mat: mk(dog.tex), frames: 8, aspect: 1 };
  const cyc = atlas(176, 192, 8, (g, ph) => drawCyclist(g, ph)); kit.cyclist = { ...cyc, mat: mk(cyc.tex), frames: 8, aspect: 176 / 192 };
  /** upright billboard of the given world height; bottom of the quad sits on the origin */
  kit.billboard = (set, height) => {
    const w = height * set.aspect, geo = new THREE.PlaneGeometry(w, height); geo.translate(0, height / 2, 0);
    const m = new THREE.Mesh(geo, set.mat); m.userData.set = set; m.userData.h = height; m.frustumCulled = false; return m;
  };
  kit.setFrame = (m, ph) => {
    const set = m.userData.set, f = Math.floor(((ph % 1) + 1) % 1 * set.frames), uv = m.geometry.attributes.uv, u0 = f / set.frames, u1 = (f + 1) / set.frames;
    if (m.userData.f === f) return; m.userData.f = f;
    uv.setXY(0, u0, 1); uv.setXY(1, u1, 1); uv.setXY(2, u0, 0); uv.setXY(3, u1, 0); uv.needsUpdate = true;
  };
  return kit;
}
