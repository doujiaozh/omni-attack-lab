'use strict';
/**
 * tests/smoke.js — `npm test`
 *
 * Part A: engine-level assertions (no network, no server).
 * Part B: full WebSocket E2E through the MicroDesk bridge (lab.status /
 *         lab.samples / lab.run), on an ephemeral loopback port.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const engine = require(path.join(ROOT, 'lab-engine'));
const server = require(path.join(ROOT, 'lab-server', 'server.js'));

let failures = 0;
function check(name, ok, extra) {
  if (ok) {
    console.log('  PASS  ' + name);
  } else {
    failures++;
    console.log('  FAIL  ' + name + (extra ? ' — ' + extra : ''));
  }
}
function section(title) { console.log('\n=== ' + title + ' ==='); }

async function partA() {
  section('A · engine (lab-engine)');
  const status = engine.status();
  check('lab.status().engines.red.available', !!(status.engines && status.engines.red && status.engines.red.available), JSON.stringify(status.engines && status.engines.red));
  check('lab.status().engines.blue.available', !!(status.engines && status.engines.blue && status.engines.blue.available));
  check('lab.status().limits.maxCodeBytes === 200000', status.limits && status.limits.maxCodeBytes === 200000);
  check('lab.status().ai.mode === local-fallback (no key configured)', status.ai && status.ai.mode === 'local-fallback');

  const samples = engine.listSamples();
  check('lab.samples() returns >= 3 specimens', !!(samples.samples && samples.samples.length >= 3), String(samples.samples && samples.samples.length));

  const code = samples.samples[0].code;
  const result = await engine.runBattle({ code: code, intensity: 3 });
  check('lab.run() returns ok:true', !!result.ok);
  check('red.code non-empty and differs from input', !!(result.red && result.red.code && result.red.code !== code));
  check('red.stats.stringsEncrypted >= 1', !!(result.red.stats && result.red.stats.stringsEncrypted >= 1), JSON.stringify(result.red && result.red.stats));
  check('blue.code non-empty', !!(result.blue && result.blue.code && result.blue.code.length > 0));
  check('blue.stats.stringsRestored >= 1 (vault unlocked)', !!(result.blue.stats && result.blue.stats.stringsRestored >= 1), JSON.stringify(result.blue && result.blue.stats));
  check('verdict.score within 0..100', typeof result.verdict.score === 'number' && result.verdict.score >= 0 && result.verdict.score <= 100, String(result.verdict && result.verdict.score));
  check('verdict.axes has 5 entries', !!(result.verdict.axes && result.verdict.axes.length === 5), String(result.verdict && result.verdict.axes && result.verdict.axes.length));
  check('timeline non-empty', !!(result.timeline && result.timeline.length >= 3), String(result.timeline && result.timeline.length));
  check('report.markdown contains the manifesto', !!(result.report && result.report.markdown && result.report.markdown.indexOf('在这个沙盒里') >= 0));
  check('report file written to reports/', !!(result.report && result.report.path && fs.existsSync(path.join(ROOT, result.report.path))), result.report && result.report.path);
  check('totalMs is positive', result.totalMs > 0, String(result.totalMs));

  // determinism: same input → same score modulo the timing axis (blue/red ms
  // are real measurements, so allow a few points of drift)
  const again = await engine.runBattle({ code: code, intensity: 3 });
  check('verdict is near-deterministic (timing axis only drifts ±4)', Math.abs(again.verdict.score - result.verdict.score) <= 4, again.verdict.score + ' vs ' + result.verdict.score);
  check('blue restoration is stable across runs', again.blue.stats.stringsRestored === result.blue.stats.stringsRestored, String(result.blue.stats.stringsRestored) + ' vs ' + String(again.blue.stats.stringsRestored));

  // error contract
  let err = null;
  try { await engine.runBattle({ code: '  ', intensity: 3 }); } catch (e) { err = e; }
  check('empty input → EEMPTY', !!(err && err.code === 'EEMPTY'), err && err.code);
  err = null;
  try { await engine.runBattle({ code: 'var a=1;', intensity: 9 }); } catch (e) { err = e; }
  check('intensity 9 → EBADINTENSITY', !!(err && err.code === 'EBADINTENSITY'), err && err.code);
  err = null;
  try { await engine.runBattle({ code: 'x'.repeat(engine.MAX_CODE_BYTES + 10), intensity: 2 }); } catch (e) { err = e; }
  check('oversized input → ETOOLARGE', !!(err && err.code === 'ETOOLARGE'), err && err.code);
}

function rpc(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = 't' + Math.random().toString(36).slice(2, 8);
    const onMessage = function (event) {
      let msg;
      try { msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); }
      catch (e) { return; }
      if (msg && msg.id === id) {
        ws.removeEventListener('message', onMessage);
        if (msg.error) reject(Object.assign(new Error(msg.error.message || 'rpc error'), { code: msg.error.code }));
        else resolve(msg.result);
      }
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id: id, method: method, params: params }));
  });
}

async function partB() {
  section('B · bridge E2E (lab-server · MicroDesk)');
  const arena = await server.createArena(0, {});
  const url = arena.url.replace(/^http/, 'ws') + 'ws';
  console.log('  arena: ' + arena.url);

  const ws = await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', function () { resolve(socket); });
    socket.addEventListener('error', function (e) { reject(new Error('websocket failed to open')); });
  });
  check('websocket /ws connected', true);

  const status = await rpc(ws, 'lab.status', []);
  check('lab.status over RPC', !!(status && status.ok && status.engines), JSON.stringify(status && status.engines && status.engines.red));

  const samples = await rpc(ws, 'lab.samples', []);
  check('lab.samples over RPC', !!(samples && samples.samples && samples.samples.length >= 3));

  const started = Date.now();
  const result = await rpc(ws, 'lab.run', [{ code: samples.samples[0].code, intensity: 3 }]);
  check('lab.run over RPC returns a full battle', !!(result && result.ok && result.verdict && result.report && result.report.markdown), String(result && result.verdict && result.verdict.score));
  check('lab.run round trip < 5 s', Date.now() - started < 5000, String(Date.now() - started) + ' ms');
  check('RPC result has red+blue code', !!(result.red.code && result.blue.code));

  let rpcErr = null;
  try { await rpc(ws, 'lab.run', [{ code: '', intensity: 3 }]); } catch (e) { rpcErr = e; }
  check('lab.run empty input → EEMPTY over RPC', !!(rpcErr && rpcErr.code === 'EEMPTY'), rpcErr && rpcErr.code);

  ws.close();
  arena.core.close();
}

(async function main() {
  console.log('omni-attack-lab smoke test · node ' + process.version);
  try {
    await partA();
    await partB();
  } catch (e) {
    failures++;
    console.log('  FATAL  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : e));
  }
  console.log('\n' + (failures ? '✗ ' + failures + ' failure(s)' : '✓ ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})();
