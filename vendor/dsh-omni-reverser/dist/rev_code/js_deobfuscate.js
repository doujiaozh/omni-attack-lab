/**
 * rev_code/js_deobfuscate — JS 反混淆与 IOC 静态提取
 *
 * 目标：在不执行任何目标代码的前提下（禁止 eval / new Function / vm），
 * 通过「手写 Tokenizer + 静态字符串还原 + 字符串数组旋转还原 + 访问器调用解析」
 * 恢复 obfuscator.io / javascript-obfuscator 风格产物中的真实字符串与隐藏行为，
 * 并提取 IOC（URL / 域名 / IP / 邮箱 / 钱包 / 注册表 / 文件路径 / Base64 团块）。
 *
 * 设计纪律：
 *  - 永不抛异常：任何畸形输入都返回结构化 JsDeobfResult（ok:true，error 记录降级原因）
 *  - 不执行目标代码：全部基于静态文本分析
 *  - 纯 TypeScript + Node 内建 Buffer，无第三方依赖
 */
/* ------------------------------------------------------------------ *
 * 内部工具
 * ------------------------------------------------------------------ */
const HEX_RE = /\\x([0-9a-fA-F]{2})/g;
const UNI_RE = /\\u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))/g;
const OCT_RE = /\\[0-7]{1,3}(?![0-9])/g;
function uniq(arr) {
    return Array.from(new Set(arr));
}
/** 1-based 行号计算器：预扫描行首偏移。 */
function makeLineMap(src) {
    const starts = [0];
    for (let i = 0; i < src.length; i++) {
        if (src.charCodeAt(i) === 10)
            starts.push(i + 1);
    }
    return (offset) => {
        let lo = 0, hi = starts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= offset)
                lo = mid;
            else
                hi = mid - 1;
        }
        return lo + 1;
    };
}
/** 解码 JS 字符串字面量内容（已剥引号），返回解码值。永不抛错。 */
function decodeJsString(raw) {
    if (!raw.includes('\\'))
        return raw;
    let out = '';
    let i = 0;
    const n = raw.length;
    const hex = (k) => parseInt(raw.slice(i, i + k), 16);
    void hex;
    while (i < n) {
        const ch = raw[i];
        if (ch !== '\\') {
            out += ch;
            i++;
            continue;
        }
        i++;
        if (i >= n) {
            out += '\\';
            break;
        }
        const c = raw[i];
        switch (c) {
            case 'x': {
                const pair = raw.slice(i + 1, i + 3);
                if (/^[0-9a-fA-F]{2}$/.test(pair)) {
                    out += String.fromCharCode(parseInt(pair, 16));
                    i += 3;
                }
                else {
                    out += 'x';
                    i++;
                }
                break;
            }
            case 'u': {
                if (raw[i + 1] === '{') {
                    const close = raw.indexOf('}', i + 2);
                    if (close > i + 2) {
                        const cp = parseInt(raw.slice(i + 2, close), 16);
                        if (!Number.isNaN(cp) && cp <= 0x10ffff)
                            out += String.fromCodePoint(cp);
                        i = close + 1;
                    }
                    else {
                        out += 'u';
                        i++;
                    }
                }
                else {
                    const quad = raw.slice(i + 1, i + 5);
                    if (/^[0-9a-fA-F]{4}$/.test(quad)) {
                        out += String.fromCharCode(parseInt(quad, 16));
                        i += 5;
                    }
                    else {
                        out += 'u';
                        i++;
                    }
                }
                break;
            }
            case 'n':
                out += '\n';
                i++;
                break;
            case 'r':
                out += '\r';
                i++;
                break;
            case 't':
                out += '\t';
                i++;
                break;
            case 'b':
                out += '\b';
                i++;
                break;
            case 'f':
                out += '\f';
                i++;
                break;
            case 'v':
                out += '\v';
                i++;
                break;
            case '0': {
                // \0 或八进制 \NNN
                let oct = '';
                while (oct.length < 3 && i < n && /[0-7]/.test(raw[i])) {
                    oct += raw[i];
                    i++;
                }
                const code = parseInt(oct || '0', 8);
                if (code === 0)
                    out += '\0';
                else if (!Number.isNaN(code))
                    out += String.fromCharCode(code);
                break;
            }
            default: {
                if (/[0-7]/.test(c)) {
                    let oct = c;
                    i++;
                    while (oct.length < 3 && i < n && /[0-7]/.test(raw[i])) {
                        oct += raw[i];
                        i++;
                    }
                    const code = parseInt(oct, 8);
                    if (!Number.isNaN(code))
                        out += String.fromCharCode(code);
                }
                else {
                    out += c; // \\ \' \" 等
                    i++;
                }
            }
        }
    }
    return out;
}
/** 统计字符串中出现的转义技术。 */
function escapeTechniques(raw) {
    const t = [];
    if (/\\x[0-9a-fA-F]{2}/.test(raw))
        t.push('hex');
    if (/\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\})/.test(raw))
        t.push('unicode');
    if (/\\[0-7]{1,3}(?![0-9])/.test(raw))
        t.push('octal');
    return t;
}
function shannonEntropy(s) {
    if (!s)
        return 0;
    const freq = new Map();
    for (const ch of s)
        freq.set(ch, (freq.get(ch) ?? 0) + 1);
    let h = 0;
    const n = s.length;
    for (const c of freq.values()) {
        const p = c / n;
        h -= p * Math.log2(p);
    }
    return h;
}
function matchAll(text, re) {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        out.push(m[0]);
        if (re.lastIndex === m.index)
            re.lastIndex++;
    }
    return out;
}
function stripTrailingPunct(u) {
    return u.replace(/[.,;:!?'")\]}>]+$/g, '');
}
function tokenize(src) {
    const toks = [];
    const n = src.length;
    let i = 0;
    const isIdStart = (c) => /[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 0x7f;
    const isIdPart = (c) => /[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) > 0x7f;
    while (i < n) {
        const ch = src[i];
        // 空白
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
            i++;
            continue;
        }
        // 注释
        if (ch === '/' && src[i + 1] === '/') {
            while (i < n && src[i] !== '\n')
                i++;
            continue;
        }
        if (ch === '/' && src[i + 1] === '*') {
            const close = src.indexOf('*/', i + 2);
            i = close < 0 ? n : close + 2;
            continue;
        }
        // 字符串
        if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            const start = i;
            i++;
            let content = '';
            while (i < n) {
                const c = src[i];
                if (c === '\\') {
                    content += c + (src[i + 1] ?? '');
                    i += 2;
                    continue;
                }
                if (c === quote)
                    break;
                content += c;
                i++;
            }
            const end = Math.min(i + 1, n);
            i = end;
            const value = quote === '`' ? content : decodeJsString(content);
            toks.push({ kind: 'str', text: src.slice(start, end), start, end, value });
            continue;
        }
        // 标识符
        if (isIdStart(ch)) {
            const start = i;
            i++;
            while (i < n && isIdPart(src[i]))
                i++;
            toks.push({ kind: 'ident', text: src.slice(start, i), start, end: i });
            continue;
        }
        // 数字
        if (/[0-9]/.test(ch)) {
            const start = i;
            i++;
            while (i < n && /[0-9a-fA-FxX._]/.test(src[i]))
                i++;
            toks.push({ kind: 'num', text: src.slice(start, i), start, end: i });
            continue;
        }
        // 标点（逐个字符，足够做模式匹配）
        toks.push({ kind: 'punct', text: ch, start: i, end: i + 1 });
        i++;
    }
    return toks;
}
function numValue(text) {
    const t = text.trim();
    if (!t)
        return null;
    if (/^0x[0-9a-f]+$/i.test(t)) {
        const v = parseInt(t.slice(2), 16);
        return Number.isNaN(v) ? null : v;
    }
    if (/^\d+$/.test(t))
        return parseInt(t, 10);
    return null;
}
function findStringArrays(toks) {
    const out = [];
    for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.kind !== 'ident' || !['var', 'let', 'const'].includes(t.text))
            continue;
        if (i + 3 >= toks.length)
            continue;
        const nameTok = toks[i + 1];
        if (nameTok.kind !== 'ident')
            continue;
        if (toks[i + 2].kind !== 'punct' || toks[i + 2].text !== '=')
            continue;
        if (toks[i + 3].kind !== 'punct' || toks[i + 3].text !== '[')
            continue;
        const values = [];
        let j = i + 4;
        let ok = true;
        while (j < toks.length) {
            const tk = toks[j];
            if (tk.kind === 'punct' && tk.text === ']')
                break;
            if (tk.kind === 'punct' && tk.text === ',') {
                j++;
                continue;
            }
            if (tk.kind === 'str') {
                values.push(tk.value ?? tk.text.slice(1, -1));
                j++;
                continue;
            }
            ok = false;
            break;
        }
        if (!ok)
            continue;
        if (j >= toks.length)
            continue;
        if (toks[j].kind === 'punct' && toks[j].text === ']' && values.length >= 3) {
            out.push({ name: nameTok.text, values, rotated: false, assignEnd: toks[j].end });
        }
    }
    return out;
}
/** 检测 while (--x) { arr.push(arr.shift()); }(N, arr) 旋转并还原。 */
function applyRotations(src, arrays) {
    const rotationRe = /while\s*\(\s*--\s*[A-Za-z_$][\w$]*\s*\)\s*\{\s*([A-Za-z_$][\w$]*)\s*\.\s*push\s*\(\s*\1\s*\.\s*shift\s*\(\s*\)\s*\)\s*;?\s*\}\s*\}\s*\(\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;
    rotationRe.lastIndex = 0;
    let m;
    while ((m = rotationRe.exec(src)) !== null) {
        const count = numValue(m[2]);
        const arrName = m[3];
        if (count == null)
            continue;
        const rec = arrays.find((a) => a.name === arrName);
        if (!rec || rec.values.length === 0)
            continue;
        // while (--x) 的语义：x=5 时实际只循环 4 次
        const rotations = Math.max(0, count - 1);
        const k = ((rotations % rec.values.length) + rec.values.length) % rec.values.length;
        if (k === 0)
            continue;
        rec.values = rec.values.slice(k).concat(rec.values.slice(0, k));
        rec.rotated = true;
    }
    // 备用形态：for 循环 shift/push 或 ((n) => ...)(K, arr)
    const altRe = /\(\s*\(\s*\)\s*=>\s*\{[^}]*?([A-Za-z_$][\w$]*)\.push\s*\(\s*\1\.shift\s*\(\s*\)\s*\)[^}]*?\}\s*\)\s*\(\s*\)\s*\)?/g;
    void altRe; // 罕见形态暂不自动还原
}
function findAccessors(src) {
    const re = /function\s+([A-Za-z_$][\w$]*)\s*\(\s*[A-Za-z_$][\w$]*\s*(?:,\s*[A-Za-z_$][\w$]*\s*)?\)\s*\{\s*return\s+([A-Za-z_$][\w$]*)\s*\[\s*[A-Za-z_$][\w$]*\s*(?:([+-])\s*(0x[0-9a-fA-F]+|\d+))?\s*\]\s*;?\s*\}/g;
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
        const offset = m[3] ? (numValue(m[4]) ?? 0) * (m[3] === '-' ? -1 : 1) : 0;
        out.push({ name: m[1], arrayName: m[2], offset });
    }
    return out;
}
/** 解析 accessor 调用：ident ( num ) */
function resolveAccessorCalls(toks, arrays, accessors) {
    const reps = [];
    if (!accessors.length)
        return reps;
    const byName = new Map(accessors.map((a) => [a.name, a]));
    for (let i = 0; i + 3 < toks.length; i++) {
        const t = toks[i];
        if (t.kind !== 'ident')
            continue;
        const acc = byName.get(t.text);
        if (!acc)
            continue;
        if (toks[i + 1].kind !== 'punct' || toks[i + 1].text !== '(')
            continue;
        if (toks[i + 2].kind !== 'num')
            continue;
        if (toks[i + 3].kind !== 'punct' || toks[i + 3].text !== ')')
            continue;
        const idx = numValue(toks[i + 2].text);
        if (idx == null)
            continue;
        const rec = arrays.find((a) => a.name === acc.arrayName);
        if (!rec || !rec.values.length)
            continue;
        const real = ((idx + acc.offset) % rec.values.length + rec.values.length) % rec.values.length;
        reps.push({
            start: t.start,
            end: toks[i + 3].end,
            text: JSON.stringify(rec.values[real]),
            priority: 1,
        });
    }
    return reps;
}
/** 按非重叠规则应用替换（同一位置高优先级胜出）。 */
function applyReplacements(src, reps) {
    const sorted = reps
        .map((r, i) => ({ ...r, i }))
        .sort((a, b) => a.priority - b.priority || a.start - b.start || a.i - b.i);
    const chosen = [];
    for (const r of sorted) {
        if (chosen.some((c) => !(r.end <= c.start || r.start >= c.end)))
            continue;
        chosen.push(r);
    }
    chosen.sort((a, b) => a.start - b.start);
    let out = '';
    let pos = 0;
    for (const r of chosen) {
        if (r.start < pos)
            continue;
        out += src.slice(pos, r.start) + r.text;
        pos = r.end;
    }
    return out + src.slice(pos);
}
/* ------------------------------------------------------------------ *
 * IOC 提取
 * ------------------------------------------------------------------ */
