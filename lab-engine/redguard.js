'use strict';
/**
 * lab-engine/redguard.js — RED TEAM output sanitizer.
 *
 * Why this exists: dsh-omni-forger prepends injected stubs
 * (`var _0x00022=function(){}`, `var _0x00033=function(){throw…}`,
 * `var _0x00044=function(){return function(){}}`) and *then* renames user
 * identifiers from the same hex pool, so at intensity 3 the two pools collide
 * and the ciphertext ends up with duplicate top-level bindings:
 *
 *   var _0x00022 = function () {};              // injected console-sink stub
 *   function _0x00022(_0x00044, _0x00055) {}    // renamed user function
 *   const _0x00033 = _0x00022([...]);           // collides with eval-lock stub
 *
 * That is a real semantic bug (var-assignment overwrites the hoisted function,
 * and `var`+`const` duplicates are a hard SyntaxError). redguard detects the
 * duplicates on the AST and repairs them without touching the obfuscation:
 *
 *   1. duplicate site with NO references anywhere  → rename its declarator.
 *   2. injected stub first + references            → rename the stub and move
 *      only the *discarded statement-level calls* to it (those are exactly the
 *      `console.*` replacements); every other reference keeps the original
 *      name and now resolves to the surviving user binding.
 *
 * It never regenerates the file unless a repair was actually needed, and it
 * validates the result with a strict re-parse (falling back to the original
 * ciphertext on failure).
 */

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;

function parseLoose(code) {
  return parser.parse(code, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowSuperOutsideMethod: true,
    errorRecovery: true,
    attachComment: false,
  });
}

function parseStrict(code) {
  try {
    parser.parse(code, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    });
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Omni-Forger injected stub: `var X = function () {…trivial…}` with 0 params. */
function looksLikeStub(decl) {
  const init = decl && decl.init;
  if (!init) return false;
  if (init.type !== 'FunctionExpression' && init.type !== 'ArrowFunctionExpression') return false;
  if (init.params && init.params.length) return false;
  const body = init.body;
  if (!body) return false;
  if (body.type !== 'BlockStatement') return false; // () => expr arrow: not a stub
  const stmts = body.body || [];
  if (!stmts.length) return true; // the console sink: function () {}
  if (stmts.length === 1) {
    const s = stmts[0];
    return s.type === 'ReturnStatement' || s.type === 'ThrowStatement';
  }
  return false;
}

function isEmptySinkStub(decl) {
  const init = decl && decl.init;
  if (!init || init.type !== 'FunctionExpression') return false;
  if (init.params && init.params.length) return false;
  return init.body && init.body.type === 'BlockStatement' && !(init.body.body || []).length;
}

function collectSites(ast) {
  const sites = [];
  (ast.program.body || []).forEach((stmt) => {
    if (stmt.type === 'VariableDeclaration') {
      stmt.declarations.forEach((d) => {
        if (d && d.id && d.id.type === 'Identifier') {
          sites.push({ name: d.id.name, kind: stmt.kind, stmt, decl: d, stub: looksLikeStub(d) });
        }
      });
    } else if (stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') {
      if (stmt.id && stmt.id.type === 'Identifier') {
        sites.push({ name: stmt.id.name, kind: 'function', stmt, decl: null, stub: false });
      }
    }
  });
  return sites;
}

function duplicateGroups(ast) {
  const byName = new Map();
  collectSites(ast).forEach((s) => {
    if (!byName.has(s.name)) byName.set(s.name, []);
    byName.get(s.name).push(s);
  });
  const groups = [];
  byName.forEach((sites, name) => {
    if (sites.length > 1) groups.push({ name, sites });
  });
  return groups;
}

/** A reference whose call result is thrown away: `_0x00022("…");` — the exact
 *  shape Omni-Forger emits when it replaces `console.log(…)`. The call may sit
 *  in a block, be an `if` consequent without braces, or hide in a comma
 *  sequence, so we test the *statement that contains the call*, not the call
 *  node itself. */
function isDiscardedCallCallee(path) {
  const parent = path.parent;
  if (!parent || parent.type !== 'CallExpression' || parent.callee !== path.node) return false;
  let p = path.parentPath.parentPath;
  while (p && p.type === 'SequenceExpression') p = p.parentPath;
  return !!(p && p.type === 'ExpressionStatement');
}

function analyzeRefs(ast) {
  let programScope = null;
  const refMap = new Map();
  const used = new Set();
  traverse(ast, {
    Program: function (path) {
      programScope = path.scope;
    },
    Identifier: function (path) {
      const n = path.node.name;
      used.add(n);
      if (!path.isReferencedIdentifier()) return;
      const binding = path.scope.getBinding(n);
      if (binding && binding.scope !== programScope) return; // shadowed by an inner scope
      if (!refMap.has(n)) refMap.set(n, []);
      refMap.get(n).push({
        path,
        inFunction: !!path.scope.getFunctionParent(),
        discarded: isDiscardedCallCallee(path),
      });
    },
  });
  return { programScope, refMap, used };
}

function maxHexBase(used) {
  let max = 0x00021;
  used.forEach((n) => {
    const m = /^_0x([0-9a-f]+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 16));
  });
  return max;
}

