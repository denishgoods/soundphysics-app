'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine');
const { Rng } = require('../engine/prng');

// Random transport abuse. Invariants: no exceptions, no negative delays, no
// note fired twice at the same moment, every note released before its pitch
// plays again, and nothing left sounding after stop.
test('scheduler survives random play/stop/seek/loop/tempo sequences', () => {
  for (let run = 0; run < 12; run++) {
    const rng = new Rng(1000 + run);
    const engine = E.createEngine({ seed: run, params: { density: rng.range(20, 100), ghosts: rng.range(0, 100) } });
    const sched = new E.LookaheadScheduler(engine, { lookaheadMs: rng.range(60, 300) });
    let t = 0;
    let song = 0;
    let bpm = rng.range(70, 170);
    let playing = false;
    let loop = null;
    let pending = [];
    const sounding = new Map(); // note -> count
    const since = new Map(); // note -> time it started sounding
    const firedAt = new Set();

    const fire = (until) => {
      pending.sort((a, b) => a.at - b.at);
      while (pending.length && pending[0].at <= until) {
        const p = pending.shift();
        if (p.velocity > 0) {
          const k = p.note + '@' + p.at.toFixed(6);
          assert.ok(!firedAt.has(k), 'duplicate onset ' + k);
          firedAt.add(k);
          // lanes never overlap themselves, so a note-on must find its pitch released
          assert.ok(!sounding.get(p.note), `run ${run}: note ${p.note} retriggered while sounding at ${p.at.toFixed(2)} ms`);
          sounding.set(p.note, 1);
          since.set(p.note, p.at);
        } else if (sounding.get(p.note)) {
          sounding.set(p.note, 0);
          since.delete(p.note);
        }
      }
    };

    for (let step = 0; step < 3000; step++) {
      const r = rng.float();
      if (r < 0.004) playing = !playing;
      else if (r < 0.007) song = rng.range(0, 64);
      else if (r < 0.01) {
        loop = rng.chance(0.3) ? null : { start: Math.floor(rng.range(0, 8)) * rng.pick([1, 0.5, 4]), length: rng.pick([0.75, 2, 3, 4, 5, 8, 16]) };
        if (loop) sched.setLoop(true, loop.start, loop.length);
        else sched.setLoop(false, 0, 0);
      } else if (r < 0.013) bpm = rng.range(60, 180);

      const cmds = sched.tick({ playing, beat: song, bpm, meter: { num: 4, den: 4 }, timeMs: t });
      for (const c of cmds) {
        if (c.type === 'clear') pending = [];
        else {
          assert.ok(c.delayMs >= 0 && Number.isFinite(c.delayMs), 'delay ' + c.delayMs);
          assert.ok(c.velocity >= 0 && c.velocity <= 127);
          pending.push({ at: t + c.delayMs, note: c.note, velocity: c.velocity });
        }
      }
      const dt = rng.chance(0.01) ? rng.range(50, 400) : rng.range(2, 25);
      fire(t + dt);
      t += dt;
      // longest note is half a beat (500 ms at 60 bpm); allow for stalls
      for (const [note, start] of since) assert.ok(t - start < 2500, `run ${run}: note ${note} sounding for ${t - start} ms`);
      if (playing) {
        const before = song;
        song += (dt * bpm) / 60000;
        if (loop && before < loop.start + loop.length) while (song >= loop.start + loop.length) song -= loop.length;
      }
    }
    // stop and drain: nothing may keep sounding
    for (const c of sched.tick({ playing: false, beat: song, bpm, meter: { num: 4, den: 4 }, timeMs: t })) {
      if (c.type === 'clear') pending = [];
      else pending.push({ at: t + c.delayMs, note: c.note, velocity: c.velocity });
    }
    fire(Infinity);
    for (const [note, n] of sounding) assert.equal(n, 0, `run ${run}: note ${note} left hanging`);
  }
});
