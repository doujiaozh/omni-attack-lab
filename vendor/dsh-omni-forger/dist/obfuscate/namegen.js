"use strict";
/**
 * Omni-Forger · 标识符生成器
 * 产出「反人类可读」的标识符：十六进制风（_0x4a2f）或 Unicode 风（希腊/科普特字母组合）。
 * 所有生成的名字都是合法 ECMA-262 IdentifierName（ID_Start + ID_Continue）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NameAllocator = void 0;
exports.hexNamePool = hexNamePool;
exports.unicodeNamePool = unicodeNamePool;
exports.collectIdentifiers = collectIdentifiers;
const HEX_CHARS = '0123456789abcdef';
/** 十六进制风格名字池：_0x0001 .. _0xffff */
function* hexNamePool(start = 1) {
    let i = start;
    while (true) {
        i++;
        yield '_0x' + i.toString(16).padStart(4, '0') + HEX_CHARS[i % 16];
    }
}
// 希腊字母与希腊扩展区字符：均为合法 ID_Start/ID_Continue
const UNI_ID_START = 'αβγδεζηθικλμνξοπρστυφχψω';
const UNI_ID_CONT = UNI_ID_START + 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ';
/** Unicode 风格名字池：ωΨξΛ 这类无语义组合 */
function* unicodeNamePool(start = 1) {
    let i = start;
    while (true) {
        i++;
        const len = 2 + (i % 4);
        let s = UNI_ID_START[i % UNI_ID_START.length];
        for (let k = 1; k < len; k++) {
            s += UNI_ID_CONT[(i * (k + 3)) % UNI_ID_CONT.length];
        }
        yield s;
    }
}
/**
 * 创建一个与「已存在名字集合」不冲突的分配器。
 * 用于保证单文件内重命名不撞车、也不撞保留字与全局引用。
 */
class NameAllocator {
    constructor(existing, mode = 'hex') {
        this.pool = mode === 'unicode' ? unicodeNamePool() : hexNamePool();
        this.taken = new Set(existing);
    }
    next(exclude) {
        for (let guard = 0; guard < 100000; guard++) {
            const candidate = this.pool.next().value;
            if (this.taken.has(candidate))
                continue;
            if (exclude && [...exclude].includes(candidate))
                continue;
            this.taken.add(candidate);
            return candidate;
        }
        throw new Error('Omni-Forger: identifier space exhausted');
    }
    reserve(name) {
        this.taken.add(name);
    }
    has(name) {
        return this.taken.has(name);
    }
}
exports.NameAllocator = NameAllocator;
/** 收集一段代码里出现的所有标识符（粗粒度，用于冲突规避）。 */
function collectIdentifiers(code) {
    const out = new Set();
    const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
    let m;
    while ((m = re.exec(code)) !== null)
        out.add(m[0]);
    return out;
}
