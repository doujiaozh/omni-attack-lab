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
exports.parseSpec = parseSpec;
exports.scaffold = scaffold;
/**
 * Omni-Forger · forge_scaffold 编排器
 * 一句话 → ProjectSpec → 文件集 → 落盘 → 打印目录树
 */
const path = __importStar(require("path"));
const intents_1 = require("./intents");
const templates_1 = require("./templates");
const fs_1 = require("../utils/fs");
const log_1 = require("../utils/log");
function parseSpec(input, opts = {}) {
    return (0, intents_1.parseIntent)(input, opts);
}
function scaffold(input, opts) {
    var _a, _b;
    const spec = (0, intents_1.parseIntent)(input, opts);
    const outDir = path.resolve(opts.outDir);
    const files = (0, templates_1.buildFiles)(spec);
    (0, log_1.banner)(`forge_scaffold · ${spec.name}`);
    (0, log_1.log)('info', `意图: ${input}`);
    (0, log_1.log)('dim', `类型=${spec.type} 框架=${spec.framework} 鉴权=${(_a = spec.auth) !== null && _a !== void 0 ? _a : 'none'} 数据库=${(_b = spec.db) !== null && _b !== void 0 ? _b : 'none'} ` +
        `WS=${spec.websocket} GraphQL=${spec.graphql} 实体=[${spec.entities.join(', ')}]`);
    for (const [rel, content] of Object.entries(files)) {
        (0, fs_1.writeFileRecursive)(path.join(outDir, rel), content);
    }
    // SQLite 项目需要 data 目录占位（运行时由 db.ts 创建）
    if (spec.db === 'sqlite')
        (0, fs_1.ensureDir)(path.join(outDir, 'data'));
    (0, log_1.log)('success', `已生成 ${Object.keys(files).length} 个文件 → ${outDir}`);
    console.log('\n' + (0, fs_1.printTree)(Object.keys(files)) + '\n');
    return { spec, files, outDir };
}
