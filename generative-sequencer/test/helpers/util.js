'use strict';

const E = require('../../engine');

function makeEngine(opts) {
  const eng = E.createEngine(opts || {});
  eng.reset(opts && opts.start !== undefined ? opts.start : 0);
  return eng;
}

// Generate [start, end) through windows whose boundaries are listed in `cuts`
// (sorted, strictly inside the range).
function generateCut(eng, start, end, cuts) {
  const out = [];
  let a = start;
  for (const c of cuts.concat([end])) {
    out.push(...eng.generate(a, c));
    a = c;
  }
  return out;
}

function key(e) {
  return [e.lane, e.note, e.beat.toFixed(12), e.velocity, e.duration.toFixed(12)].join('|');
}

module.exports = { E, makeEngine, generateCut, key };
