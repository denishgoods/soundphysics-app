'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { E, makeEngine, generateCut, key } = require('./helpers/util');
const { Rng } = require('../engine/prng');

const BARS = 32;

test('determinism: same seed and params give identical events', () => {
  const a = makeEngine({ seed: 9 }).generate(0, BARS * 4);
  const b = makeEngine({ seed: 9 }).generate(0, BARS * 4);
  assert.ok(a.length > 200);
  assert.deepEqual(a, b);
});

test('determinism: reset() replays the same performance', () => {
  const eng = makeEngine({ seed: 4 });
  const first = eng.generate(0, 64);
  eng.generate(64, 200);
  eng.reset(0);
  assert.deepEqual(eng.generate(0, 64), first);
});

test('determinism: different seeds differ', () => {
  const a = makeEngine({ seed: 1 }).generate(0, 64).map(key);
  const b = makeEngine({ seed: 2 }).generate(0, 64).map(key);
  assert.notDeepEqual(a, b);
});

test('a performance starting at bar N equals one starting at 0, shifted', () => {
  // The player starts when the transport starts; only bar phase is kept.
  const a = makeEngine({ seed: 3, start: 0 }).generate(0, 32);
  const b = makeEngine({ seed: 3, start: 40 }).generate(40, 72);
  assert.equal(a.length, b.length);
  a.forEach((e, i) => {
    assert.equal(b[i].lane, e.lane);
    assert.equal(b[i].velocity, e.velocity);
    assert.ok(Math.abs(b[i].beat - 40 - e.beat) < 1e-9);
  });
});

test('seed change mid-performance changes later bars only', () => {
  const ref = makeEngine({ seed: 5 });
  const eng = makeEngine({ seed: 5 });
  const head = eng.generate(0, 16);
  assert.deepEqual(head, ref.generate(0, 16));
  eng.setParam('seed', 6);
  const tail = eng.generate(16, 64).map(key);
  assert.notDeepEqual(tail, ref.generate(16, 64).map(key));
});

test('events are well-formed and sorted', () => {
  for (const seed of [1, 2, 3, 77, 9999]) {
    const eng = makeEngine({ seed });
    const evs = eng.generate(0, BARS * 4);
    let last = -Infinity;
    for (const e of evs) {
      assert.deepEqual(Object.keys(e).sort(), ['beat', 'duration', 'lane', 'note', 'velocity']);
      assert.ok(Number.isFinite(e.beat) && e.beat >= last, 'sorted');
      last = e.beat;
      assert.ok(Number.isInteger(e.velocity) && e.velocity >= 1 && e.velocity <= 127);
      assert.ok(Number.isInteger(e.note) && e.note === eng.lanes[e.lane].note);
      assert.ok(e.duration > 0 && e.duration <= E.MAX_DURATION);
    }
  }
});

test('lanes never overlap themselves', () => {
  const eng = makeEngine({ seed: 8, params: { density: 100, ghosts: 100, looseness: 100, drift: 100 } });
  const evs = eng.generate(0, BARS * 4);
  const lastEnd = {};
  for (const e of evs) {
    if (lastEnd[e.lane] !== undefined) assert.ok(e.beat >= lastEnd[e.lane] - 1e-9, `lane ${e.lane} overlaps at ${e.beat}`);
    lastEnd[e.lane] = e.beat + e.duration;
  }
});

test('no step grid: positions are continuous, not 16th slots', () => {
  const evs = makeEngine({ seed: 2 }).generate(0, BARS * 4);
  const off = evs.filter((e) => Math.abs(e.beat * 4 - Math.round(e.beat * 4)) > 0.02);
  assert.ok(off.length > evs.length * 0.6, `${off.length}/${evs.length} off the 16th grid`);
  const distinct = new Set(evs.map((e) => (e.beat % 1).toFixed(3)));
  assert.ok(distinct.size > 100);
});

test('other meters work', () => {
  for (const [num, den] of [[3, 4], [6, 8], [7, 8], [5, 4]]) {
    const eng = E.createEngine({ meter: { num, den } });
    eng.reset(0);
    const evs = eng.generate(0, eng.meter.barLen * 16);
    assert.ok(evs.length > 40, `${num}/${den}: ${evs.length}`);
    for (const e of evs) assert.ok(e.velocity >= 1 && e.velocity <= 127);
  }
});

// --- windows -------------------------------------------------------------

