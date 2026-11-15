'use strict';

// Tests for the Max side that can run without Max: the built v8 bundle is
// loaded into an empty JS context with stand-ins for the Max globals and
// driven the way the patch drives it; the patch JSON is checked for wiring
// mistakes. What this cannot cover (Max's own objects and threading) is
// listed in the README.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const E = require('../engine');
const { buildAll } = require('../tools/build');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'max', 'organic.js');

function loadDevice() {
  const calls = [];
  const posts = [];
  const ctx = vm.createContext({
    outlet: (n, ...args) => calls.push({ n, args: args.length === 1 && Array.isArray(args[0]) ? args[0] : args }),
    post: (...a) => posts.push(a.join(' ')),
    messagename: '',
  });
  vm.runInContext(fs.readFileSync(BUNDLE, 'utf8'), ctx, { filename: 'organic.js' });
  return { ctx, calls, posts };
}

// Drives the bundle like the patch does: every tick, [transport] reports into
// the script, then the tick bangs it. Outlet 0 goes to a pipe stand-in.
function runDevice(dev, { bpm = 120, ms, playAtMs = 3, tickMs = 10, loop, onTick }) {
  const { ctx, calls } = dev;
  let pending = [];
  const fired = [];
  const beatAt = (t) => Math.max(0, ((t - playAtMs) * bpm) / 60000);
  const song = (u) => (loop && u >= loop.start + loop.length ? loop.start + ((u - loop.start) % loop.length) : u);
  if (loop) {
    ctx.lom('loop', 1);
    ctx.lom('loop_start', loop.start);
    ctx.lom('loop_length', loop.length);
  }
  for (let t = 0; t < ms; t += tickMs) {
    if (onTick) onTick(t);
    const playing = t >= playAtMs;
    ctx.transport('resolution', 480);
    ctx.transport('tempo', bpm);
    ctx.transport('timesig', 4, 4);
    ctx.transport('state', playing ? 1 : 0);
    ctx.transport('ticks', song(beatAt(t)) * 480);
    calls.length = 0;
    ctx.bang();
    for (const c of calls) {
      if (c.n === 1 && c.args[0] === 'clear') pending = [];
      else if (c.n === 0) pending.push({ fire: t + c.args[3], note: c.args[0], velocity: c.args[1], aimed: c.args[2] });
    }
    pending.sort((a, b) => a.fire - b.fire);
    while (pending.length && pending[0].fire < t + tickMs) {
      const p = pending.shift();
      fired.push(Object.assign({ u: beatAt(p.fire), song: song(beatAt(p.fire)) }, p));
    }
  }
  return fired;
}

test('bundle loads in a bare context and announces itself', () => {
  const dev = loadDevice();
  assert.equal(dev.ctx.inlets, 1);
  assert.equal(dev.ctx.outlets, 2);
  assert.match(dev.posts.join(''), /organic: engine \d+\.\d+\.\d+ \(organic\) ready/);
  for (const fn of ['bang', 'transport', 'lom', 'param', 'probe', 'stats', 'panic', 'lookahead', 'verbose', 'anything', 'notifydeleted']) {
    assert.equal(typeof dev.ctx[fn], 'function', fn);
  }
});

test('bundle plays the same notes as the engine, on time', () => {
  const dev = loadDevice();
  dev.ctx.param('seed', 42);
  dev.ctx.param('density', 70);
  const beats = 16 * 4;
  const fired = runDevice(dev, { ms: beats * 500 + 600 });
  const ons = fired.filter((f) => f.velocity > 0 && f.u < beats);
  const ref = E.createEngine({ seed: 42, params: { density: 70 } });
  ref.reset(0);
  const expected = ref.generate(0, beats);
  assert.equal(ons.length, expected.length);
  ons.forEach((f, i) => {
    assert.equal(f.note, expected[i].note);
    assert.equal(f.velocity, expected[i].velocity);
    if (expected[i].beat > 0.25) assert.ok(Math.abs(f.u - expected[i].beat) < 1e-6, `${f.u} vs ${expected[i].beat}`);
    assert.ok(Math.abs(f.aimed - expected[i].beat) < 1e-9);
  });
});

