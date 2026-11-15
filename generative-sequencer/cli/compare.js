#!/usr/bin/env node
'use strict';

// Compare the timing of a MIDI clip recorded from the device in Live against
// the reference file the simulator wrote for the same seed and settings.
//
//   node cli/simulate.js --bars 16 --seed 7 --out out/ref.mid
//   (record the device's output in Live, right-click the clip > Export MIDI Clip)
//   node cli/compare.js recorded.mid out/ref.mid
//
// Notes are paired by pitch, nearest first, within --window-ms. Reports the
// constant offset (latency) and the spread around it (jitter).

const fs = require('fs');
const { readMidi } = require('./lib/midifile');
const { parseArgs } = require('./simulate');

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

function pair(rec, ref, windowMs, toMs) {
  const matches = [];
  const usedRec = new Set();
  const pitches = new Set(ref.map((n) => n.note));
  for (const p of pitches) {
    const a = ref.filter((n) => n.note === p);
    const b = rec.map((n, i) => ({ n, i })).filter((x) => x.n.note === p);
    const cand = [];
    for (const x of a) {
      for (const y of b) {
        const d = toMs(y.n.beat) - toMs(x.beat);
        if (Math.abs(d) <= windowMs) cand.push({ ref: x, rec: y, d });
      }
    }
    cand.sort((u, v) => Math.abs(u.d) - Math.abs(v.d));
    const usedRef = new Set();
    for (const c of cand) {
      if (usedRef.has(c.ref) || usedRec.has(c.rec.i)) continue;
      usedRef.add(c.ref);
      usedRec.add(c.rec.i);
      matches.push({ note: p, refBeat: c.ref.beat, d: c.d, velRef: c.ref.velocity, velRec: c.rec.n.velocity });
    }
  }
  return { matches, usedRec };
}

function compare(recFile, refFile, opts) {
  const rec = readMidi(fs.readFileSync(recFile));
  const ref = readMidi(fs.readFileSync(refFile));
  const bpm = Number(opts.bpm) || (ref.tempos[0] && ref.tempos[0].bpm) || 120;
  const shift = Number(opts['shift-beats']) || 0;
  const windowMs = Number(opts['window-ms']) || 60;
  const msPerBeat = 60000 / bpm;
  const toMs = (beat) => beat * msPerBeat;
  const recNotes = rec.notes.map((n) => Object.assign({}, n, { beat: n.beat - shift }));
  const limit = opts.bars ? Number(opts.bars) * 4 : Infinity;
  const refNotes = ref.notes.filter((n) => n.beat < limit);

  const { matches, usedRec } = pair(recNotes, refNotes, windowMs, toMs);
  const d = matches.map((m) => m.d).sort((a, b) => a - b);
  const median = quantile(d, 0.5);
  const dev = d.map((x) => Math.abs(x - median)).sort((a, b) => a - b);
  const mean = d.reduce((s, x) => s + x, 0) / (d.length || 1);
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / (d.length || 1));
  const velDiff = matches.filter((m) => m.velRef !== m.velRec).length;
  const tickMs = (r) => msPerBeat / r.ppq;

  const lines = [];
  lines.push(`reference: ${refFile} (${refNotes.length} notes, ppq ${ref.ppq}, ${bpm.toFixed(2)} bpm)`);
  lines.push(`recorded:  ${recFile} (${rec.notes.length} notes, ppq ${rec.ppq})`);
  lines.push(`matched ${matches.length}, missing ${refNotes.length - matches.length}, extra ${rec.notes.length - usedRec.size} (window ±${windowMs} ms)`);
  if (d.length) {
    lines.push(`offset (latency): median ${median.toFixed(2)} ms, mean ${mean.toFixed(2)} ms`);
    lines.push(
      `jitter around median: sd ${sd.toFixed(2)} ms, p50 ${quantile(dev, 0.5).toFixed(2)} ms, p95 ${quantile(dev, 0.95).toFixed(2)} ms, max ${dev[dev.length - 1].toFixed(2)} ms`
    );
    lines.push(`velocity differs on ${velDiff} matched notes`);
    const res = Math.max(tickMs(rec), tickMs(ref));
    lines.push(`file resolution: one tick = ${res.toFixed(2)} ms; differences below ~${(res / 2).toFixed(2)} ms are rounding.`);
    const byNote = {};
    for (const m of matches) (byNote[m.note] = byNote[m.note] || []).push(m.d - median);
    for (const n of Object.keys(byNote)) {
      const v = byNote[n].map(Math.abs).sort((a, b) => a - b);
      lines.push(`  note ${n}: ${v.length} notes, p95 ${quantile(v, 0.95).toFixed(2)} ms, max ${v[v.length - 1].toFixed(2)} ms`);
    }
  }
  return { text: lines.join('\n'), matches, median, sd };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args._.length < 2 || args.help) {
    process.stdout.write('usage: node cli/compare.js recorded.mid reference.mid [--bpm N] [--window-ms 60] [--shift-beats B] [--bars N]\n');
    process.exit(args.help ? 0 : 1);
  }
  process.stdout.write(compare(args._[0], args._[1], args).text + '\n');
}

module.exports = { compare };
