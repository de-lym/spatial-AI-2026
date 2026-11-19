import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld, DEFAULT_SETTINGS, TIER, EVENT_TYPES, BOARD } from '../last10m/world.js';

const city = (p) => JSON.parse(readFileSync(new URL(`./fixtures/city-${p}.json`, import.meta.url)));
const CITY = { high: city('high'), low: city('low'), mixed: city('mixed') };
const make = (over = {}, memory = {}) => { const p = over.preset ?? 'mixed'; return createWorld({ ...DEFAULT_SETTINGS, ...over }, { obstacles: CITY[p].obstacles, low: CITY[p].low, roads: CITY[p].roads, tiles: CITY[p].tiles, memory }); };
// a simulated operator: answers every event that is on hold with its first (recommended) option after `delay` seconds
const operate = (w, delay = 3) => { for (const e of w.onHold()) if (w.state.t - e.opened >= delay) w.resolve(e.id, (e.options.find((o) => o.primary) ?? e.options[0]).id); };
const runOp = (w, secs, delay = 3) => { for (let t = 0; t < secs - 1e-9; t += 0.1) { w.step(0.1); operate(w, delay); } return w; };
const run = (over = {}, memory = {}, secs = 900) => runOp(make(over, memory), secs);
const count = (w, type) => w.state.events.filter((e) => e.type === type).length;

test('one fixture per city preset; high-rise lots are taller than low-rise lots', () => {
  const mean = (p) => CITY[p].obstacles.reduce((s, o) => s + o.h, 0) / CITY[p].obstacles.length;
  assert.ok(CITY.high.obstacles.length > 20 && CITY.low.obstacles.length > 20 && CITY.mixed.obstacles.length > 20);
  assert.ok(mean('high') > mean('mixed') && mean('mixed') > mean('low'), `${mean('high')} ${mean('mixed')} ${mean('low')}`);
  const housing = (p) => CITY[p].tiles.filter((t) => t.landUse === 'housing').length;
  assert.ok(housing('low') > housing('high'));
});

test('nine fixed drones, all at the hub; seeded orders keep arriving, every address inside the delivery radius', () => {
  const w = make({ orders: 30, radiusM: 160 });
  assert.equal(w.state.drones.length, 9);
  assert.deepEqual(w.state.drones.map((d) => d.id), ['D-01', 'D-02', 'D-03', 'D-04', 'D-05', 'D-06', 'D-07', 'D-08', 'D-09']);
  w.run(600);
  assert.ok(w.state.orders.length >= 24 && w.state.orders.length <= 40, `${w.state.orders.length} orders in 10 minutes for a rate of 30`);
  for (const o of w.state.orders) assert.ok(Math.hypot(o.addr.x, o.addr.z) <= 160 / 5 + 1e-6, 'order outside the delivery radius');
  const w2 = make({ orders: 30, radiusM: 160 }); w2.run(600);
  assert.deepEqual(w.state.orders.map((o) => [o.addr.key, o.urgent]), w2.state.orders.map((o) => [o.addr.key, o.urgent]));
});

test('same seed + settings give the same event stream (deterministic); another seed does not', () => {
  const sig = (w) => w.state.events.map((e) => `${e.id}|${e.type}|${e.drone}|${e.opened.toFixed(1)}|${e.status}`).join();
  assert.equal(sig(run()), sig(run()));
  assert.notEqual(sig(run()), sig(run({ seed: 7 })));
});

test('the world never stops: drones keep circulating and orders keep being completed, in every preset', () => {
  for (const preset of ['high', 'low', 'mixed']) {
    const w = make({ preset, orders: 24 }); let last = 0;
    for (let k = 1; k <= 5; k++) {
      runOp(w, 300);
      const done = w.state.completed; assert.ok(done - last >= 3, `${preset}: only ${done - last} orders completed in minute ${k * 5 - 5}–${k * 5}`); last = done;
      assert.equal(w.state.done, false);
      assert.ok(w.state.drones.some((d) => d.phase !== 'idle'), 'somebody is always working');
    }
  }
  const quiet = make({ flocks: 0, pedestrians: 0, dogs: 0, gustPerMin: 0, replyPct: 100 }); runOp(quiet, 1200);
  assert.equal(quiet.state.done, false); assert.ok(quiet.state.completed > 15);
});

