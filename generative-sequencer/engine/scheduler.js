'use strict';

// Look-ahead scheduler: turns transport snapshots into timestamped MIDI.
// Host-agnostic (no Max APIs), so it is tested in Node with a simulated
// transport; the Max adapter only feeds it snapshots and forwards commands.
//
// Why it exists: in Max, JavaScript ([js] and [v8]) runs on the low-priority
// main thread, which can stall for tens of milliseconds. So the script never
// plays notes "now". On every tick it reads the transport, asks the engine
// for everything due within `lookaheadMs`, and emits each note with a delay
// in ms relative to that reading. The host hands notes to a high-priority
// delay line ([pipe] in Max), so timing comes from Max's scheduler, not from
// when the script happened to run.
//
// Three timelines:
//   song  Live's position in beats; jumps back at loop wraps.
//   U     unrolled play time in beats; never jumps back. Delays use U.
//   E     engine time; advances with U and keeps the song's bar phase.
// A segment is a stretch where all three advance together. When the
// look-ahead crosses the loop end, the next segment (starting at the loop
// start) is planned before the transport wraps, so the first notes of every
// pass are on time and the performance keeps evolving across passes.
//
// tick(snapshot) -> commands
//   snapshot: { playing, beat (song position), bpm, meter: {num, den}, timeMs }
//   commands: { type: 'note', note, velocity, delayMs, songBeat }  (velocity 0 = note-off)
//             { type: 'clear' }  (cancel everything still pending in the delay line)

const EPS = 1e-9;

function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

class LookaheadScheduler {
  constructor(engine, opts) {
    const o = opts || {};
    this.engine = engine;
    this.lookaheadMs = num(o.lookaheadMs, 150);
    this.maxLateMs = num(o.maxLateMs, 30); // later than this: drop instead of playing late
    this.startSnapMs = num(o.startSnapMs, 80); // see _start
    this.snapGrid = num(o.snapGrid, 0.25);
    this.tempoTolerance = num(o.tempoTolerance, 0.02); // reschedule pending notes above this change
    this.jumpTolerance = num(o.jumpTolerance, 0.5); // beats of unexplained movement = a jump
    this.loop = { on: false, start: 0, end: 0 };
    this.pendingLoop = null;
    this.running = false;
    this.segs = [];
    this.cursorE = 0;
    this.uNow = 0;
    this.lastSong = 0;
    this.lastTimeMs = null;
    this.bpm = 120;
    this.schedBpm = 120;
    this.meterKey = '4/4';
    this.inFlight = [];
    this.lateAllowance = this.maxLateMs;
    this.needsResync = false;
    this.stats = { notes: 0, late: 0, dropped: 0, starts: 0, resyncs: 0, wraps: 0, reschedules: 0 };
  }

  // Live's arrangement loop. Applied at the next tick, so the separate
  // loop / start / length updates Live sends are seen together.
  setLoop(on, start, length) {
    this.pendingLoop = { on: !!on, start: num(start, 0), length: num(length, 0) };
  }

  tick(t) {
    const cmds = [];
    const song = num(t && t.beat, NaN);
    if (!Number.isFinite(song)) return cmds;
    const bpm = t.bpm > 0 && Number.isFinite(t.bpm) ? t.bpm : this.bpm;
    const meter = t.meter || { num: 4, den: 4 };
    const meterKey = meter.num + '/' + meter.den;
    if (this.pendingLoop) this._applyLoop(song);

    if (!t.playing) {
      if (this.running) this._stop(cmds);
    } else {
      if (!this.running) this._start(t, song, bpm, cmds, false);
      else if (this.needsResync || meterKey !== this.meterKey) this._resync(t, song, bpm, cmds);
      else {
        const u = this._locate(song, bpm, t.timeMs);
        if (u === null) this._resync(t, song, bpm, cmds);
        else if (u > this.uNow) this.uNow = u;
      }
      if (Math.abs(bpm - this.schedBpm) > this.schedBpm * this.tempoTolerance) this._reschedule(cmds, bpm);
      this.engine.setTempo(bpm);
      this.inFlight = this.inFlight.filter((f) => f.uOff > this.uNow);
      this._fill(cmds, bpm);
      this.lateAllowance = this.maxLateMs;
    }
    this.bpm = bpm;
    this.lastSong = song;
    this.lastTimeMs = num(t.timeMs, null);
    return cmds;
  }

