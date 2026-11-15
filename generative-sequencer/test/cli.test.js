'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeMidi, readMidi } = require('../cli/lib/midifile');
const { textRoll, htmlRoll } = require('../cli/lib/pianoroll');
const { run } = require('../cli/simulate');
const { compare } = require('../cli/compare');
const E = require('../engine');

test('MIDI write/read round trip keeps notes within one tick', () => {
  const eng = E.createEngine({ seed: 3 });
  eng.reset(0);
  const notes = eng.generate(0, 32);
  const data = writeMidi({ notes, bpm: 97, ppq: 960 });
  assert.equal(String.fromCharCode(...data.slice(0, 4)), 'MThd');
  const back = readMidi(data);
  assert.equal(back.ppq, 960);
  assert.ok(Math.abs(back.tempos[0].bpm - 97) < 0.01);
  assert.equal(back.notes.length, notes.length);
  const sorted = notes.slice().sort((a, b) => a.beat - b.beat || a.note - b.note);
  back.notes.forEach((n, i) => {
    assert.equal(n.note, sorted[i].note);
    assert.equal(n.velocity, sorted[i].velocity);
    assert.ok(Math.abs(n.beat - sorted[i].beat) <= 0.5 / 960 + 1e-12);
  });
});

test('MIDI reader handles running status and note-on velocity 0', () => {
  // header + one track: tempo, note on 36, (running) 38 on, 36 "off" (vel 0), 38 off
  const track = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, 0, 0x90, 36, 100, 10, 38, 90, 86, 36, 0, 0, 0x80, 38, 0, 0, 0xff, 0x2f, 0];
  const bytes = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length, ...track];
  const m = readMidi(Uint8Array.from(bytes));
  assert.equal(m.notes.length, 2);
  assert.equal(m.notes[0].note, 36);
  assert.ok(Math.abs(m.notes[0].duration - 96 / 96) < 1e-9);
  assert.ok(Math.abs(m.tempos[0].bpm - 120) < 1e-6);
});

test('piano-roll views render', () => {
  const eng = E.createEngine({ seed: 1 });
  eng.reset(0);
  const evs = eng.generate(0, 16);
  const txt = textRoll(evs, { lanes: eng.lanes, bars: 4, barLen: 4 });
  assert.match(txt, /Kick/);
  assert.equal(txt.split('\n').filter((l) => l.startsWith('Snare')).length, 2);
  const html = htmlRoll(evs, { lanes: eng.lanes, bars: 4, barLen: 4, curves: [{ name: 'density', points: [[0, 0.5], [16, 0.7]] }] });
  assert.match(html, /^<!doctype html>/);
  assert.equal((html.match(/<rect x=/g) || []).length, evs.length);
});

test('simulate CLI: direct and via-scheduler give the same notes; compare reports zero jitter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'organic-'));
  const quiet = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const direct = run({ _: [], bars: '8', seed: '11', out: path.join(dir, 'a.mid'), html: path.join(dir, 'a.html') });
    const viaSched = run({ _: [], bars: '8', seed: '11', out: path.join(dir, 'b.mid'), 'via-scheduler': true });
    const late = (e) => e.beat < 0.25; // start catch-up lands a few ms late
    const sig = (evs) => evs.filter((e) => !late(e)).map((e) => e.note + '@' + e.beat.toFixed(6) + ':' + e.velocity).sort();
    assert.deepEqual(sig(viaSched), sig(direct));
    const r = compare(path.join(dir, 'b.mid'), path.join(dir, 'a.mid'), {});
    assert.equal(r.matches.length, direct.length);
    assert.ok(Math.abs(r.median) < 0.6 && r.sd < 2, `median ${r.median} sd ${r.sd}`);
    assert.ok(fs.readFileSync(path.join(dir, 'a.html'), 'utf8').includes('<svg'));
  } finally {
    process.stderr.write = quiet;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
