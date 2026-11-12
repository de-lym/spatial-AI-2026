// Illustrative street-level detail for the city, in the spirit of a monochrome isometric street illustration:
// asphalt + zebra crossings, tiled pavements, lamp posts, signals, bollards, planters, café tables, bike racks,
// shop-front windows with mullions, slatted awnings, blade signs / banners (CJK lettering), rooftop plant,
// and a small street life of pedestrians, dogs and cyclists.
// Everything here is DECOR: nothing is registered as an obstacle, so routing / airspace / picking are unaffected.
// Static pieces are merged into one mesh per material; only the people / cyclists / dogs are animated.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const rngOf = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---------- textures (generated, no assets) ---------------------------------------------
function canvasTex(w, h, draw, { repeat, srgb = true, mip = true } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = 4; t.generateMipmaps = mip; t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  return t;
}
const gridTex = (n) => canvasTex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(70,70,72,.85)'; g.fillRect(0, 0, w, 4); g.fillRect(0, 0, 4, h); }, { repeat: [n, n] });
const awningTex = () => canvasTex(32, 64, (g, w, h) => { g.fillStyle = '#e9e8e6'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 8) { g.fillStyle = '#4a4a4c'; g.fillRect(0, y, w, 2); g.fillStyle = '#b9b8b6'; g.fillRect(0, y + 2, w, 3); } });
const speckleTex = () => canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#7d7d7e'; g.fillRect(0, 0, w, h); const r = rngOf(5); for (let i = 0; i < 2600; i++) { g.fillStyle = r() < .55 ? '#1d1d1f' : '#d8d8d6'; const s = 1 + r() * 2; g.fillRect(r() * w, r() * h, s, s); } }, { repeat: [1, 1] });
const dotTex = (bg, fg) => canvasTex(32, 32, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; for (const [x, y] of [[8, 8], [24, 8], [16, 24], [0, 24], [32, 24]]) { g.beginPath(); g.arc(x, y, 3.2, 0, TAU); g.fill(); } }, { repeat: [1, 2] });
const CJK = '"Noto Sans CJK SC","Source Han Sans SC","PingFang SC","Microsoft YaHei","WenQuanYi Zen Hei",sans-serif';
const signCache = new Map();
function signTex(text, vertical, dark) {
  const k = text + vertical + dark; if (signCache.has(k)) return signCache.get(k);
  const chars = [...text];
  const W = vertical ? 128 : 384, H = vertical ? 320 : 96;
  const t = canvasTex(W, H, (g, w, h) => {
    g.fillStyle = dark ? '#161618' : '#f7f6f3'; g.fillRect(0, 0, w, h);
    g.strokeStyle = dark ? '#f7f6f3' : '#161618'; g.lineWidth = 5; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = dark ? '#f7f6f3' : '#161618'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (vertical) { const s = Math.min(84, (h - 24) / chars.length); g.font = `700 ${s * 0.9}px ${CJK}`; chars.forEach((c, i) => g.fillText(c, w / 2, 14 + s * (i + 0.5))); }
    else { const s = Math.min(70, (w - 24) / chars.length); g.font = `700 ${s}px ${CJK}`; g.fillText(text, w / 2, h / 2 + 3); }
  }, { mip: false });
  signCache.set(k, t); return t;
}
const SIGNS_V = ['爱丰房产', '匠心日料', '居酒屋', '简餐寿司', '药局', '咖啡馆', '面馆', '茶饮', '书店', '花坊', '理发', '便利店', '鲜果铺', '烧肉'];
const SIGNS_H = ['ACME 集致', '轻奢女装买手店', '匠心日料', '简餐 寿司', '24H 便利', '老字号', 'TEA & BAKE', '花坊'];

