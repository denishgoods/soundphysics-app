'use strict';

const { hash32 } = require('../prng');
const { makeNoise } = require('./noise');
const { BreathEnvelope } = require('./breath');

// Modulators are shared, seed-derived signals that generators read. They hold
// no performance state, so any generator mode can use them.
function createModulators(seed) {
  const cache = {};
  return {
    seed,
    breath: new BreathEnvelope(hash32(seed, 0xb2ea7)),
    // A named noise field, optionally per lane: noise('drift', 2)(t).
    noise(name, index, opts) {
      const key = name + ':' + (index | 0);
      if (!cache[key]) {
        let h = 0;
        for (let i = 0; i < name.length; i++) h = hash32(h, name.charCodeAt(i));
        cache[key] = makeNoise(hash32(seed, h, index | 0), opts);
      }
      return cache[key];
    },
  };
}

module.exports = { createModulators, makeNoise, BreathEnvelope };
