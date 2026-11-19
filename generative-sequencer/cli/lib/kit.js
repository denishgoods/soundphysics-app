'use strict';

// Placeholder drum kit, synthesized: sine-sweep kick, noise snare, hats, rim.
// Pure JS (no Node or browser APIs), shared by cli/render-audio.js and the
// preview page. Deliberately plain, so rhythm, timing and dynamics are what
// you hear.

const { Rng } = require('../../engine/prng');

// One-shot voices by MIDI note: fn(t seconds, rng, state, sampleRate) ->
// sample, length in seconds, pan -1..1, gain.
const VOICES = {
  36: {
    len: 0.5,
    pan: 0,
    gain: 1.0,
    fn(t, rng, st, sr) {
      const f = 48 + 110 * Math.exp(-t / 0.035);
      st.ph = (st.ph || 0) + (2 * Math.PI * f) / sr;
      const body = Math.sin(st.ph) * Math.exp(-t / 0.28);
      const click = (rng.float() * 2 - 1) * Math.exp(-t / 0.002) * 0.3;
      return body + click;
    },
  },
  38: {
    len: 0.35,
    pan: 0.05,
    gain: 0.7,
    fn(t, rng, st, sr) {
      const n = rng.float() * 2 - 1;
      st.lp = (st.lp || 0) + 0.35 * (n - (st.lp || 0));
      const noise = (n - st.lp) * Math.exp(-t / 0.13);
      st.ph = (st.ph || 0) + (2 * Math.PI * 185) / sr;
      const tone = Math.sin(st.ph) * Math.exp(-t / 0.05) * 0.6;
      return noise * 0.9 + tone;
    },
  },
  42: {
    len: 0.12,
    pan: 0.35,
    gain: 0.4,
    fn(t, rng, st, sr) {
      const n = rng.float() * 2 - 1;
      const hp = n - (st.prev || 0);
      st.prev = n;
      const hp2 = hp - (st.prev2 || 0) * 0.5;
      st.prev2 = hp;
      return hp2 * Math.exp(-t / 0.028);
    },
  },
  37: {
    len: 0.1,
    pan: -0.35,
    gain: 0.45,
    fn(t, rng, st, sr) {
      st.a = (st.a || 0) + (2 * Math.PI * 820) / sr;
      st.b = (st.b || 0) + (2 * Math.PI * 1710) / sr;
      const tone = (Math.sin(st.a) + 0.5 * Math.sign(Math.sin(st.b))) * Math.exp(-t / 0.025);
      const click = (rng.float() * 2 - 1) * Math.exp(-t / 0.003);
      return tone * 0.6 + click * 0.4;
    },
  },
};


// Renders one hit at full velocity. Scale by velocityGain(velocity).
function renderVoice(note, sampleRate, seed) {
  const v = VOICES[note] || VOICES[37];
  const rng = new Rng(seed || 4242);
  const len = Math.round(v.len * sampleRate);
  const out = new Float32Array(len);
  const st = {};
  for (let i = 0; i < len; i++) out[i] = v.fn(i / sampleRate, rng, st, sampleRate);
  return out;
}

function velocityGain(note, velocity) {
  const v = VOICES[note] || VOICES[37];
  return v.gain * Math.pow(velocity / 127, 1.6);
}

module.exports = { VOICES, renderVoice, velocityGain };
