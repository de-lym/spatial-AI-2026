import * as THREE from 'three';
// Rendering reads environment snapshots only; it never advances or modifies the simulation.
export function createEventVisual(parent){
 const root=new THREE.Group();root.name='Deterministic event effects';parent.add(root);
 // pigeons: solid black flying-dove silhouettes (6-frame wing cycle) on camera-facing billboards
 const FW=128,FH=96,FR=6,cv=document.createElement('canvas');cv.width=FW*FR;cv.height=FH;
 (function drawBirds(){
  const g=cv.getContext('2d');g.fillStyle='#000';
  for(let f=0;f<FR;f++){
   g.save();g.translate(f*FW,0);
   const ph=f/FR*Math.PI*2,flap=Math.sin(ph);                       // +1 wings up, -1 wings down
   // tail fan
   g.beginPath();g.moveTo(42,52);g.lineTo(14,48);g.lineTo(10,56);g.lineTo(16,60);g.lineTo(12,66);g.lineTo(26,66);g.lineTo(44,60);g.closePath();g.fill();
   // body, chest, head, beak
   g.beginPath();g.ellipse(62,54,25,11,-0.12,0,Math.PI*2);g.fill();
   g.beginPath();g.ellipse(86,47,7,6.2,0,0,Math.PI*2);g.fill();
   g.beginPath();g.moveTo(92,46);g.lineTo(102,48.5);g.lineTo(92,51);g.closePath();g.fill();
   // far wing (smaller) then near wing: feathered polygon from shoulder to tip with scalloped trailing edge
   const wing=(sx,sy,len,ang,sc)=>{
    const tx=sx+Math.sin(ang)*len*0.55-len*0.28,ty=sy-Math.cos(ang)*len;
    const dx=tx-sx,dy=ty-sy,L=Math.hypot(dx,dy),nx=-dy/L,ny=dx/L,w=15*sc;
    g.beginPath();g.moveTo(sx-8,sy+2);g.quadraticCurveTo(sx+dx*.45+nx*w*.8,sy+dy*.45+ny*w*.8,tx,ty);
    for(let k=0;k<=5;k++){const u=1-k/5,px=sx+dx*u+(-nx)*w*0.35*(1-u)-nx*3,py=sy+dy*u+(-ny)*w*0.35*(1-u)-ny*3;g.lineTo(px+(k%2?-3:3)*nx,py+(k%2?-3:3)*ny);}
    g.lineTo(sx+10,sy+4);g.closePath();g.fill();
   };
   const ang=flap*0.9-0.1;wing(60,48,46,ang*0.9,0.7);wing(66,50,56,ang,1);
   g.restore();
  }
 })();
 const tex=new THREE.CanvasTexture(cv);tex.generateMipmaps=false;tex.minFilter=tex.magFilter=THREE.LinearFilter;
 const quad=new THREE.PlaneGeometry(1,1);const bgeo=new THREE.InstancedBufferGeometry();bgeo.index=quad.index;bgeo.attributes.position=quad.attributes.position;bgeo.attributes.uv=quad.attributes.uv;bgeo.attributes.normal=quad.attributes.normal;
 const frameAttr=new THREE.InstancedBufferAttribute(new Float32Array(12),1);bgeo.setAttribute('frame',frameAttr);
 const bodies=new THREE.InstancedMesh(bgeo,new THREE.ShaderMaterial({side:THREE.DoubleSide,uniforms:{map:{value:tex},uFrames:{value:FR}},
  vertexShader:'attribute float frame; uniform float uFrames; varying vec2 vUv; void main(){ vUv = vec2((uv.x + frame) / uFrames, uv.y); gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
  fragmentShader:'uniform sampler2D map; varying vec2 vUv; void main(){ if (texture2D(map, vUv).a < .4) discard; gl_FragColor = vec4(vec3(.04), 1.0); }'}),12);
 bodies.frustumCulled=false;bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(bodies);const wings=bodies;
 const paper=new THREE.InstancedMesh(new THREE.PlaneGeometry(.18,.28),new THREE.MeshStandardMaterial({color:0xf4f2ee,side:THREE.DoubleSide,roughness:1}),360);root.add(paper);
 const colors=[0xf6f4f0,0x1b1b1d,0x9a9894,0x4a4a4c].map(c=>new THREE.Color(c));for(let i=0;i<360;i++)paper.setColorAt(i,colors[i%4]);
 const gust=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x2a2a2c,transparent:true,opacity:.75}));root.add(gust);
 const dummy=new THREE.Object3D();
 let lastBirds=[],lastT=0,facing=0,rightX=1,rightZ=0,camStamp='';
 const BM=new THREE.Matrix4(),BQ=new THREE.Quaternion(),BP=new THREE.Vector3(),BS=new THREE.Vector3(),UP=new THREE.Vector3(0,1,0);
 function placeBirds(){
  bodies.visible=lastBirds.length>0;
  lastBirds.forEach((b,i)=>{const flip=(b.v.x*rightX+b.v.z*rightZ)>=0?1:-1;BQ.setFromAxisAngle(UP,facing);BP.set(b.pos.x,b.pos.y+.4,b.pos.z);BS.set(1.7*flip,1.7*.75,1);bodies.setMatrixAt(i,BM.compose(BP,BQ,BS));frameAttr.setX(i,Math.floor(lastT*9+i*1.3)%FR);});
  bodies.count=Math.max(1,lastBirds.length);bodies.instanceMatrix.needsUpdate=true;frameAttr.needsUpdate=true;
 }
 /** turn every bird to the camera (cheap; only runs when the view yaw changes) */
 function face(camera){const d=new THREE.Vector3();camera.getWorldDirection(d);const yaw=Math.atan2(-d.x,-d.z),s=yaw.toFixed(3);if(s===camStamp)return;camStamp=s;facing=yaw;rightX=Math.cos(yaw);rightZ=-Math.sin(yaw);placeBirds();}
 function instance(mesh,i,pos,scale,rotation={x:0,y:0,z:0}){dummy.position.set(pos.x,pos.y+.4,pos.z);dummy.scale.set(scale.x,scale.y,scale.z);dummy.rotation.set(rotation.x,rotation.y,rotation.z);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}
 function update(effects,t){
  lastBirds=effects.pigeons;lastT=t;placeBirds();
  paper.visible=!!effects.confetti;
  if(effects.confetti){const c=effects.confetti;for(let i=0;i<360;i++){const a=i*2.399963+t*.3,r=c.radius*Math.cbrt(((i*73)%359)/359),h=2*((i*37%359)/359)-1,flat=Math.sqrt(1-h*h);instance(paper,i,{x:c.pos.x+Math.cos(a)*r*flat,y:c.pos.y+r*h,z:c.pos.z+Math.sin(a)*r*flat},{x:1,y:1,z:1},{x:t*2+i,y:a,z:t+i});}paper.instanceMatrix.needsUpdate=true;paper.computeBoundingSphere();}
  const strength=Math.hypot(effects.wind.x,effects.wind.z);gust.visible=strength>.001;
  if(gust.visible){const points=[];for(let i=0;i<22;i++){const x=-20+(i%6)*9+((t*4+i)%9),y=12+Math.floor(i/6)*3,z=-24+Math.floor(i/6)*14;const start=new THREE.Vector3(x,y,z),end=start.clone().add(new THREE.Vector3(effects.wind.x,0,effects.wind.z).multiplyScalar(5));points.push(start,end,end,end.clone().add(new THREE.Vector3(-1,0,-.3)),end,end.clone().add(new THREE.Vector3(-.4,0,1)));}gust.geometry.dispose();gust.geometry=new THREE.BufferGeometry().setFromPoints(points);}
 }
 return {root,bodies,wings,paper,gust,update,face};
}