test('drones leave and land one at a time, from slots on the plaza land around the tower (never on a road), apart from each other', () => {
  const w = make({ orders: 24 }); const departures = [], landings = [];
  for (const d of w.state.drones) { assert.ok(Math.abs(d.home.x) <= 5.6 && Math.abs(d.home.z) <= 5.6, `${d.id} home is off the plaza slab`); assert.ok(Math.abs(d.home.x) > 3.9 || Math.abs(d.home.z) > 3.9, 'home inside the tower clearance'); }
  for (let a = 0; a < w.state.drones.length; a++) for (let b = a + 1; b < w.state.drones.length; b++) assert.ok(Math.hypot(w.state.drones[a].home.x - w.state.drones[b].home.x, w.state.drones[a].home.z - w.state.drones[b].home.z) >= 2.7, 'homes too close');
  const phase = new Map();
  for (let i = 0; i < 6000; i++) {
    w.step(0.1); operate(w);
    for (const d of w.state.drones) { const p = phase.get(d.id); if (p === 'idle' && d.phase !== 'idle') departures.push(w.state.t); if (p && p !== 'idle' && p !== 'land' && d.phase === 'land') landings.push(w.state.t); phase.set(d.id, d.phase); }
  }
  const gaps = (a) => a.slice(1).map((x, i) => x - a[i]);
  assert.ok(departures.length > 10 && landings.length > 10);
  assert.ok(Math.min(...gaps(departures)) >= 4.9 - 0.11, `two drones left within ${Math.min(...gaps(departures)).toFixed(1)} s`);
  // touch-downs are spaced by the landing lock
  const touch = []; const was = new Map(); const w2 = make({ orders: 24 });
  for (let i = 0; i < 6000; i++) { w2.step(0.1); operate(w2); for (const d of w2.state.drones) { if (was.get(d.id) === 'land' && d.phase === 'idle') touch.push(w2.state.t); was.set(d.id, d.phase); } }
  assert.ok(touch.length > 8 && Math.min(...gaps(touch.sort((a, b) => a - b))) >= 4);
});

test('delivery model: a drone first collects the order at a shop (restaurant), then delivers it to the customer; the parcel exists only after pick-up', () => {
  const w = make({ orders: 12 }); const shops = new Set(w.state.shops.map((s) => `${s.x},${s.z}`)); assert.ok(shops.size >= 3);
  let picked = 0, order = new Map();
  for (let i = 0; i < 5000; i++) {
    w.step(0.1); operate(w);
    for (const d of w.state.drones) {
      if (!d.order) continue;
      if (d.leg === 'toShop' && d.phase !== 'pickup') { assert.equal(d.carrying, false, 'carrying before the pick-up'); assert.ok(shops.has(`${d.target.x},${d.target.z}`), 'first leg does not go to a shop'); }
      if (d.phase === 'lower' || d.phase === 'release') assert.equal(d.carrying, true, 'delivering without a parcel');
      const k = order.get(d.id); if (k !== d.order.id) { order.set(d.id, d.order.id); }
    }
  }
  picked = w.state.log.filter((e) => e.code === 'PICKUP').length; const delivered = w.state.log.filter((e) => e.code === 'DELIVERED').length;
  assert.ok(picked >= 8 && delivered >= 6 && picked >= delivered);
  for (const o of w.state.orders) if (o.shop) assert.ok(!w.state.addresses.some((a) => a.key === o.shop.key), 'a shop is also a customer address');
});

