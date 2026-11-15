'use strict';

// The C++ engine (plugin/engine) must give the same performance as the JS
// engine. Builds plugin/tests/engine_dump with the system compiler and
// compares event by event. Skipped when no C++ compiler is available.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('../engine');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'out', 'bin', 'engine_dump');
const SOURCES = ['plugin/tests/engine_dump.cpp', 'plugin/engine/organic.cpp'].map((f) => path.join(ROOT, f));

function compiler() {
  for (const cxx of [process.env.CXX, 'c++', 'g++', 'clang++'].filter(Boolean)) {
    try {
      execFileSync(cxx, ['--version'], { stdio: 'ignore' });
      return cxx;
    } catch (e) {
      // try the next one
    }
  }
  return null;
}

function build() {
  const cxx = compiler();
  if (!cxx) return false;
  fs.mkdirSync(path.dirname(BIN), { recursive: true });
  const newest = Math.max(...SOURCES.concat([path.join(ROOT, 'plugin/engine/organic.h')]).map((f) => fs.statSync(f).mtimeMs));
  if (!fs.existsSync(BIN) || fs.statSync(BIN).mtimeMs < newest) {
    execFileSync(cxx, ['-std=c++17', '-O2', '-ffp-contract=off', '-o', BIN, ...SOURCES], { stdio: 'inherit' });
  }
  return true;
}

function runCpp(c) {
  const args = ['--bars', c.bars, '--seed', c.seed, '--bpm', c.bpm, '--meter', `${c.meter[0]}/${c.meter[1]}`, '--start', c.start, '--window', c.window];
  for (const [id, v] of Object.entries(c.params)) args.push('--set', `${id}=${v}`);
  for (const ch of c.changes) args.push('--at', `${ch.at}:${ch.id}=${ch.value}`);
  const out = execFileSync(BIN, args.map(String), { encoding: 'utf8', maxBuffer: 64 << 20 });
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [beat, lane, note, velocity, duration] = l.split(' ').map(Number);
      return { beat, lane, note, velocity, duration };
    });
}

function runJs(c) {
  const eng = E.createEngine({ seed: c.seed, params: c.params, bpm: c.bpm, meter: { num: c.meter[0], den: c.meter[1] } });
  eng.reset(c.start);
  const end = c.start + c.bars * eng.meter.barLen;
  const out = [];
  const changes = c.changes.map((x) => Object.assign({ done: false }, x));
  for (let a = c.start; a < end; a += c.window) {
    for (const ch of changes) {
      if (!ch.done && a >= ch.at) {
        eng.setParam(ch.id, ch.value);
        ch.done = true;
      }
    }
    out.push(...eng.generate(a, Math.min(end, a + c.window)));
  }
  return out;
}

const CASES = [];
for (const seed of [1, 2, 3, 7, 12, 99, 1234, 9999]) {
  CASES.push({ seed, bars: 48, bpm: 120, meter: [4, 4], start: 0, window: 0.25, params: {}, changes: [] });
}
CASES.push({ seed: 5, bars: 40, bpm: 96, meter: [4, 4], start: 0, window: 0.37, params: { looseness: 80, drift: 70, swing: 60, ghosts: 90, memory: 10, breath: 100 }, changes: [] });
CASES.push({ seed: 6, bars: 40, bpm: 140, meter: [4, 4], start: 0, window: 1.3, params: { density: 100, accent: 100, memory: 100, breath: 0 }, changes: [] });
CASES.push({ seed: 8, bars: 32, bpm: 120, meter: [4, 4], start: 0, window: 0.11, params: {}, changes: [
  { at: 10, id: 'density', value: 90 }, { at: 30, id: 'swing', value: 75 }, { at: 50, id: 'seed', value: 42 }, { at: 70, id: 'memory', value: 0 },
] });
CASES.push({ seed: 3, bars: 24, bpm: 120, meter: [4, 4], start: 9.5, window: 0.25, params: {}, changes: [] });
for (const meter of [[3, 4], [6, 8], [7, 8], [5, 4]]) {
  CASES.push({ seed: 4, bars: 24, bpm: 110, meter, start: 0, window: 0.5, params: { looseness: 60 }, changes: [] });
}

test('C++ engine matches the JS engine event for event', (t) => {
  if (!build()) {
    t.skip('no C++ compiler');
    return;
  }
  for (const c of CASES) {
    const label = JSON.stringify({ seed: c.seed, meter: c.meter, params: c.params, start: c.start });
    const js = runJs(c);
    const cpp = runCpp(c);
    assert.ok(js.length > 50, label);
    assert.equal(cpp.length, js.length, `${label}: ${cpp.length} vs ${js.length} events`);
    js.forEach((e, i) => {
      const o = cpp[i];
      const where = `${label} event ${i} at beat ${e.beat}`;
      assert.equal(o.lane, e.lane, where);
      assert.equal(o.note, e.note, where);
      assert.equal(o.velocity, e.velocity, where);
      assert.ok(Math.abs(o.beat - e.beat) < 1e-12, `${where}: beat ${o.beat}`);
      assert.ok(Math.abs(o.duration - e.duration) < 1e-12, `${where}: duration ${o.duration}`);
    });
  }
});
