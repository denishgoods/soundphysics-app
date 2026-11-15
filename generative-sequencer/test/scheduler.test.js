'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine');
const { SimHost } = require('../cli/lib/simhost');

const BPM = 120;
const MS_PER_BEAT = 60000 / BPM;

function setup(engineOpts, hostOpts, schedOpts) {
  const engine = E.createEngine(engineOpts || { seed: 5 });
  const sched = new E.LookaheadScheduler(engine, schedOpts);
  const host = new SimHost(sched, Object.assign({ bpm: BPM }, hostOpts));
  return { engine, sched, host };
}

function truth(engineOpts, start, end, bpm) {
  const eng = E.createEngine(engineOpts || { seed: 5 });
  if (bpm) eng.setTempo(bpm);
  eng.reset(start);
  return eng.generate(start, end);
}

// Every expected event fires exactly once, at its beat (in unrolled time).
// Events due before the first tick saw the transport may fire up to
// `lateBeats` late; nothing else may be late.
function assertMatches(fired, expected, lateBeats, label) {
  const tol = 1e-6;
  assert.equal(fired.length, expected.length, `${label}: ${fired.length} fired, ${expected.length} expected`);
  const byNote = {};
  for (const f of fired) (byNote[f.note] = byNote[f.note] || []).push(f);
  for (const e of expected) {
    const list = byNote[e.note] || [];
    const idx = list.findIndex((f) => f.velocity === e.velocity && f.u >= e.beat - tol && f.u <= e.beat + Math.max(tol, lateBeats));
    assert.ok(idx >= 0, `${label}: no match for note ${e.note} at ${e.beat}`);
    const f = list.splice(idx, 1)[0];
    if (f.u - e.beat > tol) assert.ok(e.beat < 0.25, `${label}: late event at ${e.beat}`);
  }
}

test('linear playback: every note on time, exactly once, despite tick jitter', () => {
  const beats = 32 * 4;
  const expected = truth({ seed: 5 }, 0, beats);
  for (const [tickMs, jitter, seed] of [[10, 4, 1], [5, 1, 2], [25, 20, 3], [40, 5, 4]]) {
    const { host, sched } = setup({ seed: 5 }, { tickMs, tickJitterMs: jitter, seed });
    host.run(beats * MS_PER_BEAT + 600);
    const fired = host.noteOns().filter((f) => f.u < beats);
    assertMatches(fired, expected, (90 / 1000) * (BPM / 60), `tick ${tickMs}±${jitter}`);
    assert.equal(sched.stats.dropped, 0);
    assert.equal(sched.stats.resyncs, 0);
    // every note-on is followed by a note-off for the same note
    for (const on of fired) {
      assert.ok(host.fired.some((f) => f.velocity === 0 && f.note === on.note && f.timeMs >= on.timeMs), 'note-off for ' + on.note);
    }
  }
});

test('main-thread stalls shorter than the look-ahead cost nothing', () => {
  const beats = 16 * 4;
  const expected = truth({ seed: 5 }, 0, beats);
  const stalls = [500, 1500, 2600, 4100, 6000].map((atMs) => ({ atMs, ms: 110 }));
  const { host, sched } = setup({ seed: 5 }, { stalls });
  host.run(beats * MS_PER_BEAT + 600);
  // assertMatches only allows lateness for the start catch-up
  assertMatches(host.noteOns().filter((f) => f.u < beats), expected, 0.2, 'stalls');
  assert.equal(sched.stats.dropped, 0);
});

test('long stalls: late notes are played or dropped, never duplicated', () => {
  const beats = 16 * 4;
  const { host, sched } = setup({ seed: 5, params: { density: 100 } }, { stalls: [{ atMs: 2000, ms: 400 }] });
  host.run(beats * MS_PER_BEAT + 600);
  assert.ok(sched.stats.dropped > 0);
  const seen = new Set();
  for (const f of host.noteOns()) {
    const k = f.note + ':' + f.u.toFixed(9);
    assert.ok(!seen.has(k));
    seen.add(k);
  }
  // back on time after the stall
  const expected = truth({ seed: 5, params: { density: 100 } }, 0, beats).filter((e) => e.beat > 6 && e.beat < beats);
  assertMatches(host.noteOns().filter((f) => f.u > 6 && f.u < beats), expected, 0, 'after stall');
});

