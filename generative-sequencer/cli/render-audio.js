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
const { VOICES } = require('./lib/kit');
const { parseArgs } = require('./simulate');

const SR = 44100;

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
      const s = v.fn(i / SR, rng, st, SR);
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
