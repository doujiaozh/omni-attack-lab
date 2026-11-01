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
exports.decryptBundle = decryptBundle;
exports.verifyBundle = verifyBundle;
exports.runFullPipeline = runFullPipeline;
/**
 * Omni-Forger · forge_verify 红蓝对抗验证器
 *
 * 蓝方（防御）产物经过红方（Omni-Reverser 视角）三轮打击：
 *   1. 外层静态：直接对启动器文件跑探针（所见即密文）
 *   2. 内层静态：解密 bundle 还原模块源码再跑探针（最严苛，检验混淆质量）
 *   3. 动态存活：真正启动 bundle 并探测 /health（确保防御没有把程序搞坏）
 *
 * 内层分低于阈值时，由 runFullPipeline 自动升级混淆强度重新打断打。
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const zlib = __importStar(require("zlib"));
const crypto = __importStar(require("crypto"));
const child_process_1 = require("child_process");
const probes_1 = require("./probes");
const scaffold_1 = require("../scaffold");
const obfuscate_1 = require("../obfuscate");
const bundler_1 = require("../pack/bundler");
const log_1 = require("../utils/log");
/** 从启动器文件里把嵌入的密文与密钥材料抠出来（模拟攻击者第一步）。 */
function extractPayload(bundlePath) {
    const text = fs.readFileSync(bundlePath, 'utf8');
    const grab = (name) => {
        const re = new RegExp(`var __${name} = '([^']{8,})'`);
        const m = re.exec(text);
        return m ? m[1] : '';
    };
    const blob = grab('BLOB');
    const key = grab('KEY');
    const iv = grab('IV');
    const tag = grab('TAG');
    return blob && key && iv && tag ? { blob, key, iv, tag } : null;
}
/** 解密 bundle → manifest（红方视角的「完全突破」情形）。 */
function decryptBundle(bundlePath) {
    var _a, _b;
    try {
        const payload = extractPayload(bundlePath);
        if (!payload)
            return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(payload.key, 'base64'), Buffer.from(payload.iv, 'base64'));
        decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
        const raw = Buffer.concat([
            decipher.update(Buffer.from(payload.blob, 'base64')),
            decipher.final(),
        ]);
        const manifest = JSON.parse(zlib.gunzipSync(raw).toString('utf8'));
        return { code: (_a = manifest.code) !== null && _a !== void 0 ? _a : {}, main: (_b = manifest.main) !== null && _b !== void 0 ? _b : '' };
    }
    catch {
        return null;
    }
}
/** 启动 bundle → GET /health → 关闭，验证混淆没有破坏可运行性。 */
function dynamicProbe(bundlePath, port, cwd) {
    var _a, _b;
    const { spawn } = require('child_process');
    const http = require('http');
    const stdoutChunks = [];
    let child = null;
    try {
        child = spawn(process.execPath, [bundlePath], {
            env: {
                ...process.env,
                PORT: String(port),
                NODE_ENV: 'production',
                // 生成项目在生产态强制要求 JWT_SECRET；注入仅供存活性验证的一次性密钥
                JWT_SECRET: 'omni-forger-verify-only-key',
            },
            cwd: cwd || path.dirname(bundlePath),
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (d) => stdoutChunks.push(d.toString('utf8')));
        (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.on('data', (d) => stdoutChunks.push(d.toString('utf8')));
    }
    catch (e) {
        return Promise.resolve({ ok: false, httpOk: false, stdout: '', note: `spawn 失败: ${e.message}`, score: 0 });
    }
    return new Promise((resolve) => {
        const finish = (result) => {
            try {
                child === null || child === void 0 ? void 0 : child.kill('SIGKILL');
            }
            catch {
                // ignore
            }
            resolve(result);
        };
        const timeout = setTimeout(() => {
            finish({
                ok: false,
                httpOk: false,
                stdout: stdoutChunks.join(''),
                note: '启动超时（5s 内未响应健康检查）',
                score: 0,
            });
        }, 5000);
        setTimeout(() => {
            const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, (res) => {
                let body = '';
                res.on('data', (d) => (body += d));
                res.on('end', () => {
                    clearTimeout(timeout);
                    const httpOk = res.statusCode === 200;
                    finish({
                        ok: httpOk,
                        httpOk,
                        stdout: stdoutChunks.join(''),
                        note: httpOk ? `存活，/health → ${body.slice(0, 120)}` : `HTTP ${res.statusCode}`,
                        score: httpOk ? 100 : 40,
                    });
                });
            });
            req.on('error', (e) => {
                clearTimeout(timeout);
                finish({
                    ok: false,
                    httpOk: false,
                    stdout: stdoutChunks.join(''),
                    note: `健康检查失败: ${e.message}`,
                    score: 0,
                });
            });
        }, 1500);
    });
}
async function verifyBundle(bundlePath, port = 14923, opts) {
    var _a;
    (0, log_1.banner)(`forge_verify · ${path.basename(bundlePath)}`);
    const outer = (0, probes_1.runProbes)(fs.readFileSync(bundlePath, 'utf8'));
    (0, log_1.log)('dim', `外层（密文视角）防御分: ${outer.score}`);
    const decrypted = decryptBundle(bundlePath);
    const innerText = decrypted ? Object.values(decrypted.code).join('\n') : '';
    const inner = (0, probes_1.runProbes)(innerText);
    (0, log_1.log)('dim', `内层（解密视角）防御分: ${inner.score}${decrypted ? '' : '（无法解密）'}`);
    const dynamic = await dynamicProbe(bundlePath, port, opts === null || opts === void 0 ? void 0 : opts.cwd);
    (0, log_1.log)('dim', `动态存活: ${dynamic.ok ? 'PASS' : 'FAIL'} — ${dynamic.note}`);
    const overall = Math.round(0.3 * outer.score + 0.5 * inner.score + 0.2 * dynamic.score);
    const recommendation = overall >= 90
        ? `✅ 防御评分 ${overall}/100 — 通过红蓝对抗，可发布。`
        : inner.score < 80
            ? `⚠ 防御评分 ${overall}/100 — 内层混淆不足，建议提升 intensity 至 >=4 并重新打包。`
            : `⚠ 防御评分 ${overall}/100 — 存在泄露面，建议检查探针命中项。`;
    if (overall >= 90)
        (0, log_1.log)('success', recommendation);
    else
        (0, log_1.log)('warn', recommendation);
    for (const hit of inner.hits.slice(0, 5)) {
        (0, log_1.log)('warn', `  内层命中 [${hit.probe.id}] x${hit.count}: ${(_a = hit.samples[0]) === null || _a === void 0 ? void 0 : _a.slice(0, 70)}`);
    }
    return { artifact: bundlePath, outer, inner, dynamic, overall, recommendation };
}
/**
 * 红蓝对抗闭环演示：
 *   scaffold → npm install → obfuscate → pack → verify
 *   若 verify.overall < 90：自动调高混淆强度，重新 obfuscate + pack + verify，最多两轮。
 */
async function runFullPipeline(opts) {
    var _a;
    const intensity = (_a = opts.intensity) !== null && _a !== void 0 ? _a : 3;
    const workDir = path.resolve(opts.workDir);
    const appDir = path.join(workDir, 'app');
    const stages = [];
    (0, log_1.banner)('Omni-Forger · 正向构建 + 主动防御 全流水线');
    stages.push(`scaffold: ${opts.sentence}`);
    (0, scaffold_1.scaffold)(opts.sentence, { outDir: appDir });
    if (opts.installDeps !== false) {
        stages.push('npm install (生产依赖，--ignore-scripts 跳过原生编译)');
        (0, log_1.log)('info', '安装生成项目的生产依赖（用于打包内联）…');
        (0, child_process_1.execFileSync)('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
            cwd: appDir,
            stdio: 'inherit',
            timeout: 240000,
            // Windows 上 npm 是 .cmd，Node v20+ 要求 shell 才能执行
            shell: process.platform === 'win32',
        });
    }
    // 生成项目是 TypeScript：先用宿主自带的 tsc 编译成 CJS（零原生编译、零额外依赖）
    // dist/ 里的纯 JS 才是混淆与打包的输入。
    const forgerRoot = path.resolve(__dirname, '..', '..');
    const tscBin = path.join(forgerRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    stages.push('tsc build (生成项目 TS → dist/)');
    (0, log_1.log)('info', '编译生成项目（tsc）…');
    (0, child_process_1.execFileSync)(process.execPath, [tscBin, '-p', appDir], {
        cwd: appDir,
        stdio: 'inherit',
        timeout: 240000,
    });
    // db.ts 运行时按 __dirname/schema.sql 加载建表语句：编译不会复制资源，手动补进去
    const distDir = path.join(appDir, 'dist');
    const schemaSrc = path.join(appDir, 'src', 'schema.sql');
    const schemaDist = path.join(distDir, 'schema.sql');
    if (fs.existsSync(schemaSrc) && !fs.existsSync(schemaDist)) {
        fs.copyFileSync(schemaSrc, schemaDist);
    }
    // 混淆输出放在 app 内部（app/dist.obf），保证打包器解析裸模块时
    // 能沿目录向上找到 app/node_modules（express / jsonwebtoken / zod …）
    const obfDir = path.join(appDir, 'dist.obf');
    const obfEntry = path.join(obfDir, 'index.js');
    let currentIntensity = intensity;
    let verify = null;
    let bundlePath = '';
    let escalated = false;
    let packResult = null;
    for (let round = 0; round < 3; round++) {
        stages.push(`obfuscate round ${round + 1} @ intensity ${currentIntensity}`);
        (0, obfuscate_1.obfuscate)(distDir, { outDir: obfDir, intensity: currentIntensity });
        stages.push(`pack round ${round + 1}`);
        bundlePath = path.join(workDir, 'bundle', 'app.bundle.js');
        packResult = (0, bundler_1.packProject)({
            entry: obfEntry,
            out: bundlePath,
        });
        stages.push(`verify round ${round + 1}`);
        // spawn 的 cwd=appDir：外部原生模块（express/better-sqlite3…）从 app/node_modules 落地加载
        verify = await verifyBundle(bundlePath, 14923, { cwd: appDir });
        if (verify.overall >= 90) {
            (0, log_1.log)('success', `第 ${round + 1} 轮即通过红蓝对抗（overall ${verify.overall}）`);
            break;
        }
        if (round === 2 || currentIntensity >= 5) {
            (0, log_1.log)('warn', `已达最高强度上限，停止升级（overall ${verify.overall}）`);
            break;
        }
        escalated = true;
        const next = Math.min(5, currentIntensity + 2);
        (0, log_1.log)('warn', `防御分 ${verify.overall} < 90 → 混淆强度 ${currentIntensity} → ${next}，重新打断打`);
        currentIntensity = next;
    }
    return {
        sentence: opts.sentence,
        workDir,
        appDir,
        bundlePath,
        stages,
        finalIntensity: currentIntensity,
        initialIntensity: intensity,
        verify,
        escalated,
        packResult,
    };
}
