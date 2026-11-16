'use strict';

const { hash32, Rng } = require('../prng');
const { ROLES } = require('../lanes');
const { metricWeight, swingWarp } = require('../meter');

// Shared by generator modes: the bar-plan cache and per-note rendering
// (density gating, swing, drift, jitter, velocity, flams). A mode only
// decides which candidate notes a bar has; rendering is the same for all,
// so every mode gets the same feel controls.
//
// A candidate note may carry `w` (0..1), its emphasis; without it the soft
// metric weight of its position is used.

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

// Stable order for a bar's candidates; uid = index, used to key rendering.
function finishPlan(notes) {
  notes.sort((a, b) => a.pos - b.pos || a.lane - b.lane || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  notes.forEach((n, i) => {
    n.uid = i;
  });
  return notes;
}

// Plans are made once per bar, in bar order (modes keep state across bars).
function getPlan(k, st, makePlan) {
  const g = st.gen;
  while (g.nextBar <= k) {
    g.plans.set(g.nextBar, makePlan(g.nextBar, st));
    g.nextBar++;
  }
  for (const key of g.plans.keys()) if (key < k - 3) g.plans.delete(key);
  return g.plans.get(k);
}

// Events anchored in [start, end) from the bar plans.
function generateFromPlans(start, end, state, makePlan) {
  const out = [];
  const L = state.meter.barLen;
  const k0 = Math.max(0, Math.floor((start - state.origin) / L));
  const k1 = Math.floor((end - state.origin) / L);
  for (let k = k0; k <= k1; k++) {
    const plan = getPlan(k, state, makePlan);
    const barStart = state.origin + k * L;
    for (const c of plan.notes) {
      const a = barStart + c.pos;
      if (a >= start && a < end) render(c, k, barStart, state, out);
    }
  }
  return out;
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
    const w = c.w !== undefined ? c.w : metricWeight(meter, c.pos);
    v = role.velocity * (1 + A * 0.55 * (w - 0.45));
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


module.exports = { MAX_DEV, MAX_DUR, clamp, finishPlan, getPlan, generateFromPlans, laneDensity, render };
