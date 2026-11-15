'use strict';

// Generator modes. A mode is an object:
//
//   id            string
//   maxDeviation  largest |event.beat - anchor| it can produce, in beats
//   init(state)   fresh performance state (called on every reset)
//   reseed(state) optional: the seed changed while playing
//   generate(startBeat, endBeat, state) -> Event[]
//
// generate() is called on consecutive, non-overlapping anchor windows and
// must return the events anchored in [startBeat, endBeat). Event =
// { beat, lane, note, velocity, duration } with beat/duration in beats.
// Modes read shared modulators from state.mods and keep private state in
// state.gen. The Timeline turns this into the public, final-beat API.
//
// Planned: irregular, mathematical, physical.

const organic = require('./organic');

const GENERATORS = { organic };

function getGenerator(id) {
  const g = GENERATORS[id || 'organic'];
  if (!g) throw new Error('unknown generator mode: ' + id);
  return g;
}

module.exports = { GENERATORS, getGenerator };
