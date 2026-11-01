'use strict';
/**
 * lab-engine/red.js — RED TEAM: the obfuscator.
 *
 * Thin, honest adapter over Omni-Forger's compiled core. The forger itself
 * decides Babel-AST vs lite-lexical fallback; we only report which one fired.
 * The output passes through redguard (duplicate-binding sanitizer) because the
 * forger's injected stub pool can collide with its own rename pool.
 */

const env = require('./env');
const redguard = require('./redguard');

function run(code, intensity, opts) {
  const forger = env.loadRed();
  const started = Date.now();
  const options = forger.intensityDefaults(intensity);
  let result;
  try {
    result = forger.transformCode(code, (opts && opts.filename) || 'arena-input.js', options);
  } catch (e) {
    const err = new Error('red engine failed: ' + (e && e.message ? e.message : String(e)));
    err.code = 'EFORGE';
    throw err;
  }

  let outCode = result.code || '';
  const notes = Array.isArray(result.notes) ? result.notes.slice(0, 12) : [];
  const guarded = redguard.repair(outCode);
  if (guarded.repaired) {
    outCode = guarded.code;
    notes.push('redguard: 注入桩与重命名标识符撞名 ' + guarded.duplicates.join(', ') + '，已修复');
    guarded.notes.forEach((n) => notes.push('redguard: ' + n));
  }

  const ms = Date.now() - started;
  const stats = result.stats || {};
  const engine = stats.engine || 'babel';
  return {
    engine: engine,
    engineLabel: env.redLabel(engine),
    intensity: intensity,
    ms: ms,
    code: outCode,
    bytes: Buffer.byteLength(outCode, 'utf8'),
    lines: outCode.split(/\r\n|\r|\n/).length,
    stats: {
      stringsEncrypted: stats.stringsEncrypted || 0,
      identifiersRenamed: stats.identifiersRenamed || 0,
      deadCodeInjected: stats.deadCodeInjected || 0,
      evalConsoleKilled: stats.evalConsoleKilled || 0,
    },
    notes: notes,
  };
}

module.exports = { run };