test('bar-aligned loop: wraps are seamless and the performance keeps evolving', () => {
  const loop = { start: 4, length: 8 }; // bars 2-3
  const beats = 40 * 4;
  const { host, sched } = setup({ seed: 5 }, { loop, tickJitterMs: 6 });
  host.run(beats * MS_PER_BEAT + 600);
  // With a bar-aligned loop, unrolled play time is engine time: the device
  // plays the same notes as a linear run, folded into the loop.
  const expected = truth({ seed: 5 }, 0, beats);
  const fired = host.noteOns().filter((f) => f.u < beats);
  assertMatches(fired, expected, 0.2, 'loop');
  assert.equal(sched.stats.resyncs, 0);
  assert.ok(sched.stats.wraps >= 18, 'wraps ' + sched.stats.wraps);
  // notes land where the scheduler intended them in song time (probe value)
  for (const f of fired) {
    if (f.u < 0.25) continue;
    assert.ok(Math.abs(f.song - f.songBeat) < 1e-6 || Math.abs(Math.abs(f.song - f.songBeat) - loop.length) < 1e-6, `song ${f.song} vs ${f.songBeat}`);
    assert.ok(f.song < loop.start + loop.length + 1e-9);
  }
  // consecutive passes differ (memory evolves) but stay related
  const pass = (n) =>
    fired
      .filter((f) => f.u >= 12 + n * 8 && f.u < 20 + n * 8)
      .map((f) => f.note + '@' + (f.song - 4).toFixed(2))
      .join(' ');
  assert.notEqual(pass(0), pass(1));
});

test('first notes after a loop wrap are scheduled before the wrap', () => {
  const loop = { start: 0, length: 4 };
  const { host, sched } = setup({ seed: 5, params: { density: 100 } }, { loop, tickMs: 12, tickJitterMs: 8 });
  host.run(20 * 4 * MS_PER_BEAT);
  const downbeats = host.noteOns().filter((f) => f.u > 1 && (f.song < 0.05 || f.song > 3.95));
  assert.ok(downbeats.length >= 15);
  // each fires exactly where it was aimed (an unplanned wrap would make
  // these late by up to a tick)
  for (const f of downbeats) {
    const d = Math.abs(f.song - f.songBeat);
    assert.ok(d < 1e-6 || Math.abs(d - loop.length) < 1e-6, `aimed ${f.songBeat}, fired at ${f.song}`);
  }
  const startCatchUp = truth({ seed: 5, params: { density: 100 } }, 0, 0.25).length;
  assert.ok(sched.stats.late <= startCatchUp, 'late ' + sched.stats.late);
});

test('loop that is not a whole number of bars keeps the bar phase', () => {
  const loop = { start: 2, length: 5 }; // 4/4, five beats
  const beats = 30 * 4;
  const { host, sched } = setup({ seed: 5 }, { loop });
  host.run(beats * MS_PER_BEAT);
  assert.equal(sched.stats.resyncs, 0);
  assert.equal(sched.stats.dropped, 0);
  assert.ok(sched.stats.wraps > 20);
  // kick notes after the first pass still favour bar downbeats of the song
  const kicks = host.noteOns().filter((f) => f.note === 36 && f.u > 8);
  assert.ok(kicks.length > 10);
  const onDownbeat = kicks.filter((f) => Math.abs(f.song - 4) < 0.08).length;
  assert.ok(onDownbeat > 5, 'downbeat kicks ' + onDownbeat);
  // across the seam, two onsets of one pitch never pile up (they are merged)
  const byNote = {};
  for (const f of host.noteOns()) (byNote[f.note] = byNote[f.note] || []).push(f.u);
  for (const n of Object.keys(byNote)) {
    const us = byNote[n].sort((a, b) => a - b);
    for (let i = 1; i < us.length; i++) assert.ok(us[i] - us[i - 1] >= 0.02 - 1e-9, `note ${n} at ${us[i - 1]} and ${us[i]}`);
  }
});