test('bundle: stop sends clear and releases every lane', () => {
  const dev = loadDevice();
  runDevice(dev, { ms: 2000 });
  dev.calls.length = 0;
  dev.ctx.transport('state', 0);
  dev.ctx.bang();
  assert.deepEqual(dev.calls[0], { n: 1, args: ['clear'] });
  const released = dev.calls.filter((c) => c.n === 0 && c.args[1] === 0).map((c) => c.args[0]);
  for (const l of E.DEFAULT_LANES) assert.ok(released.includes(l.note));
});

test('bundle: loop from LOM messages wraps without resyncs', () => {
  const dev = loadDevice();
  const fired = runDevice(dev, { ms: 20000, loop: { start: 0, length: 8 } });
  assert.ok(fired.length > 100);
  dev.posts.length = 0;
  dev.ctx.stats();
  const line = dev.posts.join('');
  assert.match(line, /resyncs 0/);
  assert.match(line, /wraps [1-9]/);
});

test('bundle: params are applied, clamped, junk reported; probe stats', () => {
  const dev = loadDevice();
  dev.ctx.param('swing', 400);
  dev.ctx.param('nonsense', 3);
  assert.equal(dev.ctx.engine.getParams().swing, 100);
  assert.match(dev.posts.join(''), /ignored param nonsense/);
  dev.ctx.probe(480 * 4 + 4.8, 4); // 1% of a beat late at 120 bpm = 5 ms
  dev.ctx.probe(480 * 8, -1); // note-offs carry -1 and are ignored
  dev.posts.length = 0;
  dev.ctx.stats();
  assert.match(dev.posts.join(''), /probe n 1 mean 5\.00 ms/);
  dev.ctx.messagename = 'foo';
  dev.ctx.anything();
  assert.match(dev.posts.join(''), /unknown message foo/);
  // live.observer output with or without the property name
  dev.ctx.lom('loop_start', 8);
  dev.ctx.lom('loop_length', 'loop_length', 4);
  dev.ctx.lom('loop', 'id');
  assert.deepEqual({ ...dev.ctx.loopInfo }, { on: 0, start: 8, length: 4 });
});

test('bundle: panic while playing releases notes and restarts cleanly', () => {
  const dev = loadDevice();
  let panicked = false;
  const fired = runDevice(dev, {
    ms: 6000,
    onTick: (t) => {
      if (t >= 3000 && !panicked) {
        panicked = true;
        dev.ctx.panic();
      }
    },
  });
  assert.ok(fired.some((f) => f.velocity > 0 && f.fire > 3100), 'plays again after panic');
});

// --- patch ------------------------------------------------------------

const patch = JSON.parse(fs.readFileSync(path.join(ROOT, 'max', 'organic.maxpat'), 'utf8')).patcher;
const byId = Object.fromEntries(patch.boxes.map((b) => [b.box.id, b.box]));
const textOf = (id) => byId[id].text || byId[id].maxclass;
const linesFrom = (id, outlet) => patch.lines.filter((l) => l.patchline.source[0] === id && (outlet === undefined || l.patchline.source[1] === outlet));

test('patch: ids unique, every cord connects existing inlets and outlets', () => {
  assert.equal(Object.keys(byId).length, patch.boxes.length);
  for (const { patchline: l } of patch.lines) {
    const src = byId[l.source[0]];
    const dst = byId[l.destination[0]];
    assert.ok(src && dst, JSON.stringify(l));
    assert.ok(l.source[1] < src.numoutlets, `${textOf(src.id)} has no outlet ${l.source[1]}`);
    assert.ok(l.destination[1] < dst.numinlets, `${textOf(dst.id)} has no inlet ${l.destination[1]}`);
    if (src.outlettype) assert.equal(src.outlettype.length, src.numoutlets, textOf(src.id));
  }
  for (const b of patch.boxes) if (b.box.maxclass === 'newobj') assert.ok(b.box.text, b.box.id);
  assert.equal(patch.openinpresentation, 1);
});

test('patch: one v8 box loading organic.js, fed by every control path', () => {
  const v8 = patch.boxes.filter((b) => /^v8\b/.test(b.box.text || ''));
  assert.equal(v8.length, 1);
  assert.equal(v8[0].box.text, 'v8 organic.js');
  const feeders = patch.lines.filter((l) => l.patchline.destination[0] === v8[0].box.id).map((l) => textOf(l.patchline.source[0]));
  for (const f of ['t b b', 'prepend transport ticks', 'prepend transport state', 'prepend transport tempo', 'prepend transport timesig', 'prepend transport resolution', 'prepend lom loop', 'prepend lom loop_start', 'prepend lom loop_length', 'prepend probe']) {
    assert.ok(feeders.includes(f), 'missing ' + f);
  }
});

