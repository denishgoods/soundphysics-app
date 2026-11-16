// Max adapter for [v8 organic.js]. Kept deliberately thin: it turns Max
// messages into scheduler snapshots and scheduler commands into outlet calls.
// All musical and timing logic lives in the engine (bundled above as
// OrganicEngine) and is tested in Node.
//
// Top level uses var/function only: if v8 re-evaluates the script in the
// same global scope on autowatch reload, let/const would throw.
//
// Inlet 0 messages (from the patch):
//   bang                          clock tick (qmetro), after a transport read
//   transport <field> <value...>  from [transport]: ticks, state, tempo, timesig, resolution
//   lom <prop> <value>            from live.observer: loop, loop_start, loop_length
//   param <id> <value>            from the live.dial / live.numbox objects
//   probe <ticks> <aimedBeat>     transport ticks read when a note left [pipe]
//   stats, panic, lookahead <ms>, verbose <seconds>
// Outlets:
//   0  note velocity aimedBeat delayMs   -> [unpack] -> [pipe]
//   1  clear                              -> [pipe]
//   2  status words                       -> [prepend set] -> status line in the device

inlets = 1;
outlets = 3;
autowatch = 1;

var engine = OrganicEngine.createEngine({ mode: 'organic' });
var scheduler = new OrganicEngine.LookaheadScheduler(engine, { lookaheadMs: 150 });

var tp = { ticks: 0, resolution: 480, tempo: 120, num: 4, den: 4, state: 0 };
var loopInfo = { on: 0, start: 0, length: 0 };
var probeStats = { n: 0, sum: 0, sumSq: 0, min: Infinity, max: -Infinity };
var verboseMs = 0;
var lastReport = 0;
var status = { text: '', note: '', noteUntil: 0, last: 0, error: '' };

function bang() {
  var now = Date.now();
  var beat = tp.ticks / (tp.resolution > 0 ? tp.resolution : 480);
  try {
    emit(scheduler.tick({ playing: tp.state > 0, beat: beat, bpm: tp.tempo, meter: { num: tp.num, den: tp.den }, timeMs: now }));
  } catch (e) {
    // Report once; keep ticking so a transient problem doesn't kill the device.
    if (status.error !== String(e)) {
      status.error = String(e);
      post('organic: error ' + (e && e.stack ? e.stack : e) + '\n');
    }
  }
  if (verboseMs > 0 && now - lastReport >= verboseMs) {
    lastReport = now;
    stats();
  }
  if (now - status.last >= 250) {
    status.last = now;
    showStatus(now, beat);
  }
}

// One line in the device: proves the script runs, echoes knob moves, and
// shows transport state. The patch's built-in text says the script is NOT
// running, so a device that never gets here shows that instead.
function showStatus(now, beat) {
  var text;
  if (status.error) text = 'error: ' + status.error + ' (see Max Console)';
  else if (now < status.noteUntil) text = status.note;
  else if (tp.state > 0) {
    var bar = Math.floor(beat / engine.meter.barLen) + 1;
    text = 'playing - bar ' + bar + ' - ' + scheduler.stats.notes + ' notes';
  } else text = 'ready - press play in Live';
  if (text === status.text) return;
  status.text = text;
  outlet(2, text.split(' '));
}

function emit(cmds) {
  for (var i = 0; i < cmds.length; i++) {
    var c = cmds[i];
    if (c.type === 'clear') outlet(1, 'clear');
    else outlet(0, [c.note, c.velocity, c.songBeat, c.delayMs]);
  }
}

function transport(field, a, b) {
  if (field === 'ticks') tp.ticks = Number(a);
  else if (field === 'state') tp.state = Number(a);
  else if (field === 'tempo') tp.tempo = Number(a);
  else if (field === 'resolution') tp.resolution = Number(a);
  else if (field === 'timesig') {
    tp.num = Number(a) || 4;
    tp.den = Number(b) || 4;
  }
}

// live.observer output is expected to be the bare value; a "<prop> <value>"
// form is accepted too. Non-numeric output (e.g. while unbound) is ignored.
function lom(prop, a, b) {
  var value = Number(a === prop ? b : a);
  if (!isFinite(value)) return;
  if (prop === 'loop') loopInfo.on = value ? 1 : 0;
  else if (prop === 'loop_start') loopInfo.start = Number(value);
  else if (prop === 'loop_length') loopInfo.length = Number(value);
  else return;
  scheduler.setLoop(loopInfo.on, loopInfo.start, loopInfo.length);
}

function param(id, value) {
  if (!engine.setParam(String(id), value)) {
    post('organic: ignored param ' + id + ' ' + value + '\n');
    return;
  }
  var spec = OrganicEngine.paramSpec(String(id));
  var v = engine.getParams()[id];
  status.note = spec.name + ' ' + (spec.options ? spec.options[v] : Math.round(v) + (spec.unit ? ' ' + spec.unit : ''));
  status.noteUntil = Date.now() + 1500;
  showStatus(Date.now(), tp.ticks / (tp.resolution > 0 ? tp.resolution : 480));
}

// Timing self-test: how far from its aimed song position each note actually
// left Max, measured on the high-priority thread.
function probe(ticks, aimedBeat) {
  if (!(aimedBeat >= 0)) return;
  var res = tp.resolution > 0 ? tp.resolution : 480;
  var errMs = (Number(ticks) / res - aimedBeat) * (60000 / tp.tempo);
  if (!isFinite(errMs) || Math.abs(errMs) > 1000) return; // loop wrap or stop in between
  probeStats.n++;
  probeStats.sum += errMs;
  probeStats.sumSq += errMs * errMs;
  if (errMs < probeStats.min) probeStats.min = errMs;
  if (errMs > probeStats.max) probeStats.max = errMs;
}

function stats() {
  var s = scheduler.stats;
  var line = 'organic: notes ' + s.notes + ', late ' + s.late + ', dropped ' + s.dropped + ', merged ' + s.merged + ', starts ' + s.starts + ', resyncs ' + s.resyncs + ', wraps ' + s.wraps + ', reschedules ' + s.reschedules;
  if (probeStats.n > 0) {
    var mean = probeStats.sum / probeStats.n;
    var sd = Math.sqrt(Math.max(0, probeStats.sumSq / probeStats.n - mean * mean));
    line += ' | probe n ' + probeStats.n + ' mean ' + mean.toFixed(2) + ' ms, sd ' + sd.toFixed(2) + ' ms, min ' + probeStats.min.toFixed(2) + ', max ' + probeStats.max.toFixed(2);
  }
  post(line + '\n');
}

function resetstats() {
  var s = scheduler.stats;
  for (var k in s) s[k] = 0;
  probeStats = { n: 0, sum: 0, sumSq: 0, min: Infinity, max: -Infinity };
}

function panic() {
  emit(scheduler.panic());
}

function lookahead(ms) {
  var v = Number(ms);
  if (v >= 20 && v <= 2000) scheduler.lookaheadMs = v;
}

function verbose(seconds) {
  verboseMs = Math.max(0, Number(seconds) || 0) * 1000;
}

function anything() {
  post('organic: unknown message ' + messagename + '\n');
}

post('organic: engine ' + OrganicEngine.VERSION + ' (' + engine.mode + ') ready\n');