test('stop: clears pending notes and releases all lanes; play again restarts identically', () => {
  const stopAtMs = 4000;
  const { host, engine } = setup({ seed: 5 }, { stopAtMs, playAtMs: 3 });
  host.run(stopAtMs + 1000);
  const after = host.fired.filter((f) => f.timeMs > stopAtMs + 20);
  assert.equal(after.filter((f) => f.velocity > 0).length, 0);
  const offsAtStop = host.fired.filter((f) => f.velocity === 0 && f.timeMs >= stopAtMs && f.timeMs < stopAtMs + 20);
  for (const lane of engine.lanes) assert.ok(offsAtStop.some((f) => f.note === lane.note), 'release ' + lane.note);
  assert.ok(host.clears >= 1);

  // a second run from the same place gives the same performance
  const a = setup({ seed: 5 }, { seed: 1 });
  const b = setup({ seed: 5 }, { seed: 99, tickMs: 17 });
  a.host.run(3000);
  b.host.run(3000);
  // (the start catch-up depends on when the first tick lands, so skip it)
  const sig = (h) => h.noteOns().filter((f) => f.u > 0.25 && f.u < 5).map((f) => f.note + '@' + f.u.toFixed(6) + ':' + f.velocity);
  assert.deepEqual(sig(a.host), sig(b.host));
});

test('tempo change: pending notes are rescheduled, positions stay musical', () => {
  const beats = 24 * 4;
  const opts = { seed: 5, params: { ghosts: 0 } }; // flam spacing depends on tempo
  const changeAt = 5000;
  const { host, sched } = setup(opts, { tempoChanges: [{ atMs: changeAt, bpm: 90 }] });
  // 10 beats at 120, then the remaining 86 at 90
  host.run(changeAt + (86 * 60000) / 90 + 600);
  assert.ok(sched.stats.reschedules >= 1);
  const expected = truth(opts, 0, beats);
  const fired = host.noteOns().filter((f) => f.u < beats);
  assert.equal(fired.length, expected.length);
  const beatAtChange = (changeAt * BPM) / 60000;
  fired.forEach((f, i) => {
    const e = expected[i];
    // Until the next tick notices the change, notes fire on the old tempo.
    const tol = Math.abs(e.beat - beatAtChange) < 0.1 ? 0.01 : 1e-6;
    if (e.beat < 0.25) return;
    assert.ok(Math.abs(f.u - e.beat) <= tol, `note at ${e.beat} fired at ${f.u}`);
  });
});

test('jump during playback starts a fresh performance at the new position', () => {
  const { host, sched } = setup({ seed: 5 }, { seeks: [{ atMs: 3000, beat: 64 }] });
  host.run(6000);
  assert.equal(sched.stats.resyncs, 1);
  const expected = truth({ seed: 5 }, 64, 70);
  const fired = host.noteOns().filter((f) => f.timeMs > 3000 && f.song < 70);
  assert.equal(fired.length, expected.length);
  fired.forEach((f, i) => {
    assert.equal(f.note, expected[i].note);
    if (expected[i].beat > 64.2) assert.ok(Math.abs(f.song - expected[i].beat) < 1e-6);
  });
});

test('loop edits while playing never duplicate notes', () => {
  const loopChanges = [
    { atMs: 1500, loop: { start: 0, length: 8 } },
    { atMs: 5000, loop: { start: 4, length: 4 } },
    { atMs: 9000, loop: null },
    { atMs: 12000, loop: { start: 16, length: 6 } },
  ];
  const { host, sched } = setup({ seed: 5, params: { density: 90 } }, { loopChanges });
  host.run(20000);
  const seen = new Set();
  for (const f of host.noteOns()) {
    const k = f.note + ':' + f.timeMs.toFixed(6);
    assert.ok(!seen.has(k), 'duplicate ' + k);
    seen.add(k);
  }
  assert.ok(sched.stats.notes > 100);
});

test('playback that starts just after a 16th snaps to it (the downbeat is not lost)', () => {
  const { host, sched } = setup({ seed: 5 }, { playAtMs: 3, tickMs: 30, tickJitterMs: 0 });
  host.run(1000);
  const first = host.noteOns()[0];
  assert.ok(first, 'something played');
  const expected = truth({ seed: 5 }, 0, 1)[0];
  assert.equal(first.note, expected.note);
  assert.ok(first.u - expected.beat < 0.08);
  assert.ok(sched.stats.late >= 1);
  assert.equal(sched.stats.dropped, 0);
});

test('3/4 and a loop', () => {
  const opts = { seed: 2, meter: { num: 3, den: 4 } };
  const { host, sched } = setup(opts, { meter: { num: 3, den: 4 }, loop: { start: 3, length: 6 } });
  host.run(30000);
  assert.equal(sched.stats.resyncs, 0);
  const expected = truth(opts, 0, 50);
  assertMatches(host.noteOns().filter((f) => f.u < 50), expected, 0.2, '3/4');
});
