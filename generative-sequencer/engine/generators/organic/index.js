'use strict';

const { hash32, Rng } = require('../../prng');
const { ROLES } = require('../../lanes');
const { metricWeight, swingWarp } = require('../../meter');
const { MotifMemory } = require('./motifs');

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
const SALT_RENDER = 0x4e7d;
const SALT_FLAM = 0xf1a3;
const MAX_DEV = 0.4;
const MAX_DUR = 0.5;

const SWING_NOISE = { octaves: 3, persistence: 0.5 };
const BIAS_NOISE = { octaves: 2, persistence: 0.5 };
const VEL_NOISE = { octaves: 3, persistence: 0.6 };

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

const KIND_ORDER = { main: 0, fill: 1, ghost: 2 };

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
  notes.sort((a, b) => a.pos - b.pos || a.lane - b.lane || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  notes.forEach((n, i) => {
    n.uid = i;
  });
  return { k, notes, info };
}

function getPlan(k, st) {
  const g = st.gen;
  while (g.nextBar <= k) {
    g.plans.set(g.nextBar, makePlan(g.nextBar, st));
    g.nextBar++;
  }
  for (const key of g.plans.keys()) if (key < k - 3) g.plans.delete(key);
  return g.plans.get(k);
}

// Effective density of a lane at performance time t (beats).
function laneDensity(st, role, lane, t) {
  const barPos = t / st.meter.barLen;
  const level = st.mods.breath.densityAt(barPos);
  const f = Math.max(0, 1 + (level - 1) * st.p.breath * role.breathSens);
  return { dl: clamp(st.p.density * f * lane.density, 0, 1), env: st.mods.breath.value(barPos) };
}

function render(c, k, barStart, st, out) {
  const p = st.p;
  const meter = st.meter;
  const lane = st.lanes[c.lane];
  const role = ROLES[lane.role];
  const mods = st.mods;
  const li = c.lane;
  const anchor = barStart + c.pos;
  const t = anchor - st.origin;
  const { dl, env } = laneDensity(st, role, lane, t);

  if (c.kind === 'main' && c.prio > dl) return;
  if (c.kind === 'ghost' && c.prio > p.ghosts * Math.min(1, dl * 2)) return;
  if (c.kind === 'fill' && c.prio > dl * 1.3) return;

  const r = new Rng(hash32(st.seed, SALT_RENDER, k, c.uid));

  // Timing. Swing wanders around the Swing setting; drift = ensemble drift
  // shared by all lanes + per-lane drift + the role's push/pull, which itself
  // wanders slowly. Jitter is the only uncorrelated part.
  let x = c.pos;
  if (c.fam === 'main') {
    const sw = p.swing * (1 + 0.45 * mods.noise('swing', 0, SWING_NOISE)(t / 8));
    x = swingWarp(meter, x, sw);
  }
  const drift =
    p.drift *
    (0.055 * mods.noise('ensemble', 0)(t / 6) +
      0.015 * mods.noise('drift', li)(t / 4) +
      role.bias +
      0.012 * mods.noise('bias', li, BIAS_NOISE)(t / 24));
  const jitter = p.looseness * 0.014 * r.gauss();
  const beat = anchor + clamp(x - c.pos + drift + jitter, -MAX_DEV, MAX_DEV);

  // Velocity: soft metric emphasis scaled by Accent, accents on top, ghosts
  // and fills on their own curves, then phrase dynamics and a slow wander.
  const A = p.accent;
  let v;
  if (c.kind === 'ghost') {
    v = role.ghostVel * (0.85 + 0.3 * r.float()) * (1 - 0.25 * A);
  } else if (c.kind === 'fill') {
    v = role.velocity * (0.45 + 0.5 * c.fillProg) * (1 + 0.2 * A * c.fillProg);
  } else {
    v = role.velocity * (1 + A * 0.55 * (metricWeight(meter, c.pos) - 0.45));
  }
  if (c.accent > 0) v += A * 26 * c.accent;
  v *= 1 + p.breath * 0.15 * (Math.min(env, 1.3) - 0.9);
  v += 7 * mods.noise('vel', li, VEL_NOISE)(t / 2) + 3 * (0.5 + p.looseness) * r.gauss();
  const velocity = clamp(Math.round(v), 1, 127);
  const duration = Math.min(MAX_DUR, role.duration * (c.kind === 'ghost' ? 0.6 : 1));
  out.push({ beat, lane: li, note: lane.note, velocity, duration });

  // Flam: a soft grace note 14-36 ms before the stroke. Whether a note flams
  // is a property of the note (and the Ghosts setting), not of the bar.
  if (c.flam && c.kind === 'main' && hash32(st.seed, SALT_FLAM, c.id) / 4294967296 < p.ghosts * 0.55) {
    const gap = Math.min(0.09, ((14 + 22 * r.float()) * st.bpm) / 60000);
    const gv = clamp(Math.round(velocity * (0.38 + 0.2 * r.float())), 1, 127);
    out.push({ beat: beat - gap, lane: li, note: lane.note, velocity: gv, duration: gap * 0.7 });
  }
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
    const out = [];
    const L = state.meter.barLen;
    const k0 = Math.max(0, Math.floor((start - state.origin) / L));
    const k1 = Math.floor((end - state.origin) / L);
    for (let k = k0; k <= k1; k++) {
      const plan = getPlan(k, state);
      const barStart = state.origin + k * L;
      for (const c of plan.notes) {
        const a = barStart + c.pos;
        if (a >= start && a < end) render(c, k, barStart, state, out);
      }
    }
    return out;
  },

  // For tests and the piano-roll view.
  debugPlan(k, state) {
    return getPlan(k, state);
  },
  laneDensity,
};

module.exports = organic;
