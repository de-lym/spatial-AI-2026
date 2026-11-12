// Live follow-camera for the drone inspector: a second renderer draws the same scene from a chase camera
// that trails the selected drone, so the inspector shows the drone actually moving instead of a static picture.
import * as THREE from 'three';
import { createInkPass } from './ink.js?v=3';

export function installDroneView({ scene, canvas, getDrone, hiddenWhileRendering = [] }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  const ink = createInkPass(renderer, { cell: 3 });
  const cam = new THREE.PerspectiveCamera(48, 1, 0.3, 500);
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), want = new THREE.Vector3(), wantLook = new THREE.Vector3();
  let lastId = null, t = 0, w = 0, h = 0;

  function size() {
    const nw = Math.max(1, canvas.clientWidth), nh = Math.max(1, canvas.clientHeight);
    if (nw !== w || nh !== h) { w = nw; h = nh; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
  }
  new ResizeObserver(size).observe(canvas);

  function render(dt) {
    const c = getDrone();
    if (!c || !canvas.offsetParent) { lastId = null; return; }   // nothing selected or inspector hidden: no extra draw
    size();
    t += dt;
    const p = c.mesh.position;
    const hx = Math.sin(c.rot), hz = Math.cos(c.rot);              // heading the nose points to
    const swing = Math.sin(t * 0.35) * 0.55;                       // slow sway so the view feels alive and shows depth
    const ang = Math.atan2(-hx, -hz) + swing;                      // camera sits behind the drone
    const dist = 6.5;
    want.set(p.x + Math.sin(ang) * dist, p.y + 2.6 + Math.sin(t * 0.7) * 0.3, p.z + Math.cos(ang) * dist);
    wantLook.set(p.x, p.y + 0.9, p.z);
    if (lastId !== c.id) { pos.copy(want); look.copy(wantLook); lastId = c.id; }
    const k = Math.min(1, dt * 4);
    pos.lerp(want, k); look.lerp(wantLook, Math.min(1, dt * 8));
    cam.position.copy(pos); cam.lookAt(look);
    const saved = hiddenWhileRendering.map((o) => o.visible);        // screen-space labels / rings are sized for the main view
    hiddenWhileRendering.forEach((o) => { o.visible = false; });
    const lb = c.label.visible; c.label.visible = false;
    ink.render(scene, cam);
    c.label.visible = lb;
    hiddenWhileRendering.forEach((o, i) => { o.visible = saved[i]; });
  }
  return { render };
}
