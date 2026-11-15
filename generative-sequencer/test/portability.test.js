'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENGINE = path.join(__dirname, '..', 'engine');

function engineFiles(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) out.push(...engineFiles(p));
    else if (f.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Engine code must run in Max's [v8] as well as Node: relative requires only,
// no Node or browser globals.
const FORBIDDEN = [
  /\bprocess\b/,
  /\bBuffer\b/,
  /__dirname|__filename/,
  /\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b/,
  /\bconsole\./,
  /\bglobalThis\b|\bglobal\./,
  /\bwindow\b|\bdocument\b/,
  /^\s*(import|export)\s/m,
];

test('engine sources use no host APIs and only relative requires', () => {
  const files = engineFiles(ENGINE);
  assert.ok(files.length >= 10);
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const re of FORBIDDEN) assert.ok(!re.test(src), `${path.relative(ENGINE, file)} matches ${re}`);
    for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      assert.ok(m[1].startsWith('./') || m[1].startsWith('../'), `${path.relative(ENGINE, file)} requires ${m[1]}`);
    }
  }
});

test('engine runs in a bare JS context (no Node globals)', () => {
  // Minimal CommonJS loader inside an empty vm context.
  const ctx = vm.createContext({});
  const cache = {};
  function load(file) {
    if (cache[file]) return cache[file].exports;
    const module = { exports: {} };
    cache[file] = module;
    const src = fs.readFileSync(file, 'utf8');
    const fn = vm.runInContext('(function (module, exports, require) {' + src + '\n})', ctx, { filename: file });
    fn(module, module.exports, (spec) => {
      let p = path.resolve(path.dirname(file), spec);
      if (fs.existsSync(p + '.js')) p += '.js';
      else p = path.join(p, 'index.js');
      return load(p);
    });
    return module.exports;
  }
  const E = load(path.join(ENGINE, 'index.js'));
  const eng = E.createEngine({ seed: 3 });
  eng.reset(0);
  const evs = eng.generate(0, 16);
  assert.ok(evs.length > 10);
  // and gives exactly what Node gives
  const N = require('../engine');
  const ref = N.createEngine({ seed: 3 });
  ref.reset(0);
  assert.equal(JSON.stringify(evs), JSON.stringify(ref.generate(0, 16)));
});
