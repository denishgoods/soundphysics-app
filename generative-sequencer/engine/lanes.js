'use strict';

const { isOn, metricWeight } = require('./meter');

// A lane is one output voice (one drum-rack pad for now). Its role decides
// where it likes to play, how it is articulated and how it feels in time.
// Role profiles are shared by all generator modes; a mode decides what to do
// with them.

function nearestOddPulseDist(meter, pos) {
  let best = Infinity;
  const n = Math.round(meter.pulsesPerBar);
  for (let i = 1; i < n; i += 2) best = Math.min(best, Math.abs(pos - i * meter.pulse));
  return best;
}

function familyFactor(att, looseness, cross, odd) {
  if (att.family === 'cross') return cross * (0.15 + 1.4 * looseness);
  if (att.family === 'odd') return odd * 1.5 * looseness * looseness;
  return 1;
}

const ROLES = {
  // Kick-like: sparse, strongly metric, anticipates strong beats.
  anchor: {
    maxNotes: 6, minSpacing: 0.24, sharp: 2,
    velocity: 104, ghostVel: 50, ghostMax: 2,
    accentP: 0.3, flam: 0,
    bias: -0.02, duration: 0.25, breathSens: 0.9,
    pref(att, meter, looseness) {
      if (att.family !== 'main') return 0.05 * familyFactor(att, looseness, 1, 1);
      let s = Math.pow(att.weight, 2.2);
      const strong = meter.strong;
      if (isOn(att.pos + meter.pulse / 2, strong) && !isOn(att.pos, meter.pulse)) s += 0.28;
      else if (isOn(att.pos + meter.pulse / 4, strong) && !isOn(att.pos, meter.pulse / 2)) s += 0.2;
      return s;
    },
    ghostSlots(meter, mains) {
      // soft pickup a sixteenth before a strong kick
      return mains.filter((m) => m.prio < 0.5).map((m) => ({ pos: m.pos - meter.pulse / 4, weight: 1 }));
    },
    accentWeight(att) {
      return att.weight >= 0.8 ? 1.2 : 0.5;
    },
  },

  // Snare-like: backbeats, ghost notes around them, flams on accents.
  backbeat: {
    maxNotes: 4, minSpacing: 0.2, sharp: 3,
    velocity: 98, ghostVel: 30, ghostMax: 7,
    accentP: 0.4, flam: 0.4,
    bias: 0.025, duration: 0.2, breathSens: 1.0,
    pref(att, meter, looseness) {
      if (att.family !== 'main') return 0.06 * familyFactor(att, looseness, 1, 1);
      if (isOn(att.pos, meter.pulse)) {
        const idx = Math.round(att.pos / meter.pulse);
        const even = Math.round(meter.pulsesPerBar) % 2 === 0;
        if (even) return idx % 2 === 1 ? 1 : 0.05;
        return idx >= 1 ? 0.75 : 0.03;
      }
      return 0.05 + 0.08 * (1 - att.weight);
    },
    ghostSlots(meter) {
      return meter.attractors
        .filter((a) => a.family === 'main' && !isOn(a.pos, meter.pulse))
        .map((a) => {
          const d = nearestOddPulseDist(meter, a.pos) / 0.4;
          return { pos: a.pos, weight: (1 - a.weight) * 0.5 + 0.8 * Math.exp(-d * d) };
        });
    },
    accentWeight(att, meter) {
      return isOn(att.pos, meter.pulse) ? 1 : 0.3;
    },
  },

  // Hat-like: keeps time with subdivisions, swing shows most here.
  pulse: {
    maxNotes: 16, minSpacing: 0.2, sharp: 3.5,
    velocity: 80, ghostVel: 38, ghostMax: 4,
    accentP: 0.22, flam: 0,
    bias: 0.008, duration: 0.12, breathSens: 0.7,
    pref(att, meter, looseness) {
      if (att.family !== 'main') return 0.12 * familyFactor(att, looseness, 1, 0.25);
      if (isOn(att.pos, meter.pulse)) return 1;
      if (isOn(att.pos, meter.compound ? meter.pulse / 3 : meter.pulse / 2)) return 0.85;
      return 0.5;
    },
    ghostSlots(meter, mains) {
      // quiet 32nd-note pickups into a hat stroke
      return mains.filter((m) => m.prio < 0.6).map((m) => ({ pos: m.pos - meter.pulse / 8, weight: 1 }));
    },
    accentWeight(att, meter) {
      const off = isOn(att.pos, meter.pulse / 2) && !isOn(att.pos, meter.pulse);
      return off ? 1 : 0.3;
    },
  },

  // Percussion colour: syncopations, triplets, the occasional flam.
  color: {
    maxNotes: 4, minSpacing: 0.24, sharp: 1.2,
    velocity: 88, ghostVel: 42, ghostMax: 3,
    accentP: 0.35, flam: 0.25,
    bias: -0.015, duration: 0.2, breathSens: 1.2,
    pref(att, meter, looseness) {
      if (att.family !== 'main') return 0.4 * familyFactor(att, looseness, 1, 0.4);
      if (att.weight >= 0.8) return 0.02;
      let s = 0.15 + 0.75 * Math.pow(1 - att.weight, 1.3);
      if (isOn(att.pos, meter.pulse / 2) && !isOn(att.pos, meter.pulse)) s += 0.2;
      return s;
    },
    ghostSlots(meter) {
      return meter.attractors
        .filter((a) => a.family === 'main' && a.weight < 0.4)
        .map((a) => ({ pos: a.pos, weight: 1 - metricWeight(meter, a.pos) }));
    },
    accentWeight(att) {
      return att.weight < 0.5 ? 1 : 0.4;
    },
  },
};

const DEFAULT_LANES = [
  { name: 'Kick', note: 36, role: 'anchor', density: 1 },
  { name: 'Snare', note: 38, role: 'backbeat', density: 1 },
  { name: 'Hat', note: 42, role: 'pulse', density: 1 },
  { name: 'Perc', note: 37, role: 'color', density: 1 },
];

function normalizeLanes(lanes) {
  const src = Array.isArray(lanes) && lanes.length ? lanes : DEFAULT_LANES;
  return src.map((l, i) => {
    const note = Math.round(Number(l.note));
    const density = Number(l.density);
    return {
      name: String(l.name || 'Lane ' + (i + 1)),
      note: Number.isFinite(note) ? Math.min(127, Math.max(0, note)) : 36 + i,
      role: ROLES[l.role] ? l.role : 'color',
      density: Number.isFinite(density) ? Math.min(2, Math.max(0, density)) : 1,
    };
  });
}

module.exports = { ROLES, DEFAULT_LANES, normalizeLanes };
