const {chromium}=require('playwright');
const fs=require('fs'),assert=require('assert/strict');
fs.mkdirSync('work/placement-frames',{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.AIRSPACE_URL || 'http://127.0.0.1:8000');await page.waitForFunction(()=>window.__sim);
 const baseline=await page.evaluate(()=>{const a=__sim;a.setStage(4);a.S.running=false;a.S.intake=false;for(let i=0;i<2400;i++)a.step(.1);return {delivered:a.S.delivered.length,minSepM:a.S.minSepM};});assert.equal(baseline.delivered,4);
 // Starting the tour is destructive only after explicit confirmation; cancel preserves the session.
 await page.locator('#btn-placements').click();await page.locator('#placement-start').click();assert.ok(await page.locator('#dlg-placement').isVisible());await page.locator('#placement-cancel').click();assert.equal(await page.evaluate(()=>__sim.S.delivered.length),4);
 await page.locator('#placement-start').click();await page.locator('#placement-confirm').click();await page.evaluate(()=>{__sim.S.running=false;__sim.clearDroneSelection();});
 await page.locator('[data-category="updates"]').click();
 const pre=await page.evaluate(()=>{const a=__sim;while(a.placement.state.mode==='assembling'&&a.S.time<120)a.step(.1);return {mode:a.placement.state.mode,time:a.S.time};});
 let moment=null;
 for(let i=0;i<28;i++){
  const data=await page.evaluate(()=>{const a=__sim;for(let k=0;k<3;k++)a.step(.1);const c=a.S.couriers[0];return {time:a.S.time,mode:a.placement.state.mode,facts:a.placement.factsFor(c),drones:a.S.couriers.slice(0,2).map(c=>({id:c.id,pos:{...c.pos},facts:a.placement.factsFor(c)}))};});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.screenshot({path:`work/placement-frames/${String(i).padStart(3,'0')}.png`});
  if(!moment&&data.mode==='crossing'&&data.facts.length===3){moment=data;await page.screenshot({path:'docs/placement-three-relations.png'});}
 }
 assert.ok(moment,'all three facts must hold simultaneously');
 const continued=await page.evaluate(()=>{const a=__sim;for(let i=0;i<2000;i++)a.step(.1);return {mode:a.placement.state.mode,delivered:a.S.delivered.length,minSepM:a.S.minSepM,history:a.placement.snapshot().history};});assert.equal(continued.mode,'complete');assert.equal(continued.delivered,4);
 const rejected=await page.evaluate(()=>{const a=__sim;a.cfg.sepM=40;return a.placement.start();});assert.equal(rejected,false);
 const clearance=await page.evaluate(()=>{const a=__sim;a.cfg.sepM=30;a.cfg.clearanceM=30;return a.placement.start();});assert.equal(clearance,false);
 const reset=await page.evaluate(()=>{const a=__sim;a.cfg.clearanceM=6;a.resetWorld(true);a.S.running=false;return a.placement.snapshot();});assert.equal(reset.mode,'idle');assert.equal(reset.history.length,0);
 // Preserve pigeon integration in the modified city.
 const pigeon=await page.evaluate(()=>{const a=__sim;a.setStage(4);a.S.running=false;a.S.intake=false;for(let i=0;i<180;i++)a.step(.1);const spawned=a.proximity.encounter();for(let i=0;i<20;i++)a.step(.1);return {spawned,actions:a.proximity.snapshot().audit.filter(e=>e.code==='PROX_PIGEON').map(e=>e.action)};});assert.ok(pigeon.spawned);assert.ok(pigeon.actions.some(a=>a.startsWith('AUTO')));
 await page.setViewportSize({width:1280,height:800});await page.locator('#btn-placements').click();await page.screenshot({path:'docs/placement-controls-1280.png'});const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.equal(layout.width,layout.scrollWidth);
 assert.deepEqual(errors,[]);const report={baseline,pre,moment,continued,rejectedSeparation40:rejected,rejectedBlockedPassage:clearance,reset,pigeon,layout,pageErrors:errors};fs.writeFileSync('docs/placement-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify({baseline,moment,continued:{mode:continued.mode,delivered:continued.delivered,minSepM:continued.minSepM},pigeon,layout,errors}));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
