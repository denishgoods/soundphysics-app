#!/usr/bin/env node
'use strict';

// Run the engine for N bars and write a .mid file, plus a text and/or HTML
// piano roll, so you can audition the generator before the Max device exists.
//
//   node cli/simulate.js --bars 32 --seed 7 --bpm 110 --out out/seed7.mid --html out/seed7.html
//   node cli/simulate.js --density 80 --memory 20 --text
//
// Any parameter can be passed as --<id> <value> (display units, e.g. 0-100).
// --via-scheduler runs through the look-ahead scheduler with a simulated,
// jittery transport instead of calling the engine directly; the notes are
// the same, which is a quick end-to-end check of the scheduling path.

const fs = require('fs');
const path = require('path');
const E = require('../engine');
const { writeMidi } = require('./lib/midifile');
const { textRoll, htmlRoll } = require('./lib/pianoroll');
const { SimHost } = require('./lib/simhost');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

const HELP = `usage: node cli/simulate.js [options]
  --bars N          bars to generate (default 16)
  --bpm N           tempo (default 120)
  --meter 4/4       time signature (default 4/4)
  --out FILE.mid    write a MIDI file
  --html FILE.html  write an HTML piano roll
  --text            print a text piano roll (default if no --out/--html)
  --window B        generate() window size in beats (default 0.1)
  --via-scheduler   run through the look-ahead scheduler + simulated transport
  --<param> V       ${E.PARAMS.map((p) => `${p.id} (${p.min}-${p.max}, default ${p.default})`).join(', ')}
`;

function run(args) {
  if (args.help || args.h) {
    process.stdout.write(HELP);
    return;
  }
  const bars = Math.max(1, Number(args.bars) || 16);
  const bpm = Number(args.bpm) || 120;
  const [num, den] = String(args.meter || '4/4').split('/').map(Number);
  const params = {};
  for (const p of E.PARAMS) if (args[p.id] !== undefined) params[p.id] = Number(args[p.id]);

  const engine = E.createEngine({ params, bpm, meter: { num, den } });
  const barLen = engine.meter.barLen;
  const total = bars * barLen;
  let events;

  if (args['via-scheduler']) {
    const sched = new E.LookaheadScheduler(engine);
    const host = new SimHost(sched, { bpm, meter: { num, den }, playAtMs: 3 });
    host.run(((total + 1) * 60000) / bpm);
    const offs = host.fired.filter((f) => f.velocity === 0);
    events = host
      .noteOns()
      .filter((f) => f.u < total)
      .map((f) => {
        const off = offs.find((o) => o.note === f.note && o.timeMs > f.timeMs);
        const lane = engine.lanes.findIndex((l) => l.note === f.note);
        return { beat: f.u, lane, note: f.note, velocity: f.velocity, duration: off ? ((off.timeMs - f.timeMs) * bpm) / 60000 : 0.1 };
      });
    const s = sched.stats;
    process.stderr.write(`scheduler: ${s.notes} notes, ${s.late} late, ${s.dropped} dropped, ${host.clears} clears\n`);
  } else {
    engine.reset(0);
    const win = Math.max(0.001, Number(args.window) || 0.1);
    events = [];
    for (let b = 0; b < total; b += win) events.push(...engine.generate(b, Math.min(total, b + win)));
  }

  const values = engine.getParams();
  const desc = E.PARAMS.map((p) => `${p.name} ${values[p.id]}`).join(' · ');
  const st = engine.state;
  const breathAt = (beat) => st.mods.breath.value(beat / barLen);
  const densityAt = (beat) => Math.min(1, st.p.density * Math.max(0, 1 + (breathAt(beat) - 1) * st.p.breath));

  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, writeMidi({ notes: events, bpm, meter: engine.meter, name: `organic seed ${values.seed}` }));
    process.stderr.write(`wrote ${args.out} (${events.length} notes, ${bars} bars at ${bpm} bpm)\n`);
  }
  if (args.html) {
    const step = 0.125;
    const pts = (fn) => {
      const out = [];
      for (let b = 0; b <= total; b += step) out.push([b, fn(b)]);
      return out;
    };
    const curves = [{ name: 'density', points: pts(densityAt) }];
    if (engine.mode === 'organic') {
      const ens = st.mods.noise('ensemble', 0);
      const sw = st.mods.noise('swing', 0, { octaves: 3, persistence: 0.5 });
      curves.push({ name: 'drift', min: -1, max: 1, points: pts((b) => ens(b / 6)) });
      curves.push({ name: 'swing', points: pts((b) => Math.min(1, st.p.swing * (1 + 0.45 * sw(b / 8)))) });
    }
    fs.mkdirSync(path.dirname(path.resolve(args.html)), { recursive: true });
    fs.writeFileSync(
      args.html,
      htmlRoll(events, {
        lanes: engine.lanes,
        bars,
        barLen,
        curves,
        title: `Organic · seed ${values.seed} · ${bars} bars · ${bpm} bpm`,
        subtitle: desc,
      })
    );
    process.stderr.write(`wrote ${args.html}\n`);
  }
  if (args.text || (!args.out && !args.html)) {
    process.stdout.write(desc + '\n\n');
    process.stdout.write(textRoll(events, { lanes: engine.lanes, bars, barLen, curve: densityAt }) + '\n');
  }
  return events;
}

if (require.main === module) run(parseArgs(process.argv.slice(2)));

module.exports = { run, parseArgs };
