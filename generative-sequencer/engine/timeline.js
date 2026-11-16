'use strict';

// Window logic shared by all generator modes.
//
// Public contract: generate(start, end) returns every event with
// start <= event.beat < end, sorted, exactly once across consecutive calls,
// however the timeline is cut into windows.
//
// Generators work on anchor windows and their events can land up to
// maxDeviation before or after the anchor. So the timeline renders 1-beat
// anchor chunks ahead of the requested window, keeps rendered events in a
// cache sorted by final beat, and only hands out an event once every chunk
// that could still produce something before it has been rendered. Rendered
// events are latched: parameter changes affect chunks not yet rendered,
// never events already in the cache, so moving a knob can't duplicate or
// lose an event at a window boundary.
//
// It also enforces per-lane playability: onsets closer than MIN_GAP are
// merged, and durations are clipped so a lane never overlaps itself.

const MAX_DURATION = 0.5; // beats
const MIN_GAP = 0.02; // beats
const RETAIN = 4; // beats of history kept for re-queries
const EPS = 1e-9;

function compareEvents(a, b) {
  return a.beat - b.beat || a.lane - b.lane || a.seq - b.seq;
}

class Timeline {
  constructor(generator, state) {
    this.gen = generator;
    this.state = state;
    this.maxDev = Math.max(0.05, generator.maxDeviation || 0.5);
    this.seq = 0;
    this.reset(0);
  }

  // Switch generator mode. The new mode starts from its own initial state;
  // events already rendered (up to about a beat ahead) still play.
  setGenerator(generator) {
    this.gen = generator;
    generator.init(this.state);
  }

  // Start a new performance at `start`. Notes aimed before `start` are not
  // played; notes aimed at or after it but pulled earlier are played at it.
  reset(start) {
    const st = this.state;
    st.origin = Math.floor(start / st.meter.barLen + EPS) * st.meter.barLen;
    this.gen.init(st);
    this.cache = [];
    this.renderedTo = start;
    this.floor = start;
    this.lastEnd = start;
  }

  generate(start, end) {
    if (!(end > start) || !Number.isFinite(start) || !Number.isFinite(end)) return [];
    if (start > this.lastEnd + EPS) this._jump(start);
    this._renderUntil(end + MAX_DURATION + this.maxDev);
    const out = [];
    const cache = this.cache;
    for (let i = this._lowerBound(start); i < cache.length; i++) {
      const ev = cache[i];
      if (ev.beat >= end) break;
      if (ev.dropped) continue;
      if (!ev.done) this._finalize(i);
      ev.returned = true;
      out.push({ beat: ev.beat, lane: ev.lane, note: ev.note, velocity: ev.velocity, duration: ev.duration });
    }
    if (end > this.lastEnd) this.lastEnd = end;
    this._trim(this.lastEnd - RETAIN);
    return out;
  }

  // Forward gap (seek, or a loop that isn't bar-aligned): forget what was
  // rendered but not returned and render again from `start`. Rendering is
  // stateless per note, so the re-rendered notes are the same ones.
  _jump(start) {
    this.cache = this.cache.filter((ev) => ev.returned);
    this.renderedTo = start;
    this.floor = start;
    this.lastEnd = start;
  }

  _renderUntil(need) {
    while (this.renderedTo < need) {
      const c0 = this.renderedTo;
      const c1 = Math.floor(c0 + EPS) + 1;
      const evs = this.gen.generate(c0, c1, this.state) || [];
      const lo = Math.max(c0 - this.maxDev, this.floor);
      const fresh = [];
      for (const e of evs) {
        const ev = sanitize(e, this.state.lanes);
        if (!ev) continue;
        // Bound deviations so the look-ahead argument above holds even if a
        // generator misbehaves.
        ev.beat = Math.min(Math.max(ev.beat, lo), c1 + this.maxDev);
        ev.seq = this.seq++;
        fresh.push(ev);
      }
      this._insert(fresh);
      this.renderedTo = c1;
    }
  }

  _insert(fresh) {
    if (!fresh.length) return;
    fresh.sort(compareEvents);
    const merged = [];
    const a = this.cache;
    let i = 0;
    let j = 0;
    while (i < a.length || j < fresh.length) {
      if (j >= fresh.length || (i < a.length && compareEvents(a[i], fresh[j]) <= 0)) merged.push(a[i++]);
      else merged.push(fresh[j++]);
    }
    this.cache = merged;
  }

  // Merge too-close onsets and clip the duration against the next onset in
  // the same lane. Everything this looks at is already complete in the cache.
  _finalize(i) {
    const ev = this.cache[i];
    for (let j = i + 1; j < this.cache.length; j++) {
      const nx = this.cache[j];
      if (nx.beat > ev.beat + ev.duration) break;
      if (nx.dropped || nx.lane !== ev.lane) continue;
      if (nx.beat - ev.beat < MIN_GAP) {
        nx.dropped = true;
        continue;
      }
      ev.duration = Math.min(ev.duration, (nx.beat - ev.beat) * 0.9);
      break;
    }
    ev.done = true;
  }

  _lowerBound(beat) {
    let lo = 0;
    let hi = this.cache.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cache[mid].beat < beat) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  _trim(before) {
    let n = 0;
    while (n < this.cache.length && this.cache[n].beat < before && (this.cache[n].returned || this.cache[n].dropped)) n++;
    if (n) this.cache.splice(0, n);
  }
}

function sanitize(e, lanes) {
  if (!e || !Number.isFinite(e.beat)) return null;
  const lane = e.lane | 0;
  if (lane < 0 || lane >= lanes.length) return null;
  const note = Number.isFinite(e.note) ? Math.min(127, Math.max(0, Math.round(e.note))) : lanes[lane].note;
  const velocity = Math.min(127, Math.max(1, Math.round(Number(e.velocity) || 0)));
  let duration = Number(e.duration);
  if (!(duration > 0)) duration = 0.1;
  duration = Math.min(MAX_DURATION, Math.max(0.005, duration));
  return { beat: e.beat, lane, note, velocity, duration, seq: 0, done: false, dropped: false, returned: false };
}

module.exports = { Timeline, MAX_DURATION, MIN_GAP };
