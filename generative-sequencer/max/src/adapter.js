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

inlets = 1;
outlets = 2;
autowatch = 1;

var engine = OrganicEngine.createEngine({ mode: 'organic' });
var scheduler = new OrganicEngine.LookaheadScheduler(engine, { lookaheadMs: 150 });

var tp = { ticks: 0, resolution: 480, tempo: 120, num: 4, den: 4, state: 0 };
var loopInfo = { on: 0, start: 0, length: 0 };
var probeStats = { n: 0, sum: 0, sumSq: 0, min: Infinity, max: -Infinity };
var verboseMs = 0;
var lastReport = 0;

function bang() {
  var now = Date.now();
  emit(
    scheduler.tick({
      playing: tp.state > 0,
      beat: tp.ticks / (tp.resolution > 0 ? tp.resolution : 480),
      bpm: tp.tempo,
      meter: { num: tp.num, den: tp.den },
      timeMs: now,
    })
  );
  if (verboseMs > 0 && now - lastReport >= verboseMs) {
    lastReport = now;
    stats();
  }
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
  if (!engine.setParam(String(id), value)) post('organic: ignored param ' + id + ' ' + value + '\n');
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
  var line = 'organic: notes ' + s.notes + ', late ' + s.late + ', dropped ' + s.dropped + ', starts ' + s.starts + ', resyncs ' + s.resyncs + ', wraps ' + s.wraps + ', reschedules ' + s.reschedules;
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

function notifydeleted() {
  panic();
}

function anything() {
  post('organic: unknown message ' + messagename + '\n');
}

post('organic: engine ' + OrganicEngine.VERSION + ' (' + engine.mode + ') ready\n');