function randomCuts(rng, start, end, mode) {
  const cuts = [];
  let x = start;
  for (;;) {
    let step;
    if (mode === 'tiny') step = rng.range(1e-6, 0.01);
    else if (mode === 'mixed') step = rng.chance(0.3) ? rng.range(1e-9, 1e-3) : rng.range(0.001, 1.7);
    else step = rng.range(0.01, 3);
    x += step;
    if (x >= end) break;
    cuts.push(x);
  }
  return cuts;
}

test('windows: any partition gives the same events, none duplicated or missed', () => {
  const rng = new Rng(99);
  const end = 24 * 4;
  for (const seed of [1, 2, 3]) {
    const whole = makeEngine({ seed }).generate(0, end).map(key);
    for (const mode of ['tiny', 'mixed', 'coarse']) {
      const eng = makeEngine({ seed });
      const cuts = randomCuts(rng, 0, end, mode);
      const parts = generateCut(eng, 0, end, cuts).map(key);
      assert.equal(parts.length, whole.length, `seed ${seed} ${mode}`);
      assert.deepEqual(parts, whole, `seed ${seed} ${mode}`);
    }
  }
});

test('windows: cuts exactly at bar lines, beats and event times', () => {
  const end = 16 * 4;
  const whole = makeEngine({ seed: 12 }).generate(0, end);
  const cuts = [];
  for (let b = 0.25; b < end; b += 0.25) cuts.push(b);
  for (const e of whole) if (e.beat > 0 && e.beat < end) cuts.push(e.beat);
  const uniq = Array.from(new Set(cuts)).sort((a, b) => a - b);
  const eng = makeEngine({ seed: 12 });
  // every window is half-open and only returns its own events
  let a = 0;
  const parts = [];
  for (const c of uniq.concat([end])) {
    const w = eng.generate(a, c);
    for (const e of w) assert.ok(e.beat >= a && e.beat < c, `event ${e.beat} outside [${a}, ${c})`);
    parts.push(...w);
    a = c;
  }
  assert.deepEqual(parts.map(key), whole.map(key));
});

test('windows: moving knobs between windows never duplicates or drops', () => {
  const rng = new Rng(5);
  const eng = makeEngine({ seed: 21 });
  const ids = E.PARAM_IDS.filter((id) => id !== 'seed');
  const seen = new Set();
  let a = 0;
  let count = 0;
  const end = 48 * 4;
  while (a < end) {
    const b = Math.min(end, a + rng.range(0.001, 0.6));
    if (rng.chance(0.3)) eng.setParam(rng.pick(ids), rng.range(0, 100));
    for (const e of eng.generate(a, b)) {
      assert.ok(e.beat >= a && e.beat < b);
      const k = e.lane + ':' + e.beat;
      assert.ok(!seen.has(k), 'duplicate ' + k);
      seen.add(k);
      count++;
    }
    a = b;
  }
  assert.ok(count > 100);
});

test('windows: forward gap is a jump; re-query of recent past is stable', () => {
  const eng = makeEngine({ seed: 3 });
  eng.generate(0, 10);
  const after = eng.generate(14, 20);
  for (const e of after) assert.ok(e.beat >= 14 && e.beat < 20);
  // the timeline keeps the last few beats of returned events
  const again = eng.generate(17, 20);
  assert.deepEqual(again, after.filter((e) => e.beat >= 17));
});

test('reset mid-bar: notes aimed before the start are skipped, pulled-early ones play at the start', () => {
  const eng = makeEngine({ seed: 7, start: 5.5, params: { drift: 100 } });
  const evs = eng.generate(5.5, 12);
  assert.ok(evs.length > 0);
  for (const e of evs) assert.ok(e.beat >= 5.5);
  // same performance as from bar start, minus the notes before 5.5
  const full = makeEngine({ seed: 7, start: 4, params: { drift: 100 } }).generate(4, 12).filter((e) => e.beat >= 5.6);
  const tail = evs.filter((e) => e.beat >= 5.6);
  assert.deepEqual(tail.map(key), full.map(key));
});

// --- parameters -----------------------------------------------------------

