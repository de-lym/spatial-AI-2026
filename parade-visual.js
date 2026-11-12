import * as THREE from 'three';
import {PARADE_ROUTE,PARADE} from './parade-environment.js';

// Shared soft geometry and materials: lightweight crowd, editable 3D character.
export function createParadeVisual(parent,initial){
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
  const coats=[0x242426,0x2e2e30,0x1b1b1d,0x38383a,0x222224].map(material),skin=material(0x2a2a2c),trouser=material(0x1b1b1d);
  const bodyGeo=new THREE.CylinderGeometry(.17,.22,.42,7),limbGeo=new THREE.CylinderGeometry(.055,.055,.29,5);
  function human(p,i){
    const g=new THREE.Group();g.name=p.id;
    const coat=p.role==='handler'?gold:p.role==='marcher'?cream:coats[i%coats.length];
    const torso=new THREE.Mesh(bodyGeo,coat);torso.position.y=.48;g.add(torso);
    ellipsoid(g,skin,0,.83,0,.15,.17,.15);
    const legs=[],arms=[];
    for(const side of [-1,1]){
      const leg=new THREE.Mesh(limbGeo,trouser);leg.position.set(side*.09,.17,0);g.add(leg);legs.push(leg);
      const arm=new THREE.Mesh(limbGeo,coat);arm.position.set(side*.23,.5,.03);arm.rotation.z=side*.18;g.add(arm);arms.push(arm);
    }
    // Face direction is visible even in the abstract, small crowd models.
    ellipsoid(g,ink,0,.84,.145,.09,.035,.025);
    if(p.role!=='spectator')ellipsoid(g,coat,0,.98,0,.17,.06,.17);
    g.position.set(p.pos.x,.4,p.pos.z);g.rotation.y=p.heading;g.userData.staticCrowd=p.role==='spectator';
    if(p.role==='handler')arms.forEach(a=>a.rotation.x=-1);
    return {g,legs,arms};
  }
  const people=[...initial.spectators,...initial.marchers,...initial.handlers].map(human);
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
  const batches=new Map(),rigs=[...people.map(p=>p.g),...barriers];
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
    list.forEach((p,i)=>{const {g}=people[initial.spectators.length+i];g.position.set(p.pos.x,.4,p.pos.z);g.rotation.y=p.heading;g.rotation.x=p.lean??0;g.updateMatrixWorld(true);});
    for(const b of batches.values())if(!b.static){b.parts.forEach((p,i)=>b.mesh.setMatrixAt(i,p.matrixWorld));b.mesh.instanceMatrix.needsUpdate=true;b.mesh.computeBoundingSphere();stats.movingWrites+=b.parts.length;}
    env.handlers.forEach((h,i)=>{const a=h.anchor,b=h.hand,slack=(1-h.tension)*1.7,positions=ropes[i].geometry.attributes.position;
      positions.setXYZ(0,a.x,a.y+.4,a.z);positions.setXYZ(1,(a.x+b.x)/2,(a.y+b.y)/2+.4-slack,(a.z+b.z)/2);positions.setXYZ(2,b.x,b.y+.4,b.z);positions.needsUpdate=true;ropes[i].geometry.computeBoundingSphere();
    });
  }
  update(initial,0);return {root,balloon,people,ropes,route,update,stats,radius:PARADE.balloonRadius};
}
