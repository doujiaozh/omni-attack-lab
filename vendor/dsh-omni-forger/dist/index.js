"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runProbes = exports.PROBES = exports.runFullPipeline = exports.decryptBundle = exports.verifyBundle = exports.RUNTIME_TEMPLATE = exports.packProject = exports.scanDeobfuscationRisks = exports.hasBabel = exports.intensityDefaults = exports.transformCode = exports.obfuscateFile = exports.obfuscate = exports.parseSpec = exports.scaffold = void 0;
/**
 * Omni-Forger · 万物锻炉 —— 程序化 API 总入口
 *
 *   forge_scaffold  : 一句话 → 完整项目
 *   forge_obfuscate : AST 级代码混淆（反逆向防御）
 *   forge_pack      : 单文件封装 + 内存 VFS
 *   forge_verify    : 红蓝对抗自检 + 自动升级强度
 *
 * 「Omni-Forger：万物从无到有，且不可窥探。」
 * "Omni-Forger: all things forged from nothing — and beyond prying eyes."
 */
var scaffold_1 = require("./scaffold");
Object.defineProperty(exports, "scaffold", { enumerable: true, get: function () { return scaffold_1.scaffold; } });
Object.defineProperty(exports, "parseSpec", { enumerable: true, get: function () { return scaffold_1.parseSpec; } });
var obfuscate_1 = require("./obfuscate");
Object.defineProperty(exports, "obfuscate", { enumerable: true, get: function () { return obfuscate_1.obfuscate; } });
Object.defineProperty(exports, "obfuscateFile", { enumerable: true, get: function () { return obfuscate_1.obfuscateFile; } });
Object.defineProperty(exports, "transformCode", { enumerable: true, get: function () { return obfuscate_1.transformCode; } });
Object.defineProperty(exports, "intensityDefaults", { enumerable: true, get: function () { return obfuscate_1.intensityDefaults; } });
Object.defineProperty(exports, "hasBabel", { enumerable: true, get: function () { return obfuscate_1.hasBabel; } });
var babelEngine_1 = require("./obfuscate/babelEngine");
Object.defineProperty(exports, "scanDeobfuscationRisks", { enumerable: true, get: function () { return babelEngine_1.scanDeobfuscationRisks; } });
var pack_1 = require("./pack");
Object.defineProperty(exports, "packProject", { enumerable: true, get: function () { return pack_1.packProject; } });
Object.defineProperty(exports, "RUNTIME_TEMPLATE", { enumerable: true, get: function () { return pack_1.RUNTIME_TEMPLATE; } });
var verify_1 = require("./verify");
Object.defineProperty(exports, "verifyBundle", { enumerable: true, get: function () { return verify_1.verifyBundle; } });
Object.defineProperty(exports, "decryptBundle", { enumerable: true, get: function () { return verify_1.decryptBundle; } });
Object.defineProperty(exports, "runFullPipeline", { enumerable: true, get: function () { return verify_1.runFullPipeline; } });
var probes_1 = require("./verify/probes");
Object.defineProperty(exports, "PROBES", { enumerable: true, get: function () { return probes_1.PROBES; } });
Object.defineProperty(exports, "runProbes", { enumerable: true, get: function () { return probes_1.runProbes; } });