test('patch: transport outlets go to the right fields', () => {
  const tr = patch.boxes.find((b) => b.box.text === 'transport' && linesFrom(b.box.id, 7).some((l) => textOf(l.patchline.destination[0]) === 'prepend transport ticks'));
  assert.ok(tr, 'transport feeding ticks');
  const expect = { 3: 'resolution', 4: 'tempo', 5: 'timesig', 6: 'state', 7: 'ticks' };
  for (const [outlet, field] of Object.entries(expect)) {
    const dst = linesFrom(tr.box.id, Number(outlet)).map((l) => textOf(l.patchline.destination[0]));
    assert.deepEqual(dst, ['prepend transport ' + field]);
  }
});

test('patch: output chain v8 -> unpack -> pipe -> pack -> midiformat -> midiout', () => {
  const find = (t) => patch.boxes.find((b) => b.box.text === t).box.id;
  const v8 = find('v8 organic.js');
  const unpack = find('unpack 0 0 0. 0.');
  const pipe = find('pipe 0 0 0. 0.');
  const has = (s, so, d, di) => patch.lines.some((l) => l.patchline.source[0] === s && l.patchline.source[1] === so && l.patchline.destination[0] === d && l.patchline.destination[1] === di);
  assert.ok(has(v8, 0, unpack, 0));
  assert.ok(has(v8, 1, pipe, 0), 'clear goes to pipe');
  for (let i = 0; i < 4; i++) assert.ok(has(unpack, i, pipe, i), 'unpack ' + i);
  const pack = find('pack 0 0');
  assert.ok(has(pipe, 0, pack, 0) && has(pipe, 1, pack, 1));
  const mf = find('midiformat');
  const mo = find('midiout');
  assert.ok(has(pack, 0, mf, 0) && has(mf, 0, mo, 0));
  assert.ok(has(find('midiin'), 0, mo, 0), 'MIDI passes through');
});

test('patch: the nine parameters match the engine and are saved/automatable', () => {
  const params = patch.boxes.filter((b) => b.box.parameter_enable === 1).map((b) => b.box);
  assert.equal(params.length, E.PARAMS.length);
  E.PARAMS.forEach((p) => {
    const box = params.find((b) => b.varname === p.name);
    assert.ok(box, p.name);
    assert.equal(box.maxclass, p.type === 'int' ? 'live.numbox' : 'live.dial');
    const v = box.saved_attribute_attributes.valueof;
    assert.equal(v.parameter_longname, p.name);
    assert.equal(v.parameter_mmin, p.min);
    assert.equal(v.parameter_mmax, p.max);
    assert.deepEqual(v.parameter_initial, [p.default]);
    assert.equal(v.parameter_initial_enable, 1);
    assert.equal(v.parameter_type, p.type === 'int' ? 1 : 0);
    assert.equal(box.presentation, 1);
    const pre = linesFrom(box.id, 0).map((l) => byId[l.patchline.destination[0]]);
    assert.equal(pre.length, 1);
    assert.equal(pre[0].text, 'prepend param ' + p.id);
  });
});

test('built files are up to date with the sources', () => {
  const out = buildAll();
  for (const rel of Object.keys(out)) {
    const disk = fs.readFileSync(path.join(ROOT, rel));
    assert.ok(Buffer.compare(disk, Buffer.from(out[rel])) === 0, `${rel} is stale: run npm run build`);
  }
});

test('experimental .amxd: header + the same patcher JSON', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'max', 'Organic.amxd'));
  assert.equal(buf.toString('ascii', 0, 4), 'ampf');
  assert.equal(buf.toString('ascii', 8, 12), 'mmmm');
  assert.equal(buf.toString('ascii', 24, 28), 'ptch');
  const len = buf.readUInt32LE(28);
  assert.equal(len, buf.length - 32);
  assert.equal(buf.toString('utf8', 32), fs.readFileSync(path.join(ROOT, 'max', 'organic.maxpat'), 'utf8'));
});
