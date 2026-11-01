#!/usr/bin/env node
/**
 * scripts/doctor.js — 环境自检 / environment self-check
 * 用法 / usage: npm run doctor
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const checks = [];
const ok = (name, detail) => checks.push({ name, detail, pass: true });
const no = (name, detail) => checks.push({ name, detail, pass: false });

function nodeVersion() {
  const raw = process.version; // vXX.Y.Z
  const major = parseInt(raw.slice(1).split('.')[0], 10);
  ok('node', raw + (major >= 18 ? ' (>= 18 ✓)' : ' (< 18 ✗ — engines 要求 >= 18)'));
  return major >= 18;
}

function babelDeps() {
  const dirs = ['parser', 'traverse', 'generator', 'types'];
  const missing = dirs.filter((d) => {
    try { require.resolve(path.join(ROOT, 'node_modules', '@babel', d)); return false; }
    catch (_) { return true; }
  });
  if (missing.length === 0) ok('@babel/*', 'parser/traverse/generator/types 均已安装');
  else no('@babel/*', '缺失 / missing: ' + missing.join(', ') + ' — 运行 / run: npm install');
  return missing.length === 0;
}

function engines() {
  const env = require(path.join(ROOT, 'lab-engine', 'env'));
  let red = false, blue = false;
  try { const m = env.loadRed(); red = !!(m && m.transformCode); } catch (e) { no('red engine', e.message); }
  try { env.loadBlue(); blue = true; } catch (e) { no('blue engine', e.message); }
  const rel = (info) => path.relative(ROOT, info.dir).replace(/\\/g, '/');
  if (red) ok('red engine', env.redLabel(env.babelAvailable() ? 'babel' : 'lite') + ' @ ' + rel(env.redInfo));
  if (blue) ok('blue engine', 'omni-reverser static deobfuscator @ ' + rel(env.blueInfo));
  return red && blue;
}

function uiFiles() {
  const need = ['lab-ui/index.html', 'lab-ui/styles.css', 'lab-ui/app.js',
    'lab-ui/vendor/microdesk.sdk.js', 'lab-ui/vendor/codemirror/codemirror.js'];
  const missing = need.filter((p) => !fs.existsSync(path.join(ROOT, p)));
  if (missing.length === 0) ok('lab-ui assets', 'index/styles/app + 全部 vendor 就绪');
  else no('lab-ui assets', '缺失 / missing: ' + missing.join(', '));
  return missing.length === 0;
}

function portInfo() {
  // 信息项（不决定退出码）：端口被占用往往只是本沙盒已在运行。
  // Informational only — a busy port usually just means the lab is already running.
  const port = Number(process.env.OMNI_LAB_PORT || 7799);
  try {
    execSync(`netstat -ano -p tcp | findstr ":${port} "`, { stdio: 'ignore', shell: 'cmd.exe' });
    ok('port ' + port, '已占用 / in use（沙盒可能在运行中）— 换端口可用 / alternative: npm start -- --port=7800');
  } catch (_) {
    ok('port ' + port, '空闲 / free');
  }
}

(function main() {
  const results = [nodeVersion(), babelDeps(), engines(), uiFiles()];
  portInfo();
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
  console.log('\n  Omni-Attack-Lab · doctor\n  ' + '='.repeat(44));
  checks.forEach((c) => console.log('  [' + (c.pass ? 'OK ' : 'FAIL') + '] ' + pad(c.name, 14) + c.detail));
  const allPass = results.every(Boolean);
  console.log('  ' + '='.repeat(44));
  console.log(allPass ? '\n  ✓ 环境就绪 / environment ready — 运行 / run: npm start\n'
    : '\n  ✗ 存在缺失项 / some checks failed（仍可进入 DEMO 模式浏览）\n');
  process.exit(allPass ? 0 : 1);
})();
