'use strict';
/**
 * lab-engine/score.js — how much did the blue team actually recover?
 *
 * Three honest, deterministic signals (no LLM judging itself):
 *   stringRecall  — share of the ORIGINAL string literals present in the
 *                   restored output (an all-strings-encrypted + zero-recovery
 *                   obfuscation scores 0 here);
 *   structureSim  — Dice coefficient over 4-token shingles with identifiers
 *                   masked, i.e. "is the control flow still recognizable?";
 *   nameRecall    — share of original identifier names that reappeared.
 *
 * similarity = .45*stringRecall + .40*structureSim + .15*nameRecall
 * defense    = weighted radar of (1 - recovery) signals, times 100.
 */

const KEYWORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
  'let', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void',
  'while', 'with', 'yield', 'async', 'await', 'of', 'static', 'get', 'set', 'null', 'true',
  'false', 'undefined', 'NaN', 'Infinity',
]);

const GLOBALS = new Set([
  'console', 'window', 'document', 'globalThis', 'JSON', 'Math', 'Date', 'Array', 'Object',
  'String', 'Number', 'Boolean', 'Promise', 'Error', 'RegExp', 'Set', 'Map', 'Buffer',
]);

function unescapeString(raw) {
  return raw.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|u\{[0-9a-fA-F]{1,6}\}|.)/g, function (_m, seq) {
    if (seq[0] === 'x') return String.fromCharCode(parseInt(seq.slice(1), 16));
    if (seq[0] === 'u') {
      if (seq[1] === '{') return String.fromCodePoint(parseInt(seq.slice(2, -1), 16));
      return String.fromCharCode(parseInt(seq.slice(1), 16));
    }
    switch (seq) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'v': return '\v';
      case '0': return '\0';
      default: return seq;
    }
  });
}

function tokenize(code) {
  const toks = [];
  const n = code.length;
  let i = 0;
  while (i < n) {
    const c = code[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '/' && code[i + 1] === '/') { while (i < n && code[i] !== '\n') i++; continue; }
    if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      let raw = '';
      while (j < n) {
        const ch = code[j];
        if (ch === '\\') { raw += ch + (code[j + 1] || ''); j += 2; continue; }
        if (ch === quote) { j++; break; }
        raw += ch;
        j++;
      }
      toks.push({ type: 'str', value: unescapeString(raw) });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 127) {
      let j = i + 1;
      while (j < n && (/[A-Za-z0-9_$]/.test(code[j]) || code[j].charCodeAt(0) > 127)) j++;
      toks.push({ type: 'id', value: code.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxX._]/.test(code[j])) j++;
      toks.push({ type: 'num', value: code.slice(i, j) });
      i = j;
      continue;
    }
    toks.push({ type: 'punct', value: c });
    i++;
  }
  return toks;
}

function collect(tokens) {
  const strings = new Set();
  const idents = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'str' && t.value.length >= 2) strings.add(t.value);
    if (t.type !== 'id' || t.value.length < 3 || KEYWORDS.has(t.value)) continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    // Member properties (obj.prop) are never renamed, so they must not count
    // as "recovered identifier names".
    if (prev && prev.type === 'punct' && prev.value === '.') continue;
    // Object literal keys ({ prop: 1 }) are likewise untouched by the forger.
    if (
      next && next.type === 'punct' && next.value === ':' &&
      prev && prev.type === 'punct' && (prev.value === '{' || prev.value === ',')
    ) continue;
    idents.add(t.value);
  }
  return { strings, idents };
}

function shingles(tokens, k) {
  const set = new Set();
  for (let i = 0; i + k <= tokens.length; i++) {
    set.add(tokens.slice(i, i + k).join('\u0001'));
  }
  return set;
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((v) => { if (b.has(v)) inter++; });
  return (2 * inter) / (a.size + b.size);
}

