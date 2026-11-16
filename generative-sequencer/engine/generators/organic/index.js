'use strict';

const { hash32, Rng } = require('../../prng');
const { MotifMemory } = require('./motifs');
const { MAX_DEV, finishPlan, getPlan, generateFromPlans, laneDensity } = require('../shared');

// The "organic" generator: a player with a memory, a sense of phrase and an
// imperfect, drifting clock.
//
// Two stages:
//   plan    once per bar, in order: memory picks or invents a figure, phrase
//           ends may get a fill. Plans are stateful (memory evolves).
//   render  per note, stateless: density gating, swing, drift, jitter,
//           velocity and flams, all from modulators and hashed randomness
//           keyed by (seed, bar, note). Rendering a note never depends on
//           which window asked for it.
//
// generate(start, end, state) returns the events whose anchor (bar start +
// planned position) lies in [start, end). Each event's `beat` is its anchor
// plus swing and timing deviations, bounded by MAX_DEV.

const SALT_PLAN = 0x91a7;

// Fills: at a phrase end, a short roll on the snare (or perc) lane at a
// steady rate (16ths, 16th triplets or 8th triplets), bent slightly ahead or
// behind as a whole, with the odd stroke left out.
const FILL_RATES = [
  { div: 4, fam: 'main', weight: 3 },
  { div: 6, fam: 'cross', weight: 1.5 },
  { div: 3, fam: 'cross', weight: 1 },
];

function addFill(notes, info, rng, ctx) {
  if (!info.isLast) return notes;
  const pFill = 0.15 + (info.shape === 'build' ? 0.35 : 0);
  if (!rng.chance(pFill)) return notes;
  const { meter, lanes } = ctx;
  const byRole = (r) => lanes.findIndex((l) => l.role === r);
  let li = rng.chance(0.7) ? byRole('backbeat') : byRole('color');
  if (li < 0) li = byRole('backbeat') >= 0 ? byRole('backbeat') : byRole('color');
  if (li < 0) return notes;
  const spanEnd = meter.barLen * (1 - info.restInBar);
  const spanLen = Math.min(spanEnd, meter.pulse * (rng.chance(0.5) ? 1 : 2));
  if (spanLen < meter.pulse * 0.99) return notes;
  const spanStart = spanEnd - spanLen;
  const rate = FILL_RATES[rng.weighted(FILL_RATES.map((r) => r.weight))];
  const count = Math.round((spanLen / meter.pulse) * rate.div);
  const gamma = rng.range(0.93, 1.07);
  const kept = notes.filter((n) => n.lane !== li || n.pos < spanStart || n.pos >= spanEnd);
  const prio = 0.2 + 0.4 * rng.float();
  for (let i = 0; i < count; i++) {
    const u = i / count;
    if (i < count - 1 && i > 0 && rng.chance(0.15)) continue;
    kept.push({
      id: rng.int(0x7fffffff),
      lane: li,
      pos: spanStart + spanLen * Math.pow(u, gamma),
      att: spanStart + spanLen * u,
      fam: rate.fam,
      kind: 'fill',
      prio,
      accent: i === count - 1 ? 0.6 : 0,
      flam: false,
      fillProg: u,
    });
  }
  return kept;
}

function makePlan(k, st) {
  const rng = new Rng(hash32(st.seed, SALT_PLAN, k));
  const info = st.mods.breath.info(k);
  const ctx = { meter: st.meter, lanes: st.lanes, p: st.p };
  let notes = st.gen.memory.next(k, info, rng, ctx);
  notes = addFill(notes, info, rng, ctx);
  return { k, notes: finishPlan(notes), info };
}

const organic = {
  id: 'organic',
  maxDeviation: MAX_DEV + 0.09,

  init(state) {
    state.gen = { memory: new MotifMemory(), plans: new Map(), nextBar: 0 };
  },

  // Seed changed mid-performance: forget figures, keep the bar count.
  reseed(state) {
    state.gen.memory = new MotifMemory();
  },

  generate(start, end, state) {
    return generateFromPlans(start, end, state, makePlan);
  },

  // For tests and the piano-roll view.
  debugPlan(k, state) {
    return getPlan(k, state, makePlan);
  },
  laneDensity,
};

module.exports = organic;
