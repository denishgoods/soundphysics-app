#!/usr/bin/env node
'use strict';

// Renders a performance to audio with a small synthesized drum kit, to hear
// the generator without a DAW. Writes WAV; with --mp3 also an MP3 (ffmpeg).
//
//   node cli/render-audio.js --mode irregular --bars 16 --seed 3 --out out/irregular.wav --mp3
//
// Takes the same parameter options as simulate.js. The kit is deliberately
// plain (sine-sweep kick, noise snare, hats, rim click) so the rhythm, timing
// and dynamics are what you hear.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('../engine');
const { Rng } = require('../engine/prng');
const { parseArgs } = require('./simulate');

const SR = 44100;

// One-shot voices: fn(t seconds, rng) -> sample, length in seconds, pan -1..1.
const VOICES = {
  36: {
    len: 0.5,
    pan: 0,
    gain: 1.0,
    fn(t, rng, st) {
      const f = 48 + 110 * Math.exp(-t / 0.035);
      st.ph = (st.ph || 0) + (2 * Math.PI * f) / SR;
      const body = Math.sin(st.ph) * Math.exp(-t / 0.28);
      const click = (rng.float() * 2 - 1) * Math.exp(-t / 0.002) * 0.3;
      return body + click;
    },
  },
  38: {
    len: 0.35,
    pan: 0.05,
    gain: 0.7,
    fn(t, rng, st) {
      const n = rng.float() * 2 - 1;
      st.lp = (st.lp || 0) + 0.35 * (n - (st.lp || 0));
      const noise = (n - st.lp) * Math.exp(-t / 0.13);
      st.ph = (st.ph || 0) + (2 * Math.PI * 185) / SR;
      const tone = Math.sin(st.ph) * Math.exp(-t / 0.05) * 0.6;
      return noise * 0.9 + tone;
    },
  },
  42: {
    len: 0.12,
    pan: 0.35,
    gain: 0.4,
    fn(t, rng, st) {
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
    fn(t, rng, st) {
      st.a = (st.a || 0) + (2 * Math.PI * 820) / SR;
      st.b = (st.b || 0) + (2 * Math.PI * 1710) / SR;
      const tone = (Math.sin(st.a) + 0.5 * Math.sign(Math.sin(st.b))) * Math.exp(-t / 0.025);
      const click = (rng.float() * 2 - 1) * Math.exp(-t / 0.003);
      return tone * 0.6 + click * 0.4;
    },
  },
};

function render(events, bpm, seconds) {
  const n = Math.ceil(seconds * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rng = new Rng(4242);
  for (const e of events) {
    const v = VOICES[e.note] || VOICES[37];
    const start = Math.round(((e.beat * 60) / bpm) * SR);
    const amp = v.gain * Math.pow(e.velocity / 127, 1.6);
    const gl = amp * Math.sqrt(0.5 * (1 - v.pan));
    const gr = amp * Math.sqrt(0.5 * (1 + v.pan));
    const st = {};
    const len = Math.round(v.len * SR);
    for (let i = 0; i < len && start + i < n; i++) {
      if (start + i < 0) continue;
      const s = v.fn(i / SR, rng, st);
      L[start + i] += s * gl;
      R[start + i] += s * gr;
    }
  }
  return [L, R];
}

function wav([L, R]) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.tanh(L[i] * 0.9) * 32000), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.tanh(R[i] * 0.9) * 32000), 46 + i * 4);
  }
  return buf;
}

function main(args) {
  const bars = Math.max(1, Number(args.bars) || 16);
  const bpm = Number(args.bpm) || 120;
  const params = {};
  for (const p of E.PARAMS) if (args[p.id] !== undefined) params[p.id] = p.type === 'enum' ? args[p.id] : Number(args[p.id]);
  const eng = E.createEngine({ params, bpm });
  eng.reset(0);
  const total = bars * eng.meter.barLen;
  const events = [];
  for (let b = 0; b < total; b += 0.25) events.push(...eng.generate(b, Math.min(total, b + 0.25)));
  const out = args.out || 'out/render.wav';
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, wav(render(events, bpm, (total * 60) / bpm + 0.6)));
  process.stderr.write(`wrote ${out} (${events.length} notes, ${bars} bars at ${bpm} bpm)\n`);
  if (args.mp3) {
    const mp3 = out.replace(/\.wav$/, '') + '.mp3';
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, '-codec:a', 'libmp3lame', '-b:a', '160k', mp3]);
    process.stderr.write(`wrote ${mp3}\n`);
  }
}

if (require.main === module) main(parseArgs(process.argv.slice(2)));

module.exports = { render, wav };