function structureSimilarity(a, b) {
  const norm = (tokens) =>
    tokens.map((t) => {
      if (t.type === 'str') return '"S"';
      if (t.type === 'num') return '#';
      if (t.type === 'id') return KEYWORDS.has(t.value) ? t.value : '@';
      return t.value;
    });
  const A = norm(a);
  const B = norm(b);
  if (!A.length || !B.length) return 0;
  const k = Math.min(4, Math.max(2, Math.floor(Math.min(A.length, B.length) / 3)));
  return Math.min(1, dice(shingles(A, k), shingles(B, k)));
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/** Compare the original program with the restored program. */
function analyze(originalCode, restoredCode) {
  const origTokens = tokenize(originalCode);
  const restoredTokens = tokenize(restoredCode);
  const orig = collect(origTokens);
  const restored = collect(restoredTokens);

  let stringHits = 0;
  orig.strings.forEach((s) => {
    if (restored.strings.has(s) || restoredCode.indexOf(s) >= 0) stringHits++;
  });
  const stringRecall = orig.strings.size ? stringHits / orig.strings.size : 0;

  let nameHits = 0;
  let nameTotal = 0;
  orig.idents.forEach((name) => {
    if (GLOBALS.has(name)) return;
    nameTotal++;
    if (restored.idents.has(name)) nameHits++;
  });
  const nameRecall = nameTotal ? nameHits / nameTotal : 0;

  const structureSim = structureSimilarity(origTokens, restoredTokens);
  const similarity = clamp(0.45 * stringRecall + 0.4 * structureSim + 0.15 * nameRecall, 0, 1);

  return {
    stringRecall,
    structureSim,
    nameRecall,
    similarity,
    originalStrings: orig.strings.size,
    originalIdentifiers: nameTotal,
    restoredStrings: restored.strings.size,
  };
}

const AXES = [
  { key: 'string', label: '字符串加密', hint: '原始字符串字面量被还原的比例越低越强' },
  { key: 'ident', label: '标识符迷彩', hint: '原始标识符名被找回的比例' },
  { key: 'flow', label: '控制流欺骗', hint: '死代码与结构扭曲后与原文的相似度' },
  { key: 'density', label: '混淆密度', hint: '加密覆盖 + 重命名覆盖 + 死代码 + 体积膨胀' },
  { key: 'time', label: '逆向耗时', hint: '蓝方耗时相对红方的对数压力' },
];

const WEIGHTS = { string: 0.35, ident: 0.2, flow: 0.15, density: 0.15, time: 0.15 };

function gradeOf(score) {
  if (score >= 85) return { grade: 'S', label: '混淆器碾压' };
  if (score >= 70) return { grade: 'A', label: '混淆器占优' };
  if (score >= 55) return { grade: 'B', label: '势均力敌' };
  if (score >= 40) return { grade: 'C', label: '逆向器占优' };
  return { grade: 'D', label: '明文裸奔' };
}

function buildVerdict(metrics, red, blue, inputBytes) {
  const timeRatio = blue.ms / Math.max(1, red.ms);
  const stringCoverage = clamp(red.stats.stringsEncrypted / Math.max(1, metrics.originalStrings), 0, 1);
  const renameCoverage = clamp(red.stats.identifiersRenamed / Math.max(1, metrics.originalIdentifiers), 0, 1);
  const deadCoverage = clamp(red.stats.deadCodeInjected / 4, 0, 1);
  const volumeGrowth = clamp((red.bytes / Math.max(1, inputBytes) - 1) / 3, 0, 1);
  const density = Math.round(
    35 * stringCoverage + 30 * renameCoverage + 20 * deadCoverage + 15 * volumeGrowth
  );
  const timeAxis = Math.round(
    100 * clamp(Math.log10(1 + timeRatio) / Math.log10(101), 0, 1)
  );

  const values = {
    string: Math.round(100 * (1 - metrics.stringRecall)),
    ident: Math.round(100 * (1 - metrics.nameRecall)),
    flow: Math.round(100 * (1 - metrics.structureSim)),
    density,
    time: timeAxis,
  };

  const axes = AXES.map((a) => ({ key: a.key, label: a.label, value: values[a.key], hint: a.hint }));
  const score = Math.round(axes.reduce((sum, a) => sum + a.value * WEIGHTS[a.key], 0));
  const g = gradeOf(score);
  const pct = (x) => Math.round(x * 100) + '%';

  return {
    score: clamp(score, 0, 100),
    grade: g.grade,
    label: g.label,
    summary:
      '字符串还原 ' + pct(metrics.stringRecall) +
      ' · 结构还原 ' + Math.round(metrics.structureSim * 100) + '%' +
      ' · 标识符找回 ' + pct(metrics.nameRecall) +
      ' · 蓝方耗时 ' + timeRatio.toFixed(1) + '× 红方。',
    similarity: Math.round(metrics.similarity * 1000) / 1000,
    breakdown: {
      stringRecall: Math.round(metrics.stringRecall * 1000) / 1000,
      structureSim: Math.round(metrics.structureSim * 1000) / 1000,
      nameRecall: Math.round(metrics.nameRecall * 1000) / 1000,
      timeRatio: Math.round(timeRatio * 100) / 100,
      stringCoverage: Math.round(stringCoverage * 1000) / 1000,
      renameCoverage: Math.round(renameCoverage * 1000) / 1000,
      volumeGrowth: Math.round(volumeGrowth * 1000) / 1000,
    },
    axes,
    weights: WEIGHTS,
    formula: 'score = Σ(axis.value × weight)，轴值越高代表防御越强',
  };
}

module.exports = { analyze, buildVerdict, tokenize, WEIGHTS };
