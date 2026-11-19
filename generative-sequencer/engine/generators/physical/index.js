'use strict';

const { hash32, Rng } = require('../../prng');
const { MAX_DEV, finishPlan, getPlan, generateFromPlans, laneDensity } = require('../shared');

// The "physical" generator: notes come from a small simulation that runs
// through the performance.
//
//   Pendulums (kick-like and hat-like lanes) swing with a period slightly
//   detuned from the beat and are pulled back towards it on every swing.
//   Memory sets how strongly they lock to the grid; with low Memory they
//   wander, slip and catch up. Looseness sets how far they are detuned. A
//   stroke far from the grid is softer.
//
//   Bouncing balls (snare-like and perc lanes) are dropped at positions
//   chosen per phrase (snare around the backbeats, perc on off-beats). Each
//   drop is a train of impacts whose spacing shrinks geometrically and whose
//   loudness fades: an accelerating roll. Density sets how many drops land.
//   Phrase ends get a big drop that rolls into the next phrase.
//
// The simulation state (next swing time, balls still bouncing) carries from
// bar to bar, so a roll started near the bar line finishes in the next bar.
// Swing does not apply: physics ignores the grid.

const SALT_PLAN = 0x8e9f;
const BANK_SIZE = 4;

function clampPos(pos, barLen) {
  return Math.min(barLen - 1e-6, Math.max(0, pos));
}

function isPendulum(role) {
  return role === 'anchor' || role === 'pulse';
}

// Each drop fires when its fixed draw u < p * (0.3 + 0.9 * density). The
// backbeat drops draw u from 0..BACK_U so at Density >= ~53 they always land
// (a uniform 0..1 draw left some seeds without a snare for whole phrases).
const BACK_U = 0.7;

// Per-phrase setup: pendulum detunes and the ball drops.
function newConfig(rng, st) {
  const meter = st.meter;
  const L = st.p.looseness;
  const lanes = [];
  for (const lane of st.lanes) {
    const role = lane.role;
    const c = { detune: 0, drops: [] };
    if (role === 'anchor') c.detune = (rng.float() * 2 - 1) * (0.005 + 0.06 * L);
    else if (role === 'pulse') c.detune = (rng.float() * 2 - 1) * (0.005 + 0.05 * L);
    else {
      const n = Math.max(1, Math.round(meter.pulsesPerBar));
      for (let j = 0; j < n; j++) {
        if (role === 'backbeat') {
          const back = j % 2 === 1 || n % 2 === 1;
          const strong = back && j > 0;
          c.drops.push({ at: j * meter.pulse, p: strong ? 0.9 : 0.15, interval: meter.pulse * rng.range(0.3, 0.7), e: rng.range(0.5, 0.75), u: rng.float() * (strong ? BACK_U : 1) });
        } else {
          c.drops.push({ at: j * meter.pulse + meter.pulse / 2, p: 0.35, interval: meter.pulse * rng.range(0.2, 0.45), e: rng.range(0.45, 0.65), u: rng.float() });
        }
      }
    }
    lanes.push(c);
  }
  return lanes;
}

