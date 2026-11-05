const {chromium}=require('playwright');
const fs=require('fs');const assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.AIRSPACE_URL || 'http://127.0.0.1:8000');await page.waitForFunction(()=>window.__sim);
 const result={};
 result.baseline=await page.evaluate(()=>{const a=__sim;a.setStage(4);a.S.running=false;a.S.intake=false;for(let i=0;i<2400;i++)a.step(.1);return {time:a.S.time,delivered:a.S.delivered.length,minSepM:a.S.minSepM,conditions:a.proximity.snapshot().conditions};});
 assert.ok(result.baseline.delivered>=4,'first four deliveries must complete');
 result.pigeon=await page.evaluate(()=>{const a=__sim;a.resetWorld(true);a.S.running=false;a.S.intake=false;for(let i=0;i<180;i++)a.step(.1);const spawned=a.proximity.encounter();for(let i=0;i<20;i++)a.step(.1);return {spawned,snapshot:a.proximity.snapshot()};});
 assert.ok(result.pigeon.spawned);assert.ok(result.pigeon.snapshot.audit.some(e=>e.code==='PROX_PIGEON'&&e.action.startsWith('AUTO')));
 result.recovery=await page.evaluate(()=>{const a=__sim;a.proximity.clearBirds();for(let i=0;i<100;i++)a.step(.1);return {conditions:a.proximity.snapshot().conditions,audit:a.proximity.snapshot().audit};});
 assert.ok(!result.recovery.conditions.some(s=>s.cause==='PIGEON'));
 assert.ok(result.recovery.audit.some(e=>e.code==='PROX_PIGEON'&&e.action==='AUTO_RESUME'));
 // Closed airspace: current pose becomes illegal, must escalate and never falsely resolve on acknowledgment.
 result.blocked=await page.evaluate(()=>{const a=__sim;const r={id:'QA-CLOSED',name:'QA impossible airspace',active:true,x0:-58,x1:58,z0:-58,z1:58,zloM:0,zhiM:200};a.world.restricted.push(r);a.world.version++;for(let i=0;i<100;i++)a.step(.1);const before=a.ops.list('critical').map(e=>e.code);a.proximity.acknowledge();return {before,after:a.ops.list('critical').map(e=>e.code),snapshot:a.proximity.snapshot()};});
 assert.ok(result.blocked.before.includes('PROX_BUILDING_OR_AIRSPACE'));assert.deepEqual(result.blocked.before,result.blocked.after);
 await page.getByRole('button',{name:'Advanced',exact:true}).click();
 await page.locator('#sec-proximity').scrollIntoViewIfNeeded();
 await page.screenshot({path:'docs/proximity-live-1440.png'});
 await page.setViewportSize({width:1280,height:800});await page.screenshot({path:'docs/proximity-live-1280.png'});
 result.layout=await page.evaluate(()=>({viewport:innerWidth,pageWidth:document.documentElement.scrollWidth}));
 // Export is an actual browser download.
 const downloadPromise=page.waitForEvent('download');await page.locator('#prox-export').click();const download=await downloadPromise;await download.saveAs('docs/sample-session.json');
 result.export=download.suggestedFilename();
 await page.evaluate(()=>{const a=__sim;a.resetWorld(true);a.S.running=false;});
 result.reset=await page.evaluate(()=>__sim.proximity.snapshot());assert.equal(result.reset.birds.length,0);assert.equal(result.reset.conditions.length,0);assert.equal(result.reset.audit.length,0);
 result.pageErrors=errors;assert.deepEqual(errors,[]);
 fs.writeFileSync('docs/browser-acceptance.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({baseline:result.baseline,pigeonActions:result.pigeon.snapshot.audit.filter(e=>e.code==='PROX_PIGEON').map(e=>e.action),critical:result.blocked.before,layout:result.layout,export:result.export,pageErrors:errors}));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
