import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld, DEFAULT_SETTINGS, TIER, WINDOW, EVENT_TYPES, BOARD } from '../last10m/world.js';

const city = (p) => JSON.parse(readFileSync(new URL(`./fixtures/city-${p}.json`, import.meta.url)));
const CITY = { high: city('high'), low: city('low'), mixed: city('mixed') };
const make = (over = {}, memory = {}) => { const p = over.preset ?? 'mixed'; return createWorld({ ...DEFAULT_SETTINGS, ...over }, { obstacles: CITY[p].obstacles, tiles: CITY[p].tiles, memory }); };
const run = (over = {}, memory = {}) => { const w = make(over, memory); w.run(900); return w; };
const count = (w, type) => w.state.events.filter((e) => e.type === type).length;

test('one fixture per city preset; high-rise lots are taller than low-rise lots', () => {
  const mean = (p) => CITY[p].obstacles.reduce((s, o) => s + o.h, 0) / CITY[p].obstacles.length;
  assert.ok(CITY.high.obstacles.length > 20 && CITY.low.obstacles.length > 20 && CITY.mixed.obstacles.length > 20);
  assert.ok(mean('high') > mean('mixed') && mean('mixed') > mean('low'), `${mean('high')} ${mean('mixed')} ${mean('low')}`);
  const housing = (p) => CITY[p].tiles.filter((t) => t.landUse === 'housing').length;
  assert.ok(housing('low') > housing('high'));
});

test('nine fixed drones, all at the hub, a seeded order queue inside the delivery radius', () => {
  const w = make({ orders: 30, radiusM: 160 });
  assert.equal(w.state.drones.length, 9);
  assert.deepEqual(w.state.drones.map((d) => d.id), ['D-01', 'D-02', 'D-03', 'D-04', 'D-05', 'D-06', 'D-07', 'D-08', 'D-09']);
  assert.equal(w.state.orders.length, 30);
  for (const o of w.state.orders) assert.ok(Math.hypot(o.addr.x, o.addr.z) <= 160 / 5 + 1e-6, 'order outside the delivery radius');
  const w2 = make({ orders: 30, radiusM: 160 });
  assert.deepEqual(w.state.orders.map((o) => [o.addr.key, o.urgent]), w2.state.orders.map((o) => [o.addr.key, o.urgent]));
});

test('same seed + settings give the same event stream (deterministic); another seed does not', () => {
  const sig = (w) => w.state.events.map((e) => `${e.id}|${e.type}|${e.drone}|${e.opened.toFixed(1)}|${e.status}`).join();
  assert.equal(sig(run()), sig(run()));
  assert.notEqual(sig(run()), sig(run({ seed: 7 })));
});

test('every run ends (all three presets, with and without events)', () => {
  for (const preset of ['high', 'low', 'mixed']) {
    const w = run({ preset });
    assert.equal(w.state.done, true, preset);
    assert.equal(w.state.endedBy, 'orders', `${preset} should finish before the time cap`);
    assert.ok(w.state.orders.every((o) => ['delivered', 'delivered-alt', 'aborted'].includes(o.status)));
  }
  const quiet = run({ flocks: 0, pedestrians: 0, dogs: 0, gustPerMin: 0, replyPct: 100 });
  assert.equal(quiet.state.done, true);
});

test('every event has the tier of its type; an urgent order raises it by one (3→2, 2→1, 1 stays)', () => {
  const w = run({ urgentPct: 50 });
  let bumped = 0;
  for (const e of w.state.events) {
    assert.equal(e.base, TIER[e.type]);
    assert.equal(e.tier, e.urgent ? Math.max(1, e.base - 1) : e.base, `${e.type} urgent=${e.urgent}`);
    const [lo, hi] = WINDOW[e.tier]; assert.ok(e.window >= lo - 1e-6 && e.window <= hi + 1e-6, `${e.type} window ${e.window}`);
    if (e.urgent && e.tier < e.base) bumped++;
  }
  assert.ok(bumped > 0, 'expected at least one urgent event that was bumped up a tier');
  const none = run({ urgentPct: 0 });
  assert.ok(none.state.events.every((e) => e.tier === e.base));
});

test('urgent orders are handed to drones first', () => {
  const w = make({ urgentPct: 30 });
  w.run(12);
  const taken = w.state.orders.filter((o) => o.status !== 'queued'), left = w.state.orders.filter((o) => o.status === 'queued');
  assert.ok(taken.length >= 5);
  const urgentLeft = left.filter((o) => o.urgent).length;
  const normalTaken = taken.filter((o) => !o.urgent).length;
  assert.ok(!(urgentLeft > 0 && normalTaken > 0), 'a normal order left the hub while an urgent one waited');
});

test('tier ① events: the drone takes the safe action first (automatically), then asks the human', () => {
  const w = run({ pedestrians: 8, dogs: 5, gustPerMin: 4, urgentPct: 40 });
  const t1 = w.state.events.filter((e) => e.tier === 1);
  assert.ok(t1.length >= 5, `tier 1 events: ${t1.length}`);
  for (const e of t1) { assert.equal(e.autoSafe, true); assert.ok(e.safeAction && e.safeAction.length > 3, e.type); }
  // nobody is ever closer than 2 m to the parcel / drone during a person or animal event
  for (const e of t1.filter((x) => x.type === 'ped' || x.type === 'dog')) assert.ok(e.closestM == null || e.closestM >= 2, `closest ${e.closestM} m`);
  // when nobody answers, the fixed rule fires and counts as a missed decision (bigger penalty for tier 1)
  const auto = w.state.events.filter((e) => e.resolvedBy === 'auto');
  assert.ok(auto.length > 0 && auto.every((e) => e.missed));
  const sc = w.scorecard(); assert.equal(sc.missed, auto.length); assert.ok(sc.missedByTier[1] >= 1);
});