function renameDeclaration(site, fresh) {
  if (site.decl) site.decl.id.name = fresh;
  else if (site.stmt && site.stmt.id) site.stmt.id.name = fresh;
}

function regenerate(ast, original) {
  const minified = (original.match(/\n/g) || []).length < 3;
  const out = generate(ast, {
    compact: minified,
    minified: minified,
    comments: false,
    concise: minified,
    jsescOption: { minimal: true },
  });
  return out.code + (minified && out.code.charCodeAt(out.code.length - 1) !== 10 ? '\n' : '');
}

/**
 * Repair one duplicate group; returns { changed, notes }.
 * Mutates `ast` in place.
 */
function repairGroup(ast, group, used, counter) {
  const fresh = () => {
    let name;
    do {
      name = '_0x' + counter.value.toString(16);
      counter.value++;
    } while (used.has(name));
    used.add(name);
    return name;
  };

  const refs = analyzeRefs(ast).refMap.get(group.name) || [];
  const sites = group.sites;
  const notes = [];

  if (!refs.length) {
    // Every duplicate is unreferenced → safe to rename all but the first.
    let count = 0;
    for (let i = 1; i < sites.length; i++) {
      renameDeclaration(sites[i], fresh());
      count++;
    }
    notes.push('renamed ' + count + ' unreferenced duplicate declaration(s) of ' + group.name);
    return { changed: count > 0, notes };
  }

  const first = sites[0];
  if (first.stub) {
    const newName = fresh();
    renameDeclaration(first, newName);
    let moved = 0;
    if (isEmptySinkStub(first.decl)) {
      // Only the discarded statement-level calls are the console replacements;
      // every other reference must keep resolving to the user binding.
      refs.forEach((r) => {
        if (r.discarded) {
          r.path.node.name = newName;
          moved++;
        }
      });
    }
    notes.push(
      'relocated injected stub ' + group.name + ' → ' + newName +
        (moved ? '，重路由 ' + moved + ' 处 console 替换调用' : '')
    );
    return { changed: true, notes };
  }

  return { changed: false, notes: ['duplicate binding ' + group.name + ' has no injectable stub site; left as-is'] };
}

/**
 * @param {string} code the forger output
 * @returns {{repaired:boolean, code:string, duplicates:string[], notes:string[]}}
 */
function repair(code) {
  const notes = [];
  const allDupNames = [];
  let working = code;
  let repairedAny = false;

  for (let iteration = 0; iteration < 6; iteration++) {
    let ast;
    try {
      ast = parseLoose(working);
    } catch (e) {
      notes.push('parse failed, cannot sanitize: ' + e.message);
      return { repaired: repairedAny, code: working, duplicates: allDupNames, notes };
    }

    const groups = duplicateGroups(ast);
    if (!groups.length) break;
    if (iteration === 0) groups.forEach((g) => allDupNames.push(g.name));

    const scan = analyzeRefs(ast);
    const counter = { value: maxHexBase(scan.used) + 1 };
    const r = repairGroup(ast, groups[0], scan.used, counter);
    notes.push.apply(notes, r.notes);
    if (!r.changed) break;

    repairedAny = true;
    working = regenerate(ast, working);
  }

  if (!repairedAny) {
    return { repaired: false, code, duplicates: allDupNames, notes };
  }

  // Choose the better of the two outputs — never ship something worse.
  const finalOk = parseStrict(working).ok;
  const origOk = parseStrict(code).ok;
  if (finalOk && origOk) {
    return { repaired: true, code: working, duplicates: allDupNames, notes };
  }
  if (finalOk && !origOk) {
    notes.push('修复后密文恢复为合法 JavaScript');
    return { repaired: true, code: working, duplicates: allDupNames, notes };
  }
  if (!finalOk && origOk) {
    notes.push('修复产物校验失败，保留原始密文');
    return { repaired: false, code, duplicates: allDupNames, notes };
  }
  // Both invalid: keep the partially repaired version (fewer collisions).
  notes.push('best-effort：仍有残留重复绑定 ' + detect(working).duplicates.join(', '));
  return { repaired: true, code: working, duplicates: allDupNames, notes };
}

/** Detect only (no mutation). Used by the collision quantifier. */
function detect(code) {
  let ast;
  try {
    ast = parseLoose(code);
  } catch (e) {
    return { parseOk: false, duplicates: [] };
  }
  return { parseOk: true, duplicates: duplicateGroups(ast).map((g) => g.name) };
}

module.exports = { repair, detect, duplicateGroups, isEmptySinkStub };
