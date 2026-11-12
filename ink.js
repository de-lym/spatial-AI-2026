// Monochrome manga / ink-illustration look for the 3D scene.
// The scene is rendered normally into an off-screen target (colour + depth); a full-screen pass then
//   1. converts to grey and quantises the tones,
//   2. turns mid-tones into a screentone (45° halftone dots), deep tones into solid ink,
//   3. draws ink outlines where depth jumps or where thin / high-contrast features sit (lines, roof edges),
//   4. leaves the background as paper.
// Screen-space labels live on layer 1 and are drawn after the pass so they stay crisp.
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor, tDepth;
uniform vec2 uRes;
uniform float uNear, uFar, uOrtho, uDpr, uCell, uEdge, uPatY, uPatScale, uPatOn;
uniform sampler2D tPattern;
uniform mat4 uInvVP;
const float DOTMIN = .26;
const vec3 PAPER = vec3(.957,.949,.937), INK = vec3(.075,.075,.08);
float luma(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
float alphaAt(vec2 uv){ return texture2D(tColor, uv).a; }
float tone(vec2 uv){ return pow(clamp(luma(texture2D(tColor, uv).rgb), 0., 1.), 1./2.2); }
float lin(vec2 uv){
  float d = texture2D(tDepth, uv).x;
  if (uOrtho > .5) return d * (uFar - uNear);
  float z = d * 2. - 1.; return 2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
// light-weight fan / scale paving (pavé): thin arcs, constant ~1px weight, fading out when zoomed far away
float scales(vec2 p, float px){
  float k = floor(p.y * 2.) + 1., odd = mod(k, 2.);
  float i = floor(p.x - .5 * odd + .5);
  vec2 c = vec2(i + .5 * odd, k * .5);
  float sd = abs(length(p - c) - .5);
  float line = 1. - smoothstep(px * .35, px * .85, sd);
  return line * smoothstep(.45, .25, px);
}
vec2 groundXZ(vec2 uv){
  vec2 ndc = uv * 2. - 1.;
  vec4 n = uInvVP * vec4(ndc, -1., 1.); n /= n.w; vec4 f = uInvVP * vec4(ndc, 1., 1.); f /= f.w;
  vec3 d = f.xyz - n.xyz; float t = -n.y / d.y; return n.xz + d.xz * t;
}
void main(){
  vec2 px = 1. / uRes;
  float d0 = texture2D(tDepth, vUv).x;
  float l0 = tone(vUv);
  // neighbours (1 css-px reach so outlines have constant weight at any pixel ratio)
  vec2 o = px * max(1., uDpr * .75);
  float lL = tone(vUv - vec2(o.x, 0.)), lR = tone(vUv + vec2(o.x, 0.)), lU = tone(vUv + vec2(0., o.y)), lD = tone(vUv - vec2(0., o.y));
  float dd = lin(vUv), dL = lin(vUv - vec2(o.x, 0.)), dR = lin(vUv + vec2(o.x, 0.)), dU = lin(vUv + vec2(0., o.y)), dD = lin(vUv - vec2(0., o.y));
  float depthEdge = max(max(abs(dd - dL), abs(dd - dR)), max(abs(dd - dU), abs(dd - dD)));
  float depthRef = uOrtho > .5 ? 0.9 : 0.02 * dd;
  float de = smoothstep(depthRef, depthRef * 2.2, depthEdge) * (d0 < .99999 ? 1. : 0.);
  float lumEdge = max(max(lL, lR), max(lU, lD)) - l0;
  // road markings write alpha .5: no outline is drawn around (or on) them — they stay plain solid white
  float flag = min(min(alphaAt(vUv), alphaAt(vUv - vec2(o.x, 0.))), min(min(alphaAt(vUv + vec2(o.x, 0.)), alphaAt(vUv + vec2(0., o.y))), alphaAt(vUv - vec2(0., o.y))));
  if (flag < .9) lumEdge = 0.;   // one-sided: only the darker pixel of an edge is inked, so lines stay hairline
  float le = smoothstep(.07, .2, lumEdge) * (d0 < .99999 ? .0 : .0) + smoothstep(.07, .2, lumEdge) * .9;
  float edge = clamp(max(de, le) * uEdge, 0., 1.);

  // tone → screentone
  float t = floor(l0 * 6. + .5) / 6.;                  // 7 flat tone steps
  t = mix(t, l0, .35);                                  // keep a little gradation so shadows stay soft
  float dark = 1. - t;
  vec2 p = gl_FragCoord.xy / uDpr;
  mat2 R = mat2(.7071, -.7071, .7071, .7071);
  vec2 q = R * p / uCell;
  float r = length(fract(q) - .5);
  float dotR = sqrt(clamp((dark - DOTMIN) / (1. - DOTMIN), 0., 1.)) * .74;
  float aa = .6 / uCell / max(1., uDpr * .5);
  float dots = 1. - smoothstep(dotR - aa, dotR + aa, r);
  dots *= step(DOTMIN, dark);                           // lit surfaces stay flat paper; only shadow / dark tones get screentone
  float solid = smoothstep(.72, .84, dark);             // deepest shadows fill solid
  float ink = max(max(dots, solid), edge);
  float sky = d0 >= .99999 ? 1. : 0.;
  vec3 col = mix(PAPER, INK, ink);
  vec2 ndc = vUv * 2. - 1.;
  vec4 n = uInvVP * vec4(ndc, -1., 1.); n /= n.w; vec4 f = uInvVP * vec4(ndc, 1., 1.); f /= f.w;
  vec3 dir = f.xyz - n.xyz;
  if (alphaAt(vUv) < .37 && sky < .5 && dir.y < -1e-4) {   // road surface (alpha .25): paving pattern instead of dots
    float t0 = -n.y / dir.y; vec2 w = n.xz + dir.xz * t0;
    vec2 g1 = groundXZ(vUv + vec2(px.x, 0.)), g2 = groundXZ(vUv + vec2(0., px.y));   // pixel footprint on the ground (no fwidth: it breaks across quads)
    vec2 wp = w * 2.0; float L = scales(wp, max(length(g1 - w), length(g2 - w)) * 2.0);
    col = min(col, vec3(.89));                                    // road = light grey; white crossings / dashes stand out from it
    col = mix(col, vec3(.55), L * step(ink, .35) * .9);
  }
  if (sky > .5) {                                       // outside the map border: hand-drawn dash pattern on the water plane
    col = PAPER;
    if (uPatOn > .5 && dir.y < -1e-4) {
      float t = (uPatY - n.y) / dir.y; vec2 w = (n.xz + dir.xz * t) / uPatScale;
      float pv = texture2D(tPattern, w).r;
      col = mix(INK, PAPER, smoothstep(.3, .95, pv));
    }
  }
  gl_FragColor = vec4(col, 1.);
}`;

export function createInkPass(renderer, { cell = 2.0, edge = 1 } = {}) {
  const target = new THREE.WebGLRenderTarget(4, 4, { samples: 4, depthTexture: new THREE.DepthTexture(4, 4), depthBuffer: true });
  target.depthTexture.type = THREE.UnsignedIntType;
  target.texture.minFilter = target.texture.magFilter = THREE.NearestFilter;
  const pattern = new THREE.TextureLoader().load('./assets/pattern.png', (t) => { mat.uniforms.uPatOn.value = 1; });
  pattern.wrapS = pattern.wrapT = THREE.RepeatWrapping; pattern.anisotropy = 8; pattern.minFilter = THREE.LinearMipmapLinearFilter;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
    uniforms: { tPattern: { value: pattern }, uPatY: { value: -1.4 }, uPatScale: { value: 40 }, uPatOn: { value: 0 }, uInvVP: { value: new THREE.Matrix4() }, tColor: { value: target.texture }, tDepth: { value: target.depthTexture }, uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 }, uFar: { value: 100 }, uOrtho: { value: 1 }, uDpr: { value: 1 }, uCell: { value: cell }, uEdge: { value: edge } },
  });
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const size = new THREE.Vector2();

  function render(scene, camera) {
    renderer.getDrawingBufferSize(size);
    if (target.width !== size.x || target.height !== size.y) { target.setSize(size.x, size.y); mat.uniforms.uRes.value.copy(size); }
    mat.uniforms.uDpr.value = renderer.getPixelRatio();
    camera.updateMatrixWorld(); mat.uniforms.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    mat.uniforms.uNear.value = camera.near; mat.uniforms.uFar.value = camera.far;
    mat.uniforms.uOrtho.value = camera.isOrthographicCamera ? 1 : 0;
    const bg = scene.background, auto = renderer.autoClear, mask = camera.layers.mask;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);                      // layer 0: the world
    renderer.setRenderTarget(null);
    renderer.autoClear = false; scene.background = null;
    renderer.clear();
    renderer.render(quadScene, quadCam);                 // ink pass to screen
    renderer.clearDepth();
    camera.layers.set(1);
    renderer.render(scene, camera);                      // layer 1: crisp labels over the top
    camera.layers.mask = mask;
    scene.background = bg; renderer.autoClear = auto;
  }
  return { render, setBackdrop({ y, scale }) { mat.uniforms.uPatY.value = y; mat.uniforms.uPatScale.value = scale; } };
}
