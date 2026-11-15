'use strict';

// Builds the device patcher (JSON) from the engine's parameter list.
//
// Signal flow:
//   live.thisdevice -> [t 1 b b b] -> qmetro on, params sent, LOM observers bound
//   [qmetro 10] -> [t b b] -> (right) [transport] -> prepend transport ... -> v8
//                          -> (left)  bang -> v8
//   v8 out0 "note vel aimedBeat delayMs" -> [unpack] -> [pipe] -> [pack] -> [midiformat] -> [midiout]
//   v8 out1 "clear" -> [pipe]
//   [pipe] aimedBeat -> [t b f] -> [transport] ticks -> [pack] -> "probe" -> v8   (timing self-test)
//   [midiin] -> [midiout]   (incoming MIDI passes through)
//   live.path live_set -> live.observer loop / loop_start / loop_length -> "lom ..." -> v8

const { PARAMS } = require('../engine/params');

const UNITSTYLE = { int: 0, float: 1, percent: 5 };
const STATUS_NOT_RUNNING = 'organic.js is NOT running: needs Max 9 (v8) and organic.js next to the device. See Max Console.';

function build(opts) {
  const scriptName = (opts && opts.scriptName) || 'organic.js';
  const boxes = [];
  const lines = [];
  let n = 0;

  function add(box) {
    box.id = box.id || 'obj-' + ++n;
    boxes.push({ box });
    return box.id;
  }
  function obj(text, ins, outs, outlettype, x, y, extra) {
    return add(Object.assign({ maxclass: 'newobj', text, numinlets: ins, numoutlets: outs, outlettype, patching_rect: [x, y, Math.max(40, text.length * 7 + 12), 22] }, extra));
  }
  function msg(text, x, y) {
    return add({ maxclass: 'message', text, numinlets: 2, numoutlets: 1, outlettype: [''], patching_rect: [x, y, text.length * 7 + 16, 22] });
  }
  function comment(text, x, y, pres, extra) {
    return add(
      Object.assign(
        { maxclass: 'comment', text, numinlets: 1, numoutlets: 0, patching_rect: [x, y, Math.max(60, text.length * 7 + 10), 20] },
        pres ? { presentation: 1, presentation_rect: pres } : {},
        extra
      )
    );
  }
  function wire(src, outlet, dst, inlet) {
    lines.push({ patchline: { destination: [dst, inlet], source: [src, outlet] } });
  }

  comment('Organic: generative MIDI sequencer (v8). Logic lives in ' + scriptName + ' (built from engine/).', 20, 4, null);

  // --- engine
  const v8 = obj('v8 ' + scriptName, 1, 3, ['', '', ''], 20, 330, { saved_object_attributes: { parameter_enable: 0 } });

  // --- init
  const thisdevice = obj('live.thisdevice', 1, 3, ['bang', 'int', 'int'], 20, 40);
  const init = obj('t 1 b b b', 1, 4, ['int', 'bang', 'bang', 'bang'], 20, 72);
  wire(thisdevice, 0, init, 0);

  // --- clock and transport read
  const qmetro = obj('qmetro 10', 2, 1, ['bang'], 20, 110);
  wire(init, 0, qmetro, 0);
  const tick = obj('t b b', 1, 2, ['bang', 'bang'], 20, 145);
  wire(qmetro, 0, tick, 0);
  const transport = obj('transport', 2, 8, ['int', 'int', 'float', 'float', 'float', '', 'int', 'float'], 110, 180);
  wire(tick, 1, transport, 0);
  wire(tick, 0, v8, 0);
  // [transport] outlets: 0 bars, 1 beats, 2 units, 3 resolution, 4 tempo, 5 time signature, 6 state, 7 ticks
  [
    [3, 'resolution'],
    [4, 'tempo'],
    [5, 'timesig'],
    [6, 'state'],
    [7, 'ticks'],
  ].forEach(([outlet, field], i) => {
    const p = obj('prepend transport ' + field, 1, 1, [''], 110 + i * 150, 240);
    wire(transport, outlet, p, 0);
    wire(p, 0, v8, 0);
  });

  // --- Live loop (LOM)
  const path = obj('live.path live_set', 1, 3, ['', '', ''], 860, 110);
  wire(init, 2, path, 0);
  ['loop', 'loop_start', 'loop_length'].forEach((prop, i) => {
    const x = 860 + i * 170;
    const m = msg('property ' + prop, x, 145);
    const ob = obj('live.observer', 2, 2, ['', ''], x, 180);
    const p = obj('prepend lom ' + prop, 1, 1, [''], x, 240);
    wire(init, 3, m, 0);
    wire(m, 0, ob, 0);
    wire(path, 0, ob, 1);
    wire(ob, 0, p, 0);
    wire(p, 0, v8, 0);
  });

  // --- output: delay line in the high-priority scheduler
  const unpack = obj('unpack 0 0 0. 0.', 1, 4, ['int', 'int', 'float', 'float'], 20, 380);
  wire(v8, 0, unpack, 0);
  const pipe = obj('pipe 0 0 0. 0.', 4, 3, ['int', 'int', 'float'], 20, 420);
  // unpack fires right to left, so delay and data are set before the note triggers
  wire(unpack, 3, pipe, 3);
  wire(unpack, 2, pipe, 2);
  wire(unpack, 1, pipe, 1);
  wire(unpack, 0, pipe, 0);
  wire(v8, 1, pipe, 0);
  const pack = obj('pack 0 0', 2, 1, [''], 20, 470);
  wire(pipe, 1, pack, 1);
  wire(pipe, 0, pack, 0);
  const midiformat = obj('midiformat', 7, 1, ['int'], 20, 510);
  wire(pack, 0, midiformat, 0);
  const midiout = obj('midiout', 1, 0, [], 20, 550);
  wire(midiformat, 0, midiout, 0);
  const midiin = obj('midiin', 1, 1, ['int'], 200, 510);
  wire(midiin, 0, midiout, 0);

  // --- timing probe
  const probeTrig = obj('t b f', 1, 2, ['bang', 'float'], 200, 470);
  wire(pipe, 2, probeTrig, 0);
  const transport2 = obj('transport', 2, 8, ['int', 'int', 'float', 'float', 'float', '', 'int', 'float'], 200, 600);
  wire(probeTrig, 0, transport2, 0);
  const probePack = obj('pack 0. 0.', 2, 1, [''], 200, 640);
  wire(probeTrig, 1, probePack, 1);
  wire(transport2, 7, probePack, 0);
  const probeMsg = obj('prepend probe', 1, 1, [''], 200, 680);
  wire(probePack, 0, probeMsg, 0);
  wire(probeMsg, 0, v8, 0);

  // --- utility messages for the patching view (not device parameters)
  comment('diagnostics: click in locked mode, output in the Max Console', 420, 300, null);
  ['stats', 'verbose 4', 'verbose 0', 'resetstats', 'lookahead 250', 'panic'].forEach((text, i) => {
    const m = msg(text, 420 + i * 95, 325);
    wire(m, 0, v8, 0);
  });

  // --- status line. Its saved text is the failure message; the script
  // replaces it as soon as it runs, so "not running" means v8 or the file
  // is missing.
  const statusSet = obj('prepend set', 1, 1, [''], 600, 380);
  wire(v8, 2, statusSet, 0);
  const statusLine = comment(STATUS_NOT_RUNNING, 600, 420, [8, 84, 470, 34], { varname: 'status' });
  wire(statusSet, 0, statusLine, 0);

  // --- parameters (saved with the set, automatable)
  comment('ORGANIC', 20, 760, [8, 4, 120, 20], { fontface: 1, fontsize: 12 });
  PARAMS.forEach((p, i) => {
    const x = 20 + i * 90;
    const px = 8 + i * 54;
    const isInt = p.type === 'int';
    const valueof = {
      parameter_longname: p.name,
      parameter_shortname: p.name,
      parameter_type: isInt ? 1 : 0,
      parameter_mmin: p.min,
      parameter_mmax: p.max,
      parameter_initial: [p.default],
      parameter_initial_enable: 1,
      parameter_unitstyle: isInt ? UNITSTYLE.int : p.unit === '%' ? UNITSTYLE.percent : UNITSTYLE.float,
      parameter_info: p.doc,
    };
    let ui;
    if (isInt) {
      comment(p.name, x, 800, [px, 28, 50, 18]);
      ui = add({
        maxclass: 'live.numbox',
        numinlets: 1,
        numoutlets: 2,
        outlettype: ['', 'float'],
        parameter_enable: 1,
        patching_rect: [x, 830, 50, 15],
        presentation: 1,
        presentation_rect: [px, 48, 48, 15],
        saved_attribute_attributes: { valueof },
        varname: p.name,
      });
    } else {
      ui = add({
        maxclass: 'live.dial',
        numinlets: 1,
        numoutlets: 2,
        outlettype: ['', 'float'],
        parameter_enable: 1,
        patching_rect: [x, 800, 44, 48],
        presentation: 1,
        presentation_rect: [px, 26, 44, 48],
        saved_attribute_attributes: { valueof },
        varname: p.name,
      });
    }
    wire(init, 1, ui, 0);
    const pre = obj('prepend param ' + p.id, 1, 1, [''], x, 880);
    wire(ui, 0, pre, 0);
    wire(pre, 0, v8, 0);
  });

  return {
    patcher: {
      fileversion: 1,
      appversion: { major: 9, minor: 0, revision: 7, architecture: 'x64', modernui: 1 },
      classnamespace: 'box',
      rect: [80, 80, 1400, 960],
      openinpresentation: 1,
      default_fontsize: 12,
      gridsize: [15, 15],
      boxes,
      lines,
      autosave: 0,
    },
  };
}

// Experimental: a Max for Live MIDI Effect file is the same patcher JSON
// behind a small binary header ('ampf', device type 'mmmm', 'meta', 'ptch').
// The layout is reverse-engineered, not documented; see the README.
function amxd(patcherJson) {
  const json = Buffer.from(patcherJson, 'utf8');
  const head = Buffer.alloc(32);
  head.write('ampf', 0, 'ascii');
  head.writeUInt32LE(4, 4);
  head.write('mmmm', 8, 'ascii');
  head.write('meta', 12, 'ascii');
  head.writeUInt32LE(4, 16);
  head.writeUInt32LE(0, 20);
  head.write('ptch', 24, 'ascii');
  head.writeUInt32LE(json.length, 28);
  return Buffer.concat([head, json]);
}

module.exports = { build, amxd, STATUS_NOT_RUNNING };
