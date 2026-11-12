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

// ---- silhouette → solid: trace the opaque pixels into outline loops and extrude them (so figures have real volume) ----
function traceLoops(mask, w, h) {
  const out = new Map(), add = (x0, y0, x1, y1) => { const k = x0 * 4096 + y0; (out.get(k) || out.set(k, []).get(k)).push([x1, y1]); };
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) {
    if (!on(x, y - 1)) add(x, y, x + 1, y);
    if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!on(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops = [];
  for (const [k0, list] of out) {
    while (list.length) {
      const sx = Math.floor(k0 / 4096), sy = k0 % 4096; let cx = sx, cy = sy; const pts = [[sx, sy]];
      for (let guard = 0; guard < 200000; guard++) {
        const key = cx * 4096 + cy, l = out.get(key); if (!l || !l.length) break;
        const nxt = l.pop(); cx = nxt[0]; cy = nxt[1];
        if (cx === sx && cy === sy) break; pts.push([cx, cy]);
      }
      if (pts.length > 3) loops.push(pts);
    }
  }
  return loops;
}
function simplify(pts, eps) {   // Douglas–Peucker on a closed loop
  const n = pts.length; if (n < 8) return pts;
  let far = 0, fd = 0; for (let i = 1; i < n; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  const arr = pts.concat([pts[0]]), keep = new Set([0, far, n]);
  const rec = (a, b) => {
    let md = 0, mi = -1; const [x0, y0] = arr[a], [x1, y1] = arr[b], dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * (arr[i][0] - x0) - dx * (arr[i][1] - y0)) / L; if (d > md) { md = d; mi = i; } }
    if (mi > 0 && md > eps) { keep.add(mi); rec(a, mi); rec(mi, b); }
  };
  rec(0, far); rec(far, n);
  return [...keep].filter((i) => i < n).sort((a, b) => a - b).map((i) => arr[i]);
}
const area = (l) => { let s = 0; for (let i = 0; i < l.length; i++) { const [x0, y0] = l[i], [x1, y1] = l[(i + 1) % l.length]; s += x0 * y1 - x1 * y0; } return s / 2; };
const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };

/** canvas frame → THREE.ExtrudeGeometry of unit height (figure height = 1), centred on its thickness */
function solidFromFrame(canvas, fx, fw, fh, scale, depth) {
  const w = Math.round(fw * scale), h = Math.round(fh * scale), c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(canvas, fx, 0, fw, fh, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3] > 100 ? 1 : 0;
  const loops = traceLoops(mask, w, h).map((l) => simplify(l, 0.55)).filter((l) => l.length >= 3);
  if (!loops.length) return null;
  const areas = loops.map(area), big = areas.reduce((m, a) => (Math.abs(a) > Math.abs(m) ? a : m), 0);
  const outers = [], holes = [];
  loops.forEach((l, i) => (Math.sign(areas[i]) === Math.sign(big) ? outers : holes).push(l));
  const tx = (pt) => new THREE.Vector2((pt[0] - w / 2) / h, (h - pt[1]) / h);
  const shapes = outers.map((o) => new THREE.Shape(o.map(tx)));
  for (const hl of holes) { const k = outers.findIndex((o) => inside(hl[0], o)); (shapes[k >= 0 ? k : 0])?.holes.push(new THREE.Path(hl.map(tx))); }
  const geos = shapes.map((s) => new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 }));
  geos.forEach((gm) => gm.translate(0, 0, -depth / 2));
  if (geos.length === 1) return geos[0];
  const merged = new THREE.BufferGeometry(), pos = [], nor = [];
  for (const gm of geos) { const ng = gm.index ? gm.toNonIndexed() : gm; pos.push(...ng.attributes.position.array); nor.push(...ng.attributes.normal.array); }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); return merged;
}

export function createPeopleKit(seed = 41) {
  const R = rngOf(seed);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const KINDS = ['trousers', 'trousers', 'coat', 'dress', 'skirt', 'trousers', 'shorts', 'coat'];
  const variants = [];
  for (let i = 0; i < 12; i++) variants.push({ kind: KINDS[i % KINDS.length], hair: pick(['bun', 'pony', 'long', 'cap', 'tuft', 'none', 'long']), bag: pick(['none', 'none', 'hand', 'shoulder', 'pack']), lean: R() * 1.2, tall: 0.94 + R() * 0.12 });
  const build = (fw, fh, n, scale, depth, draw) => {
    const cv = document.createElement('canvas'); cv.width = fw * n; cv.height = fh; const g = cv.getContext('2d');
    for (let f = 0; f < n; f++) { g.save(); g.translate(f * fw, 0); g.beginPath(); g.rect(0, 0, fw, fh); g.clip(); draw(g, f / n); g.restore(); }
    const geos = []; for (let f = 0; f < n; f++) geos.push(solidFromFrame(cv, f * fw, fw, fh, scale, depth) || geos[f - 1]);
    const tex = new THREE.CanvasTexture(cv); tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    const flatMat = new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, alphaTest: 0.35, alphaToCoverage: true, side: THREE.DoubleSide });
    return { geos, frames: n, aspect: fw / fh, flatMat };
  };
  const solidMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 1, metalness: 0 });
  const kit = {};
  kit.walkers = variants.map((v) => build(FW, FH, FRAMES, 0.5, 0.2, (g, ph) => drawWalker(g, v, ph)));
  kit.dog = build(96, 96, 8, 0.6, 0.2, (g, ph) => drawDog(g, ph));
  kit.cyclist = build(176, 192, 8, 0.5, 0.1, (g, ph) => drawCyclist(g, ph));
  /** A figure = flat camera-facing cut-out (normal view) + extruded solid (shown only from a bird's-eye camera). */
  kit.figure = (set, height) => {
    const grp = new THREE.Group(), w = height * set.aspect, geo = new THREE.PlaneGeometry(w, height); geo.translate(0, height / 2, 0);
    const flat = new THREE.Mesh(geo, set.flatMat); flat.frustumCulled = false;
    const solid = new THREE.Mesh(set.geos[0], solidMat); solid.scale.setScalar(height); solid.castShadow = true; solid.receiveShadow = true; solid.frustumCulled = false; solid.visible = false;
    grp.add(flat, solid); grp.userData = { set, flat, solid, f: -1, plan: false };
    return grp;
  };
  /** plan = bird's-eye camera. facing = camera yaw; rightX/rightZ = camera right vector; (dx,dz) = walking direction */
  kit.orient = (grp, dx, dz, facing, rightX, rightZ, plan) => {
    const u = grp.userData;
    if (u.plan !== plan) { u.plan = plan; u.flat.visible = !plan; u.solid.visible = plan; u.f = -1; }
    if (plan) u.solid.rotation.y = Math.atan2(-dz, dx);
    else { u.flat.rotation.y = facing; u.flat.scale.x = (dx * rightX + dz * rightZ) >= 0 ? 1 : -1; }
  };
  kit.setFrame = (grp, ph) => {
    const u = grp.userData, set = u.set, f = Math.floor(((ph % 1) + 1) % 1 * set.frames); if (u.f === f) return; u.f = f;
    if (u.plan) u.solid.geometry = set.geos[f];
    else { const uv = u.flat.geometry.attributes.uv, u0 = f / set.frames, u1 = (f + 1) / set.frames; uv.setXY(0, u0, 1); uv.setXY(1, u1, 1); uv.setXY(2, u0, 0); uv.setXY(3, u1, 0); uv.needsUpdate = true; }
  };
  return kit;
}
