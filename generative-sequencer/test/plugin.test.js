'use strict';

// The native plugin's engine (plugin/engine, C++) must give the same
// performance as the JS engine, and its block scheduler must pass its own
// tests. Builds both test programs with the system compiler; skipped when
// no C++ compiler is available.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('../engine');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'out', 'bin', 'engine_dump');
const SCHED_BIN = path.join(ROOT, 'out', 'bin', 'scheduler_test');
const ENGINE_FILES = ['plugin/engine/organic.h', 'plugin/engine/organic.cpp', 'plugin/engine/block_scheduler.h', 'plugin/engine/block_scheduler.cpp'];

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

function build(bin, sources) {
  const cxx = compiler();
  if (!cxx) return false;
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  const all = sources.concat(ENGINE_FILES).map((f) => path.join(ROOT, f));
  const newest = Math.max(...all.map((f) => fs.statSync(f).mtimeMs));
  if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < newest) {
    const cpp = sources.map((f) => path.join(ROOT, f));
    execFileSync(cxx, ['-std=c++17', '-O2', '-Wall', '-ffp-contract=off', '-o', bin, ...cpp], { stdio: 'inherit' });
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
// Irregular mode
for (const seed of [1, 2, 3, 7, 12, 99, 1234]) {
  CASES.push({ seed, bars: 48, bpm: 120, meter: [4, 4], start: 0, window: 0.25, params: { mode: 1 }, changes: [] });
}
CASES.push({ seed: 5, bars: 48, bpm: 100, meter: [4, 4], start: 0, window: 0.37, params: { mode: 1, looseness: 95, memory: 5, breath: 100, ghosts: 90 }, changes: [] });
CASES.push({ seed: 6, bars: 32, bpm: 130, meter: [4, 4], start: 6.5, window: 0.9, params: { mode: 1, memory: 100, density: 100 }, changes: [] });
for (const meter of [[3, 4], [7, 8], [6, 8], [5, 4]]) {
  CASES.push({ seed: 8, bars: 24, bpm: 110, meter, start: 0, window: 0.5, params: { mode: 1, looseness: 70 }, changes: [] });
}
// switching mode during a performance
CASES.push({ seed: 9, bars: 40, bpm: 120, meter: [4, 4], start: 0, window: 0.2, params: {}, changes: [
  { at: 30, id: 'mode', value: 1 }, { at: 70, id: 'seed', value: 77 }, { at: 100, id: 'mode', value: 0 }, { at: 130, id: 'mode', value: 1 },
] });

test('C++ engine matches the JS engine event for event', (t) => {
  if (!build(BIN, ['plugin/tests/engine_dump.cpp', 'plugin/engine/organic.cpp'])) {
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

test('C++ block scheduler: sample-accurate timing, loops, stop, no hanging notes', (t) => {
  const sources = ['plugin/tests/scheduler_test.cpp', 'plugin/engine/block_scheduler.cpp', 'plugin/engine/organic.cpp'];
  if (!build(SCHED_BIN, sources)) {
    t.skip('no C++ compiler');
    return;
  }
  const out = execFileSync(SCHED_BIN, { encoding: 'utf8' });
  assert.match(out, /scheduler tests passed/);
});
