/* ============================================================
   OMNI-ATTACK-LAB · lab-ui/app.js
   Red-vs-Blue arena front-end. ES2017, plain DOM + inline SVG.
   Talks to lab-server strictly through the frozen RPC contract
   (docs/CONTRACT.md): lab.status / lab.samples / lab.run.
   ============================================================ */
'use strict';

(function () {
  /* ---------------- tiny helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function pad3(n) { return (n < 10 ? '00' : n < 100 ? '0' : '') + n; }
  function stamp(d) {
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + '.' + pad3(d.getMilliseconds());
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function bytes(b) {
    if (b == null) return '—';
    return b >= 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B';
  }
  function num(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }

  /* ---------------- state ---------------- */
  var state = {
    md: null,
    connected: false,
    everConnected: false,
    demoArmed: false,
    running: false,
    ai: 'auto',
    intensity: 3,
    samples: [],
    result: null,
    editors: {}
  };

  /* ---------------- offline fallbacks (Win7-safe, no CDN) ---------------- */
  var FALLBACK_SAMPLES = [
    {
      id: 'billing', label: '计费核心 / Billing', note: 'reduce 求和 · 税率 · 阈值分支',
      code: [
        '// 计费核心：订单求和 + 税率计算 / billing core',
        'function calcPrice(items, taxRate) {',
        '  const base = items.reduce((sum, it) => sum + it.price * it.qty, 0);',
        '  const tax = base * taxRate;',
        '  if (base > 1000) console.log("VIP order detected");',
        '  return { base, tax, total: (base + tax).toFixed(2) };',
        '}',
        'const order = calcPrice([{ price: 120, qty: 2 }, { price: 30, qty: 1 }], 0.08);',
        'console.log("TOTAL=" + order.total);'
      ].join('\n')
    },
    {
      id: 'token', label: '令牌签发 / Token', note: '十六进制编码 · 哈希签名 · 校验',
      code: [
        '// 令牌签发与校验 / token issuer',
        'function hex(text) { var out = ""; for (var k = 0; k < text.length; k++) {',
        '  var h = text.charCodeAt(k).toString(16); out += h.length < 2 ? "0" + h : h; } return out; }',
        'function signToken(user, secret) {',
        '  var payload = JSON.stringify({ sub: user.id, role: user.role || "guest", exp: 900 });',
        '  var hash = 0, material = payload + ":" + secret;',
        '  for (var i = 0; i < material.length; i++) hash = ((hash << 5) - hash + material.charCodeAt(i)) | 0;',
        '  return "Bearer " + hex(payload) + "." + Math.abs(hash).toString(16).padStart(8, "0");',
        '}',
        'var demo = signToken({ id: "u_42", role: "admin" }, "s3cr3t-key");'
      ].join('\n')
    },
    {
      id: 'state-machine', label: '状态机 / State machine', note: 'switch 控制流 · 事件表 · 回路',
      code: [
        '// 订单状态机 / order state machine',
        'var TRANSITIONS = {',
        '  created: { pay: "paid", cancel: "cancelled" },',
        '  paid: { ship: "shipped", refund: "refunded" },',
        '  shipped: { deliver: "delivered" }',
        '};',
        'function step(state, event) {',
        '  var next = TRANSITIONS[state];',
        '  if (!next || !next[event]) return { ok: false, state: state };',
        '  return { ok: true, state: next[event] };',
        '}',
        'function runCheckout() { var s = "created", out = [];',
        '  ["pay", "ship", "deliver"].forEach(function (e) { s = step(s, e).state; out.push(s); });',
        '  return out; }'
      ].join('\n')
    }
  ];

  var INLINE_DEMO = {
    "ok": true,
    "runId": "20261101-034240-demo001",
    "startedAt": "2026-11-01T03:42:40.000Z",
    "totalMs": 103,
    "input": {
      "bytes": 462,
      "lines": 14
    },
    "red": {
      "engine": "babel",
      "engineLabel": "Omni-Forger · Babel AST（演示 DEMO）",
      "intensity": 3,
      "ms": 41,
      "code": "var _0x3a9b=['\\x70\\x72\\x69\\x63\\x65','\\x71\\x74\\x79','\\x64\\x69\\x73\\x63\\x6f\\x75\\x6e\\x74'];\n(function(_0x2c1d,_0x4e2a){var _0x1f8e=function(_0x3b7c){while(--_0x3b7c){_0x2c1d['\\x70\\x75\\x73\\x68'](_0x2c1d['\\x73\\x68\\x69\\x66\\x74']());}};_0x1f8e(++_0x4e2a);}(_0x3a9b,0x3));\nfunction _0x4c11(_0x2b8a,_0x17d9){_0x2b8a=_0x2b8a-0x0;var _0x5a1c=_0x3a9b[_0x2b8a];return _0x5a1c;}\nfunction calcPrice(_0x1e2f,_0x33a0){var _0x27b4=_0x4c11('0x0');var _0x9d88=PRICE_TABLE[_0x1e2f];\n  if(_0x33a0>_0x274c['\\x74\\x68\\x72\\x65\\x73\\x68\\x6f\\x6c\\x64']){_0x9d88=_0x9d88*(0x1-_0x274c[_0x4c11('0x2')]);}\n  return Math['\\x72\\x6f\\x75\\x6e\\x64'](_0x9d88*_0x33a0*0x64)/0x64;}\ncalcPrice('sku-42',0x3);",
      "bytes": 1586,
      "lines": 12,
      "stats": {
        "stringsEncrypted": 2,
        "identifiersRenamed": 8,
        "deadCodeInjected": 1,
        "evalConsoleKilled": 2
      },
      "detection": {
        "obfuscationScore": 16,
        "entropy": 5.41,
        "longestLine": 700,
        "hexIdentifiers": 75
      },
      "notes": [
        "演示数据 · DEMO fixture, not produced by a live engine"
      ]
    },
    "blue": {
      "engine": "static-forger-vault + omni-reverser + beautifier",
      "engineLabel": "本地静态还原（vault 解包 + 反混淆 + 美化）· 演示 DEMO",
      "ms": 63,
      "code": "/* 还原 / RESTORED by Omni-Reverser · static vault unpack + beautify */\n/* vault _0x3a9b 解包: 2 条字符串还原 / 2 strings restored */\n\nfunction calcPrice(unit, qty) {\n  var price = PRICE_TABLE[unit];        // 取单价 / unit price\n  var threshold = LIMITS.threshold;    // 阈值 / discount threshold\n  if (qty > threshold) {\n    price = price * (1 - LIMITS.discount);   // 折扣 / discount\n  }\n  return Math.round(price * qty * 100) / 100;\n}\n\ncalcPrice('sku-42', 3);",
      "ai": {
        "requested": "auto",
        "used": false,
        "provider": null,
        "model": null,
        "ms": 0,
        "error": null
      },
      "stats": {
        "vaultEntries": 2,
        "stringsRestored": 2,
        "deadCodePruned": 3,
        "namesRecovered": 0,
        "hiddenBlocks": 0,
        "obfuscationScoreBefore": 16
      },
      "details": {
        "obfuscators": [
          "javascript-obfuscator / obfuscator.io (hex 标识符)"
        ],
        "stringArrays": [
          "_0x3a9b"
        ],
        "findings": [
          {
            "severity": "medium",
            "message": "字符串数组经 shift 旋转，需静态展开（演示）"
          }
        ],
        "iocs": {
          "urls": [],
          "domains": [],
          "ips": [],
          "emails": [],
          "base64Blobs": []
        }
      },
      "notes": [
        "演示数据 · DEMO fixture, not produced by a live engine"
      ]
    },
    "verdict": {
      "score": 73,
      "grade": "A",
      "label": "混淆器占优",
      "summary": "字符串与结构被恢复 27%，但标识符全部丢失；蓝方耗时 1.6× 红方。（演示数据）",
      "similarity": 0.27,
      "breakdown": {
        "stringRecall": 0,
        "structureSim": 0.42,
        "nameRecall": 0,
        "timeRatio": 1.6
      },
      "axes": [
        {
          "key": "string",
          "label": "字符串加密",
          "value": 100,
          "hint": "原始字符串字面量被还原的比例越低越强"
        },
        {
          "key": "ident",
          "label": "标识符迷彩",
          "value": 100,
          "hint": "原始标识符名被找回的比例"
        },
        {
          "key": "flow",
          "label": "控制流欺骗",
          "value": 45,
          "hint": "死代码 / 结构扭曲后与原文的相似度"
        },
        {
          "key": "density",
          "label": "混淆密度",
          "value": 16,
          "hint": "Omni-Reverser 静态探测器打分"
        },
        {
          "key": "time",
          "label": "逆向耗时",
          "value": 62,
          "hint": "蓝方耗时相对红方的对数压力"
        }
      ],
      "weights": {
        "string": 0.35,
        "ident": 0.2,
        "flow": 0.15,
        "density": 0.15,
        "time": 0.15
      },
      "formula": "score = Σ(axis.value × weight)"
    },
    "report": {
      "filename": "battle-report-20261101-034240-demo001.md",
      "path": "reports/battle-report-20261101-034240-demo001.md",
      "bytes": 1180,
      "markdown": "# ⚔️ Omni-Attack-Lab 战报 · BATTLE REPORT\n\n> **DEMO · 演示数据** — 本战报为内置样例，未经过真实引擎。\n\n- RUN: `20261101-034240-demo001`\n- 模式 / MODE: 演示模式 DEMO (intensity 3, ai auto)\n- 输入 / INPUT: 462 B · 14 行\n\n## 判定 / VERDICT\n\n| 指标 | 值 |\n|---|---|\n| 总分 / SCORE | **73 / 100** (A) |\n| 结论 / LABEL | 混淆器占优 |\n| 还原相似度 / SIMILARITY | 27% |\n\n## 红方 / RED — Omni-Forger · Babel AST\n\n- 耗时: 41 ms · 产物 1586 B / 12 行\n- 字符串加密 2 · 标识符重命名 8 · 死代码 1 · 掐断 2\n- 静态探测: 混淆评分 16 · 熵 5.41 · hex 标识符 75\n\n## 蓝方 / BLUE — 本地静态还原\n\n- 耗时: 63 ms\n- vault 条目 2 · 字符串还原 2 · 死代码剪除 3\n- AI: auto → 未启用云端模型（本地静态还原）\n\n## 五维轴 / AXES\n\n- 字符串加密 100 · 标识符迷彩 100 · 控制流欺骗 45 · 混淆密度 16 · 逆向耗时 62\n\n---\nOMNI-ATTACK-LAB · 本地沙盒 / LOCAL SANDBOX\n"
    },
    "timeline": [
      {
        "at": "2026-11-01T03:42:40.000Z",
        "phase": "red",
        "message": "Babel AST 引擎启动 · 强度 3/5（演示 DEMO）"
      },
      {
        "at": "2026-11-01T03:42:40.041Z",
        "phase": "red",
        "message": "字符串加密 2 · 重命名 8 · 死代码 1 · 掐断 2"
      },
      {
        "at": "2026-11-01T03:42:40.052Z",
        "phase": "blue",
        "message": "静态 vault 解包成功：2 条字符串还原"
      },
      {
        "at": "2026-11-01T03:42:40.098Z",
        "phase": "blue",
        "message": "本地静态还原完成（无云端 AI）"
      },
      {
        "at": "2026-11-01T03:42:40.103Z",
        "phase": "score",
        "message": "还原相似度 27% · 防御得分 73 (A)"
      }
    ]
  };

  /* ---------------- battle log ---------------- */
  var logBody = $('logBody');
  var logCount = $('logCount');
  var LOG_MAX = 200;
  var logLines = 0;

  function log(phase, message) {
    var line = document.createElement('div');
    line.className = 'log-line phase-' + (phase || 'client');
    var tag = document.createElement('span');
    tag.className = 'log-tag';
    tag.textContent = (phase || 'sys').toUpperCase();
    var ts = document.createElement('span');
    ts.className = 'log-ts';
    ts.textContent = stamp(new Date());
    var msg = document.createElement('span');
    msg.textContent = message == null ? '' : String(message);
    line.appendChild(ts);
    line.appendChild(tag);
    line.appendChild(msg);
    logBody.appendChild(line);
    logLines++;
    while (logLines > LOG_MAX) { logBody.removeChild(logBody.firstChild); logLines--; }
    logBody.scrollTop = logBody.scrollHeight;
    logCount.textContent = logLines + ' 行';
  }
  function logClient(message) { log('client', message); }
  function logError(message) { log('error', message); }

  /* ---------------- editors ---------------- */
  function mountEditor(textareaId, readOnly) {
    var ta = $(textareaId);
    if (!ta) return null;
    if (window.CodeMirror) {
      try {
        return CodeMirror.fromTextArea(ta, {
          mode: 'javascript',
          lineNumbers: true,
          readOnly: !!readOnly,
          tabSize: 2,
          indentUnit: 2,
          smartIndent: true,
          styleActiveLine: false,
          extraKeys: readOnly ? {} : { 'Ctrl-Enter': function () { onLaunch(); } }
        });
      } catch (e) {
        logClient('CodeMirror 挂载失败，回退到 textarea / CodeMirror failed: ' + (e && e.message));
      }
    }
    return null;
  }
  function mountEditors() {
    state.editors.input = mountEditor('editorInput', false);
    state.editors.cipher = mountEditor('editorCipher', true);
    state.editors.restored = mountEditor('editorRestored', true);
  }
  function edValue(name) {
    var ed = state.editors[name];
    if (ed) return ed.getValue();
    var ta = $(name === 'input' ? 'editorInput' : name === 'cipher' ? 'editorCipher' : 'editorRestored');
    return ta ? ta.value : '';
  }
  function edSetValue(name, code) {
    var ed = state.editors[name];
    if (ed) {
      ed.setValue(code == null ? '' : String(code));
      ed.refresh();
    } else {
      var ta = $(name === 'input' ? 'editorInput' : name === 'cipher' ? 'editorCipher' : 'editorRestored');
      if (ta) ta.value = code == null ? '' : String(code);
    }
    var count = $(name === 'input' ? 'countInput' : name === 'cipher' ? 'countCipher' : 'countRestored');
    var text = code == null ? '' : String(code);
    if (count) count.textContent = bytes(new Blob([text]).size) + ' · ' + text.split(/\r\n|\r|\n/).length + ' 行';
    if (name !== 'input') {
      var empty = $(name === 'cipher' ? 'emptyCipher' : 'emptyRestored');
      if (empty) empty.hidden = text.length > 0;
    }
  }

  /* ---------------- clipboard & download ---------------- */
  function copyText(text, okMsg) {
    var done = function () { logClient(okMsg || '已复制到剪贴板 / copied to clipboard'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else { fallbackCopy(text, done); }
  }
  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-2000px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    } catch (e) { logError('复制失败 / copy failed: ' + (e && e.message)); }
  }
  function download(filename, content, mime) {
    var blob = new Blob([content], { type: (mime || 'text/markdown') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 160);
    logClient('已下载 / downloaded ' + filename);
  }

  /* ---------------- radar (inline SVG, no canvas/WebGL) ---------------- */
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function buildRadar(axes) {
    var host = $('radar');
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    var list = (axes || []).slice(0, 5);
    var W = 300, H = 260, cx = W / 2, cy = H / 2 + 4, R = 78;
    var n = list.length || 5; // empty verdict → pentagon skeleton placeholder
    var angle = function (i) { return -Math.PI / 2 + (i * 2 * Math.PI) / n; };
    var pt = function (i, r) { var a = angle(i); return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };

    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H });
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var rings = [];
      for (var i = 0; i < n; i++) { var p = pt(i, R * f); rings.push(p[0].toFixed(1) + ',' + p[1].toFixed(1)); }
      svg.appendChild(svgEl('polygon', { points: rings.join(' '), 'class': 'radar-ring' }));
    });
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = angle(i);
      var outer = pt(i, R);
      svg.appendChild(svgEl('line', { x1: cx, y1: cy, x2: outer[0], y2: outer[1], 'class': 'radar-axis' }));
      if (!list[i]) continue; // placeholder skeleton has no data point
      var lr = R + 16;
      var lx = cx + lr * Math.cos(a), ly = cy + lr * Math.sin(a);
      var anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
      var label = svgEl('text', { x: lx, y: ly, 'text-anchor': anchor, 'class': 'radar-label' });
      label.textContent = list[i].label || list[i].key;
      var title = svgEl('title', {});
      title.textContent = list[i].hint || (list[i].label || list[i].key);
      label.appendChild(title);
      svg.appendChild(label);
      var v = Math.max(0, Math.min(100, num(list[i].value, 0)));
      var vp = pt(i, (R * v) / 100);
      pts.push(vp[0].toFixed(1) + ',' + vp[1].toFixed(1));
      svg.appendChild(svgEl('circle', { cx: vp[0], cy: vp[1], r: 2.6, 'class': 'radar-pt' }));
      var vt = svgEl('text', {
        x: vp[0] + (Math.cos(a) >= 0 ? 5 : -5), y: vp[1] - 4,
        'text-anchor': Math.cos(a) >= 0 ? 'start' : 'end', 'class': 'radar-val'
      });
      vt.textContent = String(Math.round(v));
      svg.appendChild(vt);
    }
    if (pts.length) svg.appendChild(svgEl('polygon', { points: pts.join(' '), 'class': 'radar-poly' }));
    host.appendChild(svg);
  }

  /* ---------------- bridge ---------------- */
  function setPill(id, textId, on, text) {
    var pill = $(id);
    if (pill) pill.classList.toggle('on', !!on);
    var t = $(textId);
    if (t) t.textContent = text;
  }

  function onStatus(s) {
    state.everConnected = true;
    state.connected = true;
    setPill('bridgePill', 'bridgePillText', true, 'BRIDGE · LIVE');
    var ai = (s && s.ai) || {};
    setPill('aiPill', 'aiPillText', !!ai.enabled, ai.enabled ? ('AI ▸ ' + (ai.model || ai.provider || 'ON')) : 'AI 本地 LOCAL');
    var engines = (s && s.engines) || {};
    var red = engines.red || {}, blue = engines.blue || {};
    $('heroMeta').textContent = 'MICRODESK · LAB.NS · ' + [red.label || red.id, blue.label || blue.id].join(' | ');
    $('footStatus').textContent = 'bridge: live · node ' + (s && s.node ? s.node.replace('v', '') : '?') +
      ' · limits ' + (s && s.limits ? s.limits.maxCodeBytes : '?') + 'B';
    logClient('引擎桥接就绪 / bridge ready — ' + (red.label || '?') + ' ⚔ ' + (blue.label || '?'));
    if (!red.available || !blue.available) {
      logError('引擎未就绪 / engine unavailable — red:' + (red.available ? 'ok' : 'MISSING') + ' blue:' + (blue.available ? 'ok' : 'MISSING'));
    }
    loadSamples();
  }

  function loadSamples() {
    var fill = function (list) {
      state.samples = list || [];
      var sel = $('sampleSelect');
      sel.innerHTML = '';
      state.samples.forEach(function (s, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = s.label || s.id;
        sel.appendChild(o);
      });
      if (state.samples.length) {
        pickSample(0);
        logClient('样本库载入 ' + state.samples.length + ' 个样本 / ' + state.samples.length + ' samples loaded');
      }
    };
    if (state.connected && state.md) {
      state.md.call('lab.samples').then(function (r) {
        var list = r && r.samples;
        fill(list && list.length ? list : FALLBACK_SAMPLES);
      }).catch(function (e) {
        logError('lab.samples 失败，使用内置样本 / samples failed: ' + rpcErr(e));
        fill(FALLBACK_SAMPLES);
      });
    } else { fill(FALLBACK_SAMPLES); }
  }

  function enterDemo(reason) {
    if (state.demoArmed) return;
    state.demoArmed = true;
    state.connected = false;
    $('demoBanner').hidden = false;
    setPill('bridgePill', 'bridgePillText', false, 'BRIDGE · DEMO');
    $('footStatus').textContent = 'bridge: offline — demo mode';
    logClient('演示模式 / DEMO MODE — ' + (reason || '引擎未连接'));
    loadSamples();
  }

  function probeBridge() {
    if (!window.MicroDesk) { enterDemo('MicroDesk SDK 未加载 / SDK missing'); return; }
    try { state.md = MicroDesk.connect({ timeout: 6000 }); }
    catch (e) { enterDemo('SDK 连接异常 / connect failed'); return; }
    if (!state.md) { enterDemo('SDK 返回空客户端 / empty client'); return; }
    var reArmForRecovery = function () { state.demoArmed = false; };
    state.md.on('open', function () {
      state.md.call('lab.status').then(function (s) {
        $('demoBanner').hidden = true;
        reArmForRecovery();
        onStatus(s);
      }).catch(function (e) {
        if (!state.everConnected) enterDemo('lab.status 失败 / status failed: ' + rpcErr(e));
      });
    });
    state.md.on('close', function () {
      if (!state.everConnected) { enterDemo('连接关闭 / connection closed'); }
      else { setPill('bridgePill', 'bridgePillText', false, 'BRIDGE · 重连中…'); logError('桥连接断开，自动重连中 / bridge dropped, reconnecting'); }
    });
    state.md.call('lab.status').then(onStatus).catch(function (e) {
      if (!state.everConnected) enterDemo(rpcErr(e) || '引擎未响应 / no engine');
    });
  }

  function rpcErr(e) {
    if (!e) return '';
    if (e.code) return e.code + (e.message ? ' · ' + e.message : '');
    return e.message || String(e);
  }

  /* ---------------- render ---------------- */
  function renderResult(r, isDemo) {
    state.result = r;
    var red = r.red || {}, blue = r.blue || {}, verdict = r.verdict || {};
    edSetValue('cipher', red.code);
    edSetValue('restored', blue.code);
    $('restoredFoot').textContent = blue.engineLabel || 'BLUE';

    $('demoChipCipher').hidden = !isDemo;
    $('demoChipRestored').hidden = !isDemo;
    $('demoChipScore').hidden = !isDemo;

    $('scoreValue').textContent = String(Math.round(num(verdict.score, 0)));
    var grade = $('gradeBadge');
    grade.textContent = verdict.grade || '?';
    grade.className = 'grade grade-' + (verdict.grade || 'empty');
    $('verdictLabel').textContent = verdict.label || '—';
    $('verdictSummary').textContent = verdict.summary || '';
    $('runMeta').textContent = 'RUN ' + (r.runId || '—') + ' · ' + num(r.totalMs, 0) + ' ms';
    $('radarFoot').textContent = verdict.formula || 'score = Σ(axis.value × weight)';

    $('statRedMs').textContent = num(red.ms, 0) + ' ms';
    $('statBlueMs').textContent = num(blue.ms, 0) + ' ms';
    $('statSimilarity').textContent = Math.round(num(verdict.similarity, 0) * 100) + '%';
    $('statBytes').textContent = bytes(num(red.bytes, 0));
    var det = red.detection || {};
    $('statObf').textContent = String(Math.round(num(det.obfuscationScore, 0)));
    $('statEngine').textContent = blue.engineLabel || blue.engine || '—';

    buildRadar(verdict.axes);

    (r.timeline || []).forEach(function (t) { log(t && t.phase, t && t.message); });
    if (red.notes && red.notes.length) red.notes.slice(0, 4).forEach(function (n) { log('red', n); });
    if (blue.notes && blue.notes.length) blue.notes.slice(0, 4).forEach(function (n) { log('blue', n); });

    $('downloadBtn').disabled = false;
    $('viewReportBtn').disabled = false;
    $('modalDownload').disabled = false;
  }

  /* ---------------- launch ---------------- */
  function setBusy(busy) {
    state.running = busy;
    var btn = $('launchBtn');
    btn.classList.toggle('is-busy', busy);
    btn.disabled = busy;
  }

  function onLaunch() {
    if (state.running) return;
    var code = edValue('input');
    if (!code || !code.trim()) {
      logError('左侧编辑器为空 / editor is empty — 先粘贴代码或选择样本');
      var pane = $('paneInput');
      if (pane) { pane.style.borderColor = 'var(--red)'; setTimeout(function () { pane.style.borderColor = ''; }, 900); }
      return;
    }
    setBusy(true);
    var t0 = Date.now();
    logClient('启动攻防对抗 / LAUNCH — 强度 ' + state.intensity + '/5 · AI ' + (state.ai === 'off' ? '仅本地' : '自动') + ' · ' + bytes(new Blob([code]).size) + ' 输入');

    var fail = function (e) {
      logError('对抗失败 / battle failed — ' + rpcErr(e));
      setBusy(false);
    };

    if (state.connected && state.md) {
      log('client', 'RPC → lab.run · 等待红蓝回合 / awaiting red+blue rounds…');
      state.md.call('lab.run', [{ code: code, intensity: state.intensity, ai: state.ai }])
        .then(function (r) {
          if (!r || !r.ok) return fail(r && r.error ? r.error : { message: 'lab.run 返回非法结果 / invalid result' });
          renderResult(r, false);
          log('score', '回合完成 / round complete — 总耗时 ' + (Date.now() - t0) + ' ms · 防御得分 ' + Math.round(num(r.verdict && r.verdict.score, 0)));
          setBusy(false);
        })
        .catch(function (e) {
          if (e && e.code === 'EDISCONNECTED') enterDemo('连接中断 / bridge dropped mid-battle');
          fail(e);
        });
    } else {
      // DEMO MODE: show bundled fixture, clearly labelled.
      log('client', '演示模式：读取内置样例数据 / demo mode — loading bundled fixture…');
      var renderDemo = function (data) {
        try { renderResult(data, true); logClient('已渲染演示数据 / demo data rendered — 启动 lab-server 后可进行真实对抗'); }
        catch (e) { logError('演示数据渲染失败 / demo render failed: ' + (e && e.message)); }
        setBusy(false);
      };
      fetch('fixtures/demo-result.json', { cache: 'no-store' })
        .then(function (res) { return res.json(); })
        .then(renderDemo)
        .catch(function () { renderDemo(INLINE_DEMO); });
    }
  }

  /* ---------------- samples / controls ---------------- */
  function pickSample(i) {
    var s = state.samples[i];
    if (!s) return;
    edSetValue('input', s.code || '');
    $('sampleNote').textContent = s.note || s.id || '';
    logClient('已载入样本 / sample loaded — ' + (s.label || s.id));
  }

  function wireControls() {
    var slider = $('intensity');
    var INT = {
      1: 'L1 · 轻度', 2: 'L2 · 基础', 3: 'L3 · 标准', 4: 'L4 · 加强', 5: 'L5 · 极限'
    };
    function syncIntensity() {
      state.intensity = Math.round(Number(slider.value) || 3);
      $('intensityValue').textContent = state.intensity + ' / 5 · ' + (INT[state.intensity] || '');
    }
    slider.addEventListener('input', syncIntensity);
    syncIntensity();

    $('sampleSelect').addEventListener('change', function () { pickSample(Number($('sampleSelect').value) || 0); });

    $('aiToggle').addEventListener('click', function (ev) {
      var btn = ev.target;
      while (btn && btn.tagName !== 'BUTTON' && btn !== this) btn = btn.parentNode;
      if (!btn || btn.tagName !== 'BUTTON') return;
      state.ai = btn.getAttribute('data-ai') === 'off' ? 'off' : 'auto';
      var btns = this.getElementsByTagName('button');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        var on = (b.getAttribute('data-ai') === state.ai);
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      $('aiHint').textContent = state.ai === 'off' ? '仅本地' : '自动';
      logClient('AI 模式 / AI mode — ' + (state.ai === 'off' ? '仅本地静态还原 / local static only' : '自动（可用时调用云端）/ auto'));
    });

    $('clearBtn').addEventListener('click', clearLog);
    $('launchBtn').addEventListener('click', onLaunch);

    $('copyInput').addEventListener('click', function () { copyText(edValue('input'), '已复制原始代码 / original copied'); });
    $('copyCipher').addEventListener('click', function () { copyText(edValue('cipher'), '已复制密文 / ciphertext copied'); });
    $('copyRestored').addEventListener('click', function () { copyText(edValue('restored'), '已复制还原代码 / restored copied'); });
    $('dlCipher').addEventListener('click', function () {
      download('ciphertext-' + (state.result ? state.result.runId : 'arena') + '.js', edValue('cipher'), 'text/javascript');
    });
    $('dlRestored').addEventListener('click', function () {
      download('restored-' + (state.result ? state.result.runId : 'arena') + '.js', edValue('restored'), 'text/javascript');
    });

    $('downloadBtn').addEventListener('click', function () {
      var r = state.result;
      if (r && r.report) download(r.report.filename || 'battle-report.md', r.report.markdown || '');
    });
    $('viewReportBtn').addEventListener('click', openReportModal);
    $('modalClose').addEventListener('click', closeReportModal);
    $('modalDownload').addEventListener('click', function () {
      var r = state.result;
      if (r && r.report) download(r.report.filename || 'battle-report.md', r.report.markdown || '');
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !$('reportModal').hidden) { closeReportModal(); return; }
      if (ev.ctrlKey && ev.key === 'Enter') { ev.preventDefault(); onLaunch(); }
      if (ev.ctrlKey && ev.shiftKey && (ev.key === 'C' || ev.key === 'c')) { ev.preventDefault(); clearLog(); }
    });
  }

  function openReportModal() {
    var r = state.result;
    if (!r || !r.report) return;
    $('reportPre').textContent = r.report.markdown || '(empty report)';
    $('reportFilename').textContent = r.report.filename || '';
    $('reportModal').hidden = false;
  }
  function closeReportModal() { $('reportModal').hidden = true; }
  function clearLog() {
    while (logBody.firstChild) logBody.removeChild(logBody.firstChild);
    logLines = 0;
    logCount.textContent = '0 行';
  }

  /* ---------------- boot ---------------- */
  function boot() {
    mountEditors();
    wireControls();
    buildRadar(null);
    edSetValue('input', '');
    logClient('OMNI-ATTACK-LAB 前端就绪 / arena UI ready · v1.0.0');
    logClient('在这个沙盒里，看看是你的混淆器硬，还是 AI 的算力强。');
    probeBridge();
    setInterval(function () { $('clockText').textContent = stamp(new Date()); }, 1000);
    $('clockText').textContent = stamp(new Date());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
