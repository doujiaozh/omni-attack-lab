'use strict';
/**
 * lab-engine/index.js — the arena orchestrator.
 *
 * One call runs the whole show:
 *   red.run()  ->  blue.run()  ->  score.analyze()  ->  report.build()
 *
 * Every input is treated as hostile data: it is parsed and transformed, never
 * executed. The only network egress is the optional LLM refinement, and only
 * when the operator configured a key.
 */

const crypto = require('crypto');
const path = require('path');
const env = require('./env');
const redTeam = require('./red');
const blueTeam = require('./blue');
const score = require('./score');
const report = require('./report');
const ai = require('./ai');
const samples = require('./samples');

const VERSION = '1.0.0';
const MAX_CODE_BYTES = 200000;
const REPORTS_DIR = path.join(env.ROOT, 'reports');

function rpcError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function pad(n, width) {
  return String(n).padStart(width || 2, '0');
}

function makeRunId() {
  const d = new Date();
  const stamp =
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds());
  return stamp + '-' + crypto.randomBytes(3).toString('hex');
}

function relPath(p) {
  return path.relative(env.ROOT, p).replace(/\\/g, '/');
}

function status() {
  let red = { id: 'omni-forger', label: 'Omni-Forger', version: '0.0.0', available: false, path: null, engine: null };
  let blue = { id: 'omni-reverser', label: 'Omni-Reverser', version: '0.0.0', available: false, path: null };

  if (env.redInfo) {
    red.version = env.redInfo.version;
    red.path = relPath(env.redInfo.dir);
    try {
      const mod = env.loadRed();
      red.available = true;
      red.engine = env.babelAvailable() && mod.hasBabel && mod.hasBabel() ? 'babel' : 'lite';
    } catch (_) {
      red.available = false;
    }
  }
  if (env.blueInfo) {
    blue.version = env.blueInfo.version;
    blue.path = relPath(env.blueInfo.dir);
    blue.available = true;
  }

  return {
    ok: true,
    app: 'Omni-Attack-Lab',
    version: VERSION,
    node: process.version,
    platform: process.platform + ' ' + process.arch,
    engines: {
      red: Object.assign({}, red, { label: red.engine === 'lite' ? 'Omni-Forger · lite lexical' : 'Omni-Forger · Babel AST' }),
      blue: Object.assign({}, blue, { label: 'Omni-Reverser · static deobfuscator' }),
    },
    ai: ai.status(),
    limits: { maxCodeBytes: MAX_CODE_BYTES, minIntensity: 1, maxIntensity: 5 },
  };
}

function listSamples() {
  return { ok: true, samples: samples.list() };
}

/**
 * @param {{code:string, intensity?:number, ai?:'auto'|'off'}} params
 */
async function runBattle(params) {
  const p = params || {};
  const code = typeof p.code === 'string' ? p.code : '';
  if (!code.trim()) {
    throw rpcError('EEMPTY', '请先粘贴一段 JavaScript 代码 / paste some JavaScript first');
  }
  const inputBytes = Buffer.byteLength(code, 'utf8');
  if (inputBytes > MAX_CODE_BYTES) {
    throw rpcError(
      'ETOOLARGE',
      '代码过大（' + inputBytes + ' bytes），上限 ' + MAX_CODE_BYTES + ' bytes / input too large'
    );
  }

  let intensity = p.intensity === undefined || p.intensity === null ? 3 : Number(p.intensity);
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5) {
    throw rpcError('EBADINTENSITY', '强度必须是 1..5 的整数 / intensity must be an integer in 1..5');
  }
  const aiRequested = p.ai === 'off' ? 'off' : 'auto';

  const runId = makeRunId();
  const startedAt = new Date();
  const timeline = [];
  const at = () => new Date().toISOString();
  const push = (phase, message) => timeline.push({ at: at(), phase: phase, message: message });
  const t0 = Date.now();

  push('input', '收到样本 ' + inputBytes + ' bytes · 强度 ' + intensity + '/5 · 蓝方模式 ' + (aiRequested === 'off' ? '仅本地' : '自动'));

  // ---- RED ----
  const red = redTeam.run(code, intensity, { filename: 'arena-input.js' });
  push(
    'red',
    red.engineLabel + ' 点火完成 · ' + red.ms + ' ms · 字符串 ' + red.stats.stringsEncrypted +
      ' · 重命名 ' + red.stats.identifiersRenamed +
      ' · 死代码 ' + red.stats.deadCodeInjected +
      ' · 掐断 ' + red.stats.evalConsoleKilled
  );

  // ---- BLUE ----
  const blue = await blueTeam.run(red.code, { aiRequested: aiRequested });
  push(
    'blue',
    (blue.ai.used ? '云端 AI + 本地 ' : '本地 ') + '还原完成 · ' + blue.ms + ' ms · 还原字符串 ' +
      blue.stats.stringsRestored + ' · 清死代码 ' + blue.stats.deadCodePruned
  );
  if (blue.ai.error) push('blue', '模型未生效：' + blue.ai.error);

  // ---- SCORE ----
  const metrics = score.analyze(code, blue.code);
  const verdict = score.buildVerdict(metrics, red, blue, inputBytes);
  blue.stats.namesRecovered = Math.round(metrics.nameRecall * metrics.originalIdentifiers);
  push('score', '还原相似度 ' + Math.round(metrics.similarity * 100) + '% · 防御得分 ' + verdict.score + ' (' + verdict.grade + ')');

  const result = {
    ok: true,
    runId: runId,
    startedAt: startedAt.toISOString(),
    input: {
      bytes: inputBytes,
      lines: code.split(/\r\n|\r|\n/).length,
      code: code,
    },
    red: {
      engine: red.engine,
      engineLabel: red.engineLabel,
      intensity: intensity,
      ms: red.ms,
      code: red.code,
      bytes: red.bytes,
      lines: red.lines,
      stats: red.stats,
      detection: {
        obfuscationScore: blue.reverserStats.obfuscationScore,
        entropy: blue.reverserStats.entropy,
        longestLine: blue.reverserStats.longestLine,
        hexIdentifiers: blue.reverserStats.hexIdentifiers,
      },
      notes: red.notes,
    },
    blue: {
      engine: blue.engine,
      engineLabel: blue.engineLabel,
      ms: blue.ms,
      code: blue.code,
      ai: blue.ai,
      stats: blue.stats,
      details: blue.details,
      notes: blue.notes,
    },
    verdict: verdict,
    report: null,
    timeline: timeline,
    totalMs: Date.now() - t0,
  };

  // ---- REPORT ----
  const markdown = report.build(result);
  const filename = 'battle-report-' + runId + '.md';
  const saved = report.save({ markdown: markdown }, REPORTS_DIR, filename);
  result.report = {
    filename: filename,
    path: saved.path,
    bytes: saved.bytes,
    markdown: markdown,
  };
  push('report', '战报已落盘 ' + saved.path + ' · ' + saved.bytes + ' bytes');

  return result;
}

function warmup() {
  try {
    env.loadRed();
  } catch (_) {
    /* status() surfaces the failure */
  }
}

module.exports = { status, listSamples, runBattle, warmup, VERSION, MAX_CODE_BYTES, REPORTS_DIR };