test('the parade: a drone never passes through the balloon — it backs off and holds', () => {
  const w = make({ orders: 40, flocks: 0 }); let near = 0, minD = Infinity;
  for (let i = 0; i < 9000; i++) {
    w.step(0.1); const t = w.state.t, bx = 0; void bx;
    const bl = w.balloon(t);
    for (const d of w.state.drones) { if (d.phase === 'idle' || d.phase === 'land') continue; const dd = Math.hypot(d.x - bl.x, (d.y - 0.4 - bl.y) * 0.7, d.z - bl.z); minD = Math.min(minD, dd); if (dd < 9) near++; }
  }
  assert.ok(minD > 5.4, `a drone got within ${minD.toFixed(1)} u of the balloon`);
  assert.ok(w.state.log.some((e) => e.code === 'PARADE'), 'no drone ever reacted to the parade');
});

test('every event has the tier of its type; an urgent order raises it by one (3→2, 2→1, 1 stays)', () => {
  const w = run({ urgentPct: 50 });
  let bumped = 0;
  for (const e of w.state.events) {
    assert.equal(e.base, TIER[e.type]);
    assert.equal(e.tier, e.urgent ? Math.max(1, e.base - 1) : e.base, `${e.type} urgent=${e.urgent}`);
    if (e.urgent && e.tier < e.base) bumped++;
  }
  assert.ok(bumped > 0, 'expected at least one urgent event that was bumped up a tier');
  const none = run({ urgentPct: 0 });
  assert.ok(none.state.events.every((e) => e.tier === e.base));
});

test('urgent orders are handed to drones first', () => {
  const w = make({ urgentPct: 30 });
  w.run(70);
  const taken = w.state.orders.filter((o) => o.status !== 'queued'), left = w.state.orders.filter((o) => o.status === 'queued');
  assert.ok(taken.length >= 5);
  const urgentLeft = left.filter((o) => o.urgent).length;
  const normalTaken = taken.filter((o) => !o.urgent).length;
  assert.ok(!(urgentLeft > 0 && normalTaken > 0), 'a normal order left the hub while an urgent one waited');
});

test('tier ① events: the drone protects people by itself and carries on when it is safe — it never waits for the operator', () => {
  const w = make({ pedestrians: 8, dogs: 5, gustPerMin: 4, urgentPct: 40 }); w.run(900);       // nobody at the console
  const t1 = w.state.events.filter((e) => e.tier === 1);
  assert.ok(t1.length >= 5, `tier 1 events: ${t1.length}`);
  for (const e of t1) { assert.equal(e.autoSafe, true); assert.ok(e.safeAction && e.safeAction.length > 3, e.type); assert.notEqual(e.status, 'open', 'a critical event is never left waiting for a human'); }
  assert.ok(t1.filter((e) => e.status === 'cleared').length >= 3, 'critical events close by themselves once the danger is gone');
  // nobody is ever closer than 2 m to the parcel / drone during a person or animal event
  for (const e of t1.filter((x) => x.type === 'ped' || x.type === 'dog')) assert.ok(e.closestM == null || e.closestM >= 2, `closest ${e.closestM} m`);
  assert.ok(!w.state.events.some((e) => e.resolvedBy === 'auto'), 'no decision is ever taken for the operator');
});

test('tier ② / ③ events stay on hold until the operator decides: nothing is decided for them, however long it takes', () => {
  const w = make({ dogs: 8, replyPct: 0, urgentPct: 0 });
  let ev = null; for (let i = 0; i < 9000 && !ev; i++) { w.step(0.1); ev = w.onHold()[0]; }
  assert.ok(ev, 'no event went on hold');
  const d = w.droneOf(ev.drone), order = d.order.id;
  w.run(200);                                                                                      // well past any old countdown
  assert.equal(ev.status, 'open'); assert.equal(ev.option, null); assert.equal(d.order?.id, order, 'the drone gave up on its own');
  assert.ok(!['lower', 'release', 'return'].includes(d.phase), `drone went on to ${d.phase} without an answer`);
  assert.ok(w.scorecard().longestWaitS >= 200 && w.scorecard().unanswered >= 1, 'waiting time is what the delay costs');
  assert.equal(w.resolve(ev.id, 'return'), true); assert.equal(ev.resolvedBy, 'operator'); assert.ok(ev.reaction >= 200);
  w.run(1); assert.equal(d.phase, 'return');
});

