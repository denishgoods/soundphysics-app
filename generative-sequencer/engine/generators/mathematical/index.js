'use strict';

const { hash32, Rng } = require('../../prng');
const { ROLES } = require('../../lanes');
const { MAX_DEV, finishPlan, getPlan, generateFromPlans, laneDensity } = require('../shared');

// The "mathematical" generator: Euclidean rhythms and polymeters.
//
// Each lane plays E(k, n): k hits spread as evenly as possible over a cycle
// of n units (16ths in x/4, 8ths in x/8), rotated by r. Density sets k.
// Looseness gives lanes cycles other than the bar (13 against 16...), and
// since cycles keep running across bars from the start of the performance,
// lanes drift in and out of phase with each other and with the bar. Memory
// sets how long a configuration holds; changes happen at phrase starts
// (rotate a lane, add or drop a hit, change a cycle length, or a new set).
// Accents fall on each lane's cycle start.

const SALT_PLAN = 0x6a7b;
const SALT_STEP = 0x7c8d;
const BANK_SIZE = 4;

// Share of a lane's cycle that gets hits at Density 50 %-ish.
const HIT_SHARE = { anchor: 0.25, backbeat: 0.125, pulse: 0.6, color: 0.35 };
// How likely a lane gets its own cycle length (scaled by Looseness).
const POLY = { anchor: 0.1, backbeat: 0.15, pulse: 0.3, color: 0.6 };

function unitOf(meter) {
  return meter.den >= 8 ? meter.beatLen : 0.25;
}

function unitsPerBar(meter) {
  return Math.max(1, Math.round(meter.barLen / unitOf(meter)));
}

// Bresenham form of the Euclidean rhythm: step 0 is always a hit.
function euclid(k, n, step) {
  return Math.floor((step * k) / n) !== Math.floor(((step - 1) * k) / n);
}

function clampPos(pos, barLen) {
  return Math.min(barLen - 1e-6, Math.max(0, pos));
}

function newConfig(rng, U, looseness, lanes) {
  const out = [];
  for (const lane of lanes) {
    const role = lane.role;
    let n = U;
    if (U >= 4 && rng.chance(POLY[role] * (0.2 + 1.2 * looseness))) {
      const deltas = [-4, -3, -2, -1, 1, 2, 3, 4];
      n = Math.max(3, U + deltas[rng.int(deltas.length)]);
    }
    let r = 0;
    if (role === 'backbeat') r = n === U ? (n - Math.round(U / 4)) % n : rng.int(n);
    else if (role === 'pulse') r = rng.chance(0.5) ? 0 : rng.int(n);
    else if (role === 'color') r = rng.int(n);
    out.push({ n, r, kAdj: 0 });
  }
  return out;
}

// Small changes: rotate a lane, add or drop a hit, stretch or shrink a cycle.
function varyConfig(cfg, rng, lanes) {
  const c = cfg.map((x) => ({ n: x.n, r: x.r, kAdj: x.kAdj }));
  const movable = [];
  for (let i = 0; i < lanes.length; i++) if (lanes[i].role !== 'anchor') movable.push(i);
  const li = movable.length ? movable[rng.int(movable.length)] : rng.int(lanes.length);
  const op = rng.int(3);
  if (op === 0) {
    const d = [-2, -1, 1, 2][rng.int(4)];
    c[li].r = (((c[li].r + d) % c[li].n) + c[li].n) % c[li].n;
  } else if (op === 1) {
    c[li].kAdj = Math.max(-2, Math.min(2, c[li].kAdj + (rng.chance(0.5) ? 1 : -1)));
  } else {
    c[li].n = Math.max(3, c[li].n + (rng.chance(0.5) ? 1 : -1));
    c[li].r = c[li].r % c[li].n;
  }
  return c;
}

function laneK(role, n, density, kAdj) {
  const k = Math.round(n * HIT_SHARE[role] * (0.3 + 1.1 * density)) + kAdj;
  return Math.max(1, Math.min(n, k));
}

function varyBar(notes, amount, rng) {
  const out = [];
  for (const n of notes) {
    if (n.kind === 'main' && n.prio > 0.3 && rng.chance(0.22 * amount)) continue;
    if (n.kind === 'ghost' && rng.chance(0.3 * amount)) continue;
    const c = Object.assign({}, n);
    if (c.kind === 'main' && rng.chance(0.12 * amount)) c.accent = c.accent > 0 ? 0 : rng.range(0.5, 1);
    out.push(c);
  }
  return out;
}

