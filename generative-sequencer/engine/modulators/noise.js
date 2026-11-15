'use strict';

const { hash32 } = require('../prng');

// Smooth correlated noise for drift, swing and velocity wander.
//
// Each octave is a uniform cubic B-spline through random lattice values, so
// the curve is C2-continuous and stays inside the lattice's [-1, 1] range.
// Octaves at doubling frequencies are summed with a persistence factor:
// persistence 1 gives equal energy per octave (1/f, "pink"); 0.5 is closer
// to a random walk (1/f^2). Defaults sit between the two.
//
// Everything is a pure function of (seed, x), so any point can be evaluated
// in any order. That random access is what makes the generators independent
// of how the timeline is cut into windows.

function lattice(seed, i) {
  return hash32(seed, i) / 2147483648 - 1;
}

function bspline(seed, x) {
  const i = Math.floor(x);
  const t = x - i;
  const t2 = t * t;
  const t3 = t2 * t;
  const w0 = (1 - 3 * t + 3 * t2 - t3) / 6;
  const w1 = (3 * t3 - 6 * t2 + 4) / 6;
  const w2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
  const w3 = t3 / 6;
  return (
    w0 * lattice(seed, i - 1) +
    w1 * lattice(seed, i) +
    w2 * lattice(seed, i + 1) +
    w3 * lattice(seed, i + 2)
  );
}

// Standard deviation of one B-spline octave over iid U(-1,1) lattice values
// (sqrt(1/3) * ~0.69, averaged over the spline phase). Used to normalise.
const BSPLINE_SD = 0.4;

// Returns f(x) -> value in (-1, 1), sd ~0.45. `x` is in lattice units: one
// unit is the spacing of the coarsest octave.
function makeNoise(seed, opts) {
  const octaves = (opts && opts.octaves) || 4;
  const persistence = opts && opts.persistence !== undefined ? opts.persistence : 0.6;
  const seeds = [];
  const offsets = [];
  const amps = [];
  let sumSq = 0;
  for (let k = 0; k < octaves; k++) {
    seeds.push(hash32(seed, 0x5eed, k));
    // Offset each octave so lattice points of different octaves don't line up.
    offsets.push((hash32(seed, 0x0ff5, k) / 4294967296) * 1024);
    const a = Math.pow(persistence, k);
    amps.push(a);
    sumSq += a * a;
  }
  const norm = 1 / (Math.sqrt(sumSq) * BSPLINE_SD);
  return function noise(x) {
    let sum = 0;
    let f = 1;
    for (let k = 0; k < octaves; k++) {
      sum += amps[k] * bspline(seeds[k], x * f + offsets[k]);
      f *= 2;
    }
    return Math.tanh(sum * norm * 0.5);
  };
}

module.exports = { makeNoise, bspline };