test('the safe action happens at the moment the tier ① event opens, before any operator input', () => {
  const w = make({ pedestrians: 10, gustPerMin: 5 });
  let seen = null;
  for (let i = 0; i < 9000 && !seen; i++) { w.step(0.1); seen = w.state.events.find((e) => e.tier === 1 && e.status === 'auto' && e.type !== 'conflict'); }
  assert.ok(seen);
  const d = w.droneOf(seen.drone);
  assert.ok(d.held || ['reel', 'wait', 'climb', 'reelup'].includes(d.phase), `drone is not in a safe state (${d.phase})`);
});

test('conflict rule: the urgent order goes first, on equal priority the lower drone ID goes first; the other yields', () => {
  let n = 0;
  for (const over of [{ orders: 40 }, { orders: 55, urgentPct: 40 }, { preset: 'high', orders: 45 }]) {
    const w = run(over);
    for (const e of w.state.events.filter((x) => x.type === 'conflict')) {
      n++;
      const y = w.droneOf(e.drone), g = w.droneOf(e.with);
      const oy = w.state.orders.find((o) => o.id === e.order);
      // reconstruct the priority of the goer at event time from the log of the event: urgent flag of the yielder's order and ids
      if (!e.urgent) assert.ok(y.idx > g.idx || e.withUrgent, `${y.id} yielded to ${g.id}`);
    }
  }
  assert.ok(n >= 5, `conflicts seen: ${n}`);
});

test('conflicts apply the priority rule at once; the operator can override with "swap" and the other drone yields', () => {
  const w = make({ orders: 40 });
  let ev = null;
  for (let i = 0; i < 9000 && !ev; i++) { w.step(0.1); ev = w.queue().find((e) => e.type === 'conflict' && !e.urgent); }
  assert.ok(ev, 'no conflict event');
  const y = w.droneOf(ev.drone), g = w.droneOf(ev.with);
  assert.equal(ev.status, 'auto'); assert.equal(y.yieldFor, g.id, 'the rule was not applied automatically');
  assert.equal(w.resolve(ev.id, 'swap'), true);
  assert.equal(ev.resolvedBy, 'operator'); assert.ok(ev.reaction >= 0); assert.equal(y.yieldFor, null);
  assert.equal(g.yieldFor, y.id);
  assert.ok(g.held);
  assert.equal(w.resolve(ev.id, 'rule'), false, 'an event can only be resolved once');
});

test('"To resolve" queue is sorted by tier, then longest waiting first', () => {
  const w = make({ pedestrians: 8, dogs: 6, gustPerMin: 5, urgentPct: 30 });
  let multi = 0;
  for (let i = 0; i < 9000; i++) {
    w.step(0.1); if (i % 20 === 0) operate(w, 8); const q = w.queue();
    if (q.length >= 2) multi++;
    for (let k = 1; k < q.length; k++) { const a = q[k - 1], b = q[k]; assert.ok(a.tier < b.tier || (a.tier === b.tier && (a.status === 'auto') >= (b.status === 'auto') && (a.status !== b.status || a.opened <= b.opened + 1e-9))); }
  }
  assert.ok(multi > 20, 'events should overlap so the operator has to triage');
});

test('more dogs → more dog events; more pigeon flocks → more pigeon events; more orders → more conflicts and more events', () => {
  assert.ok(count(run({ dogs: 8 }), 'dog') > count(run({ dogs: 0 }), 'dog'));
  assert.equal(count(run({ dogs: 0 }), 'dog'), 0);
  assert.equal(count(run({ flocks: 0 }), 'pigeon'), 0);
  assert.ok(count(run({ flocks: 6 }), 'pigeon') > count(run({ flocks: 0 }), 'pigeon'));
  assert.ok(count(run({ pedestrians: 12 }), 'ped') >= count(run({ pedestrians: 0 }), 'ped') && count(run({ pedestrians: 0 }), 'ped') === 0);
  const few = run({ orders: 9 }), many = run({ orders: 60 });
  assert.ok(count(many, 'conflict') > count(few, 'conflict'));
  assert.ok(many.state.events.length > few.state.events.length);
  assert.equal(count(run({ gustPerMin: 0 }), 'gust'), 0);
  assert.ok(count(run({ gustPerMin: 6 }), 'gust') > count(run({ gustPerMin: 0.5 }), 'gust'));
  assert.ok(count(run({ replyPct: 0 }), 'silent') > count(run({ replyPct: 100 }), 'silent'));
  assert.equal(count(run({ replyPct: 100 }), 'silent'), 0);
});

