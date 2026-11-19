// Organic Groove Lab: the preview page. Runs the same engine as the Max device
// and the plugin (bundled above as OrganicPreviewLib), plays it through the
// placeholder kit with a Web Audio look-ahead scheduler, and saves MIDI clips.
(function () {
  'use strict';
  var L = OrganicPreviewLib;
  var E = L.E;
  var LOOKAHEAD = 0.15; // seconds of notes scheduled ahead
  var TICK_MS = 25;
  var LANE_COLORS = ['--kick', '--snare', '--hat', '--perc'];
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  var $ = function (id) { return document.getElementById(id); };
  var specs = E.PARAMS;
  var knobSpecs = specs.filter(function (p) { return p.type === 'float'; });
  var values = {};
  specs.forEach(function (p) { values[p.id] = p.default; });
  var bpm = 120;

  // ---- engine ---------------------------------------------------------------
  var engine = E.createEngine({ params: values, bpm: bpm });
  var lanes = engine.lanes;
  var levels = lanes.map(function () { return 0.8; });
  var muted = lanes.map(function () { return false; });

  function setParam(id, v) {
    engine.setParam(id, v);
    values[id] = engine.getParams()[id];
    refreshSettings();
    schedulePreview();
  }

  // ---- audio ----------------------------------------------------------------
  var ctx = null;
  var buffers = {};
  var laneGain = [];
  var scheduled = [];
  function ensureAudio() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    var master = ctx.createGain();
    master.gain.value = 0.9;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
    lanes.forEach(function (lane, i) {
      var g = ctx.createGain();
      var voice = L.kit.VOICES[lane.note] || L.kit.VOICES[37];
      var out = g;
      if (ctx.createStereoPanner) {
        var pan = ctx.createStereoPanner();
        pan.pan.value = voice.pan;
        g.connect(pan);
        out = pan;
      }
      out.connect(master);
      laneGain.push(g);
      applyLevel(i);
      if (!buffers[lane.note]) {
        var data = L.kit.renderVoice(lane.note, ctx.sampleRate, 4242 + lane.note);
        var buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
        buf.getChannelData(0).set(data);
        buffers[lane.note] = buf;
      }
    });
    return ctx;
  }
  function applyLevel(i) {
    if (laneGain[i]) laneGain[i].gain.value = muted[i] ? 0 : levels[i];
  }

  // ---- transport ------------------------------------------------------------
  var playing = false;
  var timer = null;
  var anchorTime = 0;
  var anchorBeat = 0;
  var cursor = 0;
  var played = []; // recent notes for the roll: {beat, lane, velocity}
  var notesCount = 0;

  function beatAt(t) { return anchorBeat + ((t - anchorTime) * bpm) / 60; }
  function timeAt(b) { return anchorTime + ((b - anchorBeat) * 60) / bpm; }

  function start(fromBar1) {
    ensureAudio();
    if (ctx.state === 'suspended') ctx.resume();
    if (fromBar1 || !playing) {
      stopSources();
      engine.setTempo(bpm);
      engine.reset(0);
      anchorTime = ctx.currentTime + 0.08;
      anchorBeat = 0;
      cursor = 0;
      played = [];
      notesCount = 0;
    }
    if (!playing) {
      playing = true;
      timer = setInterval(tick, TICK_MS);
      requestAnimationFrame(draw);
    }
    tick();
    $('play').textContent = 'Stop';
  }

  function stop() {
    playing = false;
    clearInterval(timer);
    stopSources();
    allNotesOff();
    $('play').textContent = 'Play';
    schedulePreview();
  }

  function stopSources() {
    var now = ctx ? ctx.currentTime : 0;
    scheduled.forEach(function (s) {
      try { if (s.when > now - 0.01) s.src.stop(); } catch (e) { /* already stopped */ }
    });
    scheduled = [];
  }

  function tick() {
    if (!playing) return;
    var now = ctx.currentTime;
    var horizon = beatAt(now + LOOKAHEAD);
    if (horizon > cursor) {
      var evs = engine.generate(cursor, horizon);
      cursor = horizon;
      for (var i = 0; i < evs.length; i++) playEvent(evs[i], now);
    }
    scheduled = scheduled.filter(function (s) { return s.when > now - 1; });
    if (played.length > 600) played = played.slice(-400);
  }

  function playEvent(ev, now) {
    var when = Math.max(now, timeAt(ev.beat));
    var snd = sounds[ev.lane];
    var buf = buffers[ev.note];
    if (snd.source === 'sample' && snd.buffer) {
      playSample(snd, ev, when);
    } else if (buf) {
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var g = ctx.createGain();
      g.gain.value = L.kit.velocityGain(ev.note, ev.velocity);
      src.connect(g);
      g.connect(laneGain[ev.lane]);
      src.start(when);
      scheduled.push({ src: src, when: when });
    }
    sendMidi(ev, when - now);
    played.push({ beat: ev.beat, lane: ev.lane, velocity: ev.velocity, duration: ev.duration });
    notesCount++;
  }

  // A sample hit. Start point by the lane's mode: from the start, a random
  // point, or mixed (accents from the start, other hits half the time from
  // inside). Length cuts it short; short fades avoid clicks.
  function playSample(snd, ev, when) {
    var buf = snd.buffer;
    var dur = buf.duration;
    var len = snd.lengthMs > 0 ? Math.min(dur, snd.lengthMs / 1000) : dur;
    var fromStart = snd.start === 'start' || (snd.start === 'mixed' && (ev.velocity >= 100 || Math.random() < 0.5));
    var offset = fromStart ? 0 : Math.random() * Math.max(0, dur - Math.min(len, dur) * 0.5);
    len = Math.min(len, dur - offset);
    if (len <= 0.005) return;
    var amp = 0.9 * Math.pow(ev.velocity / 127, 1.4);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var g = ctx.createGain();
    var fadeIn = offset > 0 ? 0.004 : 0.0005;
    var fadeOut = Math.min(0.02, len * 0.3);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(amp, when + fadeIn);
    g.gain.setValueAtTime(amp, when + len - fadeOut);
    g.gain.linearRampToValueAtTime(0, when + len);
    src.connect(g);
    g.connect(laneGain[ev.lane]);
    src.start(when, offset, len);
    scheduled.push({ src: src, when: when });
  }

  function setTempo(v) {
    var b = Math.min(200, Math.max(60, Math.round(Number(v) || 120)));
    if (playing) {
      var now = ctx.currentTime;
      anchorBeat = beatAt(now);
      anchorTime = now;
    }
    bpm = b;
    engine.setTempo(b);
    $('bpm').value = b;
    refreshSettings();
  }

  // ---- live MIDI out (works in a local copy opened in Chrome; refused inside Claude) ----
  var midiOut = null;
  function sendMidi(ev, delaySec) {
    if (!midiOut) return;
    var t = performance.now() + Math.max(0, delaySec) * 1000;
    try {
      midiOut.send([0x90, ev.note, ev.velocity], t);
      midiOut.send([0x80, ev.note, 0], t + (ev.duration * 60000) / bpm);
    } catch (e) { midiOut = null; }
  }
  function allNotesOff() {
    if (!midiOut) return;
    lanes.forEach(function (l) { try { midiOut.send([0x80, l.note, 0]); } catch (e) { /* port gone */ } });
  }
  function connectMidi() {
    var status = $('status');
    if (!navigator.requestMIDIAccess) {
      status.textContent = 'Live MIDI needs Chrome or Edge with the local copy of this page (generative-sequencer/preview/organic-preview.html).';
      return;
    }
    navigator.requestMIDIAccess().then(function (access) {
      var sel = $('midi-out');
      sel.innerHTML = '';
      var none = document.createElement('option');
      none.value = '';
      none.textContent = 'No MIDI output';
      sel.appendChild(none);
      access.outputs.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.name;
        sel.appendChild(opt);
      });
      sel.hidden = false;
      sel.onchange = function () {
        midiOut = sel.value ? access.outputs.get(sel.value) : null;
        status.textContent = midiOut ? 'Sending to ' + midiOut.name + '. In Ableton, set a Drum Rack track’s MIDI From to it and Monitor to In.' : '';
      };
      status.textContent = access.outputs.size
        ? 'Pick a port. On a Mac, enable the IAC Driver in Audio MIDI Setup to reach Ableton.'
        : 'No MIDI outputs found. On a Mac, enable the IAC Driver in Audio MIDI Setup.';
    }, function () {
      status.textContent = 'This view blocks MIDI ports. Open the local copy of this page (generative-sequencer/preview/organic-preview.html) in Chrome to send live MIDI.';
    });
  }

  // ---- saving clips ---------------------------------------------------------
  function clipEvents(bars) {
    var e = E.createEngine({ params: values, bpm: bpm });
    e.reset(0);
    var total = bars * e.meter.barLen;
    var out = [];
    for (var b = 0; b < total; b += 0.25) out = out.concat(e.generate(b, Math.min(total, b + 0.25)));
    return { notes: out, meter: e.meter };
  }
  function clipName(bars) {
    var mode = specs.filter(function (p) { return p.id === 'mode'; })[0].options[values.mode].toLowerCase();
    return mode + '-seed' + values.seed + '-' + bpm + 'bpm-' + bars + 'bars';
  }
  function midiBytes(bars) {
    var c = clipEvents(bars);
    return L.midi.writeMidi({ notes: c.notes, bpm: bpm, meter: c.meter, name: clipName(bars) });
  }

  // Minimal stored (uncompressed) zip with one file: the save dialog inside
  // Claude takes .zip but not .mid.
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zipOne(name, data) {
    var nameBytes = new TextEncoder().encode(name);
    var crc = crc32(data);
    var local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    var central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, 1, true);
    end.setUint16(10, 1, true);
    end.setUint32(12, 46 + nameBytes.length, true);
    end.setUint32(16, 30 + nameBytes.length + data.length, true);
    return new Blob([local.buffer, nameBytes, data, central.buffer, nameBytes, end.buffer], { type: 'application/zip' });
  }

  function saveClip() {
    var bars = Number($('bars').value);
    var bytes = midiBytes(bars);
    var name = clipName(bars);
    var status = $('status');
    var useCapability = window.claude && typeof window.claude.use === 'function';
    if (useCapability) {
      window.claude.use('downloads').then(function (d) {
        if (!d) return saveLocal(bytes, name);
        return d.save({ filename: name + '.zip', data: zipOne(name + '.mid', bytes) }).then(function () {
          status.textContent = 'Saved ' + name + '.zip. Unzip it and drag the .mid onto a Drum Rack track.';
        }, function (err) {
          var code = err && err.code;
          if (code === 'declined') status.textContent = 'Not saved.';
          else if (code === 'rate_limited') status.textContent = 'A save dialog is already open.';
          else status.textContent = 'Saving isn’t available in this view. Use Copy settings instead.';
        });
      });
    } else {
      saveLocal(bytes, name);
    }
  }
  function saveLocal(bytes, name) {
    var url = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = name + '.mid';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    $('status').textContent = 'Saved ' + name + '.mid. Drag it onto a Drum Rack track.';
  }

  function settingsText() {
    return specs.map(function (p) {
      var v = values[p.id];
      return p.name + '\u00a0' + (p.options ? p.options[v] : p.type === 'float' ? Math.round(v) + '\u00a0%' : v);
    }).join(' · ') + ' · Tempo\u00a0' + bpm;
  }
  function refreshSettings() { $('settings').textContent = settingsText(); }

  // ---- knobs ----------------------------------------------------------------
  var ARC = 270;
  function arcPath(frac) {
    var a0 = (135 * Math.PI) / 180;
    var a1 = a0 + (ARC * frac * Math.PI) / 180;
    var r = 26;
    var x0 = 32 + r * Math.cos(a0), y0 = 32 + r * Math.sin(a0);
    var x1 = 32 + r * Math.cos(a1), y1 = 32 + r * Math.sin(a1);
    var large = ARC * frac > 180 ? 1 : 0;
    return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2);
  }
  var knobViews = {};
  function buildKnob(p) {
    var cell = document.createElement('div');
    cell.className = 'knob-cell';
    cell.innerHTML =
      '<div class="knob" role="slider" tabindex="0" id="knob-' + p.id + '" aria-label="' + p.name + '" aria-valuemin="0" aria-valuemax="100">' +
      '<svg viewBox="0 0 64 64" aria-hidden="true"><path class="track" fill="none" stroke-width="5" stroke-linecap="round" d="' + arcPath(1) + '"></path>' +
      '<path class="value" fill="none" stroke-width="5" stroke-linecap="round"></path><circle class="cap" cx="32" cy="32" r="17" stroke-width="1"></circle>' +
      '<line class="pointer" x1="32" y1="32" x2="32" y2="18" stroke-width="2.5" stroke-linecap="round"></line></svg></div>' +
      '<div class="knob-name">' + p.name + '</div><div class="knob-val"></div><div class="knob-doc">' + p.doc + '</div>';
    var el = cell.querySelector('.knob');
    knobViews[p.id] = { el: el, value: cell.querySelector('.value'), pointer: cell.querySelector('.pointer'), text: cell.querySelector('.knob-val') };
    var dragY = null;
    var dragV = 0;
    el.addEventListener('pointerdown', function (e) {
      dragY = e.clientY;
      dragV = values[p.id];
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) {
      if (dragY === null) return;
      var step = e.shiftKey ? 0.15 : 0.6;
      setKnob(p, dragV + (dragY - e.clientY) * step);
    });
    el.addEventListener('pointerup', function () { dragY = null; });
    el.addEventListener('pointercancel', function () { dragY = null; });
    el.addEventListener('dblclick', function () { setKnob(p, p.default); });
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      setKnob(p, values[p.id] - Math.sign(e.deltaY) * (e.shiftKey ? 1 : 3));
    }, { passive: false });
    el.addEventListener('keydown', function (e) {
      var d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (e.key === 'Home') d = -100;
      if (e.key === 'End') d = 100;
      if (d === undefined) return;
      e.preventDefault();
      setKnob(p, values[p.id] + d * (e.shiftKey ? 1 : d === 1 || d === -1 ? 2 : 1));
    });
    return cell;
  }
  function setKnob(p, v) {
    setParam(p.id, Math.round(Math.min(p.max, Math.max(p.min, v))));
    renderKnob(p);
  }
  function renderKnob(p) {
    var k = knobViews[p.id];
    var v = values[p.id];
    var frac = (v - p.min) / (p.max - p.min);
    k.value.setAttribute('d', frac > 0.001 ? arcPath(frac) : '');
    var ang = 135 + ARC * frac;
    k.pointer.setAttribute('transform', 'rotate(' + (ang + 90) + ' 32 32)');
    k.text.textContent = Math.round(v) + ' %';
    k.el.setAttribute('aria-valuenow', String(Math.round(v)));
    k.el.setAttribute('aria-valuetext', Math.round(v) + ' percent');
  }

  // ---- mode, seed, kit ------------------------------------------------------
  var modeSpec = specs.filter(function (p) { return p.id === 'mode'; })[0];
  function buildMode() {
    var box = $('mode');
    modeSpec.options.forEach(function (name, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.id = 'mode-' + name.toLowerCase();
      b.textContent = name;
      b.addEventListener('click', function () {
        setParam('mode', i);
        renderMode();
      });
      box.appendChild(b);
    });
  }
  function renderMode() {
    modeSpec.options.forEach(function (name, i) {
      $('mode-' + name.toLowerCase()).setAttribute('aria-pressed', String(values.mode === i));
    });
  }
  function noteName(n) { return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2); }
  // ---- lane sounds: placeholder synth, uploaded or recorded samples ----------
  var START_MODES = [
    ['start', 'From start'],
    ['random', 'Random point'],
    ['mixed', 'Mixed'],
  ];
  var sounds = lanes.map(function () {
    return { source: 'synth', name: '', bytes: null, buffer: null, start: 'mixed', lengthMs: 0 };
  });

  function decodeInto(i, name, bytes, keep) {
    ensureAudio();
    // decodeAudioData detaches its input, so keep our own copy for storage.
    return ctx.decodeAudioData(bytes.slice(0)).then(function (buffer) {
      var snd = sounds[i];
      snd.name = name;
      snd.bytes = bytes;
      snd.trim = keep === 'trim';
      snd.buffer = snd.trim ? trimAndNormalize(buffer) : buffer;
      snd.source = 'sample';
      renderLane(i);
      saveLane(i);
      setStatus(lanes[i].name + ': ' + name + ' loaded (' + snd.buffer.duration.toFixed(2) + ' s).');
    }, function () {
      setStatus('Couldn’t read that file as audio. Try a WAV, AIFF, MP3 or M4A.');
      renderLane(i);
    });
  }

  // Recordings: skip the silence before the first sound, normalise the peak.
  function trimAndNormalize(buffer) {
    var ch = buffer.getChannelData(0);
    var peak = 0;
    for (var k = 0; k < ch.length; k++) peak = Math.max(peak, Math.abs(ch[k]));
    if (peak < 1e-4) return buffer;
    var start = 0;
    while (start < ch.length && Math.abs(ch[start]) < peak * 0.08) start++;
    start = Math.max(0, start - Math.round(buffer.sampleRate * 0.005));
    var n = ch.length - start;
    var out = ctx.createBuffer(1, n, buffer.sampleRate);
    var o = out.getChannelData(0);
    var gain = 0.9 / peak;
    for (var j = 0; j < n; j++) o[j] = ch[start + j] * gain;
    return out;
  }

  function loadFile(i, file) {
    if (!file) return;
    file.arrayBuffer().then(function (bytes) { decodeInto(i, file.name, bytes); });
  }

  // Microphone recording (allowed in a normal browser tab; refused inside Claude).
  var recorder = null;
  function toggleRecord(i) {
    var btn = document.getElementById('rec-' + i);
    if (recorder && recorder.lane === i) {
      recorder.mr.stop();
      return;
    }
    if (recorder) recorder.mr.stop();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      setStatus('Recording needs a browser with microphone access. Upload a sample instead.');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function (stream) {
      var chunks = [];
      var mr = new MediaRecorder(stream);
      var started = Date.now();
      recorder = { lane: i, mr: mr, timer: null };
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = function () {
        clearInterval(recorder.timer);
        stream.getTracks().forEach(function (t) { t.stop(); });
        recorder = null;
        btn.textContent = 'Record';
        btn.setAttribute('aria-pressed', 'false');
        new Blob(chunks, { type: mr.mimeType }).arrayBuffer().then(function (bytes) {
          decodeInto(i, 'Recording ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), bytes, 'trim');
        });
      };
      mr.start();
      btn.setAttribute('aria-pressed', 'true');
      recorder.timer = setInterval(function () {
        var t = (Date.now() - started) / 1000;
        btn.textContent = 'Stop · ' + t.toFixed(1) + ' s';
        if (t >= 10) mr.stop();
      }, 100);
      btn.textContent = 'Stop · 0.0 s';
      setStatus('Recording for ' + lanes[i].name + '. Make the sound, then press Stop (10 s at most).');
    }, function () {
      setStatus('The microphone isn’t available here. Inside Claude it’s blocked: open the local copy of this page (generative-sequencer/preview/organic-preview.html) in Chrome to record, or upload a file.');
    });
  }

  function setStatus(t) { $('status').textContent = t; }

  function buildLanes() {
    var box = $('lanes');
    lanes.forEach(function (lane, i) {
      var row = document.createElement('div');
      row.className = 'lane';
      row.id = 'lane-' + i;
      row.innerHTML =
        '<div class="lane-head">' +
        '<span class="swatch" style="background:var(' + LANE_COLORS[i % 4] + ')"></span>' +
        '<span class="lane-title"><span class="name">' + lane.name + '</span> <span class="note">' + noteName(lane.note) + ' · ' + lane.note + '</span></span>' +
        '<select id="sound-' + i + '" aria-label="' + lane.name + ' sound"></select>' +
        '<button type="button" id="mute-' + i + '" aria-pressed="false">Mute</button>' +
        '</div>' +
        '<div class="lane-body">' +
        '<label class="mini" for="start-' + i + '">Start <select id="start-' + i + '"></select></label>' +
        '<label class="mini" for="len-' + i + '">Length <input type="range" id="len-' + i + '" min="0" max="2000" step="10" value="0"><output id="len-out-' + i + '">full</output></label>' +
        '<label class="mini" for="level-' + i + '">Level <input type="range" min="0" max="1" step="0.01" value="0.8" id="level-' + i + '"></label>' +
        '<button type="button" id="rec-' + i + '" aria-pressed="false">Record</button>' +
        '<input type="file" id="file-' + i + '" accept="audio/*" hidden>' +
        '</div>';
      box.appendChild(row);

      var startSel = row.querySelector('#start-' + i);
      START_MODES.forEach(function (m) {
        var o = document.createElement('option');
        o.value = m[0];
        o.textContent = m[1];
        startSel.appendChild(o);
      });
      startSel.addEventListener('change', function () { sounds[i].start = startSel.value; saveLane(i); });
      var len = row.querySelector('#len-' + i);
      len.addEventListener('input', function () { sounds[i].lengthMs = Number(len.value); renderLane(i); });
      len.addEventListener('change', function () { saveLane(i); });
      row.querySelector('#level-' + i).addEventListener('input', function (e) {
        levels[i] = Number(e.target.value);
        applyLevel(i);
      });
      var mb = row.querySelector('#mute-' + i);
      mb.addEventListener('click', function () {
        muted[i] = !muted[i];
        mb.setAttribute('aria-pressed', String(muted[i]));
        applyLevel(i);
      });
      var file = row.querySelector('#file-' + i);
      file.addEventListener('change', function () { loadFile(i, file.files[0]); file.value = ''; });
      row.querySelector('#rec-' + i).addEventListener('click', function () { toggleRecord(i); });
      row.querySelector('#sound-' + i).addEventListener('change', function (e) {
        var v = e.target.value;
        if (v === 'upload') file.click();
        else if (v === 'record') toggleRecord(i);
        else {
          sounds[i].source = v;
          saveLane(i);
        }
        renderLane(i);
      });
      // Drop an audio file anywhere on the lane.
      row.addEventListener('dragover', function (e) { e.preventDefault(); row.classList.add('drop'); });
      row.addEventListener('dragleave', function () { row.classList.remove('drop'); });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        row.classList.remove('drop');
        loadFile(i, e.dataTransfer.files[0]);
      });
      renderLane(i);
    });
  }

  function renderLane(i) {
    var snd = sounds[i];
    var sel = document.getElementById('sound-' + i);
    var opts = [['synth', 'Placeholder synth']];
    if (snd.buffer) opts.push(['sample', 'Sample: ' + snd.name]);
    opts.push(['upload', 'Upload a sample…'], ['record', 'Record with microphone…']);
    sel.innerHTML = '';
    opts.forEach(function (o) {
      var el = document.createElement('option');
      el.value = o[0];
      el.textContent = o[1];
      sel.appendChild(el);
    });
    sel.value = snd.source === 'sample' && snd.buffer ? 'sample' : 'synth';
    var isSample = sel.value === 'sample';
    document.getElementById('start-' + i).value = snd.start;
    document.getElementById('start-' + i).disabled = !isSample;
    document.getElementById('len-' + i).disabled = !isSample;
    document.getElementById('len-' + i).value = snd.lengthMs;
    document.getElementById('len-out-' + i).textContent = snd.lengthMs > 0 ? snd.lengthMs + ' ms' : 'full';
    document.getElementById('lane-' + i).classList.toggle('sampled', isSample);
  }

  // Samples are kept in this browser (IndexedDB) so they survive a reload.
  var DB_NAME = 'organic-groove-lab';
  function openDb() {
    return new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('lanes'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
  }
  function saveLane(i) {
    var snd = sounds[i];
    var rec = { source: snd.source, name: snd.name, bytes: snd.bytes, trim: snd.trim, start: snd.start, lengthMs: snd.lengthMs };
    openDb().then(function (db) {
      db.transaction('lanes', 'readwrite').objectStore('lanes').put(rec, lanes[i].note);
    }).catch(function () { /* storage unavailable: samples last until reload */ });
  }
  function restoreLanes() {
    openDb().then(function (db) {
      lanes.forEach(function (lane, i) {
        var req = db.transaction('lanes').objectStore('lanes').get(lane.note);
        req.onsuccess = function () {
          var r = req.result;
          if (!r) return;
          sounds[i].start = r.start || 'mixed';
          sounds[i].lengthMs = r.lengthMs || 0;
          if (r.bytes) {
            decodeInto(i, r.name, r.bytes, r.trim ? 'trim' : undefined).then(function () {
              sounds[i].source = r.source === 'sample' ? 'sample' : 'synth';
              renderLane(i);
              setStatus('');
            });
          } else renderLane(i);
        };
      });
    }).catch(function () { /* no storage */ });
  }

  // ---- roll -----------------------------------------------------------------
  var canvas = $('roll');
  var previewNotes = [];
  var previewTimer = null;
  function schedulePreview() {
    if (playing) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      previewNotes = clipEvents(4).notes;
      draw();
    }, 60);
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function draw() {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    var g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var barLen = engine.meter.barLen;
    var span = barLen * 4; // beats visible
    var now = playing ? beatAt(ctx.currentTime) : 0;
    var left = playing ? now - span * 0.75 : 0;
    var x = function (b) { return ((b - left) / span) * w; };
    var laneH = h / lanes.length;
    var grid = cssVar('--grid');
    var strong = cssVar('--grid-strong');
    for (var s = Math.ceil(left * 4); s <= (left + span) * 4; s++) {
      var b = s / 4;
      var isBar = Math.abs(b / barLen - Math.round(b / barLen)) < 1e-9;
      g.strokeStyle = isBar ? strong : grid;
      g.lineWidth = isBar ? 1.5 : s % 4 === 0 ? 1 : 0.5;
      g.beginPath();
      g.moveTo(x(b) + 0.5, 0);
      g.lineTo(x(b) + 0.5, h);
      g.stroke();
      if (isBar && b >= 0) {
        g.fillStyle = cssVar('--muted');
        g.font = '11px ' + cssVar('--font-mono');
        g.fillText(String(Math.round(b / barLen) + 1), x(b) + 4, 12);
      }
    }
    var notes = playing ? played : previewNotes;
    var colors = LANE_COLORS.map(cssVar);
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      if (n.beat < left - 1 || n.beat > left + span) continue;
      var bh = 6 + (laneH - 12) * (n.velocity / 127);
      g.globalAlpha = 0.3 + 0.7 * (n.velocity / 127);
      g.fillStyle = colors[n.lane % 4];
      g.fillRect(x(n.beat), n.lane * laneH + laneH - 3 - bh, Math.max(3, (n.duration / span) * w), bh);
    }
    g.globalAlpha = 1;
    if (playing) {
      g.strokeStyle = cssVar('--accent');
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x(now), 0);
      g.lineTo(x(now), h);
      g.stroke();
      var bar = Math.floor(now / barLen);
      $('pos').innerHTML = 'bar <b>' + (bar + 1) + '</b> · beat <b>' + (Math.floor(now - bar * barLen) + 1) + '</b> · ' + notesCount + ' notes';
      renderGrouping(engine, bar);
      requestAnimationFrame(draw);
    } else {
      $('pos').innerHTML = 'bar <b>1</b> · beat <b>1</b> · preview of bars 1–4';
      var pe = E.createEngine({ params: values, bpm: bpm });
      pe.reset(0);
      renderGrouping(pe, 0);
    }
  }

  // Info strip under the transport: what the current mode is doing this bar.
  var lastGrouping = '';
  var MODE_HINT = {
    organic: 'Organic: a drifting player with memory. Figures hold for a phrase and vary at its end.',
  };
  function esc(t) { return String(t).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function renderGrouping(eng, bar) {
    var box = $('grouping');
    var mode = eng.mode;
    if (MODE_HINT[mode]) {
      if (lastGrouping !== mode) {
        box.innerHTML = '<span class="hint">' + MODE_HINT[mode] + '</span>';
        lastGrouping = mode;
      }
      return;
    }
    var plan = null;
    try { plan = eng.generator.debugPlan(Math.max(0, bar), eng.state); } catch (e) { plan = null; }
    if (!plan) return;
    var names = eng.lanes.map(function (l) { return l.name; });
    var key, html;
    if (mode === 'irregular') {
      if (!plan.groups) return;
      key = 'i' + plan.groups.join('+') + '@' + plan.phase;
      if (key === lastGrouping) return;
      var cycle = plan.groups.reduce(function (a, b) { return a + b; }, 0);
      html = '<span class="hint">Grouping</span>';
      var acc = 0;
      plan.groups.forEach(function (gl) {
        var now = plan.phase >= acc && plan.phase < acc + gl;
        html += '<span class="g' + (now ? ' now' : '') + '">' + gl + '</span>';
        acc += gl;
      });
      html += '<span class="hint">' + cycle + ' units' + (cycle !== 16 ? ', slides across the bar line' : ', one bar') + '</span>';
    } else if (mode === 'mathematical') {
      if (!plan.cycles) return;
      key = 'm' + plan.cycles.map(function (c) { return c.k + ',' + c.n + ',' + c.r; }).join('|');
      if (key === lastGrouping) return;
      html = '<span class="hint">Euclid</span>';
      plan.cycles.forEach(function (c, li) {
        var poly = c.n !== 16;
        html += '<span class="g' + (poly ? ' now' : '') + '" title="' + (poly ? 'polymeter: cycle of ' + c.n + ' steps drifts against the bar' : 'cycle locked to the bar') + '">' +
          esc(names[li] || 'Lane ' + (li + 1)) + ' E(' + c.k + ',' + c.n + ')' + (c.r ? '+' + c.r : '') + '</span>';
      });
      html += '<span class="hint">highlighted = polymeter</span>';
    } else if (mode === 'physical') {
      var counts = names.map(function () { return 0; });
      plan.notes.forEach(function (n) { counts[n.lane]++; });
      key = 'p' + counts.join(',') + '/' + plan.balls;
      if (key === lastGrouping) return;
      var roles = eng.lanes.map(function (l) { return l.role; });
      html = '<span class="hint">Pendulums</span>';
      roles.forEach(function (r, li) { if (r === 'anchor' || r === 'pulse') html += '<span class="g">' + esc(names[li]) + ' ' + counts[li] + '</span>'; });
      html += '<span class="hint">Bouncing</span>';
      roles.forEach(function (r, li) { if (r !== 'anchor' && r !== 'pulse') html += '<span class="g' + (counts[li] ? ' now' : '') + '">' + esc(names[li]) + ' ' + counts[li] + '</span>'; });
      html += '<span class="hint">hits this bar' + (plan.balls ? ' · ' + plan.balls + ' still bouncing' : '') + '</span>';
    } else {
      return;
    }
    lastGrouping = key;
    box.innerHTML = html;
  }

  // ---- wire up --------------------------------------------------------------
  buildMode();
  renderMode();
  var rack = $('rack');
  knobSpecs.forEach(function (p) {
    rack.appendChild(buildKnob(p));
    renderKnob(p);
  });
  buildLanes();
  restoreLanes();
  refreshSettings();

  $('play').addEventListener('click', function () { if (playing) stop(); else start(true); });
  $('restart').addEventListener('click', function () { start(true); });
  $('bpm').addEventListener('change', function (e) { setTempo(e.target.value); });
  $('seed').addEventListener('change', function (e) {
    setParam('seed', Number(e.target.value));
    e.target.value = values.seed;
  });
  $('dice').addEventListener('click', function () {
    var s = Math.floor(Math.random() * 10000);
    setParam('seed', s);
    $('seed').value = values.seed;
  });
  $('reset').addEventListener('click', function () {
    knobSpecs.forEach(function (p) { setKnob(p, p.default); });
  });
  $('save').addEventListener('click', saveClip);
  $('copy').addEventListener('click', function () {
    var text = settingsText();
    var done = function () { $('status').textContent = 'Settings copied.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { selectSettings(); });
    } else selectSettings();
  });
  function selectSettings() {
    var r = document.createRange();
    r.selectNodeContents($('settings'));
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    $('status').textContent = 'Settings selected. Press Cmd+C or Ctrl+C to copy.';
  }
  $('midi').addEventListener('click', connectMidi);
  window.addEventListener('resize', function () { if (!playing) draw(); });

  schedulePreview();

  // For tests: the notes a saved clip would contain.
  window.__organicLab = { clipEvents: clipEvents, midiBytes: midiBytes, zipOne: zipOne, values: values, sounds: sounds, decodeInto: decodeInto };
})();
