'use strict';

const { Rng } = require('../../engine/prng');

// A simulated host for the look-ahead scheduler: a transport (tempo, loop,
// play/stop, seeks), an irregular low-priority tick like Max's main thread
// (with optional stalls), and a delay line that behaves like [pipe]
// (`clear` cancels everything pending). Used by the tests and by
// `simulate --via-scheduler`.
//
// Times are in ms. "u" is unrolled play time in beats (never jumps back).
// The transport moves in 0.25 ms steps; delay-line output times are exact.

const STEP_MS = 0.25;

class SimHost {
  constructor(scheduler, opts) {
    const o = opts || {};
    this.scheduler = scheduler;
    this.bpm = o.bpm || 120;
    this.meter = o.meter || { num: 4, den: 4 };
    this.loop = o.loop || null; // { start, length }
    this.tickMs = o.tickMs || 10;
    this.tickJitterMs = o.tickJitterMs !== undefined ? o.tickJitterMs : 4;
    this.stalls = sorted(o.stalls); // [{ atMs, ms }] extra delay before a tick
    this.tempoChanges = sorted(o.tempoChanges); // [{ atMs, bpm }]
    this.seeks = sorted(o.seeks); // [{ atMs, beat }]
    this.loopChanges = sorted(o.loopChanges); // [{ atMs, loop: {start, length} | null }]
    this.playAtMs = o.playAtMs !== undefined ? o.playAtMs : 3;
    this.stopAtMs = o.stopAtMs !== undefined ? o.stopAtMs : Infinity;
    this.song = o.startBeat || 0;
    this.u = this.song;
    this.playing = false;
    this.t = 0;
    this.nextTick = 0;
    this.rng = new Rng(o.seed || 12345);
    this.pending = [];
    this.fired = [];
    this.clears = 0;
    if (this.loop) scheduler.setLoop(true, this.loop.start, this.loop.length);
  }

  _songAfter(song, db) {
    let s = song + db;
    if (this.loop) {
      const end = this.loop.start + this.loop.length;
      if (song < end) while (s >= end) s -= this.loop.length;
    }
    return s;
  }

  _apply(cmds) {
    for (const c of cmds) {
      if (c.type === 'clear') {
        this.pending = [];
        this.clears++;
      } else if (c.type === 'note') {
        this.pending.push({ fire: this.t + Math.max(0, c.delayMs), note: c.note, velocity: c.velocity, songBeat: c.songBeat });
      }
    }
    this.pending.sort((a, b) => a.fire - b.fire);
  }

  _events() {
    if (!this.playing && this.t >= this.playAtMs && this.t < this.stopAtMs) this.playing = true;
    if (this.playing && this.t >= this.stopAtMs) this.playing = false;
    while (this.tempoChanges.length && this.tempoChanges[0].atMs <= this.t) this.bpm = this.tempoChanges.shift().bpm;
    while (this.seeks.length && this.seeks[0].atMs <= this.t) this.song = this.seeks.shift().beat;
    while (this.loopChanges.length && this.loopChanges[0].atMs <= this.t) {
      const L = this.loopChanges.shift().loop;
      this.loop = L;
      if (L) this.scheduler.setLoop(true, L.start, L.length);
      else this.scheduler.setLoop(false, 0, 0);
    }
  }

  run(untilMs) {
    while (this.t < untilMs) {
      this._events();
      if (this.t >= this.nextTick) {
        this._apply(this.scheduler.tick({ playing: this.playing, beat: this.song, bpm: this.bpm, meter: this.meter, timeMs: this.t }));
        let dt = this.tickMs + (this.tickJitterMs ? this.rng.range(-1, 1) * this.tickJitterMs : 0);
        while (this.stalls.length && this.stalls[0].atMs <= this.t) dt += this.stalls.shift().ms;
        this.nextTick = this.t + Math.max(0.5, dt);
      }
      const t1 = Math.min(this.t + STEP_MS, untilMs, this.nextTick);
      const rate = this.playing ? this.bpm / 60000 : 0;
      while (this.pending.length && this.pending[0].fire < t1) {
        const ev = this.pending.shift();
        const db = (Math.max(this.t, ev.fire) - this.t) * rate;
        this.fired.push({
          timeMs: ev.fire,
          note: ev.note,
          velocity: ev.velocity,
          song: this._songAfter(this.song, db),
          u: this.u + db,
          songBeat: ev.songBeat,
        });
      }
      const db = (t1 - this.t) * rate;
      this.song = this._songAfter(this.song, db);
      this.u += db;
      this.t = t1;
    }
    return this;
  }

  noteOns() {
    return this.fired.filter((f) => f.velocity > 0);
  }
}

function sorted(list) {
  return (list || []).slice().sort((a, b) => a.atMs - b.atMs);
}

module.exports = { SimHost };