// ---------- merged static geometry --------------------------------------------------------
class Batch {
  constructor() { this.cache = new Map(); this.m = new Map(); this.v = new THREE.Vector3(); this.nm = new THREE.Matrix3(); }
  add(geo, matrix, material) {
    let e = this.m.get(material); if (!e) this.m.set(material, e = { p: [], n: [], u: [] });
    let g = geo; if (geo.index) { g = this.cache.get(geo); if (!g) this.cache.set(geo, g = geo.toNonIndexed()); }
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    this.nm.getNormalMatrix(matrix);
    for (let i = 0; i < P.count; i++) {
      this.v.fromBufferAttribute(P, i).applyMatrix4(matrix); e.p.push(this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(N, i).applyMatrix3(this.nm).normalize(); e.n.push(this.v.x, this.v.y, this.v.z);
      e.u.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
    }
  }
  build(parent, castShadow = true) {
    for (const [material, e] of this.m) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(e.p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(e.n, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(e.u, 2));
      const mesh = new THREE.Mesh(geo, material); mesh.castShadow = castShadow; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.userData.decor = true; parent.add(mesh);
    }
  }
}

export function buildStreetscape({ scene, camera, world, buildingGroups, ROADS, parcels, takenAt, slab = 0.4 }) {
  const R = rngOf(20260);
  const root = new THREE.Group(); root.name = 'Streetscape (decor only)'; scene.add(root);
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, ...extra });
  const M = { ink: std(0x1b1b1d), dark: std(0x3b3c3f), glass: std(0x2a2c30), mid: std(0x8d8e90), light: std(0xd3d3d1), white: std(0xf8f7f4), asphalt: new THREE.MeshBasicMaterial({ color: 0xf1efec }), bush: std(0x59605a, { flatShading: true }), bush2: std(0x2f352f, { flatShading: true }), wood: std(0xc9c6bf), skin: std(0xe8e4de) };
  const awning = std(0xffffff, { map: awningTex() });
  const stone = std(0xffffff, { map: speckleTex() });
  const B = new Batch(), glassB = new Batch();
  const unitBox = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 10), cone = new THREE.ConeGeometry(1, 1, 10), ico = new THREE.IcosahedronGeometry(1, 0), sph = new THREE.SphereGeometry(1, 10, 8);
  const hoop = new THREE.TorusGeometry(1, 0.08, 5, 14), half = new THREE.TorusGeometry(1, 0.1, 5, 10, Math.PI);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const put = (batch, geo, mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => { _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); batch.add(geo, _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)), mat); };
  const bx = (mat, x, y, z, w, h, d, ry = 0, rx = 0, rz = 0, batch = B) => put(batch, unitBox, mat, x, y + h / 2, z, w, h, d, rx, ry, rz);   // y = bottom
  const cy = (mat, x, y, z, r, h, r2) => put(B, cyl, mat, x, y + h / 2, z, r, h, r);

  // building footprints (decor keeps clear of them)
  scene.updateMatrixWorld(true);
  const live = buildingGroups.filter(({ g }) => { let p = g; while (p.parent) p = p.parent; return p === scene && g.visible; });
  const footprints = [];
  const boxes = [];                       // facade targets
  for (const { g, typo } of live) {
    const fp = new THREE.Box3();
    g.traverse((o) => {
      if (!o.isMesh || !o.userData.solid) return;
      const bb = new THREE.Box3().setFromObject(o); fp.union(bb);
      const p = o.geometry.parameters;
      if (o.geometry.type === 'RoundedBoxGeometry' && p && typo !== 'platform' && typo !== 'dome' && typo !== 'tank') {
        const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y, d = bb.max.z - bb.min.z;
        if (w >= 1.6 && d >= 1.6 && h >= 1.2) boxes.push({ bb, w, h, d, typo, ground: bb.min.y < slab + 0.06 });
      }
    });
    if (!fp.isEmpty()) footprints.push(fp);
  }
  const blocked = (x, z, r = 0.5) => footprints.some((f) => x > f.min.x - r && x < f.max.x + r && z > f.min.z - r && z < f.max.z + r);
  const tileOfXY = (x, z) => world.tiles[(Math.round(x / 16) + 3) * 7 + Math.round(z / 16) + 3];

  // ---------- roads: asphalt, zebra crossings, pavement grid -----------------------------------
  // roads are simply the ground plane (same tone as the background), so there is no boundary between them
  const crossings = [];
  for (const rx of ROADS) for (const rz of ROADS) {
    // four arms; stripes run along the carriageway, spread across its 4-unit width
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cx = rx + ax * 3.3, cz = rz + az * 3.3;
      if (Math.abs(cx) > 58 || Math.abs(cz) > 58) continue;
      for (let i = -3; i <= 3; i++) {
        const off = i * 0.56;
        // arm along x (ax≠0): carriageway runs along x, stripes along x spread in z
        if (ax) { bx(M.ink, cx, 0.009, rz + off, 1.74, 0.02, 0.36); bx(M.white, cx, 0.012, rz + off, 1.7, 0.022, 0.32); }
        else { bx(M.ink, rx + off, 0.009, cz, 0.36, 0.02, 1.74); bx(M.white, rx + off, 0.012, cz, 0.32, 0.022, 1.7); }
      }
      crossings.push({ x: cx, z: cz, ax, az });
    }
  }
  // tiled pavement: one transparent grid plane on top of every parcel slab (only drawn when zoomed in)
  const gridMat = new THREE.MeshBasicMaterial({ map: gridTex(15), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const gridPlane = new THREE.PlaneGeometry(11.7, 11.7);
  const grids = new THREE.Group(); root.add(grids);
  grids.visible = false; // pavement grid removed (kept off; geometry not built)

  // ---------- street furniture -------------------------------------------------------------------
  const lamp = (x, z) => {
    cy(M.ink, x, slab, z, 0.07, 0.12); cy(M.dark, x, slab, z, 0.035, 1.9);
    put(B, cyl, M.light, x, slab + 2.1, z, 0.2, 0.34, 0.2); put(B, cone, M.dark, x, slab + 2.4, z, 0.26, 0.16, 0.26); cy(M.ink, x, slab + 1.9, z, 0.14, 0.05);
  };
  const signal = (x, z, face) => {
    cy(M.ink, x, slab, z, 0.045, 2.3);
    for (const k of [0, 1]) bx(M.ink, x + face[0] * 0.12, slab + 1.55 + k * 0.5, z + face[1] * 0.12, 0.2, 0.42, 0.2);
    for (const k of [0, 1]) bx(M.white, x + face[0] * 0.2, slab + 1.7 + k * 0.5, z + face[1] * 0.2, face[0] ? 0.03 : 0.12, 0.12, face[1] ? 0.03 : 0.12);
    bx(M.dark, x, slab + 1.0, z, 0.2, 0.3, 0.2);   // control box
  };
  const planter = (x, z, along, len = 2.0) => {
    const ry = along ? 0 : Math.PI / 2;
    const c = Math.cos(ry), s = Math.sin(ry);
    bx(M.wood, x, slab, z, along ? len : 0.7, 0.42, along ? 0.7 : len);
    if (along) for (let i = 0; i < 6; i++) { const t = -len / 2 + (i + 0.5) * len / 6; bx(M.dark, x + (along ? t : 0), slab + 0.02, z + (along ? 0 : t) + (along ? 0.36 : 0), along ? 0.03 : 0.72, 0.38, along ? 0.03 : 0.03); }
    const n = 4 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) {
      const t = -len / 2 + (i + 0.5) * len / n, jx = (R() - 0.5) * 0.2, sz = 0.28 + R() * 0.2, mat = R() < 0.5 ? M.bush : M.bush2;
      put(B, ico, mat, x + (along ? t : jx), slab + 0.5 + sz * 0.45, z + (along ? jx : t), sz * 1.1, sz * 1.15, sz * 1.1, R() * 3, R() * 3, R() * 3);
      if (R() < 0.6) put(B, ico, M.bush, x + (along ? t + 0.15 : jx), slab + 0.9 + R() * 0.15, z + (along ? jx : t + 0.15), 0.2, 0.22, 0.2, R() * 3, R() * 3, 0);
    }
  };
  const chair = (x, z, ry) => {
    bx(M.ink, x, slab + 0.2, z, 0.3, 0.04, 0.3, ry);
    const c = Math.cos(ry), s = Math.sin(ry);
    bx(M.ink, x - s * 0.14, slab + 0.2, z - c * 0.14, 0.3, 0.3, 0.03, ry);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(M.ink, x + (a * c + b * s) * 0.13, slab, z + (-a * s + b * c) * 0.13, 0.025, 0.2, 0.025);
  };
  const cafe = (x, z, ry) => {
    cy(M.dark, x, slab, z, 0.03, 0.36); put(B, cyl, M.light, x, slab + 0.37, z, 0.24, 0.03, 0.24); cy(M.ink, x, slab, z, 0.1, 0.02);
    chair(x + 0.42, z, ry + Math.PI / 2 * 3); chair(x - 0.42, z, ry + Math.PI / 2);
  };
  const bike = (x, z, ry, mat = M.ink) => {
    const c = Math.cos(ry), s = Math.sin(ry), W = (t, y) => [x + c * t, z - s * t];
    for (const t of [-0.34, 0.34]) { const [wx, wz] = W(t); put(B, hoop, mat, wx, slab + 0.22, wz, 0.21, 0.21, 0.21, 0, ry, 0); }
    const pt = (t, y) => { const [px, pz] = W(t); return [px, slab + y, pz]; };
    const link = (a, b, r = 0.012) => { const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), d = Bv.clone().sub(A), L = d.length(); const mid = A.clone().add(Bv).multiplyScalar(0.5); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); batchQ(B, cyl, mat, mid, q, r, L, r); };
    link(pt(-0.34, 0.22), pt(-0.05, 0.42)); link(pt(-0.05, 0.42), pt(0.28, 0.4)); link(pt(0.28, 0.4), pt(0.34, 0.22)); link(pt(-0.05, 0.42), pt(0.02, 0.22)); link(pt(0.02, 0.22), pt(-0.34, 0.22)); link(pt(0.28, 0.4), pt(0.3, 0.48)); link(pt(-0.08, 0.42), pt(-0.1, 0.5));
    const [hx, hz] = W(0.3); bx(mat, hx, slab + 0.47, hz, 0.03, 0.025, 0.2, ry);
  };
  function batchQ(batch, geo, mat, pos, q, sx, sy, sz) { batch.add(geo, _m.compose(pos, q, _s.set(sx, sy, sz)), mat); }
  const rack = (x, z, along) => {
    const ry = along ? 0 : Math.PI / 2;
    for (let i = -1; i <= 1; i++) put(B, half, M.dark, x + (along ? i * 0.45 : 0), slab + 0.02, z + (along ? 0 : i * 0.45), 0.24, 0.24, 0.24, 0, ry, 0);
    for (let i = -1; i <= 1; i += 1) if (R() < 0.75) bike(x + (along ? i * 0.45 : 0), z + (along ? 0 : i * 0.45), along ? Math.PI / 2 : 0);
  };
  const bollard = (x, z) => { cy(M.ink, x, slab, z, 0.07, 0.4); cy(M.white, x, slab + 0.18, z, 0.072, 0.07); };
  const coneObj = (x, z) => { bx(M.dark, x, slab, z, 0.3, 0.03, 0.3); put(B, cone, M.light, x, slab + 0.22, z, 0.12, 0.38, 0.12); cy(M.ink, x, slab + 0.14, z, 0.095, 0.05); };
  const utilBox = (x, z, ry) => { bx(M.light, x, slab, z, 0.55, 0.5, 0.4, ry); bx(M.ink, x, slab + 0.5, z, 0.6, 0.04, 0.45, ry); };

  const padded = (cx, cz) => takenAt.has(cx + ',' + cz);
  const EDGES = [{ n: [0, 1] }, { n: [0, -1] }, { n: [1, 0] }, { n: [-1, 0] }];
  const walkLines = [];                              // pavement segments walkers ping-pong along
  for (const [cx, cz] of parcels) {
    const tile = tileOfXY(cx, cz), pad = padded(cx, cz), hub = cx === 0 && cz === 0;
    const green = tile.landUse === 'park';
    for (const e of EDGES) {
      const [nx, nz] = e.n, tx = -nz, tz = nx;      // outward normal, tangent
      const at = (t, off) => [cx + nx * off + tx * t, cz + nz * off + tz * t];
      const frontPad = pad && nz === 1;
      const slots = [-3.8, -1.3, 1.3, 3.8].filter((t) => !(frontPad && Math.abs(t) < 2.0) && !hub);
      for (const t of slots) {
        const r = R(); const [px, pz] = at(t, 5.5);
        if (blocked(px, pz, 0.3) || green && r < 0.5) continue;
        const along = !!nz;                           // furniture long axis follows the edge
        if (r < 0.30) planter(px, pz, along, 2.0);
        else if (r < 0.42) { const [qx, qz] = at(t, 5.15); if (!blocked(qx, qz, 0.5)) { cafe(qx, qz, Math.atan2(nx, nz)); if (R() < 0.8) cafe(...at(t + 1.1, 5.15), Math.atan2(nx, nz)); } }
        else if (r < 0.52) rack(...at(t, 5.45), along);
        else if (r < 0.58) { bollard(...at(t - 0.5, 5.7)); bollard(...at(t + 0.5, 5.7)); }
        else if (r < 0.62) coneObj(...at(t, 5.6));
        else if (r < 0.66) utilBox(...at(t, 5.6), Math.atan2(nx, nz));
      }
      if (!hub) { const lo = frontPad ? 2.2 : -4.4, hi = 4.4; const [ax, az] = at(lo, 4.85), [bx2, bz2] = at(hi, 4.85); if (!blocked((ax + bx2) / 2, (az + bz2) / 2, 0.4)) walkLines.push({ a: [ax, az], b: [bx2, bz2] }); }
    }
  }
  // corners: lamp posts and signals at every intersection that has parcels around it
  for (const rx of ROADS) for (const rz of ROADS) {
    const corners = [[-1, -1], [1, 1], [-1, 1], [1, -1]];
    corners.forEach(([sx, sz], i) => {
      const x = rx + sx * 2.6, z = rz + sz * 2.6;               // corner of the pavement tiles
      if (!parcels.some(([px, pz]) => Math.abs(px - (rx + sx * 8)) < 1 && Math.abs(pz - (rz + sz * 8)) < 1)) return;
      if (x === 0 && z === 0) return;
      if (i < 2) signal(rx + sx * 2.5, rz + sz * 2.5, [-sx, 0]); else lamp(rx + sx * 2.5, rz + sz * 2.5);
    });
  }
  // mid-block lamps
  for (const [cx, cz] of parcels) for (const [nx, nz] of [[0, 1], [1, 0]]) { if (R() < 0.5 && !(cx === 0 && cz === 0)) { const x = cx + nx * 5.7 + nz * -2, z = cz + nz * 5.7 + nx * -2; if (!blocked(x, z, 0.3) && !(padded(cx, cz) && nz === 1)) lamp(x, z); } }

  // ---------- facades ----------------------------------------------------------------------------
  const FACES = [{ n: [0, 1] }, { n: [0, -1] }, { n: [1, 0] }, { n: [-1, 0] }];
  const signs = new THREE.Group(); root.add(signs);
  const signBoard = (x, y, z, ry, h, text, dark) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry;
    const board = new THREE.Mesh(unitBox, M.white); board.scale.set(0.07, h, 0.8); board.position.y = h / 2; board.castShadow = true; g.add(board);
    const tex = signTex(text, true, dark);
    for (const side of [1, -1]) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.76, h - 0.04), new THREE.MeshBasicMaterial({ map: tex })); pl.rotation.y = side * Math.PI / 2; pl.position.set(side * 0.037, h / 2, 0); g.add(pl); }
    signs.add(g);
    for (const yy of [0.05, h - 0.08]) { const arm = new THREE.Mesh(unitBox, M.ink); arm.scale.set(0.03, 0.03, 0.9); arm.position.set(0, yy, -0.45); g.add(arm); }
  };
  const banner = (x, y, z, ry, w, text, dark) => {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: signTex(text, false, dark) }));
    pl.position.set(x, y, z); pl.rotation.y = ry; signs.add(pl);
  };
  let blade = 0;
  for (const b of boxes) {
    const { bb, w, h, d, ground } = b, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2, y0 = bb.min.y;
    const tall = h > 4;
    for (const f of FACES) {
      const [nx, nz] = f.n, tx = nz, tz = -nx;
      const fw = nz ? w : d;
      const faceX = nx ? (nx > 0 ? bb.max.x : bb.min.x) : cx, faceZ = nz ? (nz > 0 ? bb.max.z : bb.min.z) : cz;
      const ry = Math.atan2(nx, nz);
      const P = (u, v, out) => [faceX + tx * u + nx * out, y0 + v, faceZ + tz * u + nz * out];
      const win = (u, v, ww, hh, lit) => {
        const [px, py, pz] = P(u, v, 0.03);
        bx(lit ? M.light : M.glass, px, py, pz, ww, hh, 0.05, ry, 0, 0, glassB);
        const [mx, my, mz] = P(u, v, 0.06);
        bx(M.white, mx, my, mz, 0.04, hh, 0.02, ry, 0, 0, glassB);
        bx(M.white, mx, my + hh * 0.5, mz, ww, 0.04, 0.02, ry, 0, 0, glassB);
      };
      // storefront on the ground floor
      let storeTop = 0;
      const commercial = b.typo === 'tower' || b.typo === 'block' || b.typo === 'stack';
      if (ground && commercial && fw >= 2.6) {
        const bays = Math.max(1, Math.floor((fw - 0.8) / 2.2)), bw = (fw - 0.8) / bays;
        for (let i = 0; i < bays; i++) {
          const u = -fw / 2 + 0.4 + bw * (i + 0.5);
          if (i === 0 && R() < 0.7) { win(u, 0.1, Math.min(0.8, bw - 0.3), 1.15, false); } else win(u, 0.28, bw - 0.35, 1.0, R() < 0.12);
        }
        storeTop = 1.5;
        if (fw >= 3.4 && R() < 0.85) {                               // slatted awning, tilted, with brackets
          const [px, py, pz] = P(0, 1.5, 0.55);
          const aw = new THREE.Mesh(new THREE.BoxGeometry(fw - 0.5, 0.05, 1.15), awning); aw.position.set(px, py, pz); aw.rotation.set(0, ry, 0); aw.rotateX(0.32); aw.castShadow = true; aw.userData.decor = true; root.add(aw);
          for (const u of [-fw / 2 + 0.4, fw / 2 - 0.4]) { const [qx, qy, qz] = P(u, 1.38, 0.5); bx(M.ink, qx, qy - 0.02, qz, 0.03, 0.03, 0.03, ry, 0, 0, glassB); const br = new THREE.Mesh(unitBox, M.ink); br.scale.set(0.025, 0.025, 1.0); br.position.set(qx, qy, qz); br.rotation.set(0, ry, 0); br.rotateX(0.32); root.add(br); }
          const [vx, vy, vz] = P(0, 1.2, 1.05); bx(M.dark, vx, vy, vz, fw - 0.5, 0.1, 0.03, ry, 0, 0, glassB);
        }
        if (fw >= 4 && R() < 0.35 && h > 2.4) { const [sx, sy, sz] = P(0, 1.55, 0.03); const sp = new THREE.Mesh(new THREE.PlaneGeometry(fw - 0.6, 0.5), stone); sp.position.set(sx, sy + 0.3, sz); sp.rotation.y = ry; sp.userData.decor = true; root.add(sp); }
      }
      // upper floors: window grid (rows sit between the 1.5-unit ledges)
      const cols = Math.max(1, Math.floor((fw - 0.8) / 1.25)), cw = (fw - 0.8) / cols;
      const first = ground && commercial ? 1 : 0, rows = Math.floor((h - 0.2) / 1.5);
      const style = R();
      for (let r = first; r < rows; r++) for (let i = 0; i < cols; i++) {
        const u = -fw / 2 + 0.4 + cw * (i + 0.5);
        if (style < 0.22 && tall) { if (i === 0) for (let k = 0; k < 6; k++) { const [lx, ly, lz] = P(0, r * 1.5 + 0.2 + k * 0.18, 0.04); bx(M.light, lx, ly, lz, fw - 0.5, 0.05, 0.04, ry, 0, 0, glassB); } break; } // louvre band
        win(u, r * 1.5 + 0.38, Math.min(0.85, cw - 0.3), 0.78, R() < 0.1);
      }
      // blade sign + occasional horizontal banner
      if (ground && fw >= 3 && h >= 3.4 && blade < 40 && R() < 0.45) {
        const side = R() < 0.5 ? -1 : 1, sh = Math.min(2.0, h - 2.2);
        if (sh >= 0.9) { const [qx, qy, qz] = P(side * (fw / 2 - 0.35), 2.05, 0.9); signBoard(qx, qy, qz, ry, sh, SIGNS_V[Math.floor(R() * SIGNS_V.length)], R() < 0.25); blade++; }
      }
      if (tall && fw >= 4 && R() < 0.28) { const [qx, qy, qz] = P((R() - 0.5) * (fw - 3), Math.floor(R() * Math.max(1, rows - 3)) * 1.5 + 3.4, 0.09); banner(qx, qy, qz, ry, Math.min(2.4, fw - 1), SIGNS_H[Math.floor(R() * SIGNS_H.length)], R() < 0.5); }
    }
    // rooftop plant on flat tops of larger boxes
    if (b.typo !== 'house' && b.typo !== 'restaurant' && b.typo !== 'customer' && R() < 0.8) {
      const top = bb.max.y, n = 1 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) { const ux = cx + (R() - 0.5) * (w - 1.4), uz = cz + (R() - 0.5) * (d - 1.4); bx(M.mid, ux, top, uz, 0.7, 0.35, 0.55); put(B, cyl, M.ink, ux, top + 0.36, uz, 0.2, 0.03, 0.2); }
    }
  }
  B.build(root); glassB.build(root, false);

  // ---------- street life ---------------------------------------------------------------------------
  const H = 1.75;                                                // person height in world units (1 unit ≈ 2 m)
  const geo = { leg: new THREE.CylinderGeometry(0.05, 0.04, 0.44, 6), torso: new THREE.CylinderGeometry(0.11, 0.09, 0.4, 8), arm: new THREE.CylinderGeometry(0.035, 0.03, 0.34, 5), head: new THREE.SphereGeometry(0.085, 10, 8), hair: new THREE.SphereGeometry(0.092, 10, 8, 0, TAU, 0, Math.PI * 0.62), skirt: new THREE.CylinderGeometry(0.1, 0.17, 0.26, 10), bag: new THREE.BoxGeometry(0.1, 0.13, 0.05) };
  const cloth = [M.ink, M.white, M.mid, M.dark, M.light, std(0xffffff, { map: dotTex('#f4f3f0', '#1b1b1d') }), std(0xffffff, { map: dotTex('#2b2b2d', '#f4f3f0') }), std(0xffffff, { map: awningTex() })];
  const pick = (a) => a[Math.floor(R() * a.length)];
  function makePerson() {
    const g = new THREE.Group(), top = pick(cloth), bottom = pick([M.ink, M.dark, M.mid, M.light, cloth[5]]);
    const mk = (geom, mat, x, y, z) => { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); m.castShadow = true; return m; };
    const legs = [-1, 1].map((s) => { const p = new THREE.Group(); p.position.set(s * 0.055, 0.46, 0); const m = mk(geo.leg, bottom, 0, -0.22, 0); p.add(m); g.add(p); return p; });
    const tor = mk(geo.torso, top, 0, 0.66, 0); g.add(tor);
    if (R() < 0.35) g.add(mk(geo.skirt, bottom, 0, 0.5, 0));
    const arms = [-1, 1].map((s) => { const p = new THREE.Group(); p.position.set(s * 0.14, 0.8, 0); p.add(mk(geo.arm, R() < 0.5 ? top : M.skin, 0, -0.16, 0)); g.add(p); return p; });
    g.add(mk(geo.head, M.skin, 0, 0.94, 0)); const hr = mk(geo.hair, R() < 0.3 ? M.light : M.ink, 0, 0.945, 0); hr.rotation.x = -0.15; g.add(hr);
    if (R() < 0.3) g.add(mk(geo.bag, pick([M.ink, M.white]), 0.15, 0.42, 0.02));
    g.scale.setScalar(H / 1.02); root.add(g); return { g, legs, arms };
  }
  const people = [];
  const addWalker = (a, b, y, speed) => { const p = makePerson(); const L = Math.hypot(b[0] - a[0], b[1] - a[1]); people.push({ ...p, a, b, y, L, s: R() * L, dir: R() < 0.5 ? 1 : -1, speed, ph: R() * 6 }); return people[people.length - 1]; };
  const dogGeo = { body: new THREE.BoxGeometry(0.28, 0.14, 0.12), head: new THREE.BoxGeometry(0.11, 0.1, 0.1), leg: new THREE.CylinderGeometry(0.018, 0.015, 0.14, 4), tail: new THREE.CylinderGeometry(0.01, 0.012, 0.14, 4) };
  const dogs = [];
  const makeDog = () => { const g = new THREE.Group(); const mk = (geom, mat, x, y, z) => { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; }; const mat = pick([M.light, M.white, M.mid]);
    mk(dogGeo.body, mat, 0, 0.2, 0); mk(dogGeo.head, mat, 0.2, 0.28, 0); mk(dogGeo.tail, M.ink, -0.17, 0.27, 0).rotation.z = 0.8; const legs = [[0.1, 0.06], [0.1, -0.06], [-0.1, 0.06], [-0.1, -0.06]].map(([x, z]) => mk(dogGeo.leg, M.ink, x, 0.07, z)); g.scale.setScalar(1.25); root.add(g); return { g, legs }; };

  const rr = (n, k) => Array.from({ length: n }, () => walkLines[Math.floor(R() * walkLines.length)]).filter(Boolean).slice(0, k);
  if (walkLines.length) {
    for (const l of rr(46, 40)) { const wk = addWalker(l.a, l.b, slab, 0.45 + R() * 0.35); if (R() < 0.12) { const d = makeDog(); wk.dog = d; } }
    // pedestrians crossing at zebra crossings
    for (const c of crossings.filter(() => R() < 0.07)) {
      const hx = c.ax ? 0 : 1, hz = c.ax ? 1 : 0;         // crossing direction (across the carriageway)
      const a = [c.x + (c.ax ? 0 : -2.7), c.z + (c.ax ? -2.7 : 0)], b = [c.x + (c.ax ? 0 : 2.7), c.z + (c.ax ? 2.7 : 0)];
      addWalker(a, b, 0, 0.7 + R() * 0.2).cross = true;
    }
  }
  // cyclists on the carriageways (their lane, then wrap round)
  const cyclists = [];
  const makeCyclist = () => {
    const g = new THREE.Group(), mk = (geom, mat, x, y, z) => { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    const wheelGeo = new THREE.TorusGeometry(0.2, 0.014, 5, 16);
    const w1 = mk(wheelGeo, M.ink, -0.34, 0.22, 0), w2 = mk(wheelGeo, M.ink, 0.34, 0.22, 0); w1.rotation.y = w2.rotation.y = Math.PI / 2; w1.rotation.y = 0; w2.rotation.y = 0;
    for (const [a, b, c2, d2] of [[-0.34, 0.22, -0.05, 0.42], [-0.05, 0.42, 0.28, 0.4], [0.28, 0.4, 0.34, 0.22], [-0.05, 0.42, 0.02, 0.22], [0.02, 0.22, -0.34, 0.22]]) { const L = Math.hypot(c2 - a, d2 - b), m = mk(cyl, M.ink, (a + c2) / 2, (b + d2) / 2, 0); m.scale.set(0.012, L, 0.012); m.rotation.z = Math.atan2(c2 - a, d2 - b) * -1; }
    const rider = makePerson(); root.remove(rider.g); rider.g.position.set(-0.04, 0.2, 0); rider.g.scale.multiplyScalar(0.95); g.add(rider.g);
    rider.legs.forEach((l, i) => { l.rotation.z = 0; l.rotation.x = 0; l.position.z = (i ? 1 : -1) * 0.055; });
    rider.g.rotation.y = Math.PI / 2; // face along +x (bike local)
    g.scale.setScalar(1); root.add(g); return { g, w1, w2 };
  };
  for (let i = 0; i < 5; i++) { const r = ROADS[Math.floor(R() * ROADS.length)], vert = R() < 0.5, lane = R() < 0.5 ? 1 : -1; const c = makeCyclist(); cyclists.push({ ...c, r, vert, lane, s: R() * 116 - 58, speed: 1.4 + R() * 0.8 }); }

  const loc = (o, t) => [o.a[0] + (o.b[0] - o.a[0]) * t, o.a[1] + (o.b[1] - o.a[1]) * t];
  let clock = 0;
  function update(dt) {
    clock += dt;
    for (const p of people) {
      p.s += p.dir * p.speed * dt; if (p.s > p.L) { p.s = p.L; p.dir = -1; } else if (p.s < 0) { p.s = 0; p.dir = 1; }
      const t = p.s / p.L, [x, z] = loc(p, t); p.ph += p.speed * dt * 7;
      const dx = (p.b[0] - p.a[0]) * p.dir, dz = (p.b[1] - p.a[1]) * p.dir;
      p.g.position.set(x, p.cross ? (Math.abs(t - 0.5) > 0.37 ? slab : 0) : p.y, z); p.g.rotation.y = Math.atan2(dx, dz);
      const sw = Math.sin(p.ph) * 0.55; p.legs[0].rotation.x = sw; p.legs[1].rotation.x = -sw; p.arms[0].rotation.x = -sw * 0.8; p.arms[1].rotation.x = sw * 0.8;
      if (p.dog) { const d = p.dog, bx0 = x - Math.sin(p.g.rotation.y) * 0.7 + Math.cos(p.g.rotation.y) * 0.22, bz0 = z - Math.cos(p.g.rotation.y) * 0.7 - Math.sin(p.g.rotation.y) * 0.22; d.g.position.set(bx0, p.y, bz0); d.g.rotation.y = p.g.rotation.y - Math.PI / 2; d.legs.forEach((l, i) => { l.rotation.z = Math.sin(p.ph * 1.4 + (i % 2) * Math.PI) * 0.6; }); }
    }
    for (const c of cyclists) {
      c.s += c.speed * dt * c.lane; if (c.s > 60) c.s = -60; if (c.s < -60) c.s = 60;
      const off = c.r + c.lane * 0.95;
      if (c.vert) { c.g.position.set(off, 0, c.s); c.g.rotation.y = c.lane > 0 ? -Math.PI / 2 : Math.PI / 2; } else { c.g.position.set(c.s, 0, off); c.g.rotation.y = c.lane > 0 ? 0 : Math.PI; }
      c.w1.rotation.z = c.w2.rotation.z = -clock * 6;
    }
  }
  return { update, root, stats: () => ({ people: people.length, cyclists: cyclists.length, crossings: crossings.length, facades: boxes.length, walkLines: walkLines.length }) };
}
