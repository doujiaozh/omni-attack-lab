'use strict';
/**
 * lab-engine/report.js — Markdown battle report, written next to the arena so
 * every fight leaves evidence. The browser gets the same text to download.
 */

const fs = require('fs');
const path = require('path');

const MANIFESTO = 'Omni-Attack-Lab：在这个沙盒里，看看是你的混淆器硬，还是 AI 的算力强。';

function fenceFor(text) {
  return text.indexOf('```') >= 0 ? '````' : '```';
}

function truncate(text, limit) {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit) + '\n/* … truncated … */', truncated: true };
}

function cell(v) {
  return String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function build(result) {
  const red = result.red;
  const blue = result.blue;
  const v = result.verdict;
  const axes = v.axes
    .map((a) => '| ' + cell(a.label) + ' | ' + a.value + ' | ' + cell(a.hint) + ' |')
    .join('\n');
  const timeline = (result.timeline || [])
    .map((e) => '- `' + e.at + '` · **' + e.phase + '** · ' + e.message)
    .join('\n');
  const findings = (blue.details.findings || [])
    .map((f) => '- [' + (f.severity || 'info') + '] ' + f.message)
    .join('\n');
  const inputCode = truncate(result.input.code, 6000);
  const redCode = truncate(red.code, 8000);
  const blueCode = truncate(blue.code, 10000);
  const fb = fenceFor(inputCode.text);

  const lines = [];
  lines.push('# ⚔️ Omni-Attack-Lab 战报 / Battle Report');
  lines.push('');
  lines.push('> **' + MANIFESTO + '**');
  lines.push('');
  lines.push('| 字段 / Field | 值 / Value |');
  lines.push('| --- | --- |');
  lines.push('| runId | `' + result.runId + '` |');
  lines.push('| 开始时间 / Started | `' + result.startedAt + '` |');
  lines.push('| 总耗时 / Total | ' + result.totalMs + ' ms |');
  lines.push('| 输入 / Input | ' + result.input.bytes + ' bytes · ' + result.input.lines + ' lines |');
  lines.push('| 红方 / Red | ' + red.engineLabel + ' · 强度 ' + red.intensity + '/5 · ' + red.ms + ' ms |');
  lines.push('| 蓝方 / Blue | ' + blue.engineLabel + ' · ' + blue.ms + ' ms |');
  lines.push('');
  lines.push('## 判定 / Verdict');
  lines.push('');
  lines.push('### 防御强度 ' + v.score + '/100 · ' + v.grade + ' 级 —— ' + v.label);
  lines.push('');
  lines.push('> ' + v.summary);
  lines.push('');
  lines.push('| 指标 / Metric | 数值 / Value |');
  lines.push('| --- | --- |');
  lines.push('| 还原相似度 / Similarity | ' + (v.similarity * 100).toFixed(1) + '% |');
  lines.push('| 字符串还原率 / String recall | ' + (v.breakdown.stringRecall * 100).toFixed(1) + '% |');
  lines.push('| 结构相似度 / Structure | ' + (v.breakdown.structureSim * 100).toFixed(1) + '% |');
  lines.push('| 标识符找回率 / Name recall | ' + (v.breakdown.nameRecall * 100).toFixed(1) + '% |');
  lines.push('| 蓝/红耗时比 / Time ratio | ' + v.breakdown.timeRatio + '× |');
  lines.push('');
  lines.push('### 防御雷达 / Defense radar');
  lines.push('');
  lines.push('| 维度 / Axis | 得分 0-100 | 含义 / Meaning |');
  lines.push('| --- | --- | --- |');
  lines.push(axes);
  lines.push('');
  lines.push('公式：`' + v.formula + '`；权重：' + JSON.stringify(v.weights));
  lines.push('');
  lines.push('## 红方 / RED — Omni-Forger');
  lines.push('');
  lines.push('| 项目 / Item | 数值 / Value |');
  lines.push('| --- | --- |');
  lines.push('| 引擎 / Engine | ' + red.engine + ' |');
  lines.push('| 字符串加密 / Strings encrypted | ' + red.stats.stringsEncrypted + ' |');
  lines.push('| 标识符重命名 / Identifiers renamed | ' + red.stats.identifiersRenamed + ' |');
  lines.push('| 死代码注入 / Dead code injected | ' + red.stats.deadCodeInjected + ' |');
  lines.push('| 掐断 eval/console / Killed | ' + red.stats.evalConsoleKilled + ' |');
  lines.push('| 密文体积 / Cipher bytes | ' + red.bytes + ' (' + (red.bytes / Math.max(1, result.input.bytes)).toFixed(2) + '×) |');
  lines.push('| 混淆评分 / Detector score | ' + red.detection.obfuscationScore + '/100 |');
  lines.push('| 熵 / Entropy | ' + red.detection.entropy + ' |');
  lines.push('');
  lines.push('## 蓝方 / BLUE — Omni-Reverser');
  lines.push('');
  lines.push('| 项目 / Item | 数值 / Value |');
  lines.push('| --- | --- |');
  lines.push('| 云端模型 / Cloud model | ' + (blue.ai.used ? blue.ai.provider + ' · ' + blue.ai.model + ' · ' + blue.ai.ms + ' ms' : '未使用 / not used') + ' |');
  lines.push('| 模型错误 / Model error | ' + (blue.ai.error || '—') + ' |');
  lines.push('| 保险库条目 / Vault entries | ' + blue.stats.vaultEntries + ' |');
  lines.push('| 字符串还原 / Strings restored | ' + blue.stats.stringsRestored + ' |');
  lines.push('| 死代码清除 / Dead code pruned | ' + blue.stats.deadCodePruned + ' |');
  lines.push('| 隐藏载荷 / Hidden blocks | ' + blue.stats.hiddenBlocks + ' |');
  lines.push('| 混淆指纹 / Fingerprints | ' + (blue.details.obfuscators.join('；') || '—') + ' |');
  lines.push('');
  if (findings) {
    lines.push('### 发现 / Findings');
    lines.push('');
    lines.push(findings);
    lines.push('');
  }
  const iocs = blue.details.iocs || {};
  const iocKeys = Object.keys(iocs);
  if (iocKeys.length) {
    lines.push('### IOC');
    lines.push('');
    iocKeys.forEach((k) => lines.push('- **' + k + '**: `' + iocs[k].slice(0, 8).join('`, `') + '`'));
    lines.push('');
  }
  lines.push('## 时间线 / Timeline');
  lines.push('');
  lines.push(timeline || '- —');
  lines.push('');
  lines.push('## 原始代码 / Original');
  lines.push('');
  lines.push(fb + 'js');
  lines.push(inputCode.text);
  lines.push(fb);
  if (inputCode.truncated) lines.push('_（已截断 / truncated）_');
  lines.push('');
  lines.push('## 混淆密文 / Ciphertext');
  lines.push('');
  lines.push(fb + 'js');
  lines.push(redCode.text);
  lines.push(fb);
  if (redCode.truncated) lines.push('_（已截断 / truncated）_');
  lines.push('');
  lines.push('## 逆向还原 / Restored');
  lines.push('');
  lines.push(fb + 'js');
  lines.push(blueCode.text);
  lines.push(fb);
  if (blueCode.truncated) lines.push('_（已截断 / truncated）_');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('_Generated by Omni-Attack-Lab · Node ' + process.version + ' · ' + process.platform + ' ' + process.arch + '_');
  lines.push('');

  return lines.join('\n');
}

function save(result, reportsDir, filename) {
  fs.mkdirSync(reportsDir, { recursive: true });
  const full = path.join(reportsDir, filename);
  fs.writeFileSync(full, result.markdown, 'utf8');
  return {
    filename,
    path: path.relative(path.resolve(reportsDir, '..'), full).replace(/\\/g, '/'),
    absolutePath: full,
    bytes: Buffer.byteLength(result.markdown, 'utf8'),
  };
}

module.exports = { build, save, MANIFESTO };
