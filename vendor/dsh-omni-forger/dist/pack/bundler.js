"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.packProject = packProject;
/**
 * Omni-Forger · forge_pack 纯 JS 打包器
 *
 * 做的事：
 *   1. 从入口解析整棵 require 图（含 node_modules 生产依赖）
 *   2. 把每条 require('x') 静态重写为 VFS 路径（裸模块 → 'node_modules/...'）
 *   3. 原生/外部模块（better-sqlite3 等）标记 EXTERNAL，运行时降级真实 require
 *   4. 逐模块混淆（可选），剥离 shebang
 *   5. 收集文本资产（schema.sql / package.json / 模板）进 VFS
 *   6. manifest → gzip → AES-256-GCM → base64 → 注入运行时模板 → 单文件启动器
 *
 * 全程仅用 Node 内建模块（fs/path/zlib/crypto），零原生编译，Win7 红线内。
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const zlib = __importStar(require("zlib"));
const crypto = __importStar(require("crypto"));
const runtime_1 = require("./runtime");
const obfuscate_1 = require("../obfuscate");
const log_1 = require("../utils/log");
const BUILTINS = new Set([
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
    'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http',
    'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
    'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
    'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
    'worker_threads', 'zlib',
]);
/** 已知的原生/外部包：文件不能内联进 VFS，运行时走真实 require */
const KNOWN_NATIVE = new Set([
    'better-sqlite3', 'sqlite3', 'bcrypt', 'bcryptjs', 'argon2', 'canvas', 'sharp',
    'node-sass', 'sass', 'fibers', 'bufferutil', 'utf-8-validate', 'sqlite3-bindings',
    'node-pre-gyp', '@mapbox/node-pre-gyp', 'esbuild', 'swc', 'rollup', 'terser',
]);
const TEXT_ASSET_EXT = new Set([
    '.sql', '.json', '.txt', '.html', '.htm', '.ejs', '.pug', '.csv', '.xml',
    '.yml', '.yaml', '.graphql', '.gql', '.env', '.so?no',
]);
const REQUIRE_RE = /(^|[^.\w$])require\s*\(\s*(['"])([^'"]*)\2\s*\)/g;
function isBuiltin(spec) {
    const name = spec.startsWith('node:') ? spec.slice(5) : spec;
    return BUILTINS.has(name) || spec.startsWith('node:');
}
function stripShebang(source) {
    if (source.startsWith('#!')) {
        const nl = source.indexOf('\n');
        return nl === -1 ? '' : source.slice(nl + 1);
    }
    return source;
}
function findProjectRoot(entryAbs) {
    let dir = path.dirname(entryAbs);
    for (let hop = 0; hop < 40; hop++) {
        if (fs.existsSync(path.join(dir, 'package.json')))
            return dir;
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return path.dirname(entryAbs);
}
function toVpath(abs, projectRoot) {
    const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
    if (rel.startsWith('..')) {
        throw new Error(`Omni-Forger: 模块落在项目根之外，无法虚拟化: ${abs}`);
    }
    return rel;
}
function tryFileCandidates(abs) {
    const cands = [abs, abs + '.js', abs + '.cjs', abs + '.json', path.join(abs, 'index.js'), path.join(abs, 'index.cjs')];
    for (const c of cands) {
        if (fs.existsSync(c) && fs.statSync(c).isFile())
            return c;
    }
    return null;
}
function resolveRelative(spec, fromDir, projectRoot) {
    const base = path.resolve(fromDir, spec);
    const abs = tryFileCandidates(base);
    if (!abs)
        return { kind: 'unresolved' };
    return { kind: 'code', abs, vpath: toVpath(abs, projectRoot) };
}
/**
 * 裸模块解析：node_modules 逐级向上。
 * 判定内部是否需要 EXTERNAL（原生绑定）。
 */
function resolveBare(spec, fromDir, projectRoot) {
    const pkgName = spec.startsWith('@')
        ? spec.split('/').slice(0, 2).join('/')
        : spec.split('/')[0];
    let dir = fromDir;
    for (let hop = 0; hop < 40; hop++) {
        const nmRoot = path.join(dir, 'node_modules');
        const target = path.join(nmRoot, spec);
        const pkgRoot = path.join(nmRoot, pkgName);
        const pkgJsonPath = path.join(pkgRoot, 'package.json');
        if (fs.existsSync(pkgRoot) && fs.existsSync(pkgJsonPath)) {
            // 原生/外部判定
            const isNative = KNOWN_NATIVE.has(pkgName) ||
                fs.existsSync(path.join(pkgRoot, 'binding.gyp')) ||
                /(.node|node-gyp|prebuild)/i.test(JSON.stringify(readPkg(pkgJsonPath)).slice(0, 2000));
            if (isNative) {
                return { kind: 'external', pkg: pkgName, pkgJsonPath };
            }
        }
        // 优先：按 package.json main / exports.require 找 CJS 入口（zod 等 ESM/CJS 双入口包）
        if (fs.existsSync(pkgJsonPath)) {
            const entry = resolvePkgEntry(pkgRoot, readPkg(pkgJsonPath));
            if (entry) {
                return { kind: 'code', abs: entry, vpath: toVpath(entry, projectRoot), pkgJsonPath };
            }
        }
        const abs = tryFileCandidates(target);
        if (abs) {
            return { kind: 'code', abs, vpath: toVpath(abs, projectRoot), pkgJsonPath: fs.existsSync(pkgJsonPath) ? pkgJsonPath : undefined };
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return { kind: 'unresolved' };
}
function readPkg(pkgJsonPath) {
    try {
        return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    }
    catch {
        return {};
    }
}
/**
 * 按 package.json 入口解析 CJS 入口文件：
 * 优先 exports['.'].require（CJS 侧），其次 main 字段。
 * 避免：把纯 ESM 包（如 zod 的 index.js）当 CJS 内联导致运行时 import 语法报错。
 */
function resolvePkgEntry(pkgRoot, pkg) {
    const exp = pkg.exports && typeof pkg.exports === 'object' && '.' in pkg.exports
        ? pkg.exports['.']
        : null;
    const sub = exp && typeof exp === 'object' && 'require' in exp
        ? exp['require']
        : typeof exp === 'string'
            ? exp
            : null;
    const entry = typeof sub === 'string' ? sub : typeof pkg.main === 'string' ? pkg.main : null;
    if (!entry)
        return null;
    const cand = path.join(pkgRoot, entry);
    const cands = entry.endsWith('.js') || entry.endsWith('.cjs') ? [cand] : [cand, cand + '.js', cand + '.cjs'];
    for (const c of cands) {
        try {
            if (fs.statSync(c).isFile())
                return c;
        }
        catch {
            // 不存在，继续
        }
    }
    return null;
}
/**
 * 去掉启动器模板里的注释。
 * 启动器暴露在「密文视角」下，任何注释都是静态扫描（verifier 的 comment 探针）
 * 的免费线索：这里在生成产物时统一剥离，源码里仍保留可读注释。
 */
function stripLauncherComments(code) {
    const out = [];
    let inBlock = false;
    for (const line of code.split('\n')) {
        if (inBlock) {
            const end = line.indexOf('*/');
            if (end < 0)
                continue;
            inBlock = false;
            out.push(line.slice(end + 2));
            continue;
        }
        const trimmed = line.trim();
        if (trimmed.startsWith('//'))
            continue;
        if (trimmed.startsWith('/*')) {
            const end = trimmed.indexOf('*/');
            if (end < 0) {
                inBlock = true;
                continue;
            }
            const head = line.slice(0, line.indexOf('/*'));
            out.push(head + trimmed.slice(end + 2));
            continue;
        }
        // 行尾注释：只在字符串/模板之外删除，避免误伤 '/'、'//' 等字面量
        let quote = '';
        let cut = -1;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (quote) {
                if (ch === '\\') {
                    i++;
                    continue;
                }
                if (ch === quote)
                    quote = '';
                continue;
            }
            if (ch === "'" || ch === '"' || ch === '`') {
                quote = ch;
                continue;
            }
            if (ch === '/' && line[i + 1] === '/') {
                cut = i;
                break;
            }
        }
        out.push(cut >= 0 ? line.slice(0, cut).replace(/\s+$/, '') : line);
    }
    return out.join('\n');
}
function collectAssets(assetMap, entryAbs, projectRoot) {
    const entryDir = path.dirname(entryAbs);
    let entries = [];
    try {
        entries = fs.readdirSync(entryDir, { withFileTypes: true }).map((d) => d.name);
    }
    catch {
        return;
    }
    // 入口同目录树下的文本资产（递归）
    const walk = (dir) => {
        let ents = [];
        try {
            ents = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const ent of ents) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                if (['node_modules', '.git', 'dist'].includes(ent.name))
                    continue;
                walk(full);
            }
            else if (ent.isFile() && TEXT_ASSET_EXT.has(path.extname(ent.name).toLowerCase())) {
                // package.json 不进 VFS：它的 "name"/"main"/"dependencies" 键是清单结构泄露，
                // 且运行时已按不透明 id 解析模块，不需要包元数据。
                if (ent.name === 'package.json')
                    continue;
                assetMap.set(toVpath(full, projectRoot), fs.readFileSync(full, 'utf8'));
            }
        }
    };
    walk(entryDir);
}
function packProject(opts) {
    var _a;
    const entryAbs = path.resolve(opts.entry);
    if (!fs.existsSync(entryAbs)) {
        throw new Error(`Omni-Forger: 入口文件不存在: ${entryAbs}`);
    }
    const projectRoot = findProjectRoot(entryAbs);
    const outAbs = path.resolve(opts.out);
    const intensity = (_a = opts.obfuscateIntensity) !== null && _a !== void 0 ? _a : 0;
    const obfOptions = intensity > 0 ? (0, obfuscate_1.intensityDefaults)(intensity) : null;
    (0, log_1.banner)(`forge_pack · ${path.basename(opts.out)}`);
    (0, log_1.log)('info', `入口: ${entryAbs}`);
    (0, log_1.log)('info', `项目根: ${projectRoot}`);
    if (intensity > 0)
        (0, log_1.log)('info', `打包期混淆强度: ${intensity}`);
    const codeMap = new Map();
    const assetMap = new Map();
    const externals = new Set();
    const builtins = new Set();
    const idMap = new Map(); // vpath → 不透明模块 id（抹掉包内结构信息）
    const queue = [entryAbs];
    const seen = new Set();
    let unresolvedCount = 0;
    while (queue.length > 0) {
        const abs = queue.shift();
        if (seen.has(abs))
            continue;
        seen.add(abs);
        let source = stripShebang(fs.readFileSync(abs, 'utf8'));
        const vpath = toVpath(abs, projectRoot);
        const fromDir = path.dirname(abs);
        // 单遍扫描 + 重写 require
        let rewritten = '';
        let cursor = 0;
        REQUIRE_RE.lastIndex = 0;
        let m;
        while ((m = REQUIRE_RE.exec(source)) !== null) {
            const matchStart = m.index + m[1].length;
            rewritten += source.slice(cursor, matchStart);
            const spec = m[3];
            let replacement = null;
            if (isBuiltin(spec)) {
                builtins.add(spec.replace(/^node:/, ''));
            }
            else {
                const resolved = spec.startsWith('.') || spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec)
                    ? resolveRelative(spec, fromDir, projectRoot)
                    : resolveBare(spec, fromDir, projectRoot);
                if (resolved.kind === 'unresolved') {
                    unresolvedCount++;
                    (0, log_1.log)('warn', `无法解析: require('${spec}') @ ${vpath}`);
                }
                else if (resolved.kind === 'external') {
                    externals.add(resolved.pkg);
                    replacement = resolved.pkg;
                }
                else {
                    const nextAbs = resolved.abs;
                    if (!seen.has(nextAbs))
                        queue.push(nextAbs);
                    const vp = resolved.vpath;
                    if (!idMap.has(vp))
                        idMap.set(vp, `__m${idMap.size}__`);
                    replacement = idMap.get(vp);
                    if (resolved.pkgJsonPath && fs.existsSync(resolved.pkgJsonPath)) {
                        const pj = toVpath(resolved.pkgJsonPath, projectRoot);
                        if (!assetMap.has(pj))
                            assetMap.set(pj, fs.readFileSync(resolved.pkgJsonPath, 'utf8'));
                    }
                }
            }
            if (replacement !== null) {
                rewritten += `require('${replacement}')`;
            }
            else {
                rewritten += `require('${spec}')`;
            }
            cursor = REQUIRE_RE.lastIndex;
        }
        rewritten += source.slice(cursor);
        source = rewritten;
        // 打包期混淆（require 参数已被重写，混淆器会保留它们明文）
        if (obfOptions) {
            const transformed = (0, obfuscate_1.transformCode)(source, path.basename(abs), obfOptions);
            source = transformed.code;
        }
        else if (vpath.includes('node_modules')) {
            // 内联依赖即使未启用打包期混淆也做最小硬化：剥离注释 + 字符串数组加密
            // （不重命名、不掐 console，避免破坏第三方库语义）
            try {
                const hardened = (0, obfuscate_1.transformCode)(source, path.basename(abs), {
                    intensity: 2,
                    stringArray: true,
                    deadCode: false,
                    rename: false,
                    unicodeNames: false,
                    killEvalConsole: false,
                    minify: true,
                    minStringLength: 3,
                });
                source = hardened.code;
            }
            catch {
                // 降级失败也保留原码（transformCode 内部已有 lite 兜底，此处仅防御）
            }
        }
        codeMap.set(vpath, source);
    }
    collectAssets(assetMap, entryAbs, projectRoot);
    const main = toVpath(entryAbs, projectRoot);
    const bytesBefore = Array.from(codeMap.values()).reduce((a, b) => a + b.length, 0);
    const ids = {};
    for (const [vp, id] of idMap)
        ids[id] = vp; // 反转：运行时按 id 查 vpath
    const manifest = {
        name: path.basename(outAbs),
        main,
        ids,
        code: Object.fromEntries(codeMap),
        assets: Object.fromEntries(assetMap),
    };
    const jsonBuf = Buffer.from(JSON.stringify(manifest), 'utf8');
    const gz = zlib.gzipSync(jsonBuf, { level: 9 });
    let blobB64;
    let keyB64 = '';
    let ivB64 = '';
    let tagB64 = '';
    if (opts.noEncrypt) {
        blobB64 = gz.toString('base64');
    }
    else {
        const key = crypto.randomBytes(32);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const enc = Buffer.concat([cipher.update(gz), cipher.final()]);
        const tag = cipher.getAuthTag();
        keyB64 = key.toString('base64');
        ivB64 = iv.toString('base64');
        tagB64 = tag.toString('base64');
        blobB64 = enc.toString('base64');
    }
    const launcher = stripLauncherComments(runtime_1.RUNTIME_TEMPLATE
        .replace(/%%MAIN%%/g, main)
        .replace(/%%NAME%%/g, path.basename(outAbs))
        .replace(/%%BLOB%%/g, blobB64)
        .replace(/%%KEY%%/g, keyB64)
        .replace(/%%IV%%/g, ivB64)
        .replace(/%%TAG%%/g, tagB64));
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, launcher);
    const bytesAfter = fs.statSync(outAbs).size;
    (0, log_1.log)('success', `单文件封装完成: ${outAbs}`);
    (0, log_1.log)('dim', `模块 ${codeMap.size} · 资产 ${assetMap.size} · 内建 ${builtins.size} · 外部原生 ${externals.size} ` +
        `· 源码 ${formatBytes(bytesBefore)} → 产物 ${formatBytes(bytesAfter)}`);
    if (externals.size > 0) {
        (0, log_1.log)('warn', `外部原生依赖（保持磁盘加载）: ${[...externals].join(', ')}`);
    }
    if (unresolvedCount > 0) {
        (0, log_1.log)('warn', `${unresolvedCount} 条 require 未解析（将尝试运行时真实 require 兜底）`);
    }
    return {
        out: outAbs,
        main,
        moduleCount: codeMap.size,
        assetCount: assetMap.size,
        bytesBefore,
        bytesAfter,
        externals: [...externals],
        builtins: [...builtins],
    };
}
function formatBytes(n) {
    if (n < 1024)
        return `${n}B`;
    if (n < 1024 * 1024)
        return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(2)}MB`;
}