// Nudge the setup: retune the pendulums a little, move one drop's timing.
function varyConfig(cfg, rng) {
  const c = cfg.map((x) => ({ detune: x.detune, drops: x.drops.map((d) => Object.assign({}, d)) }));
  for (const x of c) x.detune *= 1 + rng.gauss() * 0.3;
  const withDrops = [];
  for (let i = 0; i < c.length; i++) if (c[i].drops.length) withDrops.push(i);
  if (withDrops.length) {
    const lane = c[withDrops[rng.int(withDrops.length)]];
    const d = lane.drops[rng.int(lane.drops.length)];
    d.interval *= rng.range(0.8, 1.25);
    d.u = rng.float() * (d.p >= 0.9 ? BACK_U : 1);
  }
  return c;
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
  const meter = st.meter;
  const p = st.p;
  const rng = new Rng(hash32(st.seed, SALT_PLAN, k));
  const info = st.mods.breath.info(k);
  const m = p.memory;
  const loose = 1 - m;
  if (!g.current) {
    store(g, newConfig(rng, st));
  } else {
    const pChange = info.isFirst ? 0.85 * Math.pow(loose, 1.2) : 0.6 * Math.pow(loose, 2.5);
    if (rng.chance(pChange)) {
      const others = g.bank.filter((b) => b !== g.current);
      const r = rng.float();
      if (others.length && r < 0.3) g.current = others[rng.int(others.length)];
      else if (r < 0.3 + 0.7 * (0.4 + 0.6 * m)) store(g, varyConfig(g.current.cfg, rng));
      else store(g, newConfig(rng, st));
    }
  }
  const cfg = g.current.cfg;
  const barT = k * meter.barLen;
  const barEnd = barT + meter.barLen;
  const raw = st.lanes.map(() => []);

  // Pendulums.
  const lock = 0.1 + 0.85 * m;
  for (let li = 0; li < st.lanes.length; li++) {
    const role = st.lanes[li].role;
    if (!isPendulum(role)) continue;
    if (g.pend[li] === undefined) g.pend[li] = barT;
    let grid;
    if (role === 'anchor') grid = p.density < 0.35 ? 2 * meter.pulse : meter.pulse;
    else grid = p.density < 0.3 ? meter.pulse : meter.pulse / 2;
    let t = g.pend[li];
    while (t < barEnd) {
      const err = t - Math.round(t / grid) * grid;
      const off = Math.abs(err) / grid;
      let vel;
      if (role === 'anchor') vel = 1 - Math.min(0.6, off * 3);
      else {
        const onPulse = Math.abs(t - Math.round(t / meter.pulse) * meter.pulse) < grid * 0.25;
        vel = (onPulse ? 0.85 : 0.55) * (1 - Math.min(0.5, off * 2));
      }
      raw[li].push({ t, vel });
      let next = t + grid * (1 + cfg[li].detune) - lock * err;
      if (next < t + grid * 0.25) next = t + grid * 0.25;
      t = next;
    }
    g.pend[li] = t;
  }

  // New ball drops for this bar, then every ball still bouncing.
  for (let li = 0; li < st.lanes.length; li++) {
    for (const d of cfg[li].drops) {
      if (d.u < d.p * (0.3 + 0.9 * p.density)) g.balls.push({ lane: li, t: barT + d.at, interval: d.interval, e: d.e, vel: 1, j: 0 });
    }
  }
  if (info.isLast && rng.chance(0.4 + (info.shape === 'build' ? 0.3 : 0))) {
    const li = st.lanes.findIndex((l) => l.role === 'backbeat');
    if (li >= 0) {
      const at = meter.barLen * (1 - info.restInBar) - meter.pulse * rng.range(1, 2);
      if (at > 0) g.balls.push({ lane: li, t: barT + at, interval: meter.pulse * 0.5, e: 0.82, vel: 1, j: 0 });
    }
  }
  const alive = [];
  for (const b of g.balls) {
    let dead = false;
    while (b.t < barEnd) {
      raw[b.lane].push({ t: b.t, vel: b.vel });
      b.t += b.interval;
      b.interval *= b.e;
      b.vel *= Math.pow(b.e, 0.9);
      b.j++;
      if (b.interval < 0.035 || b.vel < 0.08 || b.j > 14) {
        dead = true;
        break;
      }
    }
    if (!dead) alive.push(b);
  }
  g.balls = alive;

  // Notes; louder strokes rank as more important for breathing.
  const notes = [];
  for (let li = 0; li < raw.length; li++) {
    const list = raw[li].filter((x) => x.t >= barT && x.t < barEnd);
    const ranked = list.map((x, idx) => ({ x, idx })).sort((a, b) => b.x.vel - a.x.vel || a.idx - b.idx);
    ranked.forEach((e, rank) => {
      const pos = clampPos(e.x.t - barT, meter.barLen);
      notes.push({
        id: g.nextNote++,
        lane: li,
        pos,
        att: pos,
        fam: 'free',
        kind: 'main',
        prio: ((rank + 0.5) / ranked.length) * p.density + 1e-6,
        accent: 0,
        flam: false,
        vel: e.x.vel,
      });
    });
  }
  return { k, notes: finishPlan(notes), info, balls: g.balls.length };
}

const physical = {
  id: 'physical',
  maxDeviation: MAX_DEV + 0.09,

  init(state) {
    state.gen = { plans: new Map(), nextBar: 0, bank: [], current: null, nextId: 1, nextNote: 1, pend: [], balls: [] };
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
};

module.exports = physical;