test('params: clamped to range, junk ignored, ints rounded', () => {
  const eng = E.createEngine();
  assert.equal(eng.setParam('density', 250), true);
  assert.equal(eng.getParams().density, 100);
  eng.setParam('density', -3);
  assert.equal(eng.getParams().density, 0);
  assert.equal(eng.setParam('density', NaN), false);
  assert.equal(eng.setParam('density', 'abc'), false);
  assert.equal(eng.setParam('density', undefined), false);
  assert.equal(eng.getParams().density, 0);
  assert.equal(eng.setParam('nope', 1), false);
  eng.setParam('seed', 12.6);
  assert.equal(eng.getParams().seed, 13);
  eng.setParam('seed', 1e9);
  assert.equal(eng.getParams().seed, 9999);
  eng.setParam('swing', '40');
  assert.equal(eng.getParams().swing, 40);
  for (const p of E.PARAMS) {
    assert.ok(p.min < p.max && p.default >= p.min && p.default <= p.max, p.id);
  }
  assert.deepEqual(E.PARAM_IDS, ['density', 'looseness', 'drift', 'swing', 'breath', 'memory', 'accent', 'ghosts', 'seed', 'mode']);
  eng.setParam('mode', 7);
  assert.equal(eng.getParams().mode, 3);
  assert.equal(eng.mode, 'physical');
  assert.equal(eng.setParam('mode', 'Organic'), true);
  assert.equal(eng.mode, 'organic');
});

test('params: extremes always give valid output', () => {
  const corners = [
    {},
    Object.fromEntries(E.PARAM_IDS.map((id) => [id, 0])),
    Object.fromEntries(E.PARAM_IDS.map((id) => [id, id === 'seed' ? 9999 : 100])),
    { density: 100, looseness: 100, drift: 100, swing: 100, ghosts: 100, accent: 100, breath: 0, memory: 0 },
  ];
  for (const params of corners) {
    const eng = makeEngine({ params, bpm: 200 });
    for (const e of eng.generate(0, 64)) {
      assert.ok(Number.isFinite(e.beat) && e.beat >= 0 && e.beat < 64);
      assert.ok(e.velocity >= 1 && e.velocity <= 127);
      assert.ok(e.duration > 0);
    }
  }
});

test('params: Density 0 is silent and more density means more notes', () => {
  const count = (density) => makeEngine({ seed: 4, params: { density, breath: 0 } }).generate(0, 128).length;
  assert.equal(count(0), 0);
  const c = [10, 30, 55, 80, 100].map(count);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] > c[i - 1], c.join(' '));
});

test('params: Ghosts 0 removes ghosts and flams', () => {
  const soft = (ghosts) =>
    makeEngine({ seed: 4, params: { ghosts, accent: 100, breath: 0 } })
      .generate(0, 128)
      .filter((e) => e.velocity < 40).length;
  assert.ok(soft(0) < soft(100) / 4, `${soft(0)} vs ${soft(100)}`);
});

test('params: Swing delays off-beat eighths, leaves beats alone', () => {
  // Swing only changes timing, so the same seed gives the same notes.
  const params = (swing) => ({ swing, drift: 0, looseness: 0, ghosts: 0 });
  const straight = makeEngine({ seed: 6, params: params(0) }).generate(0, 128).filter((e) => e.lane === 2);
  const swung = makeEngine({ seed: 6, params: params(100) }).generate(0, 128).filter((e) => e.lane === 2);
  assert.equal(swung.length, straight.length);
  let offbeats = 0;
  straight.forEach((e, i) => {
    const frac = e.beat % 1;
    const s = swung[i].beat % 1;
    if (Math.abs(frac) < 1e-9) assert.ok(Math.abs(s) < 1e-9, 'beat moved');
    if (Math.abs(frac - 0.5) < 1e-9) {
      offbeats++;
      assert.ok(s > 0.55 && s <= 0.67 + 1e-9, 'offbeat at ' + s);
    }
  });
  assert.ok(offbeats > 20);
});

test('params: Drift 0 + Looseness 0 + Swing 0 lands main notes on their attractors', () => {
  const evs = makeEngine({ seed: 6, params: { swing: 0, drift: 0, looseness: 0 } }).generate(0, 128);
  const near = (x, p) => Math.abs(x / p - Math.round(x / p)) * p < 1e-9;
  const onAttractor = evs.filter((e) => near(e.beat, 0.25) || near(e.beat, 1 / 3) || near(e.beat, 1 / 6) || near(e.beat, 0.2) || near(e.beat, 0.125));
  // the rest are fills (free positions) and flam grace notes
  assert.ok(onAttractor.length > evs.length * 0.9, `${onAttractor.length}/${evs.length}`);
});