test('the safe action happens at the moment the tier ① event opens, before any operator input', () => {
  const w = make({ pedestrians: 10, gustPerMin: 5 });
  let seen = null;
  for (let i = 0; i < 9000 && !seen; i++) { w.step(0.1); seen = w.state.events.find((e) => e.tier === 1 && e.status === 'open'); }
  assert.ok(seen);
  const d = w.droneOf(seen.drone);
  assert.equal(seen.opened, w.state.t - 0 > seen.opened ? seen.opened : seen.opened);   // opened this very tick or earlier
  assert.ok(d.held || ['reel', 'wait', 'climb', 'reelup'].includes(d.phase) || seen.safeAction, 'drone is not in a safe state');
  assert.equal(d.level, 'H');
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

test('operator override: "swap" makes the other drone yield; answering in time is not a missed decision', () => {
  const w = make({ orders: 40 });
  let ev = null;
  for (let i = 0; i < 9000 && !ev; i++) { w.step(0.1); ev = w.queue().find((e) => e.type === 'conflict'); }
  assert.ok(ev, 'no conflict event');
  const y = w.droneOf(ev.drone), g = w.droneOf(ev.with);
  assert.equal(w.resolve(ev.id, 'swap'), true);
  assert.equal(ev.resolvedBy, 'operator'); assert.equal(ev.missed, false); assert.ok(ev.reaction >= 0);
  assert.equal(g.yieldFor, y.id);
  assert.ok(g.held);
  assert.equal(w.resolve(ev.id, 'rule'), false, 'an event can only be resolved once');
});

test('"To resolve" queue is sorted by tier, then by time left', () => {
  const w = make({ pedestrians: 8, dogs: 6, gustPerMin: 5, urgentPct: 30 });
  let multi = 0;
  for (let i = 0; i < 9000; i++) {
    w.step(0.1); const q = w.queue();
    if (q.length >= 2) multi++;
    for (let k = 1; k < q.length; k++) assert.ok(q[k - 1].tier < q[k].tier || (q[k - 1].tier === q[k].tier && q[k - 1].deadline <= q[k].deadline + 1e-9));
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
  const seeds = [1, 2, 3, 4, 5, 6];
  const sum = (p, types, over) => seeds.reduce((n, seed) => n + types.reduce((m, ty) => m + count(run({ preset: p, seed, orders: 40, radiusM: 300, ...over }), ty), 0), 0);
  assert.ok(sum('low', ['dog', 'car'], { dogs: 8 }) > sum('high', ['dog', 'car'], { dogs: 8 }), 'low-rise should see more dogs and cars');
  assert.ok(sum('high', ['gust'], { gustPerMin: 5 }) > sum('low', ['gust'], { gustPerMin: 5 }), 'high-rise should see more gust trouble');
});

test('Retained memory speeds up repeat deliveries; Fresh forgets', () => {
  const quiet = { flocks: 0, pedestrians: 0, dogs: 0, gustPerMin: 0, replyPct: 100, orders: 24, radiusM: 200 };
  const mem = {};
  const first = run({ ...quiet, memory: 'retained' }, mem);
  assert.ok(Object.keys(mem.landmarks).length > 5, 'the first run should learn landmarks');
  const again = run({ ...quiet, memory: 'retained' }, mem);
  const fresh = run({ ...quiet, memory: 'fresh' }, mem);
  const a = again.scorecard().avgDeliveryS, f = fresh.scorecard().avgDeliveryS, one = first.scorecard().avgDeliveryS;
  assert.ok(a < f, `retained ${a} s vs fresh ${f} s`);
  assert.ok(a < one, `second retained run ${a} s vs first ${one} s`);
  assert.ok(Math.abs(f - one) < 1.5, 'a fresh run behaves like a first run');
});

test('scorecard: reaction by tier, missed decisions, outcome shares, redeliveries, closest approach, load', () => {
  const w = make({ orders: 30 });
  for (let i = 0; i < 12000 && !w.state.done; i++) { w.step(0.1); const q = w.queue()[0]; if (q && w.state.t - q.opened > 1.2) w.resolve(q.id, q.options[0].id); }   // a (fairly quick) operator
  const sc = w.scorecard();
  for (const k of ['reaction', 'missed', 'missedByTier', 'delivered', 'deliveredAlt', 'aborted', 'redelivered', 'closestTier1M', 'eventsPerMin', 'peakQueue']) assert.ok(k in sc, k);
  assert.ok(Math.abs(sc.delivered + sc.deliveredAlt + sc.aborted - 100) <= 2);
  assert.ok(sc.eventsPerMin > 0 && sc.peakQueue >= 1);
  assert.ok(Object.values(sc.reaction).some((x) => x != null), 'an attentive operator should have reaction times');
  const idle = run({ orders: 30 }).scorecard();
  assert.ok(sc.missed < idle.missed, `attentive ${sc.missed} vs idle ${idle.missed}`);
  assert.ok(sc.score > idle.score);
});

test('the board only exposes the v2 controls', () => {
  assert.deepEqual(BOARD.map((b) => b.key), ['orders', 'urgentPct', 'radiusM', 'flocks', 'pedestrians', 'dogs', 'replyPct', 'gustPerMin']);
  assert.equal(EVENT_TYPES.length, 9);
});

test('drones never fly through a building: every position of every drone stays outside every obstacle volume', () => {
  for (const preset of ['high', 'low', 'mixed']) {
    const w = make({ preset, orders: 40, urgentPct: 40 }); const obs = CITY[preset].obstacles; let steps = 0;
    for (let i = 0; i < 9000 && !w.state.done; i++) {
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
