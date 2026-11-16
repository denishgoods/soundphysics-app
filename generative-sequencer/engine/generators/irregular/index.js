'use strict';

const { hash32, Rng } = require('../../prng');
const { ROLES } = require('../../lanes');
const { MAX_DEV, finishPlan, getPlan, generateFromPlans, laneDensity } = require('../shared');

// The "irregular" generator: odd groupings over a steady pulse.
//
// The bar is counted in units (16ths in x/4, 8ths in x/8) and a *grouping*
// splits a cycle of units into groups of 2, 3, 4 and occasionally 5 (e.g.
// 3+3+2, 3+3+3+3+2+2, 2+2+3). Accents and the kit follow the groups, not the
// bar: the kick takes group starts, the snare answers on alternate groups,
// hats accent every group start, perc plays pickups into the next group.
//
// A cycle can be longer or shorter than the bar (Looseness makes that more
// likely), so the pattern slides across the bar line and realigns at every
// phrase start. Memory decides how long a grouping holds: changes happen at
// phrase starts (back to an earlier grouping, a variation such as swapping
// 3+2 for 2+3, or a new one), and with low Memory also mid-phrase.
//
// The notes for a cycle position depend only on (seed, grouping, position),
// so a bar-aligned grouping repeats exactly; per-bar variation and fills sit
// on top, and all feel controls come from the shared renderer.

const SALT_PLAN = 0x1a2b;
const SALT_FIGURE = 0x3c4d;
const BANK_SIZE = 4;

function unitOf(meter) {
  return meter.den >= 8 ? meter.beatLen : 0.25;
}

function unitsPerBar(meter) {
  return Math.max(1, Math.round(meter.barLen / unitOf(meter)));
}

const SIZES = [2, 3, 4, 5];

function sizeWeight(s, looseness) {
  if (s === 3) return 4;
  if (s === 2) return 3;
  if (s === 4) return 0.8;
  return 0.15 + 0.8 * looseness;
}

// Group lengths filling one cycle. Avoids leaving a single unit and prefers
// groupings that contain at least one 3 or 5 (otherwise it's just 4/4).
function newGrouping(rng, U, looseness) {
  let cycle = U;
  if (U >= 6 && rng.chance(0.2 + 0.5 * looseness)) {
    const deltas = [-3, -2, -1, 1, 2, 3];
    cycle = Math.max(5, U + deltas[rng.int(deltas.length)]);
  } else if (U <= 8 && rng.chance(0.3)) {
    cycle = 2 * U;
  }
  let groups = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    groups = [];
    let rem = cycle;
    while (rem > 0) {
      const sizes = SIZES.filter((s) => s <= rem && rem - s !== 1);
      if (!sizes.length) {
        groups.push(rem);
        break;
      }
      const s = sizes[rng.weighted(sizes.map((x) => sizeWeight(x, looseness)))];
      groups.push(s);
      rem -= s;
    }
    if (groups.some((g) => g === 3 || g === 5)) break;
  }
  return groups;
}

// A recognisable variant: swap a neighbouring 3+2, split or merge 2s and 4s,
// trade 3+3 for 2+2+2, or rotate the cycle.
function varyGrouping(groups, rng) {
  const g = groups.slice();
  const op = rng.int(4);
  if (op === 0) {
    const idx = [];
    for (let i = 0; i + 1 < g.length; i++) if (g[i] !== g[i + 1]) idx.push(i);
    if (idx.length) {
      const i = idx[rng.int(idx.length)];
      const t = g[i];
      g[i] = g[i + 1];
      g[i + 1] = t;
      return g;
    }
  } else if (op === 1) {
    const fours = [];
    const pairs = [];
    for (let i = 0; i < g.length; i++) {
      if (g[i] === 4) fours.push(i);
      if (i + 1 < g.length && g[i] === 2 && g[i + 1] === 2) pairs.push(i);
    }
    if (fours.length || pairs.length) {
      if (fours.length && (!pairs.length || rng.chance(0.5))) {
        const i = fours[rng.int(fours.length)];
        g.splice(i, 1, 2, 2);
      } else {
        const i = pairs[rng.int(pairs.length)];
        g.splice(i, 2, 4);
      }
      return g;
    }
  } else if (op === 2) {
    for (let i = 0; i + 1 < g.length; i++) {
      if (g[i] === 3 && g[i + 1] === 3) {
        g.splice(i, 2, 2, 2, 2);
        return g;
      }
      if (i + 2 < g.length && g[i] === 2 && g[i + 1] === 2 && g[i + 2] === 2) {
        g.splice(i, 3, 3, 3);
        return g;
      }
    }
  }
  g.push(g.shift());
  return g;
}

