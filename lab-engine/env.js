'use strict';
/**
 * lab-engine/env.js — resolve the two engines (red / blue) without hard-coding
 * this machine's layout.
 *
 * Resolution order:
 *   1. env override  (OMNI_FORGER_DIR / OMNI_REVERSER_DIR)
 *   2. vendored copy (vendor/dsh-omni-*) — committed, zero-install
 *   3. sibling checkout (../dsh-omni-*) — for development against the real repos
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');

function readVersion(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

function pick(envKey, vendored, sibling, entryRel) {
  const candidates = [];
  if (process.env[envKey]) candidates.push(path.resolve(process.env[envKey]));
  candidates.push(path.join(ROOT, 'vendor', vendored));
  candidates.push(path.resolve(ROOT, '..', sibling));
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, entryRel))) {
      return { dir, entry: path.join(dir, entryRel), version: readVersion(dir) };
    }
  }
  return null;
}

const redInfo = pick('OMNI_FORGER_DIR', 'dsh-omni-forger', 'dsh-omni-forger', 'dist/obfuscate/index.js');
const blueInfo = pick(
  'OMNI_REVERSER_DIR',
  'dsh-omni-reverser',
  'dsh-omni-reverser',
  'dist/rev_code/js_deobfuscate.js'
);

let redCache = null;
let blueCache = null;

/** Load the compiled Omni-Forger obfuscation core (CommonJS). */
function loadRed() {
  if (redCache) return redCache;
  if (!redInfo) {
    const err = new Error(
      'red engine not found: expected vendor/dsh-omni-forger or ../dsh-omni-forger (or set OMNI_FORGER_DIR)'
    );
    err.code = 'EFORGE';
    throw err;
  }
  const mod = require(redInfo.entry);
  if (typeof mod.transformCode !== 'function' || typeof mod.intensityDefaults !== 'function') {
    const err = new Error('red engine at ' + redInfo.entry + ' does not expose transformCode()/intensityDefaults()');
    err.code = 'EFORGE';
    throw err;
  }
  redCache = mod;
  return mod;
}

/** Load the compiled Omni-Reverser JS deobfuscator (ESM, dynamic import). */
async function loadBlue() {
  if (blueCache) return blueCache;
  if (!blueInfo) {
    const err = new Error(
      'blue engine not found: expected vendor/dsh-omni-reverser or ../dsh-omni-reverser (or set OMNI_REVERSER_DIR)'
    );
    err.code = 'EBLUE';
    throw err;
  }
  const mod = await import(pathToFileURL(blueInfo.entry).href);
  if (typeof mod.deobfuscateJs !== 'function') {
    const err = new Error('blue engine at ' + blueInfo.entry + ' does not export deobfuscateJs()');
    err.code = 'EBLUE';
    throw err;
  }
  blueCache = mod;
  return mod;
}

/** Babel availability is what decides AST vs lite fallback inside the forger. */
function babelAvailable() {
  try {
    require('@babel/parser');
    require('@babel/traverse');
    require('@babel/generator');
    require('@babel/types');
    return true;
  } catch (_) {
    return false;
  }
}

function redLabel(engine) {
  return engine === 'babel' ? 'Omni-Forger · Babel AST' : 'Omni-Forger · lite lexical';
}

module.exports = { ROOT, redInfo, blueInfo, loadRed, loadBlue, babelAvailable, redLabel };
