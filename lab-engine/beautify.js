'use strict';
/**
 * lab-engine/beautify.js — BLUE TEAM tooling that does not need an AI:
 *   1. prune dead top-level function declarations injected by the forger,
 *   2. pretty-print the survivors with the Babel generator.
 *
 * Both steps are static. Nothing here evaluates the target program.
 */

const parser = require('@babel/parser');
const generate = require('@babel/generator').default;

function parse(code) {
  return parser.parse(code, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowSuperOutsideMethod: true,
    errorRecovery: true,
    attachComment: true,
  });
}

function isFunctionInit(init) {
  return !!init && (init.type === 'FunctionExpression' || init.type === 'ArrowFunctionExpression');
}

/**
 * Remove top-level function-valued bindings that are never referenced.
 * Returns { code, pruned }.
 */
function pruneDead(code) {
  let ast;
  try {
    ast = parse(code);
  } catch (_) {
    return { code, pruned: 0 };
  }
  const body = ast.program && ast.program.body;
  if (!Array.isArray(body)) return { code, pruned: 0 };

  const removals = [];
  for (let i = 0; i < body.length; i++) {
    const node = body[i];
    let name = null;
    let start = node.start;
    let end = node.end;
    if (node.type === 'VariableDeclaration' && node.declarations.length === 1) {
      const d = node.declarations[0];
      if (d && d.id && d.id.type === 'Identifier' && isFunctionInit(d.init)) name = d.id.name;
    } else if (node.type === 'FunctionDeclaration' && node.id && node.id.type === 'Identifier') {
      name = node.id.name;
    }
    if (!name || typeof start !== 'number' || typeof end !== 'number') continue;

    const outside = code.slice(0, start) + code.slice(end);
    const uses = outside.match(new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b', 'g'));
    if (!uses || uses.length === 0) removals.push({ start, end });
  }

  if (!removals.length) return { code, pruned: 0 };
  removals.sort((a, b) => b.start - a.start);
  let out = code;
  for (const r of removals) {
    out = out.slice(0, r.start) + out.slice(r.end);
  }
  return { code: out, pruned: removals.length };
}

/** Pretty-print via Babel's generator. Falls back to the input on parse errors. */
function beautify(code) {
  let ast;
  try {
    ast = parse(code);
  } catch (e) {
    return { code, ok: false, error: e.message };
  }
  try {
    const out = generate(
      ast,
      {
        compact: false,
        concise: false,
        comments: true,
        retainLines: false,
        jsescOption: { minimal: true },
      },
      code
    );
    return { code: out.code, ok: true, error: null };
  } catch (e) {
    return { code, ok: false, error: e.message };
  }
}

module.exports = { pruneDead, beautify, parse };
