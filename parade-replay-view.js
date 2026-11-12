import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {createParadeVisual} from './parade-visual.js';
import {createEventVisual} from './parade-event-visual.js';
import {createInkPass} from './ink.js?v=12';

// Independent scene graph, transforms, instance buffers and camera. Static geometry/materials
// may be shared read-only; no live object or simulation state is ever updated here.
export function createReplayView({canvas,sourceScene,exclude=[],couriers,initial,focus,agentId}) {
  const excluded=new Set(exclude), copies=new Map();
  function copyNode(source,agent=false){
    if(excluded.has(source)||source.isCamera||source.isSprite||!agent&&source.userData.ref?.type==='courier')return null;
    let node;
    if(source.isInstancedMesh){node=new THREE.InstancedMesh(source.geometry,source.material,source.count);node.instanceMatrix=source.instanceMatrix.clone();if(source.instanceColor)node.instanceColor=source.instanceColor.clone();}
    else if(source.isMesh)node=new THREE.Mesh(source.geometry,source.material);
    else if(source.isLineSegments)node=new THREE.LineSegments(source.geometry,source.material);
    else if(source.isLineLoop)node=new THREE.LineLoop(source.geometry,source.material);
    else if(source.isLine)node=new THREE.Line(source.geometry,source.material);
    else if(source.isPoints)node=new THREE.Points(source.geometry,source.material);
    else if(source.isLight)node=source.clone(false);
    else node=new THREE.Group();
    copies.set(source,node);node.name=source.name;node.position.copy(source.position);node.quaternion.copy(source.quaternion);node.scale.copy(source.scale);
    node.visible=source.visible;node.renderOrder=source.renderOrder;node.frustumCulled=source.frustumCulled;
    node.userData.knowledgeGeometry=!!source.userData.knowledgeGeometry;
    for(const child of source.children){const c=copyNode(child,agent);if(c)node.add(c);}
    return node;
  }
  const scene=new THREE.Scene();scene.background=sourceScene.background?.clone()??new THREE.Color(0xf4f2ef);
  for(const child of sourceScene.children){const copy=copyNode(child);if(copy)scene.add(copy);}
  const actorCopies=couriers.map(c=>{
    // Explicitly excluded live actors are copied only into this independent actor set.
    excluded.delete(c.mesh);const mesh=copyNode(c.mesh,true);excluded.add(c.mesh);scene.add(mesh);
    return {mesh,inner:copies.get(c.inner),rotors:c.rotors.map(r=>copies.get(r)).filter(Boolean)};
  });
  const dynamic=new THREE.Group();scene.add(dynamic);
  const parade=createParadeVisual(dynamic,initial.parade),effects=createEventVisual(dynamic);
  const points=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({color:0x141414,size:.6}));dynamic.add(points);
  const buildings=[];scene.traverse(o=>{if(o.userData.knowledgeGeometry)buildings.push([o,o.visible]);});
  const camera=new THREE.OrthographicCamera(-32,32,18,-18,.1,600);
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(320,180,false);renderer.outputColorSpace=THREE.SRGBColorSpace;
  // Small previews do not need a second set of live city shadow maps.
  renderer.shadowMap.enabled=false;
  const ink=createInkPass(renderer,{cell:2});ink.setBackdrop({y:-1.4,scale:24});
  const controls=new OrbitControls(camera,canvas);controls.enableDamping=false;controls.enabled=false;
  let dirty=true, lastTime=null, lastKnowledge=null, renderedFrames=0;
  controls.addEventListener('change',()=>dirty=true);
  function lock(){controls.enabled=false;controls.target.set(focus.x,focus.y,focus.z);camera.position.set(focus.x+55,focus.y+55,focus.z+55);camera.zoom=1;camera.lookAt(controls.target);camera.updateProjectionMatrix();dirty=true;}
  lock();
  function update(snapshot,knowledge=false){
    if(snapshot.time===lastTime&&knowledge===lastKnowledge)return;
    lastTime=snapshot.time;lastKnowledge=knowledge;
    parade.update(snapshot.parade,snapshot.time);effects.update(snapshot.effects,snapshot.time);
    snapshot.agents.forEach((a,i)=>{const c=actorCopies[i];c.mesh.position.set(a.pos.x,a.pos.y+.4,a.pos.z);if(c.inner)c.inner.rotation.y=Math.atan2(a.forward.x,a.forward.z);c.rotors.forEach((r,j)=>r.rotation.y=snapshot.time*28*(j%2?1:-1));});
    for(const [node,visible]of buildings)node.visible=knowledge?false:visible;
    const a=snapshot.agents.find(a=>a.id===agentId);points.visible=knowledge&&!!a;
    points.geometry.dispose();points.geometry=new THREE.BufferGeometry().setFromPoints(Object.values(a?.knowledge??{}).map(o=>new THREE.Vector3(o.pos.x,o.pos.y+.4,o.pos.z)));
    dirty=true;
  }
  update(initial);
  return {scene,camera,controls,parade,get time(){return lastTime;},get frames(){return renderedFrames;},
    update,lock,free(){controls.enabled=true;dirty=true;},
    render(){controls.update();parade.face(camera);if(dirty){ink.render(scene,camera);dirty=false;renderedFrames++;}},
    dispose(){controls.dispose();const geometries=new Set(),materials=new Set();dynamic.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])materials.add(m);});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();renderer.dispose();renderer.forceContextLoss();}
  };
}
