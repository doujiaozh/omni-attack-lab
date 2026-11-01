"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.obfuscateLite = obfuscateLite;
/**
 * Omni-Forger · 纯 JS 词法引擎（lite mode）
 *
 * 当 Babel 不可用（或解析失败）时的降级路径：零依赖、无语法假设。
 * 能力子集：
 *   - 剥离注释
 *   - 字符串数组加密（单/双引号字面量 + 无插值模板）
 *   - 掐断 console.* / eval / new Function
 *   - 顶层死代码注入
 * 不做标识符重命名（无作用域分析，强行改名不安全）。
 */
const tokenizer_1 = require("./tokenizer");
const stringCipher_1 = require("./stringCipher");
const babelEngine_1 = require("./babelEngine");
const fs_1 = require("../utils/fs");
function obfuscateLite(code, filename, options) {
    var _a;
    const intensity = Math.max(1, Math.min(5, options.intensity));
    const minLen = ((_a = options.minStringLength) !== null && _a !== void 0 ? _a : intensity >= 5) ? 1 : 2;
    const stats = {
        stringsEncrypted: 0,
        identifiersRenamed: 0,
        deadCodeInjected: 0,
        evalConsoleKilled: 0,
        engine: 'lite',
    };
    const notes = ['使用 lite 词法引擎（无 AST）'];
    const tokens = (0, tokenizer_1.tokenize)(code);
    const vault = (0, stringCipher_1.createVault)();
    const parts = [];
    for (const tok of tokens) {
        if (tok.type === 'comment') {
            // 剥离注释
            continue;
        }
        if (tok.type === 'string' || (tok.type === 'template' && !tok.interpolated)) {
            const inner = tok.value.slice(1, -1);
            if (inner.length < minLen) {
                parts.push(tok.value);
                continue;
            }
            // 保留 require 参数，否则打包链路断裂
            const before = code.slice(Math.max(0, tok.start - 12), tok.start);
            if (/require\s*\(\s*$/.test(before)) {
                parts.push(tok.value);
                continue;
            }
            const idx = (0, stringCipher_1.vaultAdd)(vault, tok.type === 'template' ? inner : unescapeString(inner));
            parts.push((0, stringCipher_1.vaultCallExpr)(vault, idx));
            stats.stringsEncrypted++;
            continue;
        }
        parts.push(tok.value);
    }
    (0, stringCipher_1.vaultFinalize)(vault);
    let out = parts.join('');
    // 掐断泄露点：正则手术（注释已剥离、字符串已加密，误伤面很小）
    const guard = '_0x' + (0, fs_1.randHex)(4);
    const noop = '_0x' + (0, fs_1.randHex)(4);
    const fnGuard = '_0x' + (0, fs_1.randHex)(4);
    const before = out;
    out = out.replace(/\bconsole\s*\.\s*(log|error|warn|info|debug|trace)\s*\(/g, `${noop}(`);
    out = out.replace(/\beval\s*\(/g, `${guard}(`);
    out = out.replace(/\bnew\s+Function\s*\(/g, `new ${fnGuard}(`);
    stats.evalConsoleKilled = countDiff(before, out);
    const decls = [
        `var ${noop}=function(){};`,
        `var ${guard}=function(){throw new Error('Omni-Forger: eval is locked');};`,
        `var ${fnGuard}=function(){return function(){}};`,
    ];
    // 顶层死代码
    const junk = [];
    if (intensity >= 3 && stats.stringsEncrypted > 0) {
        for (let i = 0; i < intensity; i++) {
            const idx = Math.floor((code.length + i * 31) % Math.max(1, vault.entries.length));
            junk.push(`if(parseInt(${vault.name}(${idx}),16)>1e6){${vault.name}(${idx});}`);
        }
        stats.deadCodeInjected = junk.length;
    }
    const header = [vault.bootstrap, ...decls, ...junk].join('\n');
    let final = header + '\n' + out;
    if (intensity >= 5)
        final = `(function(){\n${final}\n})();`;
    for (const r of (0, babelEngine_1.scanDeobfuscationRisks)(final))
        notes.push(`⚠ 反混淆风险点: ${r}`);
    return { code: final, stats, notes };
}
function unescapeString(inner) {
    // 处理常见转义，保证解密内容与运行时一致
    return inner
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\\\/g, '\\')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\b/g, '\b')
        .replace(/\\f/g, '\f')
        .replace(/\\v/g, '\v')
        .replace(/\\0/g, '\0')
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function countDiff(a, b) {
    return a.length === b.length ? 0 : Math.abs(a.split('_0x').length - b.split('_0x').length);
}
