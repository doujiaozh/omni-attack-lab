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
exports.ensureDir = ensureDir;
exports.writeFileRecursive = writeFileRecursive;
exports.walkDir = walkDir;
exports.exists = exists;
exports.readText = readText;
exports.printTree = printTree;
exports.fnv1a = fnv1a;
exports.randHex = randHex;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** 递归创建目录（兼容 Win7 / Node 14+）。 */
function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}
/** 递归写入文件，自动创建父目录。 */
function writeFileRecursive(file, content) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, content);
}
/** 深度优先遍历目录，返回相对根目录的 posix 风格路径列表。 */
function walkDir(root, opts = {}) {
    var _a, _b, _c;
    const excludeDirs = new Set((_a = opts.excludeDirs) !== null && _a !== void 0 ? _a : ['node_modules', '.git', 'dist', '.cache']);
    const excludeFiles = new Set((_b = opts.excludeFiles) !== null && _b !== void 0 ? _b : []);
    const includeExt = (_c = opts.includeExt) === null || _c === void 0 ? void 0 : _c.map((e) => e.toLowerCase());
    const out = [];
    function visit(dir, rel) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const ent of entries) {
            const relChild = rel ? `${rel}/${ent.name}` : ent.name;
            if (ent.isDirectory()) {
                if (excludeDirs.has(ent.name))
                    continue;
                visit(path.join(dir, ent.name), relChild);
            }
            else if (ent.isFile()) {
                if (excludeFiles.has(ent.name))
                    continue;
                if (includeExt && !includeExt.includes(path.extname(ent.name).toLowerCase()))
                    continue;
                out.push(relChild);
            }
        }
    }
    visit(root, '');
    return out.sort();
}
/** 判断路径是否存在（文件或目录）。 */
function exists(p) {
    try {
        return fs.existsSync(p);
    }
    catch {
        return false;
    }
}
/** 读取文件，失败返回 null。 */
function readText(p) {
    try {
        return fs.readFileSync(p, 'utf8');
    }
    catch {
        return null;
    }
}
/** ASCII 目录树打印（用于 scaffold 结果展示）。 */
function printTree(files) {
    const sorted = [...files].sort();
    const lines = [];
    for (const f of sorted) {
        const parts = f.split('/');
        const indent = '  '.repeat(parts.length - 1);
        lines.push(`${indent}${parts[parts.length - 1]}`);
    }
    return lines.join('\n');
}
/** 简单确定性哈希（用于生成标识符后缀，非密码学用途）。 */
function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
}
/** 随机十六进制字符串。 */
function randHex(len) {
    const chars = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < len; i++)
        s += chars[Math.floor(Math.random() * 16)];
    return s;
}
