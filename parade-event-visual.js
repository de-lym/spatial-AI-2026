import * as THREE from 'three';
// Rendering reads environment snapshots only; it never advances or modifies the simulation.
export function createEventVisual(parent){
 const root=new THREE.Group();root.name='Deterministic event effects';parent.add(root);
 const birdMaterial=new THREE.MeshStandardMaterial({color:0x1b1b1d,roughness:.85});
 const bodies=new THREE.InstancedMesh(new THREE.SphereGeometry(1,8,6),birdMaterial,12);
 const wings=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),birdMaterial,24);root.add(bodies,wings);
 const paper=new THREE.InstancedMesh(new THREE.PlaneGeometry(.18,.28),new THREE.MeshStandardMaterial({color:0xf4f2ee,side:THREE.DoubleSide,roughness:1}),360);root.add(paper);
 const colors=[0xf6f4f0,0x1b1b1d,0x9a9894,0x4a4a4c].map(c=>new THREE.Color(c));for(let i=0;i<360;i++)paper.setColorAt(i,colors[i%4]);
 const gust=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x2a2a2c,transparent:true,opacity:.75}));root.add(gust);
 const dummy=new THREE.Object3D();
 function instance(mesh,i,pos,scale,rotation={x:0,y:0,z:0}){dummy.position.set(pos.x,pos.y+.4,pos.z);dummy.scale.set(scale.x,scale.y,scale.z);dummy.rotation.set(rotation.x,rotation.y,rotation.z);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}
 function update(effects,t){
  bodies.visible=wings.visible=effects.pigeons.length>0;
  effects.pigeons.forEach((b,i)=>{instance(bodies,i,b.pos,{x:.3,y:.16,z:.16});for(let side=0;side<2;side++)instance(wings,i*2+side,{x:b.pos.x,y:b.pos.y,z:b.pos.z+(side?1:-1)*.3},{x:.28,y:.04,z:.55},{x:Math.sin(t*12+i)*.6*(side?1:-1),y:.2,z:0});});
  bodies.instanceMatrix.needsUpdate=true;wings.instanceMatrix.needsUpdate=true;bodies.computeBoundingSphere();wings.computeBoundingSphere();
  paper.visible=!!effects.confetti;
  if(effects.confetti){const c=effects.confetti;for(let i=0;i<360;i++){const a=i*2.399963+t*.3,r=c.radius*Math.cbrt(((i*73)%359)/359),h=2*((i*37%359)/359)-1,flat=Math.sqrt(1-h*h);instance(paper,i,{x:c.pos.x+Math.cos(a)*r*flat,y:c.pos.y+r*h,z:c.pos.z+Math.sin(a)*r*flat},{x:1,y:1,z:1},{x:t*2+i,y:a,z:t+i});}paper.instanceMatrix.needsUpdate=true;paper.computeBoundingSphere();}
  const strength=Math.hypot(effects.wind.x,effects.wind.z);gust.visible=strength>.001;
  if(gust.visible){const points=[];for(let i=0;i<22;i++){const x=-20+(i%6)*9+((t*4+i)%9),y=12+Math.floor(i/6)*3,z=-24+Math.floor(i/6)*14;const start=new THREE.Vector3(x,y,z),end=start.clone().add(new THREE.Vector3(effects.wind.x,0,effects.wind.z).multiplyScalar(5));points.push(start,end,end,end.clone().add(new THREE.Vector3(-1,0,-.3)),end,end.clone().add(new THREE.Vector3(-.4,0,1)));}gust.geometry.dispose();gust.geometry=new THREE.BufferGeometry().setFromPoints(points);}
 }
 return {root,bodies,wings,paper,gust,update};
}
