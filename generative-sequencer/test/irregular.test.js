'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { E, makeEngine, generateCut, key } = require('./helpers/util');
const { Rng } = require('../engine/prng');
const irregular = require('../engine/generators/irregular');

const irr = (opts) => makeEngine(Object.assign({ mode: 'irregular' }, opts));

test('groupings: groups of 2-5 that fill the cycle, never a lone unit', () => {
  for (let s = 1; s <= 300; s++) {
    const rng = new Rng(s);
    for (const U of [16, 12, 7, 6, 20]) {
      const g = irregular.newGrouping(rng, U, (s % 10) / 10);
      const cycle = g.reduce((a, b) => a + b, 0);
      assert.ok(g.every((x) => x >= 2 && x <= 5), g.join('+'));
      assert.ok(cycle >= 5 && cycle <= 2 * U + 3, `cycle ${cycle} for ${U}`);
      const v = irregular.varyGrouping(g, rng);
      assert.equal(v.reduce((a, b) => a + b, 0), cycle, 'variation keeps the cycle length');
      assert.ok(v.every((x) => x >= 2 && x <= 5));
    }
  }
});

test('irregular: deterministic and window-split invariant', () => {
  const rng = new Rng(4);
  for (const seed of [1, 2, 3]) {
    const whole = irr({ seed }).generate(0, 96).map(key);
    assert.ok(whole.length > 200);
    assert.deepEqual(irr({ seed }).generate(0, 96).map(key), whole);
    const cuts = [];
    for (let x = rng.range(0, 0.5); x < 96; x += rng.range(0.001, 1.3)) cuts.push(x);
    assert.deepEqual(generateCut(irr({ seed }), 0, 96, cuts).map(key), whole);
  }
});

test('irregular: a bar-aligned grouping with Memory 100 repeats bar for bar', () => {
  // find a seed whose first grouping fills exactly one bar
  let seed = 1;
  for (;; seed++) {
    const e = irr({ seed, params: { memory: 100, breath: 0, looseness: 0 } });
    const p = e.generator.debugPlan(0, e.state);
    if (p.groups.reduce((a, b) => a + b, 0) === 16) break;
  }
  const e = irr({ seed, params: { memory: 100, breath: 0, looseness: 0, drift: 0, swing: 0 } });
  const plan = (k) => e.generator.debugPlan(k, e.state).notes.map((n) => `${n.lane}@${n.pos.toFixed(6)}:${n.kind}`).join(' ');
  let same = 0;
  for (let k = 1; k < 24; k++) if (plan(k) === plan(k - 1)) same++;
  assert.ok(same >= 16, `${same}/23 bars repeat`);
});

test('irregular: hat accents follow group starts, not the beat', () => {
  let starts = 0;
  let others = 0;
  let nS = 0;
  let nO = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const e = irr({ seed, params: { accent: 100, density: 100, breath: 0, drift: 0, looseness: 0, swing: 0, memory: 100 } });
    for (let k = 0; k < 8; k++) {
      const p = e.generator.debugPlan(k, e.state);
      const groupStarts = new Set();
      const cycle = p.groups.reduce((a, b) => a + b, 0);
      let acc = 0;
      for (const g of p.groups) {
        groupStarts.add(acc);
        acc += g;
      }
      for (const ev of e.generate(k * 4, k * 4 + 4)) {
        if (ev.lane !== 2) continue;
        const unit = Math.round((ev.beat - k * 4) / 0.25);
        if (groupStarts.has((p.phase + unit) % cycle)) {
          starts += ev.velocity;
          nS++;
        } else {
          others += ev.velocity;
          nO++;
        }
      }
    }
  }
  assert.ok(starts / nS > others / nO + 10, `group starts ${starts / nS} vs others ${others / nO}`);
});

test('irregular: a cycle longer than the bar slides, then realigns at the phrase start', () => {
  for (let seed = 1; seed < 400; seed++) {
    const e = irr({ seed, params: { looseness: 100, memory: 100 } });
    const p0 = e.generator.debugPlan(0, e.state);
    const cycle = p0.groups.reduce((a, b) => a + b, 0);
    if (cycle === 16) continue;
    const p1 = e.generator.debugPlan(1, e.state);
    if (p1.info.isFirst) continue;
    assert.equal(p1.phase, 16 % cycle, 'phase advances by one bar');
    for (let k = 1; k < 16; k++) {
      const p = e.generator.debugPlan(k, e.state);
      if (p.info.isFirst) assert.equal(p.phase, 0, 'realigned at phrase start');
    }
    return;
  }
  assert.fail('no across-the-bar grouping found');
});

test('irregular: extremes give valid output; Density 0 is silent; other meters work', () => {
  for (const params of [{ density: 0 }, { density: 100, looseness: 100, drift: 100, ghosts: 100, memory: 0, breath: 100 }]) {
    const evs = irr({ seed: 9, params }).generate(0, 64);
    if (params.density === 0) assert.equal(evs.length, 0);
    for (const e of evs) assert.ok(e.velocity >= 1 && e.velocity <= 127 && e.duration > 0 && Number.isFinite(e.beat));
  }
  for (const [num, den] of [[3, 4], [7, 8], [6, 8], [5, 4]]) {
    const e = E.createEngine({ mode: 'irregular', meter: { num, den } });
    e.reset(0);
    assert.ok(e.generate(0, e.meter.barLen * 16).length > 30, `${num}/${den}`);
  }
});

test('switching mode mid-performance never duplicates or drops at window edges', () => {
  const eng = makeEngine({ seed: 5 });
  const seen = new Set();
  let a = 0;
  let count = 0;
  const rng = new Rng(8);
  while (a < 160) {
    const b = a + rng.range(0.01, 0.9);
    if (rng.chance(0.05)) eng.setParam('mode', eng.getParams().mode ? 0 : 1);
    for (const e of eng.generate(a, b)) {
      assert.ok(e.beat >= a && e.beat < b);
      const k = e.lane + ':' + e.beat;
      assert.ok(!seen.has(k));
      seen.add(k);
      count++;
    }
    a = b;
  }
  assert.ok(count > 200);
  assert.equal(E.createEngine({ mode: 'irregular' }).mode, 'irregular');
  assert.equal(E.createEngine({ params: { mode: 'Irregular' } }).mode, 'irregular');
  assert.throws(() => E.createEngine({ mode: 'nope' }));
});
