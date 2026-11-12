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

// ---- angular "scale figure" drawing: slender tapered limbs, faceted clothing, small leaf-shaped head, tiny foot flags ----
function seg(g, a, b, wa, wb) {            // flat-ended tapered limb segment
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  g.beginPath(); g.moveTo(a[0] + nx * wa / 2, a[1] + ny * wa / 2); g.lineTo(b[0] + nx * wb / 2, b[1] + ny * wb / 2); g.lineTo(b[0] - nx * wb / 2, b[1] - ny * wb / 2); g.lineTo(a[0] - nx * wa / 2, a[1] - ny * wa / 2); g.closePath(); g.fill();
}
function chain(g, pts, ws) { for (let i = 0; i < pts.length - 1; i++) seg(g, pts[i], pts[i + 1], ws[i], ws[i + 1]); for (let i = 1; i < pts.length - 1; i++) { g.beginPath(); g.arc(pts[i][0], pts[i][1], ws[i] * 0.42, 0, TAU); g.fill(); } }
function poly(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) g.lineTo(q[0], q[1]); g.closePath(); g.fill(); }
function head(g, x, y, tilt = 0.12) { g.beginPath(); g.ellipse(x, y, 5.4, 8.8, tilt, 0, TAU); g.fill(); poly(g, [[x + 3, y - 1], [x + 8.5, y + 2.5], [x + 3.5, y + 4.5]]); }   // profile: small nose wedge