test('city preset changes the event mix: low-rise → more dogs and cars, high-rise → more gust trouble', () => {
  const seeds = [1, 2, 3, 4];
  const sum = (p, types, over) => seeds.reduce((n, seed) => n + types.reduce((m, ty) => m + count(run({ preset: p, seed, orders: 40, radiusM: 300, ...over }, {}, 600), ty), 0), 0);
  assert.ok(sum('low', ['dog', 'car'], { dogs: 8 }) > sum('high', ['dog', 'car'], { dogs: 8 }), 'low-rise should see more dogs and cars');
  assert.ok(sum('high', ['gust'], { gustPerMin: 5 }) > sum('low', ['gust'], { gustPerMin: 5 }), 'high-rise should see more gust trouble');
});

test('Retained memory speeds up repeat deliveries; Fresh forgets', () => {
  const quiet = { flocks: 0, pedestrians: 0, dogs: 0, gustPerMin: 0, replyPct: 100, orders: 30, radiusM: 200 };
  const mem = {};
  const first = run({ ...quiet, memory: 'retained' }, mem);
  assert.ok(Object.keys(mem.landmarks).length > 5, 'the first run should learn landmarks');
  const again = run({ ...quiet, memory: 'retained' }, mem);
  const fresh = run({ ...quiet, memory: 'fresh' }, mem);
  const a = again.scorecard().avgLocateS, f = fresh.scorecard().avgLocateS, one = first.scorecard().avgLocateS;
  assert.ok(a < f - 0.2, `locating: retained ${a} s vs fresh ${f} s`);
  assert.ok(a < one, `second retained run ${a} s vs first ${one} s`);
  assert.ok(Math.abs(f - one) < 0.5, 'a fresh run behaves like a first run');
});

test('scorecard: waiting time by tier, fleet time on hold, outcome shares, redeliveries, closest approach, load', () => {
  const w = runOp(make({ orders: 30 }), 900, 1.2);                                             // a quick operator
  const sc = w.scorecard();
  for (const k of ['wait', 'longestWaitS', 'holdSharePct', 'unanswered', 'autoHandled', 'delivered', 'deliveredAlt', 'aborted', 'redelivered', 'closestTier1M', 'eventsPerMin', 'peakQueue']) assert.ok(k in sc, k);
  assert.ok(Math.abs(sc.delivered + sc.deliveredAlt + sc.aborted - 100) <= 2);
  assert.ok(sc.eventsPerMin > 0 && sc.peakQueue >= 1);
  assert.ok(sc.wait[2] != null || sc.wait[3] != null);
  const slow = runOp(make({ orders: 30 }), 900, 25).scorecard(), idle = make({ orders: 30 }); idle.run(900);
  const ic = idle.scorecard();
  assert.ok(sc.holdSharePct < slow.holdSharePct && slow.holdSharePct < ic.holdSharePct, `${sc.holdSharePct} < ${slow.holdSharePct} < ${ic.holdSharePct}`);
  assert.ok(sc.score > slow.score && slow.score > ic.score, `${sc.score} > ${slow.score} > ${ic.score}`);
  assert.ok(w.state.completed > idle.state.completed * 2, 'an idle console stalls the fleet');
});

test('the board only exposes the v2 controls', () => {
  assert.deepEqual(BOARD.map((b) => b.key), ['orders', 'urgentPct', 'radiusM', 'flocks', 'pedestrians', 'dogs', 'replyPct', 'gustPerMin']);
  assert.equal(EVENT_TYPES.length, 9);
});