// The bar's notes: for every lane, the units where its rotated Euclidean
// cycle has a hit. Per-step randomness is keyed by (configuration, lane,
// step), so a repeating cycle repeats exactly.
function barNotes(fig, k, st) {
  const meter = st.meter;
  const unit = unitOf(meter);
  const U = unitsPerBar(meter);
  const pulseUnits = Math.max(1, Math.round(meter.pulse / unit));
  const p = st.p;
  const out = [];
  for (let li = 0; li < st.lanes.length; li++) {
    const roleId = st.lanes[li].role;
    const role = ROLES[roleId];
    const { n, r, kAdj } = fig.cfg[li];
    const kk = laneK(roleId, n, p.density, kAdj);
    const hits = [];
    const ghosts = [];
    for (let i = 0; i < U; i++) {
      const step = (k * U + i + r) % n;
      if (!euclid(kk, n, step)) continue;
      const rs = new Rng(hash32(st.seed, SALT_STEP, fig.id, li, step));
      const imp = (step === 0 ? 1 : i === 0 ? 0.8 : 0.5) * rs.range(0.9, 1.1);
      const disp = rs.gauss() * p.looseness * 0.02;
      const accent = rs.chance(role.accentP * (step === 0 ? 1 : 0.3)) ? rs.range(0.5, 1) : 0;
      const flam = accent > 0 && role.flam > 0 && rs.chance(role.flam);
      const w = step === 0 ? 1 : i % pulseUnits === 0 ? 0.7 : 0.45;
      hits.push({
        imp,
        note: { id: hash32(SALT_STEP, fig.id, li, step) >>> 1, lane: li, pos: clampPos(i * unit + disp, meter.barLen), att: i * unit, fam: 'main', kind: 'main', prio: 0, accent, flam, w },
      });
      // a soft stroke just before each backbeat-lane hit
      if (roleId === 'backbeat' && i > 0) {
        const prev = (k * U + i - 1 + r) % n;
        if (!euclid(kk, n, prev)) {
          ghosts.push({ id: hash32(SALT_STEP, fig.id, li, step, 1) >>> 1, lane: li, pos: (i - 1) * unit, att: (i - 1) * unit, fam: 'main', kind: 'ghost', prio: 0, accent: 0, flam: false });
        }
      }
    }
    const ranked = hits.map((h, idx) => ({ h, idx })).sort((a, b) => b.h.imp - a.h.imp || a.idx - b.idx);
    ranked.forEach((e, rank) => {
      // Scaled by Density so every hit plays at full breath; breathing then
      // drops the least important first.
      e.h.note.prio = ((rank + 0.5) / ranked.length) * p.density + 1e-6;
      out.push(e.h.note);
    });
    ghosts.forEach((g, rank) => {
      g.prio = (rank + 0.5) / ghosts.length;
      out.push(g);
    });
  }
  return out;
}

// Phrase-end fill: a denser Euclidean figure on the snare over the last two
// pulses.
function addFill(notes, info, rng, st) {
  if (!info.isLast) return notes;
  if (!rng.chance(0.2 + (info.shape === 'build' ? 0.35 : 0))) return notes;
  const li = st.lanes.findIndex((l) => l.role === 'backbeat');
  if (li < 0) return notes;
  const meter = st.meter;
  const spanEnd = meter.barLen * (1 - info.restInBar);
  const spanLen = Math.min(spanEnd, 2 * meter.pulse);
  if (spanLen < meter.pulse * 0.99) return notes;
  const from = spanEnd - spanLen;
  const kf = 5 + rng.int(3);
  const prio = 0.2 + 0.4 * rng.float();
  const kept = notes.filter((n) => n.lane !== li || n.pos < from || n.pos >= spanEnd);
  for (let s = 0; s < 8; s++) {
    if (!euclid(kf, 8, s)) continue;
    const pos = from + (s * spanLen) / 8;
    kept.push({ id: rng.int(0x7fffffff), lane: li, pos, att: pos, fam: 'main', kind: 'fill', prio, accent: s === 0 ? 0.6 : 0, flam: false, fillProg: s / 8 });
  }
  return kept;
}

function store(g, cfg) {
  const fig = { cfg, id: g.nextId++ };
  g.bank.push(fig);
  if (g.bank.length > BANK_SIZE) g.bank.shift();
  g.current = fig;
  return fig;
}

function makePlan(k, st) {
  const g = st.gen;
  const rng = new Rng(hash32(st.seed, SALT_PLAN, k));
  const info = st.mods.breath.info(k);
  const m = st.p.memory;
  const loose = 1 - m;
  const U = unitsPerBar(st.meter);
  if (!g.current) {
    store(g, newConfig(rng, U, st.p.looseness, st.lanes));
  } else {
    const pChange = info.isFirst ? 0.85 * Math.pow(loose, 1.2) : 0.6 * Math.pow(loose, 2.5);
    if (rng.chance(pChange)) {
      const others = g.bank.filter((b) => b !== g.current);
      const r = rng.float();
      if (others.length && r < 0.3) g.current = others[rng.int(others.length)];
      else if (r < 0.3 + 0.7 * (0.4 + 0.6 * m)) store(g, varyConfig(g.current.cfg, rng, st.lanes));
      else store(g, newConfig(rng, U, st.p.looseness, st.lanes));
    }
  }
  let notes = barNotes(g.current, k, st);
  if (info.isLast) notes = varyBar(notes, 0.12 + 0.35 * loose, rng);
  else if (!rng.chance(0.45 + 0.5 * m)) notes = varyBar(notes, 0.03 + 0.3 * loose, rng);
  notes = addFill(notes, info, rng, st);
  return { k, notes: finishPlan(notes), info, cycles: g.current.cfg.map((c, li) => ({ n: c.n, r: c.r, k: laneK(st.lanes[li].role, c.n, st.p.density, c.kAdj) })) };
}

const mathematical = {
  id: 'mathematical',
  maxDeviation: MAX_DEV + 0.09,

  init(state) {
    state.gen = { plans: new Map(), nextBar: 0, bank: [], current: null, nextId: 1 };
  },

  reseed(state) {
    state.gen.bank = [];
    state.gen.current = null;
  },

  generate(start, end, state) {
    return generateFromPlans(start, end, state, makePlan);
  },

  debugPlan(k, state) {
    return getPlan(k, state, makePlan);
  },
  laneDensity,
  euclid,
};

module.exports = mathematical;