/** one figure frame, facing right. v: {kind, hair, hat, bag, arm, lean, tall, still}; ph: 0..1 stride phase */
function drawWalker(g, v, ph) {
  const cx = 44, ground = 186, H = 176 * v.tall, leg = 0.5 * H, hy0 = ground - leg;
  const a = ph * TAU, still = !!v.still, bob = still ? 0 : Math.abs(Math.sin(a)) * 2, hy = hy0 - bob;
  g.fillStyle = '#000'; g.strokeStyle = '#000';
  // legs: thin, slightly tapered, feet as small flags
  const stride = v.stride ?? (still ? 0.05 : 0.6), longCoat = ['coat', 'dress', 'marcher'].includes(v.kind);
  for (const s of [0, 1]) {
    const φ = a + s * Math.PI, al = stride * Math.sin(φ), flex = still ? 0 : 0.8 * Math.max(0, Math.cos(φ + 0.35)), l1 = leg * 0.52, l2 = leg * 0.48;
    const hip = [cx + (s ? 1.5 : -1.5), hy], K = [hip[0] + l1 * Math.sin(al), hip[1] + l1 * Math.cos(al)], be = al - flex, A = [K[0] + l2 * Math.sin(be), K[1] + l2 * Math.cos(be)];
    chain(g, [hip, K, A], [v.kind === 'shorts' || v.kind === 'trousers' || v.kind === 'marcher' ? 9 : 7, 6.5, 4]);
    poly(g, [[A[0] - 2, A[1] - 1], [A[0] + 11, A[1] + 1], [A[0] + 11, A[1] + 3.5], [A[0] - 3, A[1] + 3.5]]);
  }
  // torso + clothing (angular silhouettes)
  const sh = [cx + 3 * v.lean, hy - 0.31 * H], sway = still ? 0 : Math.sin(a) * 3;
  if (v.kind === 'dress') poly(g, [[sh[0] - 7, sh[1]], [sh[0] + 7, sh[1] + 1], [cx + 5, hy - 22], [cx + 19 + sway, hy + 40], [cx - 3 + sway, hy + 46], [cx - 19 + sway, hy + 38], [cx - 5, hy - 22]]);
  else if (v.kind === 'coat') poly(g, [[sh[0] - 8, sh[1]], [sh[0] + 8, sh[1] + 1], [cx + 9, hy], [cx + 15 + sway, hy + 50], [cx - 15 + sway, hy + 53], [cx - 9, hy]]);
  else if (v.kind === 'marcher') {                                // long double-breasted uniform coat, flared hem
    poly(g, [[sh[0] - 9, sh[1]], [sh[0] + 9, sh[1] + 1], [cx + 8, hy - 4], [cx + 14 + sway, hy + 40], [cx - 14 + sway, hy + 42], [cx - 8, hy - 4]]);
    poly(g, [[sh[0] + 7, sh[1] - 2], [sh[0] + 13, sh[1] + 1], [sh[0] + 8, sh[1] + 4]]); poly(g, [[sh[0] - 7, sh[1] - 2], [sh[0] - 13, sh[1] + 1], [sh[0] - 8, sh[1] + 4]]);   // epaulettes
    g.save(); g.globalCompositeOperation = 'destination-out'; g.fillRect(cx - 12 + sway * 0.3, hy - 3, 24, 1.8); g.restore();   // belt gap
  } else if (v.kind === 'handler') poly(g, [[sh[0] - 8, sh[1]], [sh[0] + 8, sh[1] + 1], [cx + 8, hy + 6], [cx + 10, hy + 20], [cx - 10, hy + 20], [cx - 8, hy + 6]]);
  else if (v.kind === 'skirt') poly(g, [[sh[0] - 7, sh[1]], [sh[0] + 7, sh[1] + 1], [cx + 6, hy - 14], [cx + 14 + sway, hy + 18], [cx - 14 + sway, hy + 20], [cx - 6, hy - 14]]);
  else poly(g, [[sh[0] - 8, sh[1]], [sh[0] + 8, sh[1] + 1], [cx + 6.5, hy + 4], [cx - 6.5, hy + 4]]);
  // arms
  const arm = (s) => {
    const S = [sh[0] + (s ? 2 : -2), sh[1] + 4], φ = a + (1 - s) * Math.PI, sw = (still ? 0.08 : 0.55) * Math.sin(φ);
    let E, W;
    if (v.arm === 'wave' && s === 1) { const w = 0.35 * Math.sin(ph * TAU * 2); E = [S[0] + 13, S[1] - 20]; W = [E[0] + 9 * Math.sin(w), E[1] - 21]; }
    else if (v.arm === 'phone' && s === 1) { E = [S[0] + 14, S[1] + 18]; W = [E[0] - 2, E[1] - 24]; }
    else if (v.arm === 'rope') { E = [S[0] + 15, S[1] - 8]; W = [E[0] + 17, E[1] - 12]; }
    else if (v.arm === 'baton' && s === 1) { E = [S[0] + 9, S[1] + 19]; W = [E[0] + 15, E[1] - 1]; }
    else { E = [S[0] + 26 * Math.sin(sw), S[1] + 26 * Math.cos(sw)]; const fw = sw + 0.3 + 0.3 * (still ? 0 : Math.max(0, Math.sin(φ))); W = [E[0] + 24 * Math.sin(fw), E[1] + 24 * Math.cos(fw)]; }
    chain(g, [S, E, W], [6.5, 5, 3.5]); g.beginPath(); g.arc(W[0], W[1], 2.6, 0, TAU); g.fill();
    return W;
  };
  const w0 = arm(0), w1 = arm(1);
  if (v.arm === 'rope') { g.lineWidth = 1.6; g.beginPath(); g.moveTo(w1[0], w1[1]); g.lineTo(w1[0] + 22, w1[1] - 30); g.stroke(); }
  if (v.arm === 'baton') { g.lineWidth = 2.4; g.beginPath(); g.moveTo(w1[0] - 3, w1[1] + 10); g.lineTo(w1[0] + 3, w1[1] - 22); g.stroke(); }
  if (v.arm === 'flag') { g.lineWidth = 2; g.beginPath(); g.moveTo(w1[0], w1[1] + 22); g.lineTo(w1[0] + 2, w1[1] - 52); g.stroke(); poly(g, [[w1[0] + 2, w1[1] - 52], [w1[0] + 28, w1[1] - 44], [w1[0] + 2, w1[1] - 34]]); }
  if (v.bag === 'hand') { g.fillRect(w0[0] - 6, w0[1] + 3, 12, 15); g.fillRect(w0[0] - 0.8, w0[1], 1.6, 4); }
  if (v.bag === 'shoulder') { g.lineWidth = 2; g.beginPath(); g.moveTo(sh[0] - 4, sh[1] + 2); g.lineTo(cx + 9, hy + 6); g.stroke(); poly(g, [[cx + 4, hy - 2], [cx + 18, hy - 2], [cx + 18, hy + 13], [cx + 4, hy + 13]]); }
  if (v.bag === 'pack') poly(g, [[sh[0] - 19, sh[1] + 2], [sh[0] - 8, sh[1] + 1], [sh[0] - 8, sh[1] + 36], [sh[0] - 17, sh[1] + 34]]);
  // neck, head, hair / hats
  poly(g, [[sh[0] - 2, sh[1] - 12], [sh[0] + 3, sh[1] - 12], [sh[0] + 4, sh[1] + 2], [sh[0] - 3, sh[1] + 2]]);
  const hx = sh[0] + 2.5, hyy = sh[1] - 22; head(g, hx, hyy);
  if (v.hair === 'bun') { g.beginPath(); g.arc(hx - 6, hyy - 8, 4.6, 0, TAU); g.fill(); }
  else if (v.hair === 'pony') { const s2 = still ? 0 : Math.sin(a * 2) * 4; chain(g, [[hx - 5, hyy - 3], [hx - 11 + s2 * 0.4, hyy + 8], [hx - 14 + s2, hyy + 24]], [5, 4, 1]); }
  else if (v.hair === 'long') chain(g, [[hx - 5, hyy - 4], [hx - 8, hyy + 14], [hx - 6 + (still ? 0 : Math.sin(a) * 3), hyy + 32]], [8, 7, 3]);
  else if (v.hair === 'tuft') poly(g, [[hx - 2, hyy - 8], [hx + 3, hyy - 18], [hx + 6, hyy - 7]]);
  if (v.hat === 'shako') { poly(g, [[hx - 6, hyy - 7], [hx + 6, hyy - 7], [hx + 5, hyy - 29], [hx - 5, hyy - 29]]); g.fillRect(hx - 7, hyy - 8, 14, 2.4); g.lineWidth = 1.6; g.beginPath(); g.moveTo(hx, hyy - 29); g.lineTo(hx + 3, hyy - 40); g.stroke(); }
  else if (v.hat === 'cap') { poly(g, [[hx - 6, hyy - 6], [hx + 6, hyy - 8], [hx + 5, hyy - 14], [hx - 5, hyy - 14]]); poly(g, [[hx + 3, hyy - 8], [hx + 13, hyy - 6], [hx + 3, hyy - 5]]); }
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

/** flat silhouette atlases for the parade crowd (spectators, marchers, handlers): one canvas texture per variant */
let crowdKit = null;
export function createCrowdKit() {
  if (crowdKit) return crowdKit;
  const R = rngOf(77), pick = a => a[Math.floor(R() * a.length)];
  const atlas = (n, v, fw = FW, fh = FH) => {
    const cv = document.createElement('canvas'); cv.width = fw * n; cv.height = fh; const g = cv.getContext('2d');
    for (let f = 0; f < n; f++) { g.save(); g.translate(f * fw, 0); g.beginPath(); g.rect(0, 0, fw, fh); g.clip(); g.translate(fw / 2, 0); g.scale(1.32, 1); g.translate(-fw / 2, 0); drawWalker(g, v, n > 1 ? f / n : 0.3); g.restore(); }   // 1.32× wider = sturdier body, same height
    const t = new THREE.CanvasTexture(cv); t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter; return {tex: t, frames: n, aspect: fw / fh, geo: solidFromFrame(cv, 0, fw, fh, 0.5, 0.2)};
  };
  // spectators STAND (feet planted) and wave, sway or dance in place; marchers and balloon handlers WALK.
  const S = (o) => ({kind: 'trousers', hair: 'none', bag: 'none', arm: 'swing', lean: R() * 0.8, tall: 0.95 + R() * 0.1, still: false, ...o});
  const stand = (o) => S({still: true, ...o}), dance = (o) => S({still: false, stride: 0.13, ...o});
  const spectators = [
    stand({kind: 'coat', hair: 'long', arm: 'wave'}), stand({kind: 'dress', hair: 'bun', arm: 'wave'}), dance({kind: 'trousers', hair: 'tuft'}), stand({kind: 'skirt', hair: 'pony', arm: 'wave'}),
    stand({kind: 'coat', bag: 'shoulder'}), stand({kind: 'trousers', hat: 'cap', arm: 'wave'}), dance({kind: 'dress', hair: 'long'}), stand({kind: 'shorts', hair: 'pony', bag: 'pack', arm: 'wave'}),
    stand({kind: 'trousers', hair: 'bun', bag: 'hand'}), dance({kind: 'coat', hat: 'cap'}),
  ].map(v => atlas(6, v));
  const marchers = [{hat: 'shako'}, {hat: 'shako', bag: 'none'}].map(o => atlas(8, S({kind: 'marcher', tall: 1.02, lean: 0.2, ...o})));
  const handlers = [{hat: 'cap'}, {hair: 'bun'}].map(o => atlas(8, S({kind: 'handler', lean: 0.6, ...o})));
  crowdKit = {spectators, marchers, handlers, pick};
  return crowdKit;
}