test('drones never fly through a building: every position of every drone stays outside every obstacle volume', () => {
  for (const preset of ['high', 'low', 'mixed']) {
    const w = make({ preset, orders: 40, urgentPct: 40 }); const obs = CITY[preset].obstacles; let steps = 0;
    for (let i = 0; i < 9000; i++) {
      w.step(0.1);
      for (const d of w.state.drones) {
        if (d.phase === 'idle') continue; steps++;
        const alt = d.y - 0.4;
        for (const o of obs) assert.ok(!(d.x > o.x0 && d.x < o.x1 && d.z > o.z0 && d.z < o.z1 && alt < o.h), `${preset}: ${d.id} inside ${o.id} (h ${o.h}) at t=${w.state.t.toFixed(1)} alt ${alt.toFixed(1)} phase ${d.phase}`);
      }
    }
    assert.ok(steps > 2000);
  }
});

test('drones follow planned polylines: a leg is up, over, down — never a diagonal climb through the neighbourhood', () => {
  const w = make({ orders: 12 }); let maxLow = 0;
  for (let i = 0; i < 4000; i++) { w.step(0.1); for (const d of w.state.drones) if (d.phase === 'enter' && d.y - 0.4 < 3) maxLow = Math.max(maxLow, Math.hypot(d.x - d.home.x, d.z - d.home.z)); }
  assert.ok(maxLow < 3, `a departing drone travelled ${maxLow.toFixed(1)} u horizontally below 15 m`);
});

test('drones never pass through a tree, lamp post or signal (low obstacles), and every drop / backup spot is clear of them', () => {
  for (const preset of ['high', 'low', 'mixed']) {
    const low = CITY[preset].low; assert.ok(low.length > 100, 'trees and lamps are exported with the city');
    const w = make({ preset, orders: 40, pedestrians: 8, dogs: 6 }); let steps = 0;
    for (const a of w.state.addresses) for (const p of [a, a.backup].filter(Boolean)) assert.ok(!low.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < t.r + 0.75), `${preset}: spot at ${p.x},${p.z} under a tree`);
    for (let i = 0; i < 9000; i++) {
      w.step(0.1); operate(w, 2);
      for (const d of w.state.drones) {
        if (d.phase === 'idle' || (d.phase === 'land' && d.y - 0.4 < 0.3)) continue; steps++;
        for (const t of low) assert.ok(!(Math.hypot(t.x - d.x, t.z - d.z) < t.r + 0.35 && d.y - 0.4 < t.h), `${preset}: ${d.id} in a ${t.kind} at t=${w.state.t.toFixed(1)} (${d.phase})`);
      }
    }
    assert.ok(steps > 2000);
  }
});

test('people and dogs never walk through buildings: walkers keep to the street lanes and only step into a front yard to reach a pad', () => {
  for (const preset of ['high', 'low', 'mixed']) {
    const obs = CITY[preset].obstacles, roads = CITY[preset].roads;
    const w = make({ preset, pedestrians: 12, dogs: 8 }); let moved = 0;
    const onLane = (p) => roads.some((r) => Math.abs(Math.abs(p.x - r) - 1.7) < 0.05 || Math.abs(Math.abs(p.z - r) - 1.7) < 0.05);
    const inYard = (p) => w.state.addresses.some((a) => Math.abs(p.x - a.x) < 0.05 && p.z >= a.z - 0.05 && p.z <= a.z + 3.6);
    const last = new Map();
    for (let i = 0; i < 6000; i++) {
      w.step(0.1); operate(w, 2);
      for (const a of [...w.state.agents.peds, ...w.state.agents.dogs]) assert.ok(!obs.some((o) => a.x > o.x0 && a.x < o.x1 && a.z > o.z0 && a.z < o.z1), `${preset}: ${a.id} inside a building at ${a.x.toFixed(1)},${a.z.toFixed(1)}`);
      for (const p of w.state.agents.peds) { const q = last.get(p.id); if (q && Math.hypot(q.x - p.x, q.z - p.z) > 1e-3) { moved++; assert.ok(onLane(p) || inYard(p), `${preset}: ${p.id} off the street at ${p.x.toFixed(2)},${p.z.toFixed(2)}`); } last.set(p.id, { x: p.x, z: p.z }); }
    }
    assert.ok(moved > 1000);
  }
});
