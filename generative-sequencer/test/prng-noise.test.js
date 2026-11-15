'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hash32, Rng } = require('../engine/prng');
const { makeNoise } = require('../engine/modulators/noise');
const { BreathEnvelope, REST_LEVEL } = require('../engine/modulators/breath');

test('hash32 is stable (golden values) and order-sensitive', () => {
  // Golden values pin the hash so performances stay reproducible across
  // versions and engines. Change them only on purpose.
  assert.equal(hash32(1), 3331601975);
  assert.equal(hash32(1, 2, 3), 322125251);
  assert.notEqual(hash32(1, 2), hash32(2, 1));
});

test('Rng: same seed, same stream; floats in [0,1); bounded gauss', () => {
  const a = new Rng(42);
  const b = new Rng(42);
  for (let i = 0; i < 1000; i++) assert.equal(a.float(), b.float());
  const r = new Rng(7);
  let sum = 0;
  for (let i = 0; i < 20000; i++) {
    const f = r.float();
    assert.ok(f >= 0 && f < 1);
    const g = r.gauss();
    assert.ok(Math.abs(g) <= 3.4642);
    sum += g;
  }
  assert.ok(Math.abs(sum / 20000) < 0.05);
  assert.notEqual(new Rng(1).float(), new Rng(2).float());
});

test('noise: deterministic, random-access, bounded', () => {
  const n1 = makeNoise(5);
  const n2 = makeNoise(5);
  const xs = [];
  for (let i = 0; i < 500; i++) xs.push(i * 0.137 - 20);
  const forward = xs.map(n1);
  const backward = xs.slice().reverse().map(n2).reverse();
  assert.deepEqual(forward, backward);
  for (const v of forward) assert.ok(v > -1 && v < 1);
  assert.notDeepEqual(forward, xs.map(makeNoise(6)));
});

test('noise is smooth and correlated, not white', () => {
  const n = makeNoise(11);
  const N = 4000;
  const v = [];
  for (let i = 0; i < N; i++) v.push(n(i * 0.01));
  let mean = 0;
  for (const x of v) mean += x / N;
  let varSum = 0;
  for (const x of v) varSum += (x - mean) ** 2;
  const sd = Math.sqrt(varSum / N);
  assert.ok(sd > 0.2 && sd < 0.7, 'sd ' + sd);
  const lagDiff = (lag) => {
    let s = 0;
    for (let i = lag; i < N; i++) s += Math.abs(v[i] - v[i - lag]);
    return s / (N - lag);
  };
  // adjacent samples are close; far samples are not
  assert.ok(lagDiff(1) < 0.05 * lagDiff(400), `${lagDiff(1)} vs ${lagDiff(400)}`);
  // continuity: no jumps between neighbours
  for (let i = 1; i < N; i++) assert.ok(Math.abs(v[i] - v[i - 1]) < 0.1);
});

test('breath envelope: deterministic phrases, rests, range', () => {
  const a = new BreathEnvelope(3);
  const b = new BreathEnvelope(3);
  let rests = 0;
  for (let x = 0; x < 64; x += 0.05) {
    const v = a.value(x);
    assert.equal(v, b.value(x));
    assert.ok(v >= REST_LEVEL - 1e-12 && v < 1.6, 'value ' + v);
  }
  for (let bar = 0; bar < 128; bar++) {
    const info = a.info(bar);
    assert.ok(info.barInPhrase >= 0 && info.barInPhrase < info.bars);
    assert.equal(info.isFirst, info.barInPhrase === 0);
    if (info.restInBar > 0) {
      rests++;
      assert.ok(info.isLast);
      assert.equal(a.value(bar + 0.999), REST_LEVEL);
    }
  }
  assert.ok(rests > 4, 'expected some rests, got ' + rests);
  // the performance always opens with a phrase start
  assert.equal(a.info(0).barInPhrase, 0);
});
