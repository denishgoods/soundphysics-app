'use strict';

// Minimal Standard MIDI File writer and reader (format 0/1). No dependencies;
// works on Uint8Array so it isn't tied to Node's Buffer.

function vlq(n) {
  n = Math.max(0, Math.round(n));
  const bytes = [n & 0x7f];
  n = Math.floor(n / 128);
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  return bytes;
}

function u32(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u16(n) {
  return [(n >>> 8) & 0xff, n & 0xff];
}

function ascii(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0x7f);
  return out;
}

// notes: [{ beat, note, velocity, duration, channel? }] (beats = quarter notes)
// Writes a format-0 file: tempo and time signature, then notes. Note-offs at
// the same tick as a note-on are written first.
function writeMidi(opts) {
  const ppq = opts.ppq || 960;
  const bpm = opts.bpm || 120;
  const meter = opts.meter || { num: 4, den: 4 };
  const msg = [];
  for (const n of opts.notes) {
    const ch = (n.channel || 0) & 0x0f;
    const on = Math.max(0, Math.round(n.beat * ppq));
    const off = Math.max(on + 1, Math.round((n.beat + n.duration) * ppq));
    msg.push({ tick: on, order: 1, bytes: [0x90 | ch, n.note & 0x7f, Math.max(1, Math.min(127, n.velocity))] });
    msg.push({ tick: off, order: 0, bytes: [0x80 | ch, n.note & 0x7f, 0] });
  }
  msg.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const tr = [];
  const name = ascii(opts.name || 'organic');
  tr.push(0, 0xff, 0x03, ...vlq(name.length), ...name);
  const usPerQ = Math.round(60000000 / bpm);
  tr.push(0, 0xff, 0x51, 0x03, (usPerQ >>> 16) & 0xff, (usPerQ >>> 8) & 0xff, usPerQ & 0xff);
  tr.push(0, 0xff, 0x58, 0x04, meter.num, Math.round(Math.log2(meter.den)), 24, 8);
  let last = 0;
  for (const m of msg) {
    tr.push(...vlq(m.tick - last), ...m.bytes);
    last = m.tick;
  }
  tr.push(0, 0xff, 0x2f, 0x00);

  const head = [...ascii('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(ppq)];
  const track = [...ascii('MTrk'), ...u32(tr.length), ...tr];
  return Uint8Array.from(head.concat(track));
}

// Returns { format, ppq, tempos: [{tick, bpm}], notes: [{beat, note, velocity, duration, channel, track}] }.
function readMidi(data) {
  const b = data instanceof Uint8Array ? data : Uint8Array.from(data);
  let p = 0;
  const str = (n) => {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(b[p + i]);
    p += n;
    return s;
  };
  const r32 = () => {
    const v = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
    p += 4;
    return v;
  };
  const r16 = () => {
    const v = (b[p] << 8) | b[p + 1];
    p += 2;
    return v;
  };
  const rv = () => {
    let v = 0;
    for (;;) {
      const c = b[p++];
      v = v * 128 + (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
  };
  if (str(4) !== 'MThd') throw new Error('not a MIDI file');
  const hlen = r32();
  const format = r16();
  const ntracks = r16();
  const division = r16();
  p += hlen - 6;
  if (division & 0x8000) throw new Error('SMPTE time division is not supported');
  const ppq = division;
  const tempos = [];
  const notes = [];
  for (let t = 0; t < ntracks && p < b.length; t++) {
    const id = str(4);
    const len = r32();
    const end = p + len;
    if (id !== 'MTrk') {
      p = end;
      continue;
    }
    let tick = 0;
    let status = 0;
    const open = {};
    while (p < end) {
      tick += rv();
      let s = b[p];
      if (s & 0x80) p++;
      else s = status; // running status
      if (s === 0xff) {
        const type = b[p++];
        const l = rv();
        if (type === 0x51 && l === 3) tempos.push({ tick, bpm: 60000000 / ((b[p] << 16) | (b[p + 1] << 8) | b[p + 2]) });
        p += l;
        continue;
      }
      if (s === 0xf0 || s === 0xf7) {
        p += rv();
        continue;
      }
      status = s;
      const type = s & 0xf0;
      const ch = s & 0x0f;
      const d1 = b[p++];
      const d2 = type === 0xc0 || type === 0xd0 ? 0 : b[p++];
      if (type === 0x90 && d2 > 0) {
        const key = ch * 128 + d1;
        (open[key] = open[key] || []).push({ tick, velocity: d2 });
      } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
        const key = ch * 128 + d1;
        const q = open[key];
        if (q && q.length) {
          const on = q.shift();
          notes.push({ beat: on.tick / ppq, note: d1, velocity: on.velocity, duration: (tick - on.tick) / ppq, channel: ch, track: t });
        }
      }
    }
    p = end;
  }
  notes.sort((x, y) => x.beat - y.beat || x.note - y.note);
  return { format, ppq, tempos, notes };
}

module.exports = { writeMidi, readMidi };
