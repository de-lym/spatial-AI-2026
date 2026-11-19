import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createScene } from '../last10m/sim.js';
import { SCENES, DEFAULT_GLOBAL, sceneDefaults } from '../last10m/scenes.js';

const obstacles = JSON.parse(readFileSync(new URL('./fixtures/city-obstacles.json', import.meta.url)));
const byId = (id) => SCENES.find((s) => s.id === id);
const run = (id, over = {}, memory = {}) => { const sc = createScene(byId(id), { ...DEFAULT_GLOBAL, ...sceneDefaults(id), ...over }, { obstacles, memory }); sc.run(400); return sc; };

test('every scene ends within 400 simulated seconds', () => {
  for (const s of SCENES) assert.equal(run(s.id).state.done, true, s.id);
});

test('same seed and parameters give the same event log (deterministic)', () => {
  const a = run('B1').state.events.map((e) => e.time + e.code).join();
  const b = run('B1').state.events.map((e) => e.time + e.code).join();
  assert.equal(a, b);
});

test('A1: the dog interrupts the drop; with an authorized backup the drone redirects instead of asking', () => {
  const ask = run('A1');
  assert.ok(ask.state.events.some((e) => e.code === 'REEL_IN'));
  assert.ok(ask.state.events.some((e) => e.code === 'ASK_BACKUP'));
  const auto = run('A1', { backupAuthorized: 1 });
  assert.equal(auto.summary().outcome, 'delivered-alt');
  assert.ok(!auto.state.events.some((e) => e.code === 'ASK_BACKUP'));
});

test('A1: a dog that stays longer than the hover budget forces an abort and Distance to You grows', () => {
  const sc = run('A1', { dogStayS: 90, backupSpots: 0 });
  assert.equal(sc.summary().outcome, 'aborted');
  assert.ok(sc.summary().distanceM > 50);
});

test('A2: a car on the pad is static, so the drone does not wait — it goes straight to the backup', () => {
  const sc = run('A2');
  assert.equal(sc.summary().outcome, 'delivered-alt');
  assert.ok(!sc.state.events.some((e) => e.code === 'WAIT'));
});

test('A3: people crossing make the drone reel in; nobody gets within 2 m of the parcel column', () => {
  const sc = run('A3');
  assert.ok(sc.summary().intrusions >= 1);
  assert.ok(sc.summary().minClearM >= 0.5);
});

test('B2: the yield question is answered by the fixed rule when the operator does not reply', () => {
  const sc = run('B2');
  assert.ok(sc.state.events.some((e) => e.code === 'AUTO'));
  assert.equal(sc.summary().maxLevel, 'H');
});

test('B2: an operator answer resolves the conflict immediately', () => {
  const sc = createScene(byId('B2'), { ...DEFAULT_GLOBAL, ...sceneDefaults('B2') }, { obstacles });
  while (!sc.state.prompt && sc.state.t < 60) sc.step(0.1);
  assert.ok(sc.state.prompt);
  assert.equal(sc.command('yield-D-01'), true);
  assert.equal(sc.state.prompt, null);
  sc.run(300);
  assert.equal(sc.summary().decisionS[0] < 1, true);
});

test('B3: sustained wind above the limit aborts', () => {
  assert.equal(run('B3', { windMs: 13 }).summary().outcome, 'aborted');
  assert.equal(run('B3').summary().outcome, 'delivered');
});

test('C1: memory locates the pad but the drone still waits for the confetti before verifying', () => {
  const sc = run('C1');
  const occl = sc.state.events.find((e) => e.code === 'OCCLUDED'), ok = sc.state.events.find((e) => e.code === 'VERIFY_OK');
  assert.ok(occl && ok && ok.t > occl.t);
});

test('C2: a silent customer ends in an abort; a reply leads to a delivery', () => {
  assert.equal(run('C2').summary().outcome, 'aborted');
  assert.equal(run('C2', { replyS: 15 }).summary().outcome, 'delivered');
});

test('C3: the battery reserve forces a return', () => {
  assert.equal(run('C3').summary().outcome, 'aborted');
  assert.notEqual(run('C3', { crowdStayS: 0 }).summary().outcome, 'aborted');
});

test('retained memory makes the second run of a scene faster than a fresh one', () => {
  const memory = {};
  const first = run('B3', { memory: 'retained' }, memory).summary().t;
  const second = run('B3', { memory: 'retained' }, memory).summary().t;
  const fresh = run('B3', { memory: 'fresh' }, {}).summary().t;
  assert.ok(second < first, `${second} < ${first}`);
  assert.ok(second < fresh);
});

test('operator commands: hold freezes the drone, resume releases it', () => {
  const sc = createScene(byId('A2'), { ...DEFAULT_GLOBAL, ...sceneDefaults('A2') }, { obstacles });
  sc.run(3); sc.command('hold');
  const x = sc.state.drones[0].x; sc.run(3);
  assert.equal(sc.state.drones[0].x, x);
  sc.command('resume'); sc.run(1);
  assert.notEqual(sc.state.drones[0].x, x);
});
