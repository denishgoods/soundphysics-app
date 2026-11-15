'use strict';

// Meter, metric weight and rhythmic attractors. All positions are in
// quarter-note beats, measured from the start of a bar.

const EPS = 1e-9;

function makeMeter(num, den) {
  num = Math.max(1, Math.round(num) || 4);
  den = [1, 2, 4, 8, 16].indexOf(den) >= 0 ? den : 4;
  const beatLen = 4 / den;
  const barLen = num * beatLen;
  // 6/8, 9/8, 12/8: the felt pulse is a dotted quarter, subdivided in three.
  const compound = den >= 8 && num % 3 === 0 && num > 3;
  const pulse = compound ? 3 * beatLen : beatLen;
  const pulsesPerBar = barLen / pulse;
  const meter = { num, den, beatLen, barLen, pulse, pulsesPerBar, compound, levels: [] };

  const evenPulses = Math.abs(pulsesPerBar - Math.round(pulsesPerBar)) < EPS && Math.round(pulsesPerBar) % 2 === 0;
  const lv = (period, weight, family) => meter.levels.push({ period, weight, family });
  lv(barLen, 1.0, 'main');
  const halfBar = evenPulses && pulsesPerBar >= 4;
  if (halfBar) lv(barLen / 2, 0.82, 'main');
  // The strongest position inside the bar after the downbeat.
  meter.strong = halfBar ? barLen / 2 : barLen;
  lv(pulse, 0.66, 'main');
  if (compound) {
    lv(pulse / 3, 0.46, 'main');
    lv(pulse / 6, 0.3, 'main');
    lv(pulse / 2, 0.3, 'cross'); // duplets against the compound pulse
    lv(pulse / 4, 0.18, 'cross');
  } else {
    lv(pulse / 2, 0.46, 'main');
    lv(pulse / 4, 0.3, 'main');
    lv(pulse / 3, 0.34, 'cross'); // triplets
    lv(pulse / 6, 0.2, 'cross');
  }
  lv(pulse / 5, 0.16, 'odd'); // quintuplets
  meter.key = num + '/' + den;
  meter.attractors = buildAttractors(meter);
  return meter;
}

function distToMultiple(x, period) {
  const r = x - Math.round(x / period) * period;
  return Math.abs(r);
}

function isOn(x, period) {
  return distToMultiple(x, period) < 1e-6;
}

// Soft metric weight in [0.1, 1]: the strongest metric level a position sits
// on, with a gaussian fall-off for positions slightly off it. A note a few
// milliseconds late still reads as "on the beat", just a little less.
const SOFT_SIGMA = 0.04;
function metricWeight(meter, pos) {
  let best = 0.1;
  for (let i = 0; i < meter.levels.length; i++) {
    const L = meter.levels[i];
    const d = distToMultiple(pos, L.period) / SOFT_SIGMA;
    const w = L.weight * Math.exp(-d * d);
    if (w > best) best = w;
  }
  return best;
}

// Attractors are the positions a player is likely to aim for, drawn from
// several subdivisions at once (binary, triplet, quintuplet). They are not a
// grid the output is snapped to: generators place notes near them and then
// displace continuously.
function buildAttractors(meter) {
  const out = [];
  for (let i = 0; i < meter.levels.length; i++) {
    const L = meter.levels[i];
    const n = Math.round(meter.barLen / L.period);
    for (let j = 0; j < n; j++) {
      const pos = j * L.period;
      if (pos > meter.barLen - EPS) break;
      const existing = out.find((a) => Math.abs(a.pos - pos) < 1e-6);
      if (existing) continue; // keep the strongest (first-listed) level
      out.push({ pos, weight: L.weight, family: L.family, level: i });
    }
  }
  out.sort((a, b) => a.pos - b.pos);
  return out;
}

// Swing as a continuous time warp, applied to binary ('main') positions in
// simple meters. Inside each pulse the off-beat eighth is delayed (up to a
// triplet feel), and inside each eighth the off-beat sixteenth is delayed a
// little less. Positions in between are stretched linearly, so the warp works
// on any float position.
function warpSpan(x, span, m) {
  const k = Math.floor(x / span + EPS);
  const f = x / span - k;
  const g = f < 0.5 ? f * (m / 0.5) : m + (f - 0.5) * ((1 - m) / 0.5);
  return (k + g) * span;
}

function swingWarp(meter, pos, amount) {
  if (meter.compound || !(amount > 0)) return pos;
  const a = Math.min(1, amount);
  const m16 = 0.5 + 0.12 * a;
  const m8 = 0.5 + 0.17 * a;
  return warpSpan(warpSpan(pos, meter.pulse / 2, m16), meter.pulse, m8);
}

module.exports = { makeMeter, metricWeight, swingWarp, isOn, distToMultiple };
