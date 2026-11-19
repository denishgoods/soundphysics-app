'use strict';

// Mathematical and Physical modes.

const test = require('node:test');
const assert = require('node:assert/strict');
const { E, makeEngine, generateCut, key } = require('./helpers/util');
const { Rng } = require('../engine/prng');
const mathematical = require('../engine/generators/mathematical');

const eng = (mode, opts) => makeEngine(Object.assign({ mode }, opts));

test('Euclidean rhythms: classic patterns', () => {
  const pat = (k, n) => Array.from({ length: n }, (_, i) => (mathematical.euclid(k, n, i) ? 'x' : '.')).join('');
  assert.equal(pat(3, 8), 'x..x..x.');
  assert.equal(pat(4, 16), 'x...x...x...x...');
  // any rotation of the textbook form is the same rhythm
  const rotations = (x) => Array.from({ length: x.length }, (_, i) => x.slice(i) + x.slice(0, i));
  assert.ok(rotations('x.xx.xx.').includes(pat(5, 8)), pat(5, 8));
  for (let n = 1; n <= 24; n++) for (let k = 1; k <= n; k++) assert.equal(pat(k, n).split('x').length - 1, k);
});

for (const mode of ['mathematical', 'physical']) {
  test(`${mode}: deterministic, window-split invariant, valid at extremes, silent at Density 0`, () => {
    const rng = new Rng(11);
    for (const seed of [1, 2, 3]) {
      const whole = eng(mode, { seed }).generate(0, 96).map(key);
      assert.ok(whole.length > 150, `${mode} seed ${seed}: ${whole.length} events`);
      assert.deepEqual(eng(mode, { seed }).generate(0, 96).map(key), whole);
      const cuts = [];
      for (let x = rng.range(0, 0.4); x < 96; x += rng.range(0.001, 1.4)) cuts.push(x);
      assert.deepEqual(generateCut(eng(mode, { seed }), 0, 96, cuts).map(key), whole);
    }
    assert.equal(eng(mode, { params: { density: 0 } }).generate(0, 64).length, 0);
    for (const params of [{ density: 100, looseness: 100, drift: 100, memory: 0, breath: 100, ghosts: 100, accent: 100 }, { density: 5, memory: 100 }]) {
      for (const e of eng(mode, { seed: 4, params }).generate(0, 64)) {
        assert.ok(Number.isFinite(e.beat) && e.velocity >= 1 && e.velocity <= 127 && e.duration > 0);
      }
    }
    for (const [num, den] of [[3, 4], [7, 8], [6, 8], [5, 4]]) {
      const e = E.createEngine({ mode, meter: { num, den } });
      e.reset(0);
      assert.ok(e.generate(0, e.meter.barLen * 16).length > 20, `${mode} ${num}/${den}`);
    }
  });
}

test('mathematical: a lane with its own cycle length drifts against the bar', () => {
  for (let seed = 1; seed < 300; seed++) {
    const e = eng('mathematical', { seed, params: { looseness: 100, memory: 100 } });
    const cyc = e.generator.debugPlan(0, e.state).cycles;
    // a lane whose pattern period doesn't divide the bar shows up shifted
    // in the next bar, because its cycle keeps running
    const lanePos = (k, li) => e.generator.debugPlan(k, e.state).notes.filter((n) => n.lane === li && n.kind === 'main').map((n) => Math.round(n.att * 4)).join(',');
    for (let li = 0; li < cyc.length; li++) {
      if (cyc[li].n !== 16 && lanePos(0, li) !== lanePos(1, li)) return;
    }
  }
  assert.fail('no polymetric configuration found');
});

test('mathematical: Density adds hits, Memory 100 holds the configuration', () => {
  const count = (density) => eng('mathematical', { seed: 3, params: { density, breath: 0 } }).generate(0, 128).length;
  const c = [20, 50, 80, 100].map(count);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] > c[i - 1], c.join(' '));
  const e = eng('mathematical', { seed: 5, params: { memory: 100 } });
  const ids = new Set();
  for (let k = 0; k < 32; k++) ids.add(JSON.stringify(e.generator.debugPlan(k, e.state).cycles));
  assert.equal(ids.size, 1);
});

test('physical: snare balls roll faster and softer, then stop', () => {
  const e = eng('physical', { seed: 2, params: { drift: 0, looseness: 0, breath: 0, density: 70 } });
  const snare = e.generate(0, 64).filter((x) => x.lane === 1);
  // find a train: consecutive strokes with shrinking gaps
  let trains = 0;
  for (let i = 2; i < snare.length; i++) {
    const g1 = snare[i - 1].beat - snare[i - 2].beat;
    const g2 = snare[i].beat - snare[i - 1].beat;
    if (g1 < 0.6 && g2 < g1 * 0.95 && snare[i].velocity <= snare[i - 1].velocity + 3) trains++;
  }
  assert.ok(trains > 10, 'accelerating, fading strokes: ' + trains);
});

test('physical: Memory locks the pendulums to the grid', () => {
  const spread = (memory) => {
    const kicks = eng('physical', { seed: 6, params: { memory, looseness: 80, drift: 0, breath: 0, density: 60 } })
      .generate(0, 128)
      .filter((x) => x.lane === 0);
    return kicks.reduce((s, x) => s + Math.abs(x.beat - Math.round(x.beat)), 0) / kicks.length;
  };
  const locked = spread(100);
  const free = spread(0);
  assert.ok(locked < 0.02, 'locked ' + locked);
  assert.ok(free > locked * 2, `free ${free} vs locked ${locked}`);
});

test('physical: at default density every seed has a backbeat in every bar', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const eng = E.createEngine({ params: { mode: 'physical', seed } });
    eng.reset(0);
    const bars = new Set(eng.generate(0, 64).filter((e) => e.lane === 1).map((e) => Math.floor(e.beat / 4)));
    assert.equal(bars.size, 16, `seed ${seed}`);
  }
});

test('all four modes switch mid-performance without duplicates', () => {
  const e = makeEngine({ seed: 9 });
  const seen = new Set();
  const rng = new Rng(3);
  let a = 0;
  let n = 0;
  while (a < 200) {
    const b = a + rng.range(0.01, 0.9);
    if (rng.chance(0.06)) e.setParam('mode', rng.int(4));
    for (const x of e.generate(a, b)) {
      assert.ok(x.beat >= a && x.beat < b);
      const k = x.lane + ':' + x.beat;
      assert.ok(!seen.has(k));
      seen.add(k);
      n++;
    }
    a = b;
  }
  assert.ok(n > 300);
  assert.deepEqual(E.MODES, ['organic', 'irregular', 'mathematical', 'physical']);
});
