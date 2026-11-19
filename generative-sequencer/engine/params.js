'use strict';

// The exposed parameters. This list is the single source of truth: the Max
// patch generator builds its live.dial / live.numbox objects from it.
// Values are in display units (0-100 %, seed as an integer); generators read
// the normalised 0..1 copies in state.p.

const PARAMS = [
  { id: 'density', name: 'Density', type: 'float', min: 0, max: 100, default: 55, unit: '%',
    doc: 'How many notes play. 0 is silence; 100 plays every candidate of the current figure.' },
  { id: 'looseness', name: 'Looseness', type: 'float', min: 0, max: 100, default: 25, unit: '%',
    doc: 'Per-note timing scatter, and how often figures use triplets and quintuplets.' },
  { id: 'drift', name: 'Drift', type: 'float', min: 0, max: 100, default: 25, unit: '%',
    doc: 'Slow correlated timing drift: the ensemble rushes and drags, each lane pushes or pulls.' },
  { id: 'swing', name: 'Swing', type: 'float', min: 0, max: 100, default: 20, unit: '%',
    doc: 'Average swing (100 = triplet feel). The actual amount wanders over time.' },
  { id: 'breath', name: 'Breath', type: 'float', min: 0, max: 100, default: 40, unit: '%',
    doc: 'Depth of phrase-level density breathing: builds, thinning out and rests.' },
  { id: 'memory', name: 'Memory', type: 'float', min: 0, max: 100, default: 65, unit: '%',
    doc: 'How strongly the groove holds. 0 changes figure almost every bar; 100 locks it, varying only at phrase ends.' },
  { id: 'accent', name: 'Accent', type: 'float', min: 0, max: 100, default: 50, unit: '%',
    doc: 'Velocity contrast: metric emphasis depth and accent strength.' },
  { id: 'ghosts', name: 'Ghosts', type: 'float', min: 0, max: 100, default: 35, unit: '%',
    doc: 'Amount of ghost notes and flams.' },
  { id: 'seed', name: 'Seed', type: 'int', min: 0, max: 9999, default: 1, unit: '',
    doc: 'Random seed. Same seed and settings give the same performance.' },
  { id: 'mode', name: 'Mode', type: 'enum', options: ['Organic', 'Irregular', 'Mathematical', 'Physical'], min: 0, max: 3, default: 0, unit: '',
    doc: 'Pattern type. Organic: a drifting player with memory. Irregular: odd groupings (3+3+2...). Mathematical: Euclidean rhythms and polymeters. Physical: pendulums and bouncing balls.' },
];

const BY_ID = {};
for (const p of PARAMS) BY_ID[p.id] = p;

// Clamp to range; ints are rounded. Returns undefined for values that can't
// be interpreted (NaN, strings, objects) so callers can keep the old value.
function sanitize(id, value) {
  const spec = BY_ID[id];
  if (!spec) return undefined;
  if (spec.options && typeof value === 'string') {
    const i = spec.options.findIndex((o) => o.toLowerCase() === value.trim().toLowerCase());
    if (i >= 0) return i;
  }
  const v = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(v)) return undefined;
  const c = Math.min(spec.max, Math.max(spec.min, v));
  return spec.type === 'float' ? c : Math.round(c);
}

function defaults() {
  const out = {};
  for (const p of PARAMS) out[p.id] = p.default;
  return out;
}

// Display values -> what generators read (floats 0..1, seed as uint32).
function normalize(values) {
  const out = {};
  for (const p of PARAMS) {
    const v = values[p.id];
    out[p.id] = p.type === 'float' ? (v - p.min) / (p.max - p.min) : v >>> 0;
  }
  return out;
}

module.exports = { PARAMS, PARAM_IDS: PARAMS.map((p) => p.id), sanitize, defaults, normalize, paramSpec: (id) => BY_ID[id] };