const COMMON_TLDS = [
    'com', 'net', 'org', 'io', 'ru', 'cn', 'top', 'xyz', 'info', 'biz', 'cc', 'me', 'co', 'tk', 'pw',
    'club', 'app', 'dev', 'online', 'site', 'space', 'store', 'tech', 'link', 'live', 'icu', 'vip',
    'work', 'fun', 'pro', 'mobi', 'asia', 'wang', 'ren', 'ink', 'pub', 'bid', 'loan', 'download',
    'trade', 'date', 'party', 'review', 'science', 'stream', 'gdn', 'win', 'men', 'host', 'press',
    'website', 'uno', 'cyou', 'monster', 'rest', 'bar', 'beer', 'fit', 'example',
];
export function extractIocs(text) {
    const urls = uniq(matchAll(text, /https?:\/\/[^\s'"`<>()\[\]{}\\,;]+/gi).map(stripTrailingPunct)).filter((u) => u.length > 8);
    const ipRe = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
    const ips = uniq(matchAll(text, ipRe));
    const domainSet = new Set();
    for (const u of urls) {
        try {
            const host = new URL(u).hostname.toLowerCase();
            if (host && !/^\d+\.\d+\.\d+\.\d+$/.test(host))
                domainSet.add(host);
        }
        catch {
            /* 非法 URL 忽略 */
        }
    }
    const standalone = new RegExp('\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:' + COMMON_TLDS.join('|') + ')\\b', 'gi');
    for (const d of matchAll(text, standalone)) {
        const low = d.toLowerCase();
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(low))
            domainSet.add(low);
    }
    const domains = Array.from(domainSet)
        .filter((d) => !d.endsWith('.example') || d === 'evil.example' || d.includes('.'))
        .sort();
    const emails = uniq(matchAll(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g));
    const btcAddresses = uniq(matchAll(text, /\b(?:bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g));
    const ethAddresses = uniq(matchAll(text, /\b0x[a-fA-F0-9]{40}\b/g));
    const registryKeys = uniq(matchAll(text, /(?:HKEY_(?:LOCAL_MACHINE|CURRENT_USER|CLASSES_ROOT|USERS)|HKLM|HKCU)\\[^\s'"`,;)]{2,200}/gi));
    const filePaths = uniq(matchAll(text, /[A-Za-z]:\\(?:[^\s'"`|<>:*?]+\\)*[^\s'"`|<>:*?]+/g)).filter((p) => p.length > 3 && p.length < 300);
    const base64Blobs = [];
    const b64Re = /[A-Za-z0-9+/]{40,}={0,2}/g;
    b64Re.lastIndex = 0;
    let bm;
    const seenBlob = new Set();
    while ((bm = b64Re.exec(text)) !== null && base64Blobs.length < 20) {
        const encoded = bm[0];
        if (seenBlob.has(encoded))
            continue;
        seenBlob.add(encoded);
        try {
            const decodedBuf = Buffer.from(encoded, 'base64');
            if (decodedBuf.length < 8)
                continue;
            const decoded = decodedBuf.toString('utf-8');
            const printable = Array.from(decoded).filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) < 0x7f || c === '\n' || c === '\r' || c === '\t').length;
            if (printable / decoded.length >= 0.85) {
                base64Blobs.push({ encoded, decoded: decoded.replace(/\uFFFD/g, '') });
            }
        }
        catch {
            /* 忽略 */
        }
    }
    return {
        urls,
        domains,
        ips,
        emails,
        btcAddresses,
        ethAddresses,
        registryKeys,
        filePaths,
        base64Blobs,
    };
}
const CALL_KINDS = [
    { kind: 'eval', re: /(?:^|[^\w$.])eval\s*\(/g },
    { kind: 'Function', re: /(?:^|[^\w$.])new\s+Function\s*\(|(?:^|[^\w$.])Function\s*\(/g },
    { kind: 'setTimeout', re: /(?:^|[^\w$.])setTimeout\s*\(/g },
    { kind: 'setInterval', re: /(?:^|[^\w$.])setInterval\s*\(/g },
    { kind: 'document.write', re: /document\s*\.\s*write(?:ln)?\s*\(/g },
];
function findCodeCalls(src) {
    const out = [];
    for (const { kind, re } of CALL_KINDS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src)) !== null) {
            const open = m.index + m[0].length - 1;
            const argStart = open + 1;
            // 取到匹配的右括号（粗略配对，忽略字符串内括号的小概率误差）
            let depth = 1, i = argStart, instr = null;
            while (i < src.length && depth > 0) {
                const c = src[i];
                if (instr) {
                    if (c === '\\') {
                        i += 2;
                        continue;
                    }
                    if (c === instr)
                        instr = null;
                }
                else if (c === '"' || c === "'" || c === '`') {
                    instr = c;
                }
                else if (c === '(')
                    depth++;
                else if (c === ')')
                    depth--;
                i++;
            }
            const argText = src.slice(argStart, Math.max(argStart, i - 1));
            out.push({ kind, index: m.index, argStart, argText });
            if (out.length > 200)
                break;
        }
    }
    return out.sort((a, b) => a.index - b.index);
}
/** 判断一段文本是否像 JS 代码（用于隐藏代码判定）。 */
function looksLikeJs(code) {
    if (code.length < 4)
        return false;
    const signals = [
        /function\s*\(/, /=>/, /;\s*\w+\s*=/, /document\./, /window\./,
        /var\s+\w+/, /let\s+\w+/, /const\s+\w+/, /eval\s*\(/, /return\s/,
    ];
    let hits = 0;
    for (const re of signals)
        if (re.test(code))
            hits++;
    return hits >= 2 || /[{};]/.test(code);
}
/* ------------------------------------------------------------------ *
 * 混淆器指纹
 * ------------------------------------------------------------------ */
function detectObfuscators(src, stats, arrays, accessors) {
    const out = [];
    const hexIdCount = matchAll(src, /_0x[0-9a-fA-F]+/g).length;
    if (hexIdCount >= 10)
        out.push('javascript-obfuscator / obfuscator.io (hex 标识符)');
    if (arrays.length >= 1 && accessors.length >= 1)
        out.push('字符串数组 + 访问器（string-array 混淆）');
    if (arrays.some((a) => a.rotated))
        out.push('字符串数组旋转（array rotation）');
    if (/eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k/.test(src))
        out.push('Dean Edwards Packer');
    if (/\[[\[\]()!+]{20,}\]/.test(src) || (/\+\s*\[\s*\]/.test(src) && /!!\[\]/.test(src)))
        out.push('JSFuck');
    if (/eval\s*\(\s*(?:window\s*\.\s*)?atob\s*\(/.test(src))
        out.push('eval(atob(...)) 双重编码');
    if (src.length > 2000 && stats.longestLine > 500)
        out.push('单行压缩/打包（compressed）');
    if (stats.hexEscapes >= 20)
        out.push('高密度 \\xNN 转义');
    if (stats.unicodeEscapes >= 20)
        out.push('高密度 \\uNNNN 转义');
    if (/\b(function\s*\(\s*_0x|var\s+_0x[0-9a-f]+\s*=\s*\[)/.test(src))
        out.push('obfuscator.io 变体特征');
    return uniq(out).filter((s) => s.length > 0);
}
/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */
export function deobfuscateJs(code, filePath) {
    const empty = {
        ok: true,
        filePath,
        stats: {
            chars: 0, lines: 0, longestLine: 0, entropy: 0,
            hexEscapes: 0, unicodeEscapes: 0, hexIdentifiers: 0,
            stringCount: 0, hexIdentDensity: 0, obfuscationScore: 0,
        },
        obfuscators: [],
        stringArrays: [],
        decodedStrings: [],
        evalCalls: [],
        hiddenCode: [],
        iocs: emptyIocs(),
        decoded: '',
        findings: [],
    };
    if (typeof code !== 'string') {
        empty.ok = false;
        empty.error = 'input is not a string';
        return empty;
    }
    if (code.trim().length === 0) {
        empty.findings = [{ severity: 'info', message: '空输入' }];
        return empty;
    }
    try {
        const lineOf = makeLineMap(code);
        const toks = tokenize(code);
        // 1) 字符串转义还原
        const decodedStrings = [];
        const replacements = [];
        for (const t of toks) {
            if (t.kind !== 'str')
                continue;
            const inner = t.text.slice(1, t.text.length - 1);
            if (t.text.startsWith('`'))
                continue; // 模板字符串不动
            const tech = escapeTechniques(inner);
            if (!tech.length)
                continue;
            const value = t.value ?? inner;
            if (value === inner)
                continue;
            decodedStrings.push({
                line: lineOf(t.start),
                technique: tech.join('+'),
                value,
                original: t.text,
            });
            replacements.push({ start: t.start, end: t.end, text: JSON.stringify(value), priority: 0 });
        }
        // 2) 字符串数组 + 旋转还原
        const arrays = findStringArrays(toks);
        applyRotations(code, arrays);
        // 3) 访问器调用还原
        const accessors = findAccessors(code);
        for (const rep of resolveAccessorCalls(toks, arrays, accessors))
            replacements.push(rep);
        const pass1 = applyReplacements(code, replacements);
        // 4) 动态执行点 + 隐藏代码
        const calls = findCodeCalls(pass1);
        const evalCalls = [];
        const hiddenCode = [];
        for (const c of calls) {
            evalCalls.push({
                line: lineOf(Math.min(c.index, code.length - 1)),
                kind: c.kind,
                snippet: c.argText.replace(/\s+/g, ' ').slice(0, 160),
            });
        }
        // 对 eval/Function 的「字符串字面量参数」做隐藏代码还原
        for (const c of calls) {
            if (c.kind !== 'eval' && c.kind !== 'Function' && c.kind !== 'document.write')
                continue;
            const arg = c.argText.trim();
            const strLit = arg.match(/^(['"])((?:\\.|(?!\1)[^\\])*)\1$/);
            if (!strLit)
                continue;
            let inner = decodeJsString(strLit[2]);
            if (inner.length < 4)
                continue;
            // eval(atob("...")) 形态
            const atob = inner.match(/atob\s*\(\s*(['"])([A-Za-z0-9+/=]{16,})\1\s*\)/);
            if (atob) {
                try {
                    const decodedB64 = Buffer.from(atob[2], 'base64').toString('utf-8');
                    if (decodedB64.length >= 4) {
                        hiddenCode.push({ kind: 'atob-payload', code: decodedB64 });
                        inner = decodedB64;
                    }
                }
                catch {
                    /* 忽略 */
                }
            }
            if (looksLikeJs(inner)) {
                hiddenCode.push({ kind: 'eval-argument', code: inner });
            }
            else if (inner.length > 12) {
                hiddenCode.push({ kind: 'eval-string', code: inner });
            }
        }
        // 去重
        const seenHidden = new Set();
        const uniqueHidden = hiddenCode.filter((h) => {
            const key = h.kind + '\u0000' + h.code;
            if (seenHidden.has(key))
                return false;
            seenHidden.add(key);
            return true;
        });
        // 5) IOC 提取：原始 + 还原后
        const decodedText = decodedStrings.map((d) => d.value).join('\n') + '\n' + pass1;
        const iocs = extractIocs(code + '\n' + decodedText);
        // 清理：域名中剔除非 URL 域名误报（纯 TLD 枚举）
        iocs.domains = iocs.domains.filter((d) => d.includes('.'));
        // 6) 统计
        const lines = code.split(/\r\n|\r|\n/);
        const stats = {
            chars: code.length,
            lines: lines.length,
            longestLine: Math.max(...lines.map((l) => l.length)),
            entropy: Math.round(shannonEntropy(code) * 1000) / 1000,
            hexEscapes: matchAll(code, HEX_RE).length,
            unicodeEscapes: matchAll(code, UNI_RE).length,
            hexIdentifiers: matchAll(code, /_0x[0-9a-fA-F]+/g).length,
            stringCount: toks.filter((t) => t.kind === 'str').length,
            hexIdentDensity: 0,
            obfuscationScore: 0,
        };
        stats.hexIdentDensity =
            stats.chars > 0 ? Math.round((stats.hexIdentifiers / stats.chars) * 1000 * 100) / 100 : 0;
        // 7) 评分
        let score = 0;
        score += Math.min(30, stats.hexEscapes * 0.12);
        score += Math.min(20, stats.unicodeEscapes * 0.18);
        if (arrays.length)
            score += 15;
        if (arrays.some((a) => a.rotated))
            score += 5;
        if (accessors.length)
            score += 10;
        score += Math.min(15, evalCalls.length * 4);
        score += Math.min(10, iocs.base64Blobs.length * 3);
        if (stats.longestLine > 500)
            score += 6;
        score += Math.min(10, stats.hexIdentifiers * 0.15);
        if (/\[[\[\]()!+]{40,}\]/.test(code))
            score += 15;
        stats.obfuscationScore = Math.max(0, Math.min(100, Math.round(score)));
        // 8) 混淆器指纹
        const obfuscators = detectObfuscators(code, stats, arrays, accessors);
        // 9) findings
        const findings = [];
        if (evalCalls.length) {
            findings.push({
                severity: 'high',
                message: `检测到 ${evalCalls.length} 处动态代码执行（${uniq(evalCalls.map((e) => e.kind)).join('/')}）`,
            });
        }
        if (uniqueHidden.length) {
            findings.push({
                severity: 'high',
                message: `成功还原 ${uniqueHidden.length} 段隐藏代码（eval 参数 / atob 载荷）`,
            });
        }
        if (iocs.urls.length) {
            findings.push({
                severity: 'high',
                message: `提取到 ${iocs.urls.length} 个外部 URL（C2/下载源嫌疑）: ${iocs.urls.slice(0, 3).join(', ')}`,
            });
        }
        if (iocs.ips.length) {
            findings.push({ severity: 'medium', message: `硬编码 IP 地址: ${iocs.ips.slice(0, 5).join(', ')}` });
        }
        if (iocs.base64Blobs.length) {
            findings.push({ severity: 'medium', message: `${iocs.base64Blobs.length} 个可解码 Base64 团块（可能藏匿载荷）` });
        }
        if (obfuscators.length) {
            findings.push({
                severity: stats.obfuscationScore >= 60 ? 'high' : 'medium',
                message: `混淆指纹: ${obfuscators.join('; ')}（评分 ${stats.obfuscationScore}/100）`,
            });
        }
        if (decodedStrings.length) {
            findings.push({ severity: 'low', message: `静态还原 ${decodedStrings.length} 条转义字符串` });
        }
        if (!findings.length) {
            findings.push({
                severity: 'info',
                message: `未发现明显混淆特征（评分 ${stats.obfuscationScore}/100）`,
            });
        }
        const sample = (arr) => ({
            name: arr.name,
            count: arr.values.length,
            rotated: arr.rotated,
            sample: arr.values.slice(0, 4),
        });
        return {
            ok: true,
            filePath,
            stats,
            obfuscators,
            stringArrays: arrays.map(sample),
            decodedStrings,
            evalCalls,
            hiddenCode: uniqueHidden,
            iocs,
            decoded: pass1,
            findings,
        };
    }
    catch (e) {
        empty.ok = false;
        empty.error = `deobfuscate failed: ${String(e)}`;
        empty.findings = [{ severity: 'low', message: `反混淆异常，降级返回: ${String(e)}` }];
        return empty;
    }
}
function emptyIocs() {
    return {
        urls: [],
        domains: [],
        ips: [],
        emails: [],
        btcAddresses: [],
        ethAddresses: [],
        registryKeys: [],
        filePaths: [],
        base64Blobs: [],
    };
}