function clampPos(pos, barLen) {
  return Math.min(barLen - 1e-6, Math.max(0, pos));
}

function noteId(figId, c, li, kind) {
  return hash32(SALT_FIGURE, figId, c, li * 4 + kind) >>> 1;
}

// The bar's candidates for a grouping at a given phase (cycle position of the
// bar's first unit). Per-position randomness is keyed by (figure, position),
// so the same position always yields the same notes.
function figureNotes(fig, phase, st) {
  const meter = st.meter;
  const unit = unitOf(meter);
  const U = unitsPerBar(meter);
  const groups = fig.groups;
  const starts = [];
  let cycle = 0;
  for (const g of groups) {
    starts.push(cycle);
    cycle += g;
  }
  const lanes = st.lanes;
  const looseness = st.p.looseness;
  const cand = lanes.map(() => ({ main: [], ghost: [] }));

  for (let i = 0; i < U; i++) {
    const c = (phase + i) % cycle;
    let gj = 0;
    while (gj + 1 < starts.length && starts[gj + 1] <= c) gj++;
    const off = c - starts[gj];
    const L = groups[gj];
    const isStart = off === 0;
    const cycleStart = c === 0;
    const r = new Rng(hash32(st.seed, SALT_FIGURE, fig.id, c));
    const base = i * unit;

    for (let li = 0; li < lanes.length; li++) {
      const roleId = lanes[li].role;
      const role = ROLES[roleId];
      const main = (imp, w) => {
        const disp = r.gauss() * looseness * 0.02;
        const accent = r.chance(role.accentP * (isStart ? 1 : 0.3)) ? r.range(0.5, 1) : 0;
        const flam = accent > 0 && role.flam > 0 && r.chance(role.flam);
        cand[li].main.push({
          imp: imp * r.range(0.9, 1.1),
          note: { id: noteId(fig.id, c, li, 0), lane: li, pos: clampPos(base + disp, meter.barLen), att: base, fam: 'main', kind: 'main', prio: 0, accent, flam, w },
        });
      };
      const ghost = (imp) => {
        cand[li].ghost.push({
          imp: imp * r.range(0.9, 1.1),
          note: { id: noteId(fig.id, c, li, 1), lane: li, pos: base, att: base, fam: 'main', kind: 'ghost', prio: 0, accent: 0, flam: false },
        });
      };
      if (roleId === 'anchor') {
        if (isStart) main(cycleStart ? 1 : gj % 2 === 0 ? (L >= 3 ? 0.75 : 0.55) : 0.3, cycleStart ? 1 : 0.85);
        else if (off === 2 && L >= 4) main(0.2, 0.5);
      } else if (roleId === 'backbeat') {
        if (isStart && gj % 2 === 1) main(0.9, 0.85);
        else if (isStart && !cycleStart) main(0.12, 0.7);
        else if (!isStart && off === L - 1) ghost(0.6);
        else if (!isStart && off === 1 && L >= 3) ghost(0.35);
      } else if (roleId === 'pulse') {
        main(isStart ? 0.95 : off % 2 === 0 ? 0.6 : 0.3, isStart ? 0.9 : off % 2 === 0 ? 0.45 : 0.25);
      } else if (!cycleStart) {
        if (off === L - 1 && L >= 3) main(0.6, 0.5);
        else if (off === 1 && L === 2) main(0.3, 0.5);
      }
    }
  }

  const out = [];
  for (let li = 0; li < lanes.length; li++) {
    const curve = ROLES[lanes[li].role].prioCurve;
    for (const [list, cv] of [
      [cand[li].main, curve],
      [cand[li].ghost, 1],
    ]) {
      const ranked = list.map((x, idx) => ({ x, idx })).sort((a, b) => b.x.imp - a.x.imp || a.idx - b.idx);
      ranked.forEach((e, rank) => {
        e.x.note.prio = Math.min(0.999, Math.max(0.001, Math.pow((rank + 0.5) / ranked.length, cv)));
        out.push(e.x.note);
      });
    }
  }
  return out;
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

// Phrase-end fill: a roll at half-unit spacing through the bar's last group.
function addFill(notes, info, rng, fig, phase, st) {
  if (!info.isLast) return notes;
  if (!rng.chance(0.2 + (info.shape === 'build' ? 0.35 : 0))) return notes;
  const lanes = st.lanes;
  let li = lanes.findIndex((l) => l.role === 'backbeat');
  if (li < 0) li = lanes.findIndex((l) => l.role === 'color');
  if (li < 0) return notes;
  const meter = st.meter;
  const unit = unitOf(meter);
  const U = unitsPerBar(meter);
  const spanEnd = meter.barLen * (1 - info.restInBar);
  const starts = [];
  let cycle = 0;
  for (const g of fig.groups) {
    starts.push(cycle);
    cycle += g;
  }
  let from = -1;
  for (let i = 0; i < U; i++) {
    if (i * unit >= spanEnd - 2 * unit) break;
    if (starts.indexOf((phase + i) % cycle) >= 0) from = i * unit;
  }
  if (from < 0) return notes;
  const step = unit / 2;
  const count = Math.round((spanEnd - from) / step);
  const prio = 0.2 + 0.4 * rng.float();
  const kept = notes.filter((n) => n.lane !== li || n.pos < from || n.pos >= spanEnd);
  for (let i = 0; i < count; i++) {
    const u = i / count;
    kept.push({ id: rng.int(0x7fffffff), lane: li, pos: from + i * step, att: from + i * step, fam: 'main', kind: 'fill', prio, accent: i === count - 1 ? 0.6 : 0, flam: false, fillProg: u });
  }
  return kept;
}

function store(g, groups) {
  const fig = { groups, id: g.nextId++ };
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
    store(g, newGrouping(rng, U, st.p.looseness));
    g.phase = 0;
  } else {
    const pChange = info.isFirst ? 0.85 * Math.pow(loose, 1.2) : 0.6 * Math.pow(loose, 2.5);
    if (rng.chance(pChange)) {
      const others = g.bank.filter((b) => b !== g.current);
      const r = rng.float();
      if (others.length && r < 0.3) g.current = others[rng.int(others.length)];
      else if (r < 0.3 + 0.7 * (0.4 + 0.6 * m)) store(g, varyGrouping(g.current.groups, rng));
      else store(g, newGrouping(rng, U, st.p.looseness));
      g.phase = 0;
    }
  }
  if (info.isFirst) g.phase = 0;
  const fig = g.current;
  const phase = g.phase;
  let cycle = 0;
  for (const x of fig.groups) cycle += x;

  let notes = figureNotes(fig, phase, st);
  if (info.isLast) notes = varyBar(notes, 0.12 + 0.35 * loose, rng);
  else if (!rng.chance(0.45 + 0.5 * m)) notes = varyBar(notes, 0.03 + 0.3 * loose, rng);
  notes = addFill(notes, info, rng, fig, phase, st);
  g.phase = (phase + U) % cycle;
  return { k, notes: finishPlan(notes), info, groups: fig.groups.slice(), phase };
}

const irregular = {
  id: 'irregular',
  maxDeviation: MAX_DEV + 0.09,

  init(state) {
    state.gen = { plans: new Map(), nextBar: 0, bank: [], current: null, phase: 0, nextId: 1 };
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
  newGrouping,
  varyGrouping,
};

module.exports = irregular;
