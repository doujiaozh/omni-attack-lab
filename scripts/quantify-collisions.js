'use strict';
/**
 * scripts/quantify-collisions.js
 *
 * Measures how often Omni-Forger's injected-stub pool collides with its own
 * identifier-rename pool, and whether lab-engine/redguard.js repairs it.
 *
 * Method: every specimen ends with a `__sink.put(<expr>);` probe. The probe
 * program is compiled with `new Function('__sink', code)` and run with a
 * shared object, so the observable result survives every transformation the
 * forger can apply — identifier renaming, console silencing and even the
 * intensity-5 IIFE wrapper (the object is shared by reference).
 *
 *   node scripts/quantify-collisions.js
 */

const forger = require('../vendor/dsh-omni-forger/dist/obfuscate/index.js');
const redguard = require('../lab-engine/redguard');
const samples = require('../lab-engine/samples');

function mulberry(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function execute(code) {
  try {
    const fn = new Function('__sink', code);
    const sink = { value: undefined };
    sink.put = function (v) {
      sink.value = v;
    };
    fn(sink);
    return { ok: true, value: sink.value, error: null };
  } catch (e) {
    return { ok: false, value: undefined, error: e.message };
  }
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Specimens: the three shipped samples + a synthetic family. */
function specimens() {
  const list = samples.list();
  const out = [
    { label: 'billing', code: list[0].code, probe: 'order.total' },
    { label: 'token', code: list[1].code, probe: 'demo' },
    { label: 'state-machine', code: list[2].code, probe: 'runTrail(runCheckout())' },
  ];

  for (let s = 0; s < 8; s++) {
    const rnd = mulberry(0x1010 + s * 7919);
    const name = 'compute' + Math.floor(rnd() * 900 + 100);
    const thr = Math.floor(rnd() * 400 + 120);
    const deduct = Math.floor(rnd() * 40 + 5);
    const factor = (rnd() * 3 + 1).toFixed(1);
    const nums = [0, 1, 2, 3].map(() => Math.floor(rnd() * 80 + 5));
    const flavor = ['ALPHA', 'OMEGA', 'ZETA', 'DELTA', 'KAPPA'][Math.floor(rnd() * 5)];
    const style = Math.floor(rnd() * 3);
    let body;
    if (style === 0) {
      body = [
        'function ' + name + '(values, factor) {',
        '  var total = 0;',
        '  for (var i = 0; i < values.length; i++) { total += values[i] * factor; }',
        '  if (total > ' + thr + ') { total = total - ' + deduct + '; }',
        '  return "' + flavor + '-" + total;',
        '}',
        'var out = ' + name + '([' + nums.join(',') + '], ' + factor + ');',
        'var mirror = (function (x) { return function () { return x; }; })(out);',
      ].join('\n');
    } else if (style === 1) {
      body = [
        'function ' + name + '(step) {',
        '  var state = "created";',
        '  var log = [];',
        '  switch (step) {',
        '    case 1: state = "paid"; log.push("p" + step); break;',
        '    case 2: state = "shipped"; log.push("s" + step); break;',
        '    default: state = "cancelled"; log.push("x"); break;',
        '  }',
        '  return state + "|" + log.join(",") + "|" + ' + thr + ';',
        '}',
        'var out = ' + name + '(Math.floor(' + factor + '));',
      ].join('\n');
    } else {
      body = [
        'var TW=' + thr + ';',
        'function ' + name + '(xs) {',
        '  var sum = xs.reduce(function (a, b) { return a + b; }, 0);',
        '  var bonus = sum > TW ? ' + deduct + ' : 0;',
        '  return "' + flavor + '"+(sum - bonus);',
        '}',
        'var out = ' + name + '([' + nums.join(',') + '].map(function (n) { return n * 2; }));',
      ].join('\n');
    }
    out.push({ label: 'synthetic-' + s, code: body, probe: 'out' });
  }
  return out;
}

function pad(s, w) {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}
function pct(n, d) {
  return d ? Math.round((100 * n) / d) + '%' : '-';
}

function measure() {
  const specs = specimens();
  const rows = [];
  const brokenBase = [];

  for (const spec of specs) {
    const code = spec.code + '\n__sink.put((' + spec.probe + '));';
    const base = execute(code);
    if (!base.ok || base.value === undefined) {
      brokenBase.push(spec.label + ': ' + (base.error || 'no probe value'));
      continue;
    }
    for (let intensity = 1; intensity <= 5; intensity++) {
      let forged;
      try {
        forged = forger.transformCode(code, 'quantify.js', forger.intensityDefaults(intensity)).code;
      } catch (e) {
        rows.push({ label: spec.label, intensity, transformOk: false, dup: false, dupNames: [], repaired: false, preEq: false, postEq: false, postErr: 'transform: ' + e.message });
        continue;
      }
      const pre = execute(forged);
      const detection = redguard.detect(forged);
      const guarded = redguard.repair(forged);
      const post = guarded.repaired ? execute(guarded.code) : pre;
      rows.push({
        label: spec.label,
        intensity: intensity,
        transformOk: true,
        dup: detection.duplicates.length > 0,
        dupNames: detection.duplicates,
        repaired: guarded.repaired,
        preEq: pre.ok && same(pre.value, base.value),
        postEq: post.ok && same(post.value, base.value),
        postOk: post.ok,
        postErr: post.error,
      });
    }
  }
  return { specs, rows, brokenBase };
}

function main() {
  const { rows, brokenBase } = measure();

  console.log('');
  console.log('┌─ COLLISION QUANTIFICATION · Omni-Forger duplicate-binding risk ─┐');
  const total = rows.filter((x) => x.transformOk);
  console.log('specimens: 11 · intensities 1..5 · transforms: ' + total.length + ' · probe: shared __sink object');
  console.log('');
  console.log('intensity  transforms  collisions  repaired  sem-equiv raw  sem-equiv after redguard');
  console.log('─────────  ─────────  ──────────  ────────  ──────────────  ──────────────────────');
  for (let i = 1; i <= 5; i++) {
    const r = total.filter((x) => x.intensity === i);
    const dup = r.filter((x) => x.dup);
    const rep = r.filter((x) => x.repaired);
    const pre = r.filter((x) => x.preEq);
    const post = r.filter((x) => x.postEq);
    console.log(
      pad('L' + i, 9) + '  ' +
      pad(String(r.length), 10) + '  ' +
      pad(String(dup.length) + ' (' + pct(dup.length, r.length) + ')', 11) + '  ' +
      pad(String(rep.length) + '/' + dup.length, 9) + '  ' +
      pad(String(pre.length) + '/' + r.length + ' (' + pct(pre.length, r.length) + ')', 15) + '  ' +
      pad(String(post.length) + '/' + r.length + ' (' + pct(post.length, r.length) + ')', 13)
    );
  }

  const anyDup = total.filter((x) => x.dup);
  const anyPostEq = total.filter((x) => x.postEq);
  console.log('');
  console.log('▸ duplicate-binding rate (all intensities)         : ' + anyDup.length + '/' + total.length + ' = ' + pct(anyDup.length, total.length));
  console.log('▸ semantic equivalence after redguard              : ' + anyPostEq.length + '/' + total.length + ' = ' + pct(anyPostEq.length, total.length));
  console.log('▸ collisions repaired                             : ' + anyDup.filter((x) => x.repaired).length + '/' + anyDup.length);

  const stillBroken = anyDup.filter((x) => !x.postEq);
  if (stillBroken.length) {
    console.log('\n! specimens still broken after repair:');
    stillBroken.forEach((x) => console.log('   ' + x.label + ' L' + x.intensity + ' dup=[' + x.dupNames.join(',') + '] repaired=' + x.repaired + ' postErr=' + x.postErr));
  }
  if (brokenBase.length) console.log('\n!! specimens that never produced a baseline: ' + brokenBase.join('; '));
  console.log('');
}

if (require.main === module) main();

module.exports = { specimens, measure, execute };