test('params: Memory controls how much bars repeat', () => {
  const similarity = (memory) => {
    const eng = makeEngine({ seed: 10, params: { memory } });
    const plans = [];
    for (let k = 0; k < 64; k++) plans.push(eng.generator.debugPlan(k, eng.state).notes.filter((n) => n.kind === 'main'));
    let same = 0;
    let total = 0;
    for (let k = 1; k < plans.length; k++) {
      for (const n of plans[k]) {
        total++;
        if (plans[k - 1].some((m) => m.lane === n.lane && Math.abs(m.pos - n.pos) < 0.03)) same++;
      }
    }
    return same / total;
  };
  const lo = similarity(0);
  const mid = similarity(60);
  const hi = similarity(100);
  assert.ok(lo < mid && mid < hi, `${lo} ${mid} ${hi}`);
  assert.ok(hi > 0.9, 'memory 100 repeats: ' + hi);
});

test('params: Accent widens velocity contrast', () => {
  const spread = (accent) => {
    const v = makeEngine({ seed: 3, params: { accent, ghosts: 0, breath: 0 } })
      .generate(0, 128)
      .map((e) => e.velocity);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  };
  assert.ok(spread(100) > spread(0) * 1.3, `${spread(0)} -> ${spread(100)}`);
});

test('params: Breath makes density vary more between bars', () => {
  const barSpread = (breath) => {
    const evs = makeEngine({ seed: 2, params: { breath, memory: 100 } }).generate(0, 64 * 4);
    const c = new Array(64).fill(0);
    evs.forEach((e) => c[Math.min(63, Math.floor(e.beat / 4))]++);
    const mean = c.reduce((a, b) => a + b, 0) / c.length;
    return Math.sqrt(c.reduce((a, b) => a + (b - mean) ** 2, 0) / c.length);
  };
  assert.ok(barSpread(100) > barSpread(0) * 1.5, `${barSpread(0)} -> ${barSpread(100)}`);
});

// --- groove: guards against tuning drifting back to "too random" ---------

function barStats(params, seeds) {
  let sim = 0;
  let pairs = 0;
  let repeats = 0;
  let backbeats = 0;
  let bars = 0;
  for (const seed of seeds) {
    const evs = makeEngine({ seed, params }).generate(0, 32 * 4);
    const byBar = Array.from({ length: 32 }, () => []);
    for (const e of evs) byBar[Math.min(31, Math.floor((e.beat + 0.1) / 4))].push(e);
    for (let k = 0; k < 32; k++) {
      const snare = byBar[k].filter((e) => e.lane === 1 && e.velocity > 60);
      const on = (b) => snare.some((e) => Math.abs(e.beat - (k * 4 + b)) < 0.08);
      bars++;
      if (on(1) && on(3)) backbeats++;
      if (k === 0) continue;
      const a = byBar[k - 1];
      const b = byBar[k];
      const match = (x, other, dk) => other.some((y) => y.lane === x.lane && Math.abs(y.beat - x.beat + dk * 4) < 0.06);
      const s = (b.filter((x) => match(x, a, 1)).length + a.filter((y) => match(y, b, -1)).length) / Math.max(1, a.length + b.length);
      sim += s;
      pairs++;
      if (s > 0.95) repeats++;
    }
  }
  return { similarity: sim / pairs, repeats: repeats / pairs, backbeats: backbeats / bars };
}

test('groove: at default settings most bars repeat, the figure holds', () => {
  const s = barStats({}, [1, 2, 3, 4, 5, 6]);
  assert.ok(s.similarity > 0.88, 'similarity ' + s.similarity);
  assert.ok(s.repeats > 0.4, 'repeats ' + s.repeats);
});

test('groove: Memory 100 without breathing locks the groove; Memory 0 does not', () => {
  const locked = barStats({ memory: 100, breath: 0 }, [1, 2, 3, 4]);
  const loose = barStats({ memory: 0, breath: 0 }, [1, 2, 3, 4]);
  assert.ok(locked.repeats > 0.8, 'locked ' + locked.repeats);
  assert.ok(loose.repeats < locked.repeats - 0.3, `memory 0 ${loose.repeats} vs 100 ${locked.repeats}`);
});

test('groove: backbeats survive thinning', () => {
  const s = barStats({ breath: 0, density: 30 }, [1, 2, 3, 4, 5, 6]);
  assert.ok(s.backbeats > 0.85, 'backbeats ' + s.backbeats);
});