  // Stop everything now: cancel pending notes, release sounding ones. If the
  // transport is still playing, the next tick starts a fresh performance.
  panic() {
    const cmds = [];
    this._stop(cmds);
    return cmds;
  }

  _segment(songStart, eStart, uStart) {
    const L = this.loop;
    const songEnd = L.on && songStart < L.end - EPS ? L.end : Infinity;
    return { songStart, songEnd, eStart, uStart };
  }

  // Playback starts are only seen on the first tick after they happen, a few
  // ms late. If the position is just past a 16th, assume playback started on
  // it, so the downbeat isn't skipped (it plays immediately, slightly late).
  _start(t, song, bpm, cmds, isResync) {
    const msPerBeat = 60000 / bpm;
    const g = Math.floor(song / this.snapGrid + EPS) * this.snapGrid;
    const start = (song - g) * msPerBeat <= this.startSnapMs ? g : song;
    const meter = t.meter || { num: 4, den: 4 };
    this.engine.setTempo(bpm);
    this.engine.setMeter(meter.num, meter.den);
    this.engine.reset(start);
    this.meterKey = meter.num + '/' + meter.den;
    this.segs = [this._segment(start, start, start)];
    this.cursorE = start;
    this.uNow = start + (song - start);
    this.inFlight = [];
    this.running = true;
    this.needsResync = false;
    this.schedBpm = bpm;
    this.lateAllowance = Math.max(this.maxLateMs, this.startSnapMs);
    if (isResync) this.stats.resyncs++;
    else this.stats.starts++;
  }

  // An unexplained jump (clicking elsewhere in the arrangement, a loop edit
  // that invalidates notes already scheduled, a meter change): start a new
  // performance at the new position.
  _resync(t, song, bpm, cmds) {
    this._stop(cmds);
    this._start(t, song, bpm, cmds, true);
  }

  _stop(cmds) {
    cmds.push({ type: 'clear' });
    const notes = [];
    const add = (n) => {
      if (notes.indexOf(n) < 0) notes.push(n);
    };
    this.engine.lanes.forEach((l) => add(l.note));
    this.inFlight.forEach((f) => add(f.note));
    notes.forEach((n) => cmds.push({ type: 'note', note: n, velocity: 0, delayMs: 0, songBeat: -1 }));
    this.inFlight = [];
    this.running = false;
    this.segs = [];
    this.needsResync = false;
  }

  // Map the reported song position to U, accepting normal advance within the
  // current segment or a wrap into the planned next one.
  _locate(song, bpm, timeMs) {
    const tol = Math.max(0.01, (15 * bpm) / 60000);
    const elapsed =
      Number.isFinite(timeMs) && Number.isFinite(this.lastTimeMs) ? (Math.max(0, timeMs - this.lastTimeMs) * bpm) / 60000 : null;
    const seg = this.segs[0];
    if (song >= this.lastSong - tol && song >= seg.songStart - tol && song < seg.songEnd + tol) {
      if (elapsed === null || Math.abs(song - (this.lastSong + elapsed)) <= this.jumpTolerance) {
        return seg.uStart + (song - seg.songStart);
      }
    }
    const nx = this.segs[1];
    if (nx && song >= nx.songStart - tol && song < nx.songEnd + tol) {
      const u = nx.uStart + (song - nx.songStart);
      const ok =
        elapsed === null
          ? u - this.uNow < (this.lookaheadMs * bpm) / 60000 + this.jumpTolerance
          : Math.abs(u - (this.uNow + elapsed)) <= this.jumpTolerance;
      if (ok) {
        this.segs.shift();
        this.stats.wraps++;
        return u;
      }
    }
    return null;
  }

