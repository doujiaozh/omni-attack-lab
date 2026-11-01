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
exports.hasBabel = hasBabel;
exports.intensityDefaults = intensityDefaults;
exports.transformCode = transformCode;
exports.obfuscateFile = obfuscateFile;
exports.obfuscate = obfuscate;
/**
 * Omni-Forger · forge_obfuscate 编排器
 *
 * 输入一个项目目录 → 逐文件混淆 → 输出到目标目录。
 * 引擎选择：优先 Babel AST；不可用或单文件解析失败时自动降级到 lite 词法引擎。
 * Win7 红线：全程纯 JS，Babel 全家桶也是纯 JS 实现，无任何原生编译。
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const babelEngine_1 = require("./babelEngine");
const liteEngine_1 = require("./liteEngine");
const fs_1 = require("../utils/fs");
const log_1 = require("../utils/log");
let babelProbe = null;
function hasBabel() {
    if (babelProbe !== null)
        return babelProbe;
    try {
        require('@babel/parser');
        require('@babel/traverse');
        require('@babel/generator');
        babelProbe = true;
    }
    catch {
        babelProbe = false;
        (0, log_1.log)('warn', 'Babel 不可用，降级为 lite 词法引擎（能力子集：字符串加密/注释剥离/掐断泄露点）');
    }
    return babelProbe;
}
const CODE_EXT = new Set(['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts', '.tsx']);
function intensityDefaults(intensity) {
    const i = Math.max(1, Math.min(5, intensity));
    return {
        intensity: i,
        stringArray: true,
        deadCode: i >= 3,
        rename: i >= 3,
        unicodeNames: i >= 4,
        killEvalConsole: i >= 2,
        minify: i >= 3,
        minStringLength: i >= 5 ? 1 : 2,
    };
}
/** 内存级变换：代码 → 混淆代码（Babel 优先，解析失败降级 lite）。 */
function transformCode(code, filename, options) {
    if (hasBabel()) {
        try {
            return (0, babelEngine_1.transformSource)(code, filename, options);
        }
        catch (e) {
            (0, log_1.log)('warn', `AST 解析失败，降级 lite: ${filename} (${e.message})`);
            return (0, liteEngine_1.obfuscateLite)(code, filename, options);
        }
    }
    return (0, liteEngine_1.obfuscateLite)(code, filename, options);
}
function obfuscateFile(filePath, outPath, options) {
    const code = (0, fs_1.readText)(filePath);
    if (code === null)
        throw new Error(`无法读取: ${filePath}`);
    const result = transformCode(code, path.basename(filePath), options);
    (0, fs_1.writeFileRecursive)(outPath, result.code);
    if (result.notes.length > 0) {
        for (const note of result.notes)
            (0, log_1.log)('dim', `  ${path.basename(filePath)}: ${note}`);
    }
    return result.stats;
}
function obfuscate(input, opts) {
    var _a;
    const inputAbs = path.resolve(input);
    const outDir = path.resolve(opts.outDir);
    const intensity = (_a = opts.intensity) !== null && _a !== void 0 ? _a : 3;
    const options = intensityDefaults(intensity);
    const stats = {
        stringsEncrypted: 0,
        identifiersRenamed: 0,
        deadCodeInjected: 0,
        evalConsoleKilled: 0,
        engine: hasBabel() ? 'babel' : 'lite',
    };
    const notes = [];
    let engines = new Set();
    let processed = 0;
    (0, log_1.banner)(`forge_obfuscate · intensity ${intensity}`);
    const isDir = fs.statSync(inputAbs).isDirectory();
    const files = isDir
        ? (0, fs_1.walkDir)(inputAbs, {
            excludeDirs: ['node_modules', '.git', ...(opts.includeDeps ? [] : [])],
            excludeFiles: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'],
        })
        : [path.basename(inputAbs)];
    for (const rel of files) {
        const srcAbs = isDir ? path.join(inputAbs, rel) : inputAbs;
        const outAbs = isDir ? path.join(outDir, rel) : outDir;
        const ext = path.extname(srcAbs).toLowerCase();
        if (!CODE_EXT.has(ext)) {
            // 非代码文件原样保留（schema.sql / package.json / Dockerfile …）
            const content = (0, fs_1.readText)(srcAbs);
            if (content !== null)
                (0, fs_1.writeFileRecursive)(outAbs, content);
            continue;
        }
        const fileStats = obfuscateFile(srcAbs, outAbs, options);
        stats.stringsEncrypted += fileStats.stringsEncrypted;
        stats.identifiersRenamed += fileStats.identifiersRenamed;
        stats.deadCodeInjected += fileStats.deadCodeInjected;
        stats.evalConsoleKilled += fileStats.evalConsoleKilled;
        engines.add(fileStats.engine);
        processed++;
    }
    const engine = engines.has('babel') && engines.has('lite') ? 'mixed' : engines.has('babel') ? 'babel' : 'lite';
    (0, log_1.log)('success', `混淆完成: ${processed} 个代码文件 → ${outDir}`);
    (0, log_1.log)('dim', `字符串加密 ${stats.stringsEncrypted} · 重命名 ${stats.identifiersRenamed} · 死代码 ${stats.deadCodeInjected} · 泄露点掐断 ${stats.evalConsoleKilled}`);
    if (stats.evalConsoleKilled === 0 && intensity >= 2) {
        notes.push('未发现 eval/console 调用（代码可能已经很干净）');
    }
    return { outDir, files, stats, engine, notes };
}
