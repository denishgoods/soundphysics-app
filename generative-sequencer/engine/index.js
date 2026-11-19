'use strict';

// Public engine API. Pure JavaScript, no host dependencies: loads in Node
// (require) and in Max's [v8] (bundled by tools/build.js).
//
//   const engine = createEngine({ seed: 7, params: { density: 60 } });
//   engine.reset(0);
//   const events = engine.generate(0, 4); // [{ beat, lane, note, velocity, duration }]

const { PARAMS, PARAM_IDS, sanitize, defaults, normalize, paramSpec } = require('./params');
const { makeMeter } = require('./meter');
const { DEFAULT_LANES, ROLES, normalizeLanes } = require('./lanes');
const { createModulators } = require('./modulators');
const { GENERATORS, MODES, getGenerator } = require('./generators');
const { Timeline, MAX_DURATION, MIN_GAP } = require('./timeline');
const { LookaheadScheduler } = require('./scheduler');
const prng = require('./prng');
const noise = require('./modulators/noise');

const VERSION = '0.4.0';

function createEngine(options) {
  const opts = options || {};
  const values = defaults();
  if (opts.mode !== undefined) {
    const m = typeof opts.mode === 'string' ? MODES.indexOf(opts.mode) : opts.mode;
    if (m < 0 || !(m < MODES.length)) throw new Error('unknown generator mode: ' + opts.mode);
    values.mode = m;
  }
  if (opts.seed !== undefined) values.seed = sanitize('seed', opts.seed);
  if (opts.params) {
    for (const id of Object.keys(opts.params)) {
      const v = sanitize(id, opts.params[id]);
      if (v !== undefined) values[id] = v;
    }
  }
  if (opts.params && opts.params.mode !== undefined) {
    const m = sanitize('mode', opts.params.mode);
    if (m !== undefined) values.mode = m;
  }
  let generator = getGenerator(MODES[values.mode]);
  const meterIn = opts.meter || {};
  const state = {
    mode: generator.id,
    values,
    p: normalize(values),
    seed: values.seed,
    lanes: normalizeLanes(opts.lanes),
    meter: makeMeter(meterIn.num || 4, meterIn.den || 4),
    bpm: opts.bpm > 0 ? opts.bpm : 120,
    origin: 0,
    mods: createModulators(values.seed),
    gen: null,
  };
  let pendingMeter = null;
  const timeline = new Timeline(generator, state);

  function applyValue(id, v) {
    values[id] = v;
    state.p = normalize(values);
    if (id === 'seed' && v !== state.seed) {
      state.seed = v;
      state.mods = createModulators(v);
      if (generator.reseed) generator.reseed(state);
    }
    if (id === 'mode' && MODES[v] !== generator.id) {
      generator = getGenerator(MODES[v]);
      state.mode = generator.id;
      timeline.setGenerator(generator);
    }
  }

  return {
    VERSION,
    get mode() {
      return generator.id;
    },
    get generator() {
      return generator;
    },
    get lanes() {
      return state.lanes;
    },
    get meter() {
      return state.meter;
    },
    // Exposed for tests and the CLI views; hosts shouldn't need it.
    get state() {
      return state;
    },

    reset(startBeat) {
      if (pendingMeter) {
        state.meter = pendingMeter;
        pendingMeter = null;
      }
      timeline.reset(Number.isFinite(startBeat) ? startBeat : 0);
    },

    generate(startBeat, endBeat) {
      return timeline.generate(startBeat, endBeat);
    },

    // Returns true if the value was accepted (after clamping).
    setParam(id, value) {
      const v = sanitize(id, value);
      if (v === undefined) return false;
      applyValue(id, v);
      return true;
    },

    setParams(obj) {
      let ok = true;
      for (const id of Object.keys(obj || {})) ok = this.setParam(id, obj[id]) && ok;
      return ok;
    },

    getParams() {
      return Object.assign({}, values);
    },

    // Used for tempo-dependent musical constants (flam spacing). Timing in
    // events is always in beats.
    setTempo(bpm) {
      if (bpm > 0 && Number.isFinite(bpm)) state.bpm = bpm;
    },

    // Takes effect at the next reset(); a meter change mid-performance would
    // move every bar line.
    setMeter(num, den) {
      const m = makeMeter(num, den);
      if (m.key !== state.meter.key) pendingMeter = m;
      else pendingMeter = null;
    },
  };
}

module.exports = {
  VERSION,
  createEngine,
  PARAMS,
  PARAM_IDS,
  paramSpec,
  DEFAULT_LANES,
  ROLES,
  GENERATORS,
  MODES,
  MAX_DURATION,
  MIN_GAP,
  LookaheadScheduler,
  makeMeter,
  createModulators,
  prng,
  noise,
};
