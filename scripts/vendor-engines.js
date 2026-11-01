#!/usr/bin/env node
/**
 * scripts/vendor-engines.js — 把上游引擎/内核重新 vendor 进仓库 / re-vendor upstream engines.
 * 用法 / usage: npm run vendor [-- --refresh]
 *
 * 默认（无参数）只做校验：报告 vendor 目录与上游差异。加 --refresh 才真正拷贝。
 * By default this only verifies; pass --refresh to actually copy.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CODE_ROOT = path.dirname(ROOT);

const TARGETS = [
  {
    name: 'micro-desk',
    src: path.join(CODE_ROOT, 'micro-desk'),
    dst: path.join(ROOT, 'lab-server', 'vendor', 'micro-desk'),
    pick: ['lib', 'package.json', 'LICENSE'],
  },
  {
    name: 'microdesk.sdk.js',
    src: path.join(CODE_ROOT, 'micro-desk', 'web', 'sdk', 'microdesk.js'),
    dst: path.join(ROOT, 'lab-ui', 'vendor', 'microdesk.sdk.js'),
    pick: null,
  },
  {
    name: 'dsh-omni-forger',
    src: path.join(CODE_ROOT, 'dsh-omni-forger'),
    dst: path.join(ROOT, 'vendor', 'dsh-omni-forger'),
    pick: ['dist', 'package.json', 'LICENSE'],
  },
  {
    name: 'dsh-omni-reverser',
    src: path.join(CODE_ROOT, 'dsh-omni-reverser'),
    dst: path.join(ROOT, 'vendor', 'dsh-omni-reverser'),
    pick: ['dist/rev_code/js_deobfuscate.js', 'package.json'],
  },
];

function copyRecursive(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) copyRecursive(path.join(src, entry), path.join(dst, entry));
  } else {
    fs.copyFileSync(src, dst);
  }
}

function clearDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
    else fs.unlinkSync(p);
  }
}

function main() {
  const refresh = process.argv.slice(2).includes('--refresh');
  console.log(refresh ? '\n  vendoring (refresh)...' : '\n  verifying vendored engines (dry-run, pass --refresh to copy)');
  let missing = 0;
  for (const t of TARGETS) {
    if (!fs.existsSync(t.src)) {
      console.log('  [MISS] ' + pad(t.name) + ' 上游不存在 / upstream missing: ' + t.src);
      missing++;
      continue;
    }
    if (refresh) {
      if (t.pick) {
        clearDir(t.dst);
        fs.mkdirSync(t.dst, { recursive: true });
        for (const rel of t.pick) copyRecursive(path.join(t.src, rel), path.join(t.dst, rel));
      } else {
        fs.mkdirSync(path.dirname(t.dst), { recursive: true });
        fs.copyFileSync(t.src, t.dst);
      }
      console.log('  [COPY] ' + pad(t.name) + ' → ' + path.relative(ROOT, t.dst));
    } else {
      const exists = t.pick
        ? t.pick.every((rel) => fs.existsSync(path.join(t.dst, rel)))
        : fs.existsSync(t.dst);
      console.log('  [' + (exists ? ' OK ' : 'MISS') + '] ' + pad(t.name) + ' ' + (exists ? path.relative(ROOT, t.dst) : '不完整 / incomplete'));
      if (!exists) missing++;
    }
  }
  console.log(refresh ? '\n  ✓ vendor 完成 / done\n' : (missing === 0
    ? '\n  ✓ vendor 完整 / vendored sets complete\n'
    : '\n  ✗ ' + missing + ' 项不完整 / incomplete — npm run vendor -- --refresh\n'));
  process.exit(missing === 0 ? 0 : 1);
}

function pad(s) { return s + ' '.repeat(Math.max(0, 20 - s.length)); }

main();
