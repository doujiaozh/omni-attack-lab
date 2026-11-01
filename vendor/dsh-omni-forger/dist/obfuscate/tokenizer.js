"use strict";
/**
 * Omni-Forger · 纯 JavaScript 词法分析器（零依赖）
 *
 * 不做完整语法分析，只把源码切成区段：
 *   string   —— 单/双引号字符串字面量
 *   template —— 模板字符串（无插值 ${} 的才可安全提取）
 *   comment  —— 注释（可安全剥离）
 *   regex    —— 正则字面量（只标记，不处理）
 *   code     —— 其余代码文本
 *
 * 关键难点是 regex 与除法的消歧：用「上一个有意义 token」启发式判断。
 * 模板字符串用模式栈处理 ${} 嵌套。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenize = tokenize;
exports.extractStrings = extractStrings;
const REGEX_PREV_KEYWORDS = new Set([
    'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw',
    'instanceof', 'yield', 'await', 'do', 'else', 'if', 'while', 'for',
]);
/** 判断是否处于「可以出现正则字面量」的上下文。 */
function canBeRegex(prevSig) {
    if (!prevSig)
        return true;
    if (REGEX_PREV_KEYWORDS.has(prevSig))
        return true;
    // 标点：这些之后也可能是除号，但我们宁可漏判 regex 也不误伤字符串
    return !/[\w$\)\]"]/.test(prevSig);
}
function tokenize(code) {
    const tokens = [];
    const n = code.length;
    let i = 0;
    let buf = '';
    let bufStart = 0;
    let prevSig = '';
    const flushCode = (end) => {
        if (buf.length > 0) {
            tokens.push({ type: 'code', value: buf, start: bufStart, end });
            buf = '';
        }
    };
    // 模式栈：'code' | 'tpl' —— 处理模板字符串插值嵌套
    const modeStack = ['code'];
    // 插值深度：遇到 ${ 压栈进入 code 模式，配对的 } 弹回 tpl 模式
    const tplDepthStack = []; // 每层 tpl 已进入的插值括号深度
    let braceStack = [];
    while (i < n) {
        const ch = code[i];
        const mode = modeStack[modeStack.length - 1];
        if (mode === 'tpl') {
            // 模板字符串内部
            if (ch === '\\') {
                // 转义：跳两个字符
                i += 2;
                continue;
            }
            if (ch === '`') {
                const start = findTplStart(code, i);
                // 找到模板起点由外层处理；此处不该到达（外层一次性消费模板）
                i++;
                continue;
            }
            if (ch === '$' && code[i + 1] === '{') {
                tplDepthStack[tplDepthStack.length - 1]++;
                modeStack.push('code');
                braceStack.push('${');
                i += 2;
                continue;
            }
            i++;
            continue;
        }
        // code 模式
        if (ch === '`') {
            // 消费整个模板字符串（含嵌套），决定可否整体提取
            const start = i;
            let j = i + 1;
            let interpolated = false;
            let depth = 0;
            while (j < n) {
                const c = code[j];
                if (c === '\\') {
                    j += 2;
                    continue;
                }
                if (c === '`' && depth === 0) {
                    break;
                }
                if (c === '$' && code[j + 1] === '{') {
                    interpolated = true;
                    depth++;
                    j += 2;
                    // 粗扫到配对的 }
                    let d = 1;
                    while (j < n && d > 0) {
                        const cc = code[j];
                        if (cc === '\\') {
                            j += 2;
                            continue;
                        }
                        if (cc === '{')
                            d++;
                        else if (cc === '}')
                            d--;
                        if (d === 0)
                            break;
                        j++;
                    }
                    continue;
                }
                j++;
            }
            const end = Math.min(j + 1, n);
            flushCode(start);
            tokens.push({ type: 'template', value: code.slice(start, end), start, end, interpolated });
            prevSig = '`';
            i = end;
            continue;
        }
        if (ch === "'" || ch === '"') {
            const quote = ch;
            const start = i;
            let j = i + 1;
            while (j < n) {
                const c = code[j];
                if (c === '\\') {
                    j += 2;
                    continue;
                }
                if (c === quote) {
                    break;
                }
                if (c === '\n' || c === '\r') {
                    // 未闭合字符串：保守终止
                    break;
                }
                j++;
            }
            const end = Math.min(j + 1, n);
            flushCode(start);
            tokens.push({ type: 'string', value: code.slice(start, end), start, end });
            prevSig = quote;
            i = end;
            continue;
        }
        if (ch === '/' && code[i + 1] === '/') {
            const start = i;
            let j = i + 2;
            while (j < n && code[j] !== '\n')
                j++;
            flushCode(start);
            tokens.push({ type: 'comment', value: code.slice(start, j), start, end: j });
            i = j;
            continue;
        }
        if (ch === '/' && code[i + 1] === '*') {
            const start = i;
            let j = i + 2;
            while (j < n && !(code[j] === '*' && code[j + 1] === '/'))
                j++;
            const end = Math.min(j + 2, n);
            flushCode(start);
            tokens.push({ type: 'comment', value: code.slice(start, end), start, end });
            i = end;
            continue;
        }
        if (ch === '/' && canBeRegex(prevSig)) {
            // 尝试扫描正则字面量
            const start = i;
            let j = i + 1;
            let inClass = false;
            let ok = true;
            while (j < n) {
                const c = code[j];
                if (c === '\\') {
                    j += 2;
                    continue;
                }
                if (c === '[')
                    inClass = true;
                else if (c === ']')
                    inClass = false;
                else if (c === '/' && !inClass)
                    break;
                else if (c === '\n') {
                    ok = false;
                    break;
                }
                j++;
            }
            if (ok && j < n) {
                j++;
                // flags
                const flagsStart = j;
                while (j < n && /[gimsuyvd]/.test(code[j]))
                    j++;
                // 如果 flags 后面不是合法终止符，可能是除法误判 → 回退
                const after = code[j];
                if (after === undefined || /[\s)\]};,:\n=&|?:]/.test(after) || j === flagsStart) {
                    flushCode(start);
                    tokens.push({ type: 'regex', value: code.slice(start, j), start, end: j });
                    prevSig = code.slice(start, j);
                    i = j;
                    continue;
                }
            }
        }
        // 普通字符
        if (buf.length === 0)
            bufStart = i;
        buf += ch;
        // 更新 prevSig：遇到空白外的有意义字符
        if (!/\s/.test(ch)) {
            if (/[A-Za-z0-9_$]/.test(ch)) {
                // 积累完整标识符
                let j = i + 1;
                while (j < n && /[A-Za-z0-9_$]/.test(code[j]))
                    j++;
                prevSig = code.slice(i, j);
                buf += code.slice(i + 1, j);
                i = j;
                continue;
            }
            if (ch === '{')
                braceStack.push('{');
            else if (ch === '(')
                braceStack.push('(');
            else if (ch === '[')
                braceStack.push('[');
            else if (ch === '}') {
                const top = braceStack.pop();
                if (top === '${') {
                    // 插值结束，回到模板模式
                    modeStack.pop();
                    tplDepthStack[tplDepthStack.length - 1]--;
                }
            }
            else if (ch === ')' || ch === ']') {
                braceStack.pop();
            }
            prevSig = ch;
        }
        i++;
    }
    flushCode(n);
    // 过滤空 code token
    return tokens.filter((tok) => tok.type !== 'code' || tok.value.length > 0);
}
/** 由模板结束反查其起点（本实现未使用，保留接口）。 */
function findTplStart(code, end) {
    let j = end - 1;
    while (j >= 0) {
        if (code[j] === '`')
            return j;
        j--;
    }
    return end;
}
/**
 * 提取所有可安全替换的字符串字面量值（含无插值模板）。
 * 返回 token 列表，调用方负责按区间做字符串手术。
 */
function extractStrings(code, opts = {}) {
    var _a;
    const min = (_a = opts.minLength) !== null && _a !== void 0 ? _a : 2;
    return tokenize(code).filter((tok) => (tok.type === 'string' || (tok.type === 'template' && !tok.interpolated)) &&
        tok.value.length - 2 >= min &&
        tok.value.trim().length > 2);
}
