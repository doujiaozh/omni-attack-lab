#!/usr/bin/env node
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
/**
 * Omni-Forger · 命令行工具 `forge`
 * 零第三方依赖的手写参数解析器（连 commander 都不用 —— 纯 JS 到底）。
 */
const path = __importStar(require("path"));
const scaffold_1 = require("./scaffold");
const obfuscate_1 = require("./obfuscate");
const bundler_1 = require("./pack/bundler");
const verify_1 = require("./verify");
const log_1 = require("./utils/log");
const VERSION = 'dsh-omni-forger 1.0.0';
function parseArgs(argv) {
    var _a;
    const positional = [];
    const flags = {};
    let i = 0;
    while (i < argv.length) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const name = a.slice(2);
            const next = argv[i + 1];
            if (next !== undefined && !next.startsWith('--')) {
                flags[name] = next;
                i += 2;
            }
            else {
                flags[name] = true;
                i += 1;
            }
        }
        else if (a.startsWith('-')) {
            const name = a.slice(1);
            const next = argv[i + 1];
            // 单字母选项（-o）也接受值：-o out
            if (!name.startsWith('-') && next !== undefined && !next.startsWith('-')) {
                flags[name] = next;
                i += 2;
            }
            else {
                flags[name] = true;
                i += 1;
            }
        }
        else {
            positional.push(a);
            i += 1;
        }
    }
    return { command: (_a = positional[0]) !== null && _a !== void 0 ? _a : '', positional: positional.slice(1), flags };
}
function quietIf(flags) {
    if (flags['quiet'] === true || flags['q'] === true)
        (0, log_1.setVerbose)(false);
}
function help() {
    console.log(`
${VERSION} · Omni-Forger：万物从无到有，且不可窥探。

USAGE
  forge <command> [options]

COMMANDS
  scaffold "<一句话>" -o <dir>            意念级项目生成（目录树/路由/Schema/Dockerfile/CI）
      --name <pkg-name>                    指定包名（默认由语义推导）

  obfuscate <inputDir> -o <outDir>         AST 混淆（变量重命名 + 字符串数组加密 + 死代码）
      --intensity <1-5>                    混淆强度，默认 3（5 = 降维打击）
      --lite                               强制纯词法引擎（不依赖 Babel）
      --include-deps                       连 node_modules 一起混淆

  pack <entry.js> -o <bundle.js>           单文件封装（整树 + 依赖 → 一个启动器，内存 VFS 加载）
      --obfuscate <0-5>                    打包期混淆强度，默认 0（如已跑过 obfuscate）
      --no-encrypt                         跳过 AES-256-GCM（调试用）

  verify <bundle.js>                       红蓝对抗：正则/字符串提取 → 泄露则告警
      --demo ["<一句话>"]                   跑完整流水线（scaffold→install→obfuscate→pack→verify）
      --intensity <1-5>                    demo 起始强度，默认 3
      --workdir <dir>                      demo 工作目录，默认 ./.omni-demo
      --no-install                         demo 跳过 npm install

  build "<一句话>" -o <dir>                 全自动：scaffold → obfuscate → pack → verify
      --intensity <1-5>                    起始混淆强度，默认 3
      --no-install                         跳过 npm install

  version, -v                              版本号
  help, -h                                 本帮助

EXAMPLE
  forge scaffold "做一个带 JWT 鉴权和 SQLite 的记账 API" -o out
  forge obfuscate out -o out.obf --intensity 5
  forge pack out.obf/src/index.js -o dist/app.bundle.js
  forge verify dist/app.bundle.js
  forge verify --demo "做一个带 JWT 鉴权和 SQLite 的记账 API"
`);
}
async function main() {
    const { command, positional, flags } = parseArgs(process.argv.slice(2));
    quietIf(flags);
    (0, log_1.banner)('Omni-Forger · 万物锻炉');
    switch (command) {
        case 'scaffold': {
            const sentence = positional.join(' ') || flags.demo || '';
            if (!sentence || !flags.o) {
                (0, log_1.log)('error', '用法: forge scaffold "<一句话>" -o <dir>');
                process.exit(1);
            }
            (0, scaffold_1.scaffold)(sentence, { outDir: String(flags.o), name: flags.name ? String(flags.name) : undefined });
            break;
        }
        case 'obfuscate': {
            const input = positional[0];
            if (!input || !flags.o) {
                (0, log_1.log)('error', '用法: forge obfuscate <inputDir> -o <outDir> [--intensity 1-5]');
                process.exit(1);
            }
            (0, obfuscate_1.obfuscate)(input, {
                outDir: String(flags.o),
                intensity: flags.intensity ? Number(flags.intensity) : 3,
                lite: flags.lite === true,
                includeDeps: flags['include-deps'] === true,
            });
            break;
        }
        case 'pack': {
            const entry = positional[0];
            if (!entry || !flags.o) {
                (0, log_1.log)('error', '用法: forge pack <entry.js> -o <bundle.js> [--obfuscate 0-5]');
                process.exit(1);
            }
            (0, bundler_1.packProject)({
                entry,
                out: String(flags.o),
                obfuscateIntensity: flags.obfuscate ? Number(flags.obfuscate) : 0,
                noEncrypt: flags['no-encrypt'] === true,
            });
            break;
        }
        case 'verify': {
            if (flags.demo === true || (flags.demo !== undefined && positional.length === 0)) {
                const sentence = typeof flags.demo === 'string' && flags.demo.length > 0
                    ? flags.demo
                    : '做一个带 JWT 鉴权和 SQLite 的记账 API';
                const report = await (0, verify_1.runFullPipeline)({
                    sentence,
                    workDir: flags.workdir ? String(flags.workdir) : path.resolve('.omni-demo'),
                    intensity: flags.intensity ? Number(flags.intensity) : 3,
                    installDeps: flags['no-install'] !== true,
                });
                summarizePipeline(report);
                process.exit(report.verify && report.verify.overall >= 90 ? 0 : 1);
            }
            const bundle = positional[0];
            if (!bundle) {
                (0, log_1.log)('error', '用法: forge verify <bundle.js>   或   forge verify --demo');
                process.exit(1);
            }
            const report = await (0, verify_1.verifyBundle)(path.resolve(bundle));
            process.exit(report.overall >= 90 ? 0 : 1);
        }
        case 'build': {
            const sentence = positional.join(' ') || (typeof flags.demo === 'string' ? flags.demo : '');
            if (!sentence || !flags.o) {
                (0, log_1.log)('error', '用法: forge build "<一句话>" -o <dir>');
                process.exit(1);
            }
            const workDir = path.resolve(String(flags.o));
            const report = await (0, verify_1.runFullPipeline)({
                sentence,
                workDir,
                intensity: flags.intensity ? Number(flags.intensity) : 3,
                installDeps: flags['no-install'] !== true,
            });
            summarizePipeline(report);
            process.exit(report.verify && report.verify.overall >= 90 ? 0 : 1);
        }
        case 'version':
        case '-v':
            console.log(VERSION);
            break;
        case 'help':
        case '-h':
        case '':
            help();
            break;
        default:
            (0, log_1.log)('error', `未知命令: ${command}`);
            help();
            process.exit(1);
    }
}
function summarizePipeline(report) {
    (0, log_1.banner)('流水线总结');
    (0, log_1.log)('info', `一句话: ${report.sentence}`);
    for (const stage of report.stages)
        (0, log_1.log)('dim', '  · ' + stage);
    (0, log_1.log)('info', `混淆强度: ${report.initialIntensity}${report.escalated ? ` → 升级至 ${report.finalIntensity}` : '（未升级）'}`);
    (0, log_1.log)('info', `产物: ${report.bundlePath}`);
    if (report.packResult) {
        (0, log_1.log)('dim', `模块 ${report.packResult.moduleCount} · 资产 ${report.packResult.assetCount} · ${report.packResult.bytesAfter} 字节`);
    }
    if (report.verify) {
        (0, log_1.log)('info', `外层防御 ${report.verify.outer.score} / 内层防御 ${report.verify.inner.score} / 动态 ${report.verify.dynamic.ok ? 'PASS' : 'FAIL'}`);
        (0, log_1.log)(report.verify.overall >= 90 ? 'success' : 'warn', report.verify.recommendation);
    }
}
main().catch((e) => {
    (0, log_1.log)('error', e instanceof Error ? e.stack || e.message : String(e));
    process.exit(1);
});