  _fill(cmds, bpm) {
    const msPerBeat = 60000 / bpm;
    const horizonU = this.uNow + this.lookaheadMs / msPerBeat;
    for (let guard = 0; guard < 64; guard++) {
      const seg = this.segs[this.segs.length - 1];
      const segUEnd = seg.uStart + (seg.songEnd - seg.songStart);
      const cursorU = seg.uStart + (this.cursorE - seg.eStart);
      const targetU = Math.min(horizonU, segUEnd);
      if (targetU > cursorU + EPS) {
        const targetE = seg.eStart + (targetU - seg.uStart);
        const evs = this.engine.generate(this.cursorE, targetE);
        for (const ev of evs) this._schedule(cmds, seg, ev, msPerBeat);
        this.cursorE = targetE;
      }
      if (horizonU <= segUEnd + EPS) break;
      const next = this._wrapSegment(seg);
      if (!next) break;
      this.segs.push(next);
      this.cursorE = next.eStart;
    }
  }

  // The next pass of the loop. E skips forward (by less than a bar) only if
  // the loop length isn't a whole number of bars, to keep the bar phase.
  _wrapSegment(seg) {
    if (!this.loop.on || !Number.isFinite(seg.songEnd)) return null;
    const bar = this.engine.meter.barLen;
    const len = seg.songEnd - seg.songStart;
    const eEnd = seg.eStart + len;
    let d = (this.loop.start - eEnd) % bar;
    if (d < 0) d += bar;
    if (d < 1e-6 || bar - d < 1e-6) d = 0;
    return { songStart: this.loop.start, songEnd: this.loop.end, eStart: eEnd + d, uStart: seg.uStart + len };
  }

  _schedule(cmds, seg, ev, msPerBeat) {
    const u = seg.uStart + (ev.beat - seg.eStart);
    const songBeat = seg.songStart + (ev.beat - seg.eStart);
    let uOn = u;
    if (u < this.uNow) {
      if ((this.uNow - u) * msPerBeat > this.lateAllowance) {
        this.stats.dropped++;
        return;
      }
      this.stats.late++;
      uOn = this.uNow;
    }
    const uOff = Math.max(uOn + 0.01, u + ev.duration);
    cmds.push({ type: 'note', note: ev.note, velocity: ev.velocity, delayMs: (uOn - this.uNow) * msPerBeat, songBeat });
    cmds.push({ type: 'note', note: ev.note, velocity: 0, delayMs: (uOff - this.uNow) * msPerBeat, songBeat: -1 });
    this.inFlight.push({ note: ev.note, velocity: ev.velocity, uOn, uOff, songBeat });
    this.stats.notes++;
  }

  // Tempo changed noticeably: pending delays were computed at the old tempo.
  // Clear the delay line and re-issue every pending note-on/off at the new one.
  _reschedule(cmds, bpm) {
    const msPerBeat = 60000 / bpm;
    cmds.push({ type: 'clear' });
    for (const f of this.inFlight) {
      if (f.uOff <= this.uNow) continue;
      if (f.uOn > this.uNow) {
        cmds.push({ type: 'note', note: f.note, velocity: f.velocity, delayMs: (f.uOn - this.uNow) * msPerBeat, songBeat: f.songBeat });
      }
      cmds.push({ type: 'note', note: f.note, velocity: 0, delayMs: (f.uOff - this.uNow) * msPerBeat, songBeat: -1 });
    }
    this.schedBpm = bpm;
    this.stats.reschedules++;
  }

  _applyLoop(song) {
    const L = this.pendingLoop;
    this.pendingLoop = null;
    const on = L.on && L.length >= 1 / 16;
    const next = on ? { on: true, start: L.start, end: L.start + L.length } : { on: false, start: 0, end: 0 };
    const cur = this.loop;
    if (cur.on === next.on && Math.abs(cur.start - next.start) < EPS && Math.abs(cur.end - next.end) < EPS) return;
    this.loop = next;
    if (!this.running) return;
    if (this.segs.length > 1) {
      this.needsResync = true; // notes after the planned wrap are already scheduled
      return;
    }
    const seg = this.segs[0];
    const end = next.on && song < next.end - EPS && seg.songStart < next.end - EPS ? next.end : Infinity;
    const cursorSong = seg.songStart + (this.cursorE - seg.eStart);
    if (cursorSong > end + EPS) this.needsResync = true;
    else seg.songEnd = end;
  }
}

module.exports = { LookaheadScheduler };
