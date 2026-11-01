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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanDeobfuscationRisks = scanDeobfuscationRisks;
exports.transformSource = transformSource;
/**
 * Omni-Forger · forge_obfuscate 全量 AST 引擎（Babel）
 *
 * 变换流水线（顺序不可调换）：
 *   1. TS 类型剥离（含 import x = require() / enum / 断言）
 *   2. ESM → CommonJS（import/export → require/module.exports）
 *   3. 字符串数组加密（全部字面量 → 运行时解码器调用；保留 require 参数）
 *   4. 死代码 / 虚假控制流注入
 *   5. 标识符重命名（十六进制 / Unicode，跳过保留名）
 *   6. 掐断 eval / new Function / console 泄露点
 *   7. 输出压缩 + 反混淆风险扫描
 *
 * 纯 JS 实现，无任何原生编译依赖，Win7 可运行。
 */
const parser_1 = require("@babel/parser");
const traverse_1 = __importDefault(require("@babel/traverse"));
const generator_1 = __importDefault(require("@babel/generator"));
const t = __importStar(require("@babel/types"));
const stringCipher_1 = require("./stringCipher");
const namegen_1 = require("./namegen");
const fs_1 = require("../utils/fs");
const traverse = traverse_1.default;
const generate = generator_1.default;
/** 绝不动的名字：CJS/Node 契约 + 全局 */
const KEEP_NAMES = new Set([
    'module', 'exports', 'require', '__dirname', '__filename', 'process', 'global',
    'globalThis', 'Buffer', 'arguments', 'console', 'undefined', 'NaN', 'Infinity',
    'window', 'document', 'self', 'setTimeout', 'setInterval', 'clearTimeout',
    'clearInterval', 'queueMicrotask', 'setImmediate', 'clearImmediate',
]);
function isTsFile(filename) {
    return /\.(ts|cts|mts|tsx)$/i.test(filename);
}
// ────────────────────────────────────────────────────────────
// 1. TS 类型剥离
// ────────────────────────────────────────────────────────────
function stripTypes(ast) {
    traverse(ast, {
        TSImportEqualsDeclaration(path) {
            const node = path.node;
            const ref = node.moduleReference;
            if (ref && ref.type === 'TSExternalModuleReference') {
                // import X = require('mod') → const X = require('mod')
                path.replaceWith(t.variableDeclaration('const', [
                    t.variableDeclarator(node.id, t.callExpression(t.identifier('require'), [ref.expression])),
                ]));
            }
            else {
                path.remove();
            }
        },
        TSInterfaceDeclaration(path) {
            path.remove();
        },
        TSTypeAliasDeclaration(path) {
            path.remove();
        },
        TSDeclareFunction(path) {
            path.remove();
        },
        TSModuleDeclaration(path) {
            path.remove();
        },
        TSTypeParameterDeclaration(path) {
            path.remove();
        },
        TSTypeParameterInstantiation(path) {
            path.remove();
        },
        TSTypeAnnotation(path) {
            path.remove();
        },
        TSTypeAssertion(path) {
            path.replaceWith(path.node.expression);
        },
        TSAsExpression(path) {
            path.replaceWith(path.node.expression);
        },
        TSNonNullExpression(path) {
            path.replaceWith(path.node.expression);
        },
        OptionalMemberExpression(path) {
            path.node.optional = false;
        },
        OptionalCallExpression(path) {
            path.node.optional = false;
        },
        TSEnumDeclaration(path) {
            // enum X { A, B = 3 } → const X = { A: 'A', B: 3 }
            const props = node0enumProps(path);
            path.replaceWith(t.variableDeclaration('const', [
                t.variableDeclarator(path.node.id, t.objectExpression(props)),
            ]));
        },
        VariableDeclaration(path) {
            if (path.node.declare)
                path.remove();
        },
        ClassDeclaration(path) {
            if (path.node.abstract)
                path.node.abstract = false;
        },
        ClassMethod(path) {
            path.node.accessibility = null;
            if (path.node.kind === 'constructor')
                path.node.accessibility = null;
        },
        ClassProperty(path) {
            path.node.accessibility = null;
            path.node.declare = false;
            if (path.node.readonly)
                path.node.readonly = false;
        },
        ObjectMethod(path) {
            // TS 参数修饰器不影响
        },
    });
}
function node0enumProps(path) {
    const props = [];
    let auto = 0;
    for (const member of path.node.members) {
        if (member.type !== 'TSEnumMember' || !member.id)
            continue;
        const key = member.id.type === 'Identifier' ? t.stringLiteral(member.id.name) : member.id;
        const value = member.init ? member.init : t.numericLiteral(auto++);
        props.push(t.objectProperty(key, value));
    }
    return props;
}
// ────────────────────────────────────────────────────────────
// 2. ESM → CJS
// ────────────────────────────────────────────────────────────
function requireCall(source) {
    return t.callExpression(t.identifier('require'), [t.stringLiteral(source)]);
}
function objectPatternFromSpecifiers(specifiers) {
    const props = specifiers
        .filter((s) => s.type === 'ImportSpecifier')
        .map((s) => t.objectProperty(s.imported, s.local, false, s.imported.type === 'Identifier' && s.imported.name !== s.local.name));
    return t.objectPattern(props);
}
function esmToCjs(ast) {
    const deferred = [];
    traverse(ast, {
        ImportDeclaration(path) {
            const node = path.node;
            const specifiers = node.specifiers;
            if (specifiers.length === 0) {
                path.replaceWith(t.expressionStatement(requireCall(node.source.value)));
                return;
            }
            const decls = [];
            // default / namespace
            for (const spec of specifiers) {
                if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
                    decls.push(t.variableDeclarator(spec.local, requireCall(node.source.value)));
                }
            }
            const named = specifiers.filter((s) => s.type === 'ImportSpecifier');
            if (named.length > 0) {
                decls.push(t.variableDeclarator(objectPatternFromSpecifiers(named), requireCall(node.source.value)));
            }
            path.replaceWith(t.variableDeclaration('const', decls));
        },
        ExportDefaultDeclaration(path) {
            const expr = path.node.declaration.type === 'FunctionDeclaration' ||
                path.node.declaration.type === 'ClassDeclaration'
                ? t.functionExpression(null, path.node.declaration.params, path.node.declaration.body)
                : path.node.declaration;
            path.replaceWith(t.expressionStatement(t.assignmentExpression('=', t.memberExpression(t.identifier('module'), t.identifier('exports')), expr)));
        },
        ExportNamedDeclaration(path) {
            const node = path.node;
            if (node.declaration) {
                // 先把声明本体拆出来
                path.replaceWith(node.declaration);
                // 收集导出的绑定名，生成 module.exports.x = x
                const ids = [];
                const decl = node.declaration;
                if (decl.type === 'VariableDeclaration') {
                    for (const d of decl.declarations)
                        if (d.id.type === 'Identifier')
                            ids.push(d.id.name);
                }
                else if (decl.id && decl.id.type === 'Identifier') {
                    ids.push(decl.id.name);
                }
                for (const name of ids) {
                    deferred.push(t.expressionStatement(t.assignmentExpression('=', t.memberExpression(t.identifier('module'), t.identifier('exports')), t.identifier(name))));
                }
            }
            else if (node.specifiers && node.specifiers.length > 0) {
                if (node.source) {
                    // export {a as b} from 'm'
                    const tmp = '_omniReexport' + (0, fs_1.randHex)(4);
                    deferred.push(t.variableDeclaration('const', [t.variableDeclarator(t.identifier(tmp), requireCall(node.source.value))]));
                    for (const spec of node.specifiers) {
                        deferred.push(t.expressionStatement(t.assignmentExpression('=', t.memberExpression(t.identifier('module'), t.identifier('exports')), t.memberExpression(t.identifier(tmp), spec.local, false))));
                    }
                    path.remove();
                }
                else {
                    for (const spec of node.specifiers) {
                        deferred.push(t.expressionStatement(t.assignmentExpression('=', t.memberExpression(t.identifier('module'), t.identifier('exports')), spec.local)));
                    }
                    path.remove();
                }
            }
            else {
                path.remove();
            }
        },
        ExportAllDeclaration(path) {
            path.replaceWith(t.expressionStatement(t.callExpression(t.memberExpression(t.identifier('Object'), t.identifier('assign')), [
                t.memberExpression(t.identifier('module'), t.identifier('exports')),
                requireCall(path.node.source.value),
            ])));
        },
    });
    if (deferred.length > 0) {
        // parse() 返回 File 节点，语句挂在 program.body
        ast.program.body.push(...deferred);
    }
}
// ────────────────────────────────────────────────────────────
// 3. 字符串数组加密
// ────────────────────────────────────────────────────────────
function skipStringEncryption(path, minLen) {
    var _a;
    const node = path.node;
    if (typeof node.value !== 'string' || node.value.length < minLen)
        return true;
    const parent = path.parent;
    if (!parent)
        return false;
    // require('...') 必须保留明文，否则打包器无法解析依赖图
    if (parent.type === 'CallExpression' && ((_a = parent.callee) === null || _a === void 0 ? void 0 : _a.type) === 'Identifier' && parent.callee.name === 'require') {
        return true;
    }
    // "use strict" 指令
    if (parent.type === 'Directive' || parent.type === 'DirectiveLiteral')
        return true;
    // import / export 源
    if (parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportAllDeclaration') {
        return parent.source === node;
    }
    // 对象属性键（非计算键）：{ default: mod } 替换成函数调用会产出非法语法
    if ((parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') &&
        parent.key === node &&
        !parent.computed) {
        return true;
    }
    // 类方法名等非计算键同理
    if (parent.type === 'ClassMethod' && parent.key === node && !parent.computed)
        return true;
    return false;
}
function encryptStrings(ast, vault, minLen) {
    let count = 0;
    traverse(ast, {
        StringLiteral(path) {
            if (skipStringEncryption(path, minLen))
                return;
            const idx = (0, stringCipher_1.vaultAdd)(vault, path.node.value);
            path.replaceWith(t.callExpression(t.identifier(vault.name), [t.numericLiteral(idx)]));
            count++;
        },
        TemplateLiteral(path) {
            var _a, _b;
            // 无插值的模板字符串整体加密
            if (path.node.expressions.length !== 0)
                return;
            const cooked = (_b = (_a = path.node.quasis[0]) === null || _a === void 0 ? void 0 : _a.value) === null || _b === void 0 ? void 0 : _b.cooked;
            if (typeof cooked !== 'string' || cooked.length < minLen)
                return;
            const idx = (0, stringCipher_1.vaultAdd)(vault, cooked);
            path.replaceWith(t.callExpression(t.identifier(vault.name), [t.numericLiteral(idx)]));
            count++;
        },
    });
    return count;
}
// ────────────────────────────────────────────────────────────
// 4. 死代码 / 虚假控制流
// ────────────────────────────────────────────────────────────
function rng(seed) {
    let s = seed || 1;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}
function injectDeadCode(ast, vault, intensity, seed) {
    let count = 0;
    const rand = rng(seed);
    const perFn = Math.max(1, Math.floor(intensity / 2));
    traverse(ast, {
        'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression'(path) {
            const body = path.node.body;
            if (!body || body.type !== 'BlockStatement')
                return;
            // 跳过箭头函数单表达式
            const junk = [];
            for (let i = 0; i < perFn; i++) {
                const kind = Math.floor(rand() * 3);
                if (vault.entries.length > 0) {
                    const strIdx = Math.floor(rand() * vault.entries.length);
                    if (kind === 0) {
                        // 虚假控制流：parseInt('非数字', 16) 恒为 NaN → 分支永不命中
                        junk.push(t.ifStatement(t.binaryExpression('>', t.callExpression(t.identifier('parseInt'), [
                            t.callExpression(t.identifier(vault.name), [t.numericLiteral(strIdx)]),
                            t.numericLiteral(16),
                        ]), t.numericLiteral(1e6)), t.blockStatement([
                            t.expressionStatement(t.callExpression(t.identifier(vault.name), [t.numericLiteral(strIdx)])),
                        ])));
                    }
                    else if (kind === 1) {
                        junk.push(t.variableDeclaration('var', [
                            t.variableDeclarator(t.identifier('_0x' + (0, fs_1.randHex)(3)), t.callExpression(t.identifier(vault.name), [t.numericLiteral(strIdx)])),
                        ]));
                    }
                    else {
                        junk.push(t.expressionStatement(t.logicalExpression('&&', t.numericLiteral(0), t.callExpression(t.identifier(vault.name), [t.numericLiteral(strIdx)]))));
                    }
                }
                else {
                    junk.push(t.expressionStatement(t.logicalExpression('&&', t.numericLiteral(0), t.stringLiteral('_' + (0, fs_1.randHex)(6)))));
                }
                count++;
            }
            if (junk.length > 0) {
                path.get('body').unshiftContainer('body', junk);
            }
        },
    });
    return count;
}
// ────────────────────────────────────────────────────────────
// 5. 标识符重命名
// ────────────────────────────────────────────────────────────
function renameIdentifiers(ast, unicode, avoid) {
    let count = 0;
    const allocator = new namegen_1.NameAllocator(avoid, unicode ? 'unicode' : 'hex');
    traverse(ast, {
        Scope(path) {
            var _a, _b;
            const scope = path.scope;
            if (!scope || !scope.bindings)
                return;
            for (const name of Object.keys(scope.bindings)) {
                if (KEEP_NAMES.has(name))
                    continue;
                if (/^_0x/.test(name))
                    continue;
                if (((_a = scope.getBinding(name)) === null || _a === void 0 ? void 0 : _a.kind) === 'param' && ((_b = path.isProgram) === null || _b === void 0 ? void 0 : _b.call(path)))
                    continue;
                // 只重命名「文件内声明」的绑定；CJS 顶层声明也是文件局部作用域，安全
                const binding = scope.bindings[name];
                if (!binding || binding.kind === 'module' || binding.kind === 'let' && false)
                    continue;
                try {
                    const newName = allocator.next();
                    scope.rename(name, newName);
                    count++;
                }
                catch {
                    // 跳过失败项（如 arguments）
                }
            }
        },
    });
    return count;
}
// ────────────────────────────────────────────────────────────
// 6. 掐断 eval / new Function / console
// ────────────────────────────────────────────────────────────
function killLeakPoints(ast, avoid) {
    let count = 0;
    const allocator = new namegen_1.NameAllocator(avoid, 'hex');
    const noopName = allocator.next();
    const guardName = allocator.next();
    const fnGuardName = allocator.next();
    traverse(ast, {
        CallExpression(path) {
            var _a;
            const callee = path.node.callee;
            // console.*(...) → NOOP(...)
            if (callee.type === 'MemberExpression' &&
                ((_a = callee.object) === null || _a === void 0 ? void 0 : _a.type) === 'Identifier' &&
                callee.object.name === 'console') {
                path.get('callee').replaceWith(t.identifier(noopName));
                count++;
                return;
            }
            // eval(...) → GUARD(...)（运行时抛错，直接掐断 RCE 反混淆通道）
            if (callee.type === 'Identifier' && callee.name === 'eval') {
                path.get('callee').replaceWith(t.identifier(guardName));
                count++;
            }
        },
        NewExpression(path) {
            const callee = path.node.callee;
            if (callee.type === 'Identifier' && (callee.name === 'Function' || callee.name === 'AsyncFunction')) {
                path.get('callee').replaceWith(t.identifier(fnGuardName));
                count++;
            }
        },
        MemberExpression(path) {
            var _a, _b, _c;
            // 剩余的 console 引用（如 const c = console）也改名
            if (((_a = path.node.object) === null || _a === void 0 ? void 0 : _a.type) === 'Identifier' && path.node.object.name === 'console' && !((_c = (_b = path.parentPath).isMemberExpression) === null || _c === void 0 ? void 0 : _c.call(_b))) {
                // 保守：仅整成员表达式的根替换上下文太复杂，跳过
            }
        },
    });
    const decls = [
        `var ${noopName}=function(){};`,
        `var ${guardName}=function(){throw new Error('Omni-Forger: eval is locked');};`,
        `var ${fnGuardName}=function(){return function(){}};`,
    ];
    return { count, decls };
}
// ────────────────────────────────────────────────────────────
// 7. 反混淆风险扫描
// ────────────────────────────────────────────────────────────
const RISK_PATTERNS = [
    ['eval 调用残存', /\beval\s*\(/],
    ['new Function 残存', /new\s+Function\s*\(/],
    ['console 残存', /console\s*\.\s*(log|warn|error|info|debug|trace)\s*\(/],
    ['可读业务词', /\b(account|transaction|ledger|password|secret|user|login|invoice)\b/i],
];
function scanDeobfuscationRisks(code) {
    const risks = [];
    for (const [label, pattern] of RISK_PATTERNS) {
        if (pattern.test(code))
            risks.push(label);
    }
    return risks;
}
// ────────────────────────────────────────────────────────────
// 主入口
// ────────────────────────────────────────────────────────────
function transformSource(code, filename, options) {
    var _a, _b, _c, _d, _e, _f, _g;
    const stats = {
        stringsEncrypted: 0,
        identifiersRenamed: 0,
        deadCodeInjected: 0,
        evalConsoleKilled: 0,
        engine: 'babel',
    };
    const notes = [];
    const intensity = Math.max(1, Math.min(5, options.intensity));
    const opts = {
        stringArray: (_a = options.stringArray) !== null && _a !== void 0 ? _a : intensity >= 1,
        deadCode: (_b = options.deadCode) !== null && _b !== void 0 ? _b : intensity >= 3,
        rename: (_c = options.rename) !== null && _c !== void 0 ? _c : intensity >= 3,
        unicodeNames: (_d = options.unicodeNames) !== null && _d !== void 0 ? _d : intensity >= 4,
        killEvalConsole: (_e = options.killEvalConsole) !== null && _e !== void 0 ? _e : intensity >= 2,
        minify: (_f = options.minify) !== null && _f !== void 0 ? _f : intensity >= 3,
        minStringLength: ((_g = options.minStringLength) !== null && _g !== void 0 ? _g : intensity >= 5) ? 1 : 2,
    };
    const ast = (0, parser_1.parse)(code, {
        sourceType: 'unambiguous',
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowUndeclaredExports: true,
        errorRecovery: true,
        plugins: [['typescript', {}], 'jsx', 'dynamicImport'],
    });
    if (isTsFile(filename)) {
        try {
            stripTypes(ast);
        }
        catch (e) {
            notes.push(`TS 类型剥离警告: ${e.message}`);
        }
    }
    try {
        esmToCjs(ast);
    }
    catch (e) {
        notes.push(`ESM 转换警告: ${e.message}`);
    }
    // 预收集现有标识符，避免重命名撞车
    const generated = generate(ast, { comments: false }).code;
    const avoid = (0, namegen_1.collectIdentifiers)(generated);
    const vault = (0, stringCipher_1.createVault)();
    if (opts.stringArray) {
        stats.stringsEncrypted = encryptStrings(ast, vault, opts.minStringLength);
    }
    let decls = [];
    if (opts.killEvalConsole) {
        const kill = killLeakPoints(ast, avoid);
        decls = kill.decls;
        stats.evalConsoleKilled = kill.count;
    }
    if (opts.deadCode && stats.stringsEncrypted > 0) {
        stats.deadCodeInjected = injectDeadCode(ast, (0, stringCipher_1.vaultFinalize)(vault), intensity, generated.length + intensity * 7);
    }
    else if (stats.stringsEncrypted > 0) {
        (0, stringCipher_1.vaultFinalize)(vault);
    }
    if (opts.rename) {
        stats.identifiersRenamed = renameIdentifiers(ast, opts.unicodeNames, avoid);
    }
    const output = generate(ast, {
        comments: false,
        minified: opts.minify,
        compact: opts.minify,
        jsescOption: { minimal: true },
        retainLines: false,
    }).code;
    // 组装：bootstrap（字符串解码器）+ 泄露点守卫 + 主代码
    let final = output;
    if (vault.bootstrap) {
        final = vault.bootstrap + '\n' + final;
    }
    if (decls.length > 0) {
        final = decls.join('\n') + '\n' + final;
    }
    // high entropy: 顶部包一层 IIFE 隔离
    if (intensity >= 5) {
        final = `(function(){\n${final}\n})();`;
    }
    const risks = scanDeobfuscationRisks(final);
    for (const r of risks)
        notes.push(`⚠ 反混淆风险点: ${r}`);
    return { code: final, stats, notes };
}
