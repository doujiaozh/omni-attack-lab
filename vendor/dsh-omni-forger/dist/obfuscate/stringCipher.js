"use strict";
/**
 * Omni-Forger · 字符串数组加密（String-Array Encryption）
 * 把源码中的字面量字符串提取为「运行时才解密」的数组：
 *   原文 -> 逐字符位移 -> base64 -> 解码器在运行时还原
 * 位移量与下标相关，无明文密钥 —— 让 Omni-Reverser 的静态字符串搜索扑空。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVault = createVault;
exports.vaultAdd = vaultAdd;
exports.vaultFinalize = vaultFinalize;
exports.vaultCallExpr = vaultCallExpr;
const namegen_1 = require("./namegen");
/**
 * shift 方案：encoded[j] = (orig[j] + 3 + (idx % 11) + j * 5) & 0xffff
 *
 * 重要：位移结果必须先按 UTF-16 码元取模（& 0xffff），再拆成小端双字节交给
 * base64。早期版本直接对 charCode 位移，而 base64Encode 内部按字节 (& 0xff)
 * 取数 —— 位移一旦越过 0xFF，高位就被截断且不可逆：解码后表现为
 * 「前二三十个字符正确、之后全是乱码」；含中文等非 ASCII 的字符串也必然失真。
 */
function encodeEntry(str, idx) {
    let bin = '';
    for (let j = 0; j < str.length; j++) {
        const v = (str.charCodeAt(j) + 3 + (idx % 11) + j * 5) & 0xffff;
        bin += String.fromCharCode(v & 0xff, (v >> 8) & 0xff); // 小端双字节
    }
    return base64Encode(bin);
}
/** 纯 JS base64 编码（不依赖 btoa）。 */
function base64Encode(input) {
    const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    let i = 0;
    const n = input.length;
    while (i < n) {
        const c1 = input.charCodeAt(i++) & 0xff;
        const c2 = i < n ? input.charCodeAt(i++) & 0xff : NaN;
        const c3 = i < n ? input.charCodeAt(i++) & 0xff : NaN;
        out += table[c1 >> 2];
        out += table[((c1 & 0x3) << 4) | (isNaN(c2) ? 0 : c2 >> 4)];
        out += isNaN(c2) ? '=' : table[((c2 & 0xf) << 2) | (isNaN(c3) ? 0 : c3 >> 6)];
        out += isNaN(c3) ? '=' : table[c3 & 0x3f];
    }
    return out;
}
/** 生成 bootstrap：一个 IIFE，返回解码函数。内部自带 base64 解码实现。 */
function genBootstrap(vault, decoderVar) {
    const arr = vault.entries.map((s, i) => `'${encodeEntry(s, i)}'`).join(',');
    // bootstrap 内部变量也用十六进制名，自身即不可读
    const pool = (0, namegen_1.hexNamePool)(0x1a2b + vault.entries.length);
    const nArr = pool.next().value;
    const nA2 = pool.next().value;
    const nTbl = pool.next().value;
    const nIn = pool.next().value;
    const nOut = pool.next().value;
    const nJ = pool.next().value;
    const nK = pool.next().value;
    const nC = pool.next().value;
    // 注意：indexOf('=') 得到 -1，不能用 64 判断填充（标准 atob 的哨兵值）
    return (`var ${vault.name}=(function(){var ${nArr}=[${arr}];` +
        `var ${nTbl}='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';` +
        `var ${nA2}=function(${nIn}){var ${nOut}='',${nJ}=0;` +
        `while(${nJ}<${nIn}.length){` +
        `var s1=${nTbl}.indexOf(${nIn}[${nJ}++]),s2=${nTbl}.indexOf(${nIn}[${nJ}++]),` +
        `s3=${nTbl}.indexOf(${nIn}[${nJ}++]),s4=${nTbl}.indexOf(${nIn}[${nJ}++]);` +
        `${nOut}+=String.fromCharCode((s1<<2)|(s2>>4));` +
        `if(s3>=0){${nOut}+=String.fromCharCode(((s2&15)<<4)|(s3>>2));}` +
        `if(s4>=0){${nOut}+=String.fromCharCode(((s3&3)<<6)|s4);}}return ${nOut};};` +
        `return function(${nIn}){var ${nOut}='',${nK}=0,${nC}=${nA2}(${nArr}[${nIn}]);` +
        `for(var ${nJ}=0;${nJ}<${nC}.length;${nJ}+=2){` +
        `var v=(${nC}.charCodeAt(${nJ})|(${nC}.charCodeAt(${nJ}+1)<<8));` +
        `v=(v-3-(${nIn}%11)-${nK}*5)&0xffff;` +
        `${nOut}+=String.fromCharCode(v);${nK}++;}` +
        `return ${nOut};};})();`);
}
function createVault() {
    const pool = (0, namegen_1.hexNamePool)(0x2b3c);
    const name = pool.next().value;
    const vault = {
        name,
        bootstrap: '',
        entries: [],
        lookup: new Map(),
    };
    let bootstrapBuilt = false;
    const finish = () => {
        if (!bootstrapBuilt) {
            vault.bootstrap = genBootstrap(vault, name);
            bootstrapBuilt = true;
        }
        return vault;
    };
    // finish 通过闭包挂回外层：为保持类型简单，直接在 add 阶段暂存，finalize 时生成
    vault._finish = finish;
    return vault;
}
/** 注册一条字符串，返回下标（重复字符串自动复用同一下标）。 */
function vaultAdd(vault, value) {
    const hit = vault.lookup.get(value);
    if (hit !== undefined)
        return hit;
    const idx = vault.entries.length;
    vault.entries.push(value);
    vault.lookup.set(value, idx);
    return idx;
}
/** 生成 bootstrap 并冻结 vault（之后不可再 add）。 */
function vaultFinalize(vault) {
    const finish = vault._finish;
    return finish ? finish() : vault;
}
function vaultCallExpr(vault, idx) {
    return `${vault.name}(${idx})`;
}
