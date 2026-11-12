import * as THREE from 'three';
import {PARADE_ROUTE,PARADE} from './parade-environment.js';
import {createCrowdKit} from './people.js?v=10';

// Shared soft geometry and materials: lightweight crowd, editable 3D character.
export function createParadeVisual(parent,initial,{avoid=[]}={}){
  const root=new THREE.Group();root.name='Patterned street parade';parent.add(root);
  const material=color=>new THREE.MeshStandardMaterial({color,roughness:.88});
  // monochrome: the balloon is white paper with grey / black details; people are dark cut-out silhouettes
  const cream=material(0xf6f4f0),blue=material(0xd9d7d3),pink=material(0xb4b2ae),ink=material(0x1b1b1d),gold=material(0x8f8d89);
  const sphere=new THREE.SphereGeometry(1,16,12);
  function ellipsoid(g,mat,x,y,z,sx,sy,sz){const m=new THREE.Mesh(sphere,mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);g.add(m);return m;}
  const balloon=new THREE.Group();balloon.name='Mochi · long-eared parade balloon';root.add(balloon);
  ellipsoid(balloon,blue,0,-.95,0,1.65,1.8,1.25);
  ellipsoid(balloon,cream,0,-.9,1.03,1.02,1.25,.36);
  ellipsoid(balloon,cream,0,1,0,1.8,1.45,1.42);
  for(const side of [-1,1]){
    const ear=ellipsoid(balloon,cream,side*.98,2.85,0,.52,1.32,.48);ear.rotation.z=-side*.14;
    const inner=ellipsoid(balloon,pink,side*.98,2.97,.43,.25,.9,.08);inner.rotation.z=-side*.14;
    ellipsoid(balloon,cream,side*2,-.6,.12,.78,.55,.65);
    ellipsoid(balloon,cream,side*.95,-2.55,.4,.76,.5,.82);
    ellipsoid(balloon,ink,side*.6,1.22,1.29,.14,.2,.12);
    ellipsoid(balloon,pink,side*1.05,.65,1.15,.26,.15,.12);
  }
  ellipsoid(balloon,pink,0,.84,1.44,.19,.13,.13);
  ellipsoid(balloon,ink,0,.52,1.38,.26,.065,.07);
  // Soft scarf makes the character readable from the rear as well.
  const scarf=new THREE.Mesh(new THREE.TorusGeometry(1.23,.19,8,24),gold);scarf.rotation.x=Math.PI/2;scarf.position.y=-.05;balloon.add(scarf);
  ellipsoid(balloon,gold,1.2,-.65,.9,.25,.85,.12);
  const route=new THREE.Line(new THREE.BufferGeometry().setFromPoints(PARADE_ROUTE.map(p=>new THREE.Vector3(p.x,.055,p.z))),new THREE.LineDashedMaterial({color:0x3a3a3c,dashSize:.65,gapSize:.65,transparent:true,opacity:.7}));route.computeLineDistances();root.add(route);
  // The crowd is drawn as flat silhouette figures (scale-figure style) batched per variant; they turn to the camera and mirror toward their facing direction.
  const kit=createCrowdKit(),H=1.1,Y0=.4;
  const people=[...initial.spectators.map((p,i)=>({p,role:'spectator',v:i%kit.spectators.length})),...initial.marchers.map((p,i)=>({p,role:'marcher',v:i%kit.marchers.length})),...initial.handlers.map((p,i)=>({p,role:'handler',v:i%kit.handlers.length}))];
  const groups=new Map();
  for(const item of people){
    const set=item.role==='spectator'?kit.spectators[item.v]:item.role==='marcher'?kit.marchers[item.v]:kit.handlers[item.v],key=item.role+item.v;
    if(!groups.has(key))groups.set(key,{set,items:[],role:item.role});groups.get(key).items.push(item);
  }
  const quad=new THREE.PlaneGeometry(1,1);quad.translate(0,.5,0);
  for(const gr of groups.values()){
    const n=gr.items.length,geo=new THREE.InstancedBufferGeometry();geo.index=quad.index;geo.attributes.position=quad.attributes.position;geo.attributes.uv=quad.attributes.uv;geo.attributes.normal=quad.attributes.normal;
    gr.frame=new THREE.InstancedBufferAttribute(new Float32Array(n),1);geo.setAttribute('frame',gr.frame);
    const mat=new THREE.ShaderMaterial({side:THREE.DoubleSide,uniforms:{map:{value:gr.set.tex},uFrames:{value:gr.set.frames}},
      vertexShader:'attribute float frame; uniform float uFrames; varying vec2 vUv; void main(){ vUv = vec2((uv.x + frame) / uFrames, uv.y); gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader:'uniform sampler2D map; varying vec2 vUv; void main(){ if (texture2D(map, vUv).a < .4) discard; gl_FragColor = vec4(vec3(.04), 1.0); }'});
    gr.mesh=new THREE.InstancedMesh(geo,mat,n);gr.mesh.frustumCulled=false;gr.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(gr.mesh);
    gr.solid=new THREE.InstancedMesh(gr.set.geo,new THREE.MeshStandardMaterial({color:0x0a0a0b,roughness:1}),n);gr.solid.frustumCulled=false;gr.solid.castShadow=true;gr.solid.visible=false;gr.solid.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(gr.solid);
    gr.items.forEach((it,k)=>{it.group=gr;it.k=k;it.frame=0;});
  }
  const _m=new THREE.Matrix4(),_q=new THREE.Quaternion(),_p=new THREE.Vector3(),_s=new THREE.Vector3(),_up=new THREE.Vector3(0,1,0);
  let facing=0,rightX=1,rightZ=0,camStamp='',plan=false;
  function place(it){
    const p=it.p,onPad=avoid.some(a=>Math.hypot(a.x-p.pos.x,a.z-p.pos.z)<2.1),sc=onPad?0:H*(it.role==='marcher'?1.04:1),dirX=Math.sin(p.heading),dirZ=Math.cos(p.heading),flip=(dirX*rightX+dirZ*rightZ)>=0?1:-1;
    _q.setFromAxisAngle(_up,facing);_p.set(p.pos.x,Y0,p.pos.z);_s.set(sc*it.group.set.aspect*flip,sc,1);
    it.group.mesh.setMatrixAt(it.k,_m.compose(_p,_q,_s));
    if(plan){_q.setFromAxisAngle(_up,Math.atan2(-dirZ,dirX));_s.setScalar(sc);it.group.solid.setMatrixAt(it.k,_m.compose(_p,_q,_s));}
  }
  function refresh(frames){
    for(const it of people){place(it);if(frames!==undefined&&it.group.set.frames>1)it.group.frame.setX(it.k,frames(it));}
    for(const gr of groups.values()){gr.mesh.visible=!plan;gr.solid.visible=plan;gr.mesh.instanceMatrix.needsUpdate=true;gr.solid.instanceMatrix.needsUpdate=true;gr.frame.needsUpdate=true;}
  }
  /** turn every figure to the given camera (called each frame; cheap, only re-uploads when the view yaw changes) */
  function face(camera){
    const d=new THREE.Vector3();camera.getWorldDirection(d);const yaw=Math.atan2(-d.x,-d.z),down=-d.y,nextPlan=plan?down>.84:down>.9,stamp=yaw.toFixed(3)+nextPlan;if(stamp===camStamp)return;camStamp=stamp;plan=nextPlan;
    facing=yaw;rightX=Math.cos(facing);rightZ=-Math.sin(facing);refresh();
  }
  const ropeMaterial=new THREE.LineBasicMaterial({color:0x2a2a2c});
  const ropes=initial.handlers.map(()=>{
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(9),3));
    const l=new THREE.Line(geometry,ropeMaterial);l.name='Ground tether';root.add(l);return l;
  });
  // Short barriers on the sidewalk edge, leaving existing intersections open.
  const railMat=material(0xe4e1dc),railGeo=new THREE.BoxGeometry(.9,.045,.045),postGeo=new THREE.BoxGeometry(.045,.52,.045);
  const barriers=[];
  initial.spectators.forEach((p,i)=>{if(i%2)return;const g=new THREE.Group();g.position.set(p.pos.x,.03,p.pos.z);g.rotation.y=p.heading;
    const rail=new THREE.Mesh(railGeo,railMat);rail.position.set(0,.48,.35);g.add(rail);
    for(const x of [-.4,.4]){const post=new THREE.Mesh(postGeo,railMat);post.position.set(x,.25,.35);g.add(post);}g.userData.staticCrowd=true;barriers.push(g);
  });
  // Render the crowd and barriers in material/geometry batches, rather than
  // several thousand separate draw calls. Detached groups remain animation rigs.
  const batches=new Map(),rigs=[...barriers];
  for(const g of rigs)for(const mesh of g.children){
    const key=mesh.geometry.uuid+mesh.material.uuid+(g.userData.staticCrowd?'static':'moving');
    if(!batches.has(key))batches.set(key,{geometry:mesh.geometry,material:mesh.material,parts:[],static:!!g.userData.staticCrowd});
    batches.get(key).parts.push(mesh);
  }
  for(const b of batches.values()){b.mesh=new THREE.InstancedMesh(b.geometry,b.material,b.parts.length);b.mesh.instanceMatrix.setUsage(b.static?THREE.StaticDrawUsage:THREE.DynamicDrawUsage);root.add(b.mesh);}
  const stats={staticWrites:0,movingWrites:0,crowdUpdates:0};
  for(const g of rigs)g.updateMatrixWorld(true);
  for(const b of batches.values())if(b.static){b.parts.forEach((p,i)=>b.mesh.setMatrixAt(i,p.matrixWorld));b.mesh.instanceMatrix.needsUpdate=true;b.mesh.computeBoundingSphere();stats.staticWrites+=b.parts.length;}
  let crowdStamp=null;
  function update(env,t){
    balloon.position.set(env.balloon.x,env.balloon.y+.4,env.balloon.z);
    // Fixed front-facing character; translating along the same route avoids orientation
    // interpolation changing the conservative collision envelope at corners.
    balloon.rotation.z=env.drift*.08;
    // Moving formation updates at 10 Hz. Spectators and barriers are uploaded once;
    // no spectator waving, turning, walking rigs or per-frame static buffer writes.
    const stamp=Math.floor(t*10+1e-7);if(stamp===crowdStamp)return;crowdStamp=stamp;stats.crowdUpdates++;
    const list=[...env.marchers,...env.handlers];
    list.forEach((p,i)=>{const it=people[initial.spectators.length+i];it.p=p;});
    refresh(it=>Math.floor(t*4+it.k*.7)%8);
    for(const b of batches.values())if(!b.static){b.parts.forEach((p,i)=>b.mesh.setMatrixAt(i,p.matrixWorld));b.mesh.instanceMatrix.needsUpdate=true;b.mesh.computeBoundingSphere();stats.movingWrites+=b.parts.length;}
    env.handlers.forEach((h,i)=>{const a=h.anchor,b=h.hand,slack=(1-h.tension)*1.7,positions=ropes[i].geometry.attributes.position;
      positions.setXYZ(0,a.x,a.y+.4,a.z);positions.setXYZ(1,(a.x+b.x)/2,(a.y+b.y)/2+.4-slack,(a.z+b.z)/2);positions.setXYZ(2,b.x,b.y+.4,b.z);positions.needsUpdate=true;ropes[i].geometry.computeBoundingSphere();
    });
  }
  update(initial,0);return {root,balloon,people,ropes,route,update,face,stats,radius:PARADE.balloonRadius};
}
