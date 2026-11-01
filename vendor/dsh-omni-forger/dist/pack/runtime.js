"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUNTIME_TEMPLATE = void 0;
/**
 * Omni-Forger · forge_pack 单文件运行时（VFS）模板
 *
 * 纯 ES5 风格手写，不使用模板字面量，避免与 TS 模板字符串转义冲突。
 * 运行时职责：
 *   1. AES-256-GCM + zlib 解出 manifest（模块源码 + 文本资产）
 *   2. 挂载内存 VFS，require 全部走 VFS
 *   3. require('fs') 返回代理：VFS 优先、磁盘兜底
 *   4. Node 内建与外部原生模块（如 better-sqlite3）降级到真实 require
 *
 * 占位符（Webpack 风格，由 bundler 填充）：
 *   %%MAIN%%    入口模块 vpath
 *   %%NAME%%    bundle 名
 *   %%BLOB%%    base64(gzip(aes(json)))
 *   %%KEY%% %%IV%% %%TAG%%  base64 密钥材料
 */
exports.RUNTIME_TEMPLATE = `#!/usr/bin/env node
(function () {
  'use strict';
  var __MAIN = '%%MAIN%%';
  var __BLOB = '%%BLOB%%';
  var __KEY = '%%KEY%%';
  var __IV = '%%IV%%';
  var __TAG = '%%TAG%%';

  var __nodeRequire = (function () { return require; })();
  var __crypto = __nodeRequire('crypto');
  var __zlib = __nodeRequire('zlib');
  var __path = __nodeRequire('path');

  var __decipher = __crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(__KEY, 'base64'),
    Buffer.from(__IV, 'base64')
  );
  __decipher.setAuthTag(Buffer.from(__TAG, 'base64'));
  var __raw;
  try {
    __raw = Buffer.concat([
      __decipher.update(Buffer.from(__BLOB, 'base64')),
      __decipher.final()
    ]);
  } catch (e) {
    throw new Error('Omni-Forger: bundle integrity check failed (tampered?)');
  }

  var __manifest = JSON.parse(__zlib.gunzipSync(__raw).toString('utf8'));
  var __CODE = __manifest.code || {};
  var __ASSETS = __manifest.assets || {};
  var __ID = __manifest.ids || {}; // 不透明模块 id → vpath
  var __REAL_FS = __nodeRequire('fs');

  function __hasCode(p) { return Object.prototype.hasOwnProperty.call(__CODE, p); }
  function __hasAsset(p) { return Object.prototype.hasOwnProperty.call(__ASSETS, p); }

  // ---------- VFS 路径归一化 ----------
  function __vnorm(p) {
    var parts = String(p).replace(/\\\\/g, '/').split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
        else out.push('..');
        continue;
      }
      out.push(seg);
    }
    return out.join('/');
  }

  function __tryCandidates(base) {
    var cands = [base, base + '.js', base + '.cjs', base + '.json', base + '/index.js', base + '/index.cjs'];
    for (var i = 0; i < cands.length; i++) {
      if (__hasCode(cands[i])) return cands[i];
    }
    return null;
  }

  function __tryPackage(base) {
    var found = __tryCandidates(base);
    if (found) return found;
    var pkgPath = base + '/package.json';
    if (__hasAsset(pkgPath)) {
      var pkg = null;
      try { pkg = JSON.parse(__ASSETS[pkgPath]); } catch (e) { pkg = null; }
      if (pkg) {
        var main = pkg.main || pkg.module || 'index.js';
        var c = __vnorm(base + '/' + main);
        if (__hasCode(c)) return c;
        var c2 = __tryCandidates(c);
        if (c2) return c2;
        var d = __vnorm(base + '/' + (pkg.browser && typeof pkg.browser === 'string' ? pkg.browser : 'index.js'));
        if (__hasCode(d)) return d;
      }
    }
    return null;
  }

  function __resolve(request, fromDir) {
    // 直接命中（vpath 或资产键）
    var direct = __vnorm(request);
    if (__hasCode(direct)) return direct;
    if (__hasAsset(direct)) return direct;
    // 打包期分配的不透明 id
    var mapped = Object.prototype.hasOwnProperty.call(__ID, request) ? __ID[request] : null;
    if (mapped) return mapped;
    if (request.charAt(0) === '.' ) {
      var rel = __vnorm(fromDir + '/' + request);
      var hit = __tryCandidates(rel);
      if (hit) return hit;
      if (__hasAsset(rel)) return rel;
      return null;
    }
    if (request.charAt(0) === '/') {
      var abs = __vnorm(request);
      var hit2 = __tryCandidates(abs);
      if (hit2) return hit2;
      if (__hasAsset(abs)) return abs;
      return null;
    }
    if (/^[A-Za-z]:[\\/]/.test(request)) {
      var win = __vnorm(request);
      var hit3 = __tryCandidates(win);
      if (hit3) return hit3;
      if (__hasAsset(win)) return win;
      return null;
    }
    // 裸模块：沿 fromDir 向上找 node_modules
    var dir = fromDir;
    for (var hop = 0; hop < 32; hop++) {
      var nm = __vnorm(dir + '/node_modules/' + request);
      var found = request.charAt(0) === '@'
        ? __tryCandidates(nm) || __tryPackage(nm)
        : __tryPackage(nm);
      if (found) return found;
      if (dir === '' || dir === '.') break;
      var up = __vnorm(dir + '/..');
      if (up === dir) break;
      dir = up;
    }
    return null;
  }

  // ---------- fs 代理：VFS 优先 ----------
  function __vfsReadFileSync(p) {
    var key = __vnorm(p);
    if (__hasAsset(key)) return __ASSETS[key];
    if (__hasCode(key)) return __CODE[key];
    return __REAL_FS.readFileSync.apply(__REAL_FS, arguments);
  }
  function __vfsExistsSync(p) {
    var key = __vnorm(p);
    if (__hasAsset(key) || __hasCode(key)) return true;
    return __REAL_FS.existsSync(p);
  }
  function __vfsReadFile(p, a, b) {
    var key = __vnorm(p);
    var cb = typeof a === 'function' ? a : b;
    if (cb && (__hasAsset(key) || __hasCode(key))) {
      var content = __hasAsset(key) ? __ASSETS[key] : __CODE[key];
      setImmediate(function () { cb(null, content); });
      return;
    }
    return __REAL_FS.readFile.apply(__REAL_FS, arguments);
  }
  function __vfsStatSync(p) {
    var key = __vnorm(p);
    if (__hasAsset(key) || __hasCode(key)) {
      return {
        isFile: function () { return true; },
        isDirectory: function () { return false; },
        isSymbolicLink: function () { return false; },
        size: (__hasAsset(key) ? __ASSETS[key] : __CODE[key]).length,
        mtime: new Date(0),
        ctime: new Date(0)
      };
    }
    return __REAL_FS.statSync(p);
  }
  function __vfsRealpathSync(p) {
    var key = __vnorm(p);
    if (__hasAsset(key) || __hasCode(key)) return '/' + key;
    return __REAL_FS.realpathSync(p);
  }

  var __FS_PROXY = new Proxy(__REAL_FS, {
    get: function (target, prop) {
      if (prop === 'readFileSync') return __vfsReadFileSync;
      if (prop === 'existsSync') return __vfsExistsSync;
      if (prop === 'readFile') return __vfsReadFile;
      if (prop === 'statSync') return __vfsStatSync;
      if (prop === 'realpathSync') return __vfsRealpathSync;
      var v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    }
  });

  // ---------- 模块注册表 ----------
  var __BUILTINS = {};
  var __builtinList = [
    'assert','async_hooks','buffer','child_process','cluster','console','constants','crypto',
    'dgram','diagnostics_channel','dns','domain','events','fs','http','http2','https','inspector',
    'module','net','os','path','perf_hooks','process','punycode','querystring','readline','repl',
    'stream','string_decoder','sys','timers','tls','trace_events','tty','url','util','v8','vm',
    'wasi','worker_threads','zlib'
  ];
  for (var __bi = 0; __bi < __builtinList.length; __bi++) __BUILTINS[__builtinList[__bi]] = true;

  var __cache = {};

  function __makeRequire(fromDir) {
    var req = function (request) {
      if (__BUILTINS[request]) {
        if (request === 'fs') return __FS_PROXY;
        return __nodeRequire(request);
      }
      var key = __resolve(request, fromDir);
      if (!key) {
        // 解析失败 → 降级真实 require（支持被标记为外部的原生模块）
        // 先用 bundle 自身路径解析，再用「运行进程 cwd 所在 node_modules」兜底
        try {
          return __nodeRequire(request);
        } catch (e) {
          try {
            var Module = __nodeRequire('module');
            var filename = Module._resolveFilename(request, { paths: Module._nodeModulePaths(process.cwd()) });
            return __nodeRequire(filename);
          } catch (e2) {
            throw new Error("Omni-Forger VFS: cannot resolve '" + request + "' from '" + fromDir + "'");
          }
        }
      }
      return __loadModule(key);
    };
    req.resolve = function (request) {
      var key = __resolve(request, fromDir);
      if (key) return '/' + key;
      return __nodeRequire.resolve(request);
    };
    req.cache = __cache;
    req.extensions = {};
    return req;
  }

  function __loadModule(key) {
    if (Object.prototype.hasOwnProperty.call(__cache, key)) return __cache[key].exports;
    if (/\\.json$/i.test(key) && __hasCode(key)) {
      var parsed = JSON.parse(__CODE[key]);
      __cache[key] = { exports: parsed, id: key, filename: '/' + key, loaded: true, parent: null, children: [], paths: [] };
      return parsed;
    }
    var module = {
      exports: {},
      id: '/' + key,
      filename: '/' + key,
      loaded: false,
      parent: null,
      children: [],
      paths: []
    };
    __cache[key] = module;
    var dir = key.indexOf('/') >= 0 ? key.slice(0, key.lastIndexOf('/')) : '';
    var src = __CODE[key];
    var fn = Function(
      'module', 'exports', 'require', '__filename', '__dirname',
      '"use strict";' + src
    );
    fn.call(module.exports, module, module.exports, __makeRequire(dir), '/' + key, '/' + dir);
    module.loaded = true;
    return module.exports;
  }

  // ---------- 启动 ----------
  var __entryDir = __MAIN.indexOf('/') >= 0 ? __MAIN.slice(0, __MAIN.lastIndexOf('/')) : '';
  __loadModule(__MAIN);
})();
`;
