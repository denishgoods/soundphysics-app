'use strict';

const { hash32, Rng } = require('../prng');
const { makeNoise } = require('./noise');

// Breathing envelope: slow density modulation organised in phrases.
//
// The performance is cut into phrases of 2, 4 or 8 bars. Each phrase has a
// shape (build, arch, steady, fade) and may end in a rest, a short stretch of
// near-silence before the next phrase comes back in on its downbeat. The
// value is a density multiplier around 1.0; the generator scales its depth
// with the Breath parameter, so at Breath 0 nothing breathes.
//
// The phrase plan depends only on the seed and is laid out in performance
// bars (bar 0 = where playback started), so every performance opens with a
// fresh phrase rather than in the middle of a rest.

const PHRASE_BARS = [2, 4, 8];
const PHRASE_BAR_WEIGHTS = [1, 3, 2];
const SHAPES = ['build', 'arch', 'steady', 'fade'];
const SHAPE_WEIGHTS = [3, 2, 1.5, 1.5];
const REST_FRACTIONS = [0.25, 0.5, 1]; // of a bar
const REST_LEVEL = 0.04;
const REST_FADE = 0.125; // bars of fade into a rest

function shapeValue(shape, u) {
  switch (shape) {
    case 'build':
      return 0.3 + 1.0 * Math.pow(u, 1.5);
    case 'arch':
      return 0.4 + 0.85 * Math.sin(Math.PI * u);
    case 'fade':
      return 1.25 - 0.85 * u;
    default:
      return 0.95 + 0.12 * Math.sin(2 * Math.PI * u);
  }
}

class BreathEnvelope {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.phrases = [];
    this.wobble = makeNoise(hash32(this.seed, 0xb4ea7), { octaves: 3, persistence: 0.5 });
  }

  _extend(bar) {
    while (true) {
      const last = this.phrases[this.phrases.length - 1];
      const start = last ? last.start + last.bars : 0;
      if (last && start > bar) return;
      const rng = new Rng(hash32(this.seed, 0x9e7a5e, this.phrases.length));
      const bars = PHRASE_BARS[rng.weighted(PHRASE_BAR_WEIGHTS)];
      const shape = SHAPES[rng.weighted(SHAPE_WEIGHTS)];
      const level = rng.range(0.85, 1.12);
      let rest = 0;
      if (rng.chance(bars > 2 ? 0.6 : 0.3)) rest = REST_FRACTIONS[rng.int(bars > 2 ? REST_FRACTIONS.length : 2)];
      this.phrases.push({ index: this.phrases.length, start, bars, shape, level, rest });
    }
  }

  phraseAt(bar) {
    const b = Math.max(0, Math.floor(bar));
    this._extend(b);
    let lo = 0;
    let hi = this.phrases.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.phrases[mid].start <= b) lo = mid;
      else hi = mid - 1;
    }
    return this.phrases[lo];
  }

  // Density multiplier at performance position `barPos` (in bars, float).
  value(barPos) {
    const x = Math.max(0, barPos);
    const ph = this.phraseAt(x);
    const local = x - ph.start;
    const active = ph.bars - ph.rest;
    const wob = 0.08 * this.wobble(x * 0.7);
    if (local >= active) return REST_LEVEL;
    const v = ph.level * shapeValue(ph.shape, local / active) + wob;
    // Fade into the rest so the drop-out isn't a hard edge.
    if (ph.rest > 0 && local > active - REST_FADE) {
      const f = (active - local) / REST_FADE;
      const s = 0.5 - 0.5 * Math.cos(Math.PI * f);
      return REST_LEVEL + (v - REST_LEVEL) * s;
    }
    return Math.max(REST_LEVEL, v);
  }

  // Phrase facts for a whole performance bar, used for bar-level decisions
  // (new ideas at phrase starts, fills at phrase ends).
  info(bar) {
    const ph = this.phraseAt(bar);
    const barInPhrase = Math.floor(bar) - ph.start;
    const isLast = barInPhrase === ph.bars - 1;
    return {
      index: ph.index,
      bars: ph.bars,
      barInPhrase,
      isFirst: barInPhrase === 0,
      isLast,
      shape: ph.shape,
      // Portion of this bar (in bars, 0..1) at its end that is resting.
      restInBar: isLast ? Math.min(1, ph.rest) : 0,
    };
  }
}

module.exports = { BreathEnvelope, REST_LEVEL };
