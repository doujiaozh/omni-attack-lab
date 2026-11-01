'use strict';
/**
 * lab-engine/blue.js — BLUE TEAM: restore what red tried to hide.
 *
 * Pipeline (all static, nothing is executed):
 *   1. crack Omni-Forger's string vault (base64 + shift inverse)
 *   2. run Omni-Reverser's deobfuscator (escapes, string arrays, eval payloads)
 *   3. prune dead top-level functions injected by the forger
 *   4. pretty-print with Babel
 *   5. optionally refine identifiers with a cloud LLM (only if configured)
 */

const env = require('./env');
const ai = require('./ai');
const { crackVault } = require('./vault');
const { pruneDead, beautify, parse } = require('./beautify');

function printableRatio(s) {
  if (!s) return 0;
  let ok = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 0x7f)) ok++;
  }
  return ok / s.length;
}

function pickIocs(iocs) {
  const out = {};
  if (!iocs || typeof iocs !== 'object') return out;
  ['urls', 'domains', 'ips', 'emails', 'btcAddresses', 'ethAddresses', 'registryKeys', 'filePaths', 'base64Blobs'].forEach(
    (k) => {
      if (Array.isArray(iocs[k]) && iocs[k].length) out[k] = iocs[k].slice(0, 20);
    }
  );
  return out;
}

async function run(cipherCode, ctx) {
  const started = Date.now();
  const notes = [];
  const options = ctx || {};

  // 1) vault
  const vault = crackVault(cipherCode);
  let stage = vault.cleaned;
  const validVault = vault.entries.filter((e) => e.value && printableRatio(e.value) > 0.85);
  if (vault.found) {
    notes.push(
      '静态解包字符串保险库 ' + vault.vaults.length + ' 个：' + vault.entries.length +
      ' 条密文，' + vault.replacedCalls + ' 处调用点还原'
    );
    if (validVault.length < vault.entries.length) {
      notes.push('其中 ' + (vault.entries.length - validVault.length) + ' 条解码结果不可打印，保持原样');
    }
  } else {
    notes.push('未发现 Omni-Forger 字符串保险库，直接进入通用反混淆');
  }

  // 2) omni-reverser
  let rev = null;
  try {
    const reverser = await env.loadBlue();
    rev = reverser.deobfuscateJs(stage, 'cipher.js');
    if (rev && rev.decoded) stage = rev.decoded;
    if (rev && rev.decodedStrings && rev.decodedStrings.length) {
      notes.push('Omni-Reverser 额外还原 ' + rev.decodedStrings.length + ' 条编码字符串');
    }
  } catch (e) {
    notes.push('Omni-Reverser 调用失败：' + (e && e.message ? e.message : String(e)));
  }

  // 3) dead code
  const pruned = pruneDead(stage);
  stage = pruned.code;
  if (pruned.pruned) notes.push('清除未被引用的死代码函数 ' + pruned.pruned + ' 个');

  // 4) beautify
  const pretty = beautify(stage);
  let code = pretty.ok ? pretty.code : stage;
  if (pretty.ok) notes.push('Babel generator 完成结构化美化');
  else notes.push('美化失败（保留原始排版）：' + (pretty.error || 'unknown'));

  // 5) optional cloud refinement
  const aiStatus = ai.status();
  const requested = options.aiRequested === 'off' ? 'off' : 'auto';
  const aiInfo = {
    requested,
    used: false,
    provider: aiStatus.enabled ? aiStatus.provider : null,
    model: aiStatus.enabled ? aiStatus.model : null,
    ms: 0,
    error: null,
  };
  if (requested !== 'off' && aiStatus.enabled) {
    try {
      const localLength = code.length;
      const refined = await ai.deobfuscate(code);
      let parses = true;
      try {
        parse(refined.code);
      } catch (_) {
        parses = false;
      }
      if (!parses) {
        aiInfo.error = 'model output failed to parse; kept local restoration';
        notes.push('云端还原结果无法解析，已回退本地结果');
      } else if (refined.code.length < localLength * 0.25) {
        aiInfo.error = 'model output suspiciously short; kept local restoration';
        notes.push('云端还原结果过短（可能截断），已回退本地结果');
      } else {
        code = refined.code;
        aiInfo.used = true;
        aiInfo.ms = refined.ms;
        notes.push('云端模型 ' + refined.model + ' 完成语义级还原（' + refined.ms + ' ms）');
      }
    } catch (e) {
      aiInfo.error = e && e.message ? e.message : String(e);
      notes.push('云端模型调用失败，保留本地静态还原：' + aiInfo.error);
    }
  } else if (requested === 'off') {
    notes.push('已按请求关闭云端模型，仅使用本地静态还原');
  } else {
    notes.push('云端模型未配置，仅使用本地静态还原（结果可复现）');
  }

  const ms = Date.now() - started;
  const stats = rev && rev.stats ? rev.stats : {};
  const obfuscationScoreBefore = typeof stats.obfuscationScore === 'number' ? stats.obfuscationScore : 0;

  return {
    engine: aiInfo.used ? 'static-forger-vault + omni-reverser + llm' : 'static-forger-vault + omni-reverser + beautifier',
    engineLabel: aiInfo.used
      ? '云端 AI 语义还原 + 本地静态解包'
      : '本地静态还原（vault 解包 + 反混淆 + 美化）',
    ms,
    code,
    ai: aiInfo,
    stats: {
      vaultEntries: vault.entries.length,
      stringsRestored: validVault.length + (rev && rev.decodedStrings ? rev.decodedStrings.length : 0),
      deadCodePruned: pruned.pruned,
      namesRecovered: 0, // filled by the scorer against the original program
      hiddenBlocks: rev && rev.hiddenCode ? (Array.isArray(rev.hiddenCode) ? rev.hiddenCode.length : 1) : 0,
      obfuscationScoreBefore,
    },
    details: {
      obfuscators: rev && rev.obfuscators ? rev.obfuscators : [],
      stringArrays: rev && rev.stringArrays ? rev.stringArrays.slice(0, 8) : [],
      findings: rev && rev.findings ? rev.findings.slice(0, 12) : [],
      iocs: pickIocs(rev && rev.iocs),
    },
    notes,
    reverserStats: {
      chars: stats.chars || 0,
      lines: stats.lines || 0,
      longestLine: stats.longestLine || 0,
      entropy: stats.entropy || 0,
      hexEscapes: stats.hexEscapes || 0,
      unicodeEscapes: stats.unicodeEscapes || 0,
      hexIdentifiers: stats.hexIdentifiers || 0,
      hexIdentDensity: stats.hexIdentDensity || 0,
      obfuscationScore: obfuscationScoreBefore,
    },
    vault: {
      found: vault.found,
      count: vault.entries.length,
      calls: vault.replacedCalls,
    },
  };
}

module.exports = { run, printableRatio };
