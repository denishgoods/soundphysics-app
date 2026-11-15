'use strict';

// Seeded randomness. Integer math only (Math.imul, >>>), so results are
// bit-identical in any JS engine.

function fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// murmur3_32 over a list of 32-bit integers. Used to derive independent,
// random-access streams: hash32(seed, SALT, bar, noteId).
function hash32() {
  let h = 0x9747b28c ^ arguments.length;
  for (let i = 0; i < arguments.length; i++) {
    let k = arguments[i] | 0;
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  return fmix32(h);
}

function hashFloat() {
  return hash32.apply(null, arguments) / 4294967296;
}

// Small fast PRNG (mulberry32) wrapped with the helpers the generators need.
class Rng {
  constructor(seed) {
    this.s = seed >>> 0;
  }

  float() {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) {
    return a + (b - a) * this.float();
  }

  int(n) {
    return Math.floor(this.float() * n);
  }

  chance(p) {
    return this.float() < p;
  }

  // Bounded approximately-normal value (Irwin-Hall, 4 uniforms): mean 0,
  // sd 1, hard limit +-3.46. Bounded tails keep timing deviations bounded.
  gauss() {
    return (this.float() + this.float() + this.float() + this.float() - 2) * 1.7320508075688772;
  }

  pick(arr) {
    return arr[this.int(arr.length)];
  }

  // Index chosen with probability proportional to weights[i].
  weighted(weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += Math.max(0, weights[i]);
    if (total <= 0) return this.int(weights.length);
    let r = this.float() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}

module.exports = { hash32, hashFloat, fmix32, Rng };
