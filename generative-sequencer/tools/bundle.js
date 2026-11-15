'use strict';

// Tiny CommonJS bundler: wraps each module reachable from an entry file in a
// function and links them with a precomputed require table, so the output is
// one plain script with no file lookups at runtime. Only relative requires
// are allowed (the engine has no dependencies).

const fs = require('fs');
const path = require('path');

function resolveFile(fromDir, spec) {
  const base = path.resolve(fromDir, spec);
  for (const candidate of [base, base + '.js', path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`cannot resolve ${spec} from ${fromDir}`);
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Returns the JS source of `var <globalName> = (function () { ... })();`.
function bundle(root, entry, globalName) {
  const modules = new Map();
  const toId = (abs) => path.relative(root, abs).split(path.sep).join('/');
  function add(abs) {
    const id = toId(abs);
    if (modules.has(id)) return id;
    const src = fs.readFileSync(abs, 'utf8');
    const mod = { src, deps: {} };
    modules.set(id, mod);
    for (const m of stripComments(src).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1];
      if (!spec.startsWith('./') && !spec.startsWith('../')) throw new Error(`${id}: only relative requires can be bundled, got '${spec}'`);
      mod.deps[spec] = add(resolveFile(path.dirname(abs), spec));
    }
    return id;
  }
  const entryId = add(entry);
  const ids = Array.from(modules.keys()).sort();
  const parts = [];
  parts.push(`var ${globalName} = (function () {`);
  parts.push('  var defs = {};');
  for (const id of ids) {
    const m = modules.get(id);
    parts.push(`  // ---- ${id}`);
    parts.push(`  defs[${JSON.stringify(id)}] = [function (module, exports, require) {\n${m.src.trimEnd()}\n  }, ${JSON.stringify(m.deps)}];`);
  }
  parts.push(`  var cache = {};
  function load(id) {
    if (cache[id]) return cache[id].exports;
    var def = defs[id];
    var module = { exports: {} };
    cache[id] = module;
    def[0](module, module.exports, function (spec) {
      var dep = def[1][spec];
      if (!dep) throw new Error('cannot find module ' + spec + ' from ' + id);
      return load(dep);
    });
    return module.exports;
  }
  return load(${JSON.stringify(entryId)});
})();`);
  return { source: parts.join('\n') + '\n', modules: ids };
}

module.exports = { bundle };
