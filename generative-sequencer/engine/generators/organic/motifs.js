'use strict';

const { ROLES } = require('../../lanes');

// Figures ("motifs") and the memory that brings them back.
//
// A motif is one bar of candidate notes for all lanes. Every candidate has a
// priority: at render time a lane plays the candidates whose priority is
// below its current density, so the same figure thins out or fills in as the
// density breathes, keeping its identity.
//
// Note fields:
//   lane  lane index
//   pos   position in the bar (beats, float). Already includes the player's
//         intentional displacement, which returns with the motif.
//   att   the attractor the note was aimed at
//   fam   'main' | 'cross' | 'odd' | 'free' (only 'main' gets swing)
//   kind  'main' | 'ghost' | 'fill'
//   prio  0..1, lower plays first
//   accent 0, or 0.5..1
//   flam  true if this accent may be flammed
//   id    stable identity, kept through variations

const BANK_SIZE = 4;

function clampPos(pos, barLen) {
  return Math.min(barLen - 1e-6, Math.max(0, pos));
}

// Weighted sampling without replacement (Efraimidis-Spirakis), skipping items
// closer than `spacing` to an already taken position. Consumes exactly one
// random number per item, so the stream doesn't depend on what gets picked.
function sample(rng, items, weightOf, count, spacing, taken) {
  const keyed = [];
  for (let i = 0; i < items.length; i++) {
    const u = rng.float();
    const w = weightOf(items[i]);
    if (w > 0) keyed.push({ item: items[i], key: Math.log(1 - u) / w, i });
  }
  keyed.sort((a, b) => b.key - a.key || a.i - b.i);
  const picked = [];
  const occupied = taken ? taken.slice() : [];
  for (let j = 0; j < keyed.length && picked.length < count; j++) {
    const pos = keyed[j].item.pos;
    let free = true;
    for (let o = 0; o < occupied.length; o++) {
      if (Math.abs(occupied[o] - pos) < spacing) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    picked.push(keyed[j].item);
    occupied.push(pos);
  }
  return picked;
}

function laneScale(meter) {
  return meter.barLen / 4;
}

// Priority from rank. `curve` > 1 pulls the first ranks towards 0, so a
// role's core notes (backbeats, downbeat kick) survive deep thinning.
function prioFor(rank, n, rng, curve) {
  const p = Math.pow((rank + 0.5 + rng.range(-0.15, 0.15)) / n, curve || 1);
  return Math.min(0.999, Math.max(0.001, p));
}

// Rank picked attractors by how idiomatic they are for the role (with a
// little randomness), so thinning drops the least important notes first.
function byImportance(items, scoreOf, rng) {
  return items
    .map((it, i) => ({ it, k: scoreOf(it) * rng.range(0.85, 1.15), i }))
    .sort((a, b) => b.k - a.k || a.i - b.i)
    .map((x) => x.it);
}

function makeMain(li, att, rank, n, rng, ctx) {
  const role = ROLES[ctx.lanes[li].role];
  const disp = rng.gauss() * ctx.p.looseness * 0.02 * (att.family === 'main' ? 1 : 0.6);
  const accent = rng.chance(role.accentP * role.accentWeight(att, ctx.meter)) ? rng.range(0.5, 1) : 0;
  const flam = accent > 0 && role.flam > 0 && rng.chance(role.flam);
  return {
    id: rng.int(0x7fffffff),
    lane: li,
    pos: clampPos(att.pos + disp, ctx.meter.barLen),
    att: att.pos,
    fam: att.family,
    kind: 'main',
    prio: prioFor(rank, n, rng, ROLES[ctx.lanes[li].role].prioCurve),
    accent,
    flam,
  };
}

function freshLane(li, rng, ctx) {
  const { meter, p } = ctx;
  const role = ROLES[ctx.lanes[li].role];
  const n = Math.max(1, Math.round(role.maxNotes * laneScale(meter)));
  const weight = (a) => Math.pow(role.pref(a, meter, p.looseness), role.sharp);
  const atts = sample(rng, meter.attractors, weight, n, role.minSpacing);
  const ranked = byImportance(atts, (a) => role.pref(a, meter, p.looseness), rng);
  const mains = ranked.map((a, r) => makeMain(li, a, r, n, rng, ctx));

  const out = mains.slice();
  const nGhost = Math.round(role.ghostMax * laneScale(meter));
  if (nGhost > 0) {
    const slots = role.ghostSlots(meter, mains).filter((s) => s.pos >= 0 && s.pos < meter.barLen);
    const picked = sample(rng, slots, (s) => Math.pow(s.weight, 1.5), nGhost, 0.11, mains.map((m) => m.pos));
    byImportance(picked, (s) => s.weight, rng).forEach((s, r) => {
      out.push({ id: rng.int(0x7fffffff), lane: li, pos: s.pos, att: s.pos, fam: 'main', kind: 'ghost', prio: prioFor(r, nGhost, rng), accent: 0, flam: false });
    });
  }
  return out;
}

function freshMotif(rng, ctx) {
  let notes = [];
  for (let li = 0; li < ctx.lanes.length; li++) notes = notes.concat(freshLane(li, rng, ctx));
  return dedupe(notes, ctx);
}

// Keep each lane playable: mains at least ~minSpacing apart (lower priority
// loses), ghosts clear of every other note in their lane.
function dedupe(notes, ctx) {
  const out = [];
  for (let li = 0; li < ctx.lanes.length; li++) {
    const role = ROLES[ctx.lanes[li].role];
    const lane = notes.filter((n) => n.lane === li);
    const kept = [];
    const ordered = lane
      .filter((n) => n.kind !== 'ghost')
      .sort((a, b) => a.prio - b.prio || a.pos - b.pos)
      .concat(lane.filter((n) => n.kind === 'ghost').sort((a, b) => a.prio - b.prio || a.pos - b.pos));
    for (const n of ordered) {
      const gap = n.kind === 'ghost' ? 0.1 : role.minSpacing * 0.8;
      if (kept.every((k) => Math.abs(k.pos - n.pos) >= gap)) kept.push(n);
    }
    for (const k of kept) out.push(k);
  }
  return out;
}

// A recognisable variant of a figure. `amount` 0..1: small amounts nudge
// timing and dynamics; larger ones drop, move and add notes.
function varyMotif(notes, amount, rng, ctx) {
  const { meter, p } = ctx;
  const out = [];
  for (const n of notes) {
    if (n.kind === 'fill') continue;
    if (n.kind === 'main' && n.prio > 0.3 && rng.chance(0.22 * amount)) continue;
    if (n.kind === 'ghost' && rng.chance(0.3 * amount)) continue;
    const role = ROLES[ctx.lanes[n.lane].role];
    const c = Object.assign({}, n);
    c.pos = clampPos(c.pos + rng.gauss() * amount * 0.03 * p.looseness, meter.barLen);
    if (c.kind === 'main' && rng.chance(0.12 * amount)) {
      c.accent = c.accent > 0 ? 0 : rng.range(0.5, 1);
      c.flam = c.accent > 0 && role.flam > 0 && rng.chance(role.flam);
    }
    if (c.kind === 'main' && rng.chance(0.1 * amount)) {
      const near = meter.attractors.filter((a) => Math.abs(a.pos - c.att) > 1e-6 && Math.abs(a.pos - c.att) <= 0.5);
      if (near.length) {
        const w = near.map((a) => Math.pow(role.pref(a, meter, p.looseness), role.sharp));
        const a = near[rng.weighted(w)];
        c.pos = clampPos(a.pos + (c.pos - c.att), meter.barLen);
        c.att = a.pos;
        c.fam = a.family;
      }
    }
    if (rng.chance(0.15 * amount)) c.prio = Math.min(0.999, Math.max(0.001, c.prio + rng.gauss() * 0.12));
    out.push(c);
  }
  const adds = Math.floor(amount * 1.5 + rng.float() * 0.8);
  for (let i = 0; i < adds; i++) {
    const li = rng.weighted(ctx.lanes.map((l) => ROLES[l.role].maxNotes));
    const role = ROLES[ctx.lanes[li].role];
    const taken = out.filter((n) => n.lane === li).map((n) => n.pos);
    const weight = (a) => Math.pow(role.pref(a, meter, p.looseness), role.sharp);
    const pick = sample(rng, meter.attractors, weight, 1, role.minSpacing, taken)[0];
    if (!pick) continue;
    const note = makeMain(li, pick, 0, 1, rng, ctx);
    note.prio = rng.range(0.35, 0.95);
    out.push(note);
  }
  return dedupe(out, ctx);
}

function copyNotes(notes) {
  return notes.map((n) => Object.assign({}, n));
}

// The player's memory: a small bank of figures with strengths. A figure holds
// for a whole phrase. Most bars replay it exactly (timing and velocity are
// still humanised at render time), some get a light variation, and the last
// bar of a phrase carries the bigger variation. Switching figure (back to an
// older one, a development of the current one, or a new idea) is decided at
// phrase starts; with low Memory it can also happen mid-phrase, and
// variations may overwrite the stored figure so it drifts.
class MotifMemory {
  constructor() {
    this.bank = [];
    this.current = null;
  }

  next(bar, info, rng, ctx) {
    const m = ctx.p.memory;
    const loose = 1 - m;
    for (const mo of this.bank) mo.strength *= 0.97;
    if (!this.bank.length) return copyNotes(this._store(freshMotif(rng, ctx), bar).notes);

    const pChange = info.isFirst ? 0.85 * Math.pow(loose, 1.2) : 0.6 * Math.pow(loose, 2.5);
    if (rng.chance(pChange)) {
      const others = this.bank.filter((b) => b !== this.current);
      const r = rng.float();
      if (others.length && r < 0.3) {
        this.current = others[rng.weighted(others.map((b) => b.strength))];
      } else if (r < 0.3 + 0.7 * (0.4 + 0.6 * m)) {
        this._store(varyMotif(this.current.notes, 0.35 + 0.4 * loose, rng, ctx), bar);
      } else {
        this._store(freshMotif(rng, ctx), bar);
      }
    }

    const motif = this.current;
    motif.strength += 1;
    motif.uses += 1;
    let amount;
    if (info.isLast) amount = 0.12 + 0.35 * loose;
    else if (rng.chance(0.45 + 0.5 * m)) amount = 0;
    else amount = 0.03 + 0.3 * loose;
    if (amount === 0) return copyNotes(motif.notes);
    const varied = varyMotif(motif.notes, amount, rng, ctx);
    if (!info.isLast && rng.chance(0.4 * loose * loose)) motif.notes = copyNotes(varied);
    return varied;
  }

  _store(notes, bar) {
    const motif = { notes: copyNotes(notes), strength: 1, born: bar, uses: 1 };
    this.bank.push(motif);
    if (this.bank.length > BANK_SIZE) {
      let weakest = -1;
      for (let i = 0; i < this.bank.length; i++) {
        if (this.bank[i] === motif || this.bank[i] === this.current) continue;
        if (weakest < 0 || this.bank[i].strength < this.bank[weakest].strength) weakest = i;
      }
      this.bank.splice(weakest, 1);
    }
    this.current = motif;
    return motif;
  }
}

module.exports = { MotifMemory, freshMotif, varyMotif, dedupe, sample, clampPos };
