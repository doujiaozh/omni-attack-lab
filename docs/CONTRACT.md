# Omni-Attack-Lab · RPC Contract (v1, frozen)

This document is the **single source of truth** for the browser ⇄ Node boundary.
`lab-ui/` and `lab-engine/` are developed independently against this file.

Transport: MicroDesk `md_bridge` over WebSocket `/ws`.
Browser: `const md = MicroDesk.connect(); const res = await md.call('lab.run', {...});`

All methods are on the `lab.` namespace. No `fs.*`, `sys.*` or `exec.*` method is
exposed to the page (the bridge runs with permissions `fs:false, exec:false,
open:false, env:false`). The page can only ask the engine to fight, never to
touch the machine.

Times are milliseconds (integers). All strings are UTF-8.

---

## 1. `lab.status()`

```json
{
  "ok": true,
  "app": "Omni-Attack-Lab",
  "version": "1.0.0",
  "node": "v26.7.0",
  "platform": "win32 x64",
  "engines": {
    "red":  { "id": "omni-forger", "label": "Omni-Forger · Babel AST", "version": "1.0.0", "available": true, "path": "vendor/dsh-omni-forger" },
    "blue": { "id": "omni-reverser", "label": "Omni-Reverser · static deobfuscator", "version": "1.0.0", "available": true, "path": "vendor/dsh-omni-reverser" }
  },
  "ai": {
    "enabled": false,
    "provider": null,
    "model": null,
    "mode": "local-fallback",
    "note": "云端模型未配置，使用本地静态还原引擎（结果可复现）"
  },
  "limits": { "maxCodeBytes": 200000, "maxIntensity": 5, "minIntensity": 1 }
}
```

`ai.enabled=false` is normal and must NOT break the UI. When false the blue
side still works (local static restoration), and the UI shows a badge
「本地静态还原」instead of「云端 AI」.

---

## 2. `lab.samples()`

```json
{
  "ok": true,
  "samples": [
    { "id": "billing", "label": "计费核心 / Billing core", "code": "function ...", "note": "含字符串、分支、闭包" }
  ]
}
```

At least 3 samples. UI may ship a hard-coded fallback copy but must prefer this.

---

## 3. `lab.run({ code, intensity, ai })`

Params:
- `code` (string, required, 1..200000 bytes)
- `intensity` (number 1..5, optional, default 3)
- `ai` (`"auto" | "off"`, optional, default `"auto"`) — `auto` = use cloud LLM
  only when configured; `off` = force local static restoration.

Returns the battle result. **This is the only method the UI needs to render the
whole arena.**

```json
{
  "ok": true,
  "runId": "20261101-103622-a1b2c3",
  "startedAt": "2026-11-01T02:36:22.000Z",
  "totalMs": 214,
  "input": { "bytes": 412, "lines": 9 },

  "red": {
    "engine": "babel",
    "engineLabel": "Omni-Forger · Babel AST",
    "intensity": 3,
    "ms": 38,
    "code": "var _0x...",
    "bytes": 1519,
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
    "notes": []
  },

  "blue": {
    "engine": "static-forger-vault + omni-reverser + beautifier",
    "engineLabel": "本地静态还原（vault 解包 + 反混淆 + 美化）",
    "ms": 61,
    "code": "function calcPrice(...)",
    "ai": { "requested": "auto", "used": false, "provider": null, "model": null, "ms": 0, "error": null },
    "stats": {
      "vaultEntries": 2,
      "stringsRestored": 2,
      "deadCodePruned": 3,
      "namesRecovered": 0,
      "hiddenBlocks": 0,
      "obfuscationScoreBefore": 16
    },
    "details": {
      "obfuscators": ["javascript-obfuscator / obfuscator.io (hex 标识符)"],
      "stringArrays": [],
      "findings": [{ "severity": "medium", "message": "..." }],
      "iocs": { "urls": [], "domains": [], "ips": [], "emails": [], "base64Blobs": [] }
    },
    "notes": []
  },

  "verdict": {
    "score": 73,
    "grade": "A",
    "label": "混淆器占优",
    "summary": "字符串与结构被恢复 27%，但标识符全部丢失；蓝方耗时 1.6× 红方。",
    "similarity": 0.27,
    "breakdown": {
      "stringRecall": 0.0,
      "structureSim": 0.42,
      "nameRecall": 0.0,
      "timeRatio": 1.6
    },
    "axes": [
      { "key": "string",  "label": "字符串加密", "value": 100, "hint": "原始字符串字面量被还原的比例越低越强" },
      { "key": "ident",   "label": "标识符迷彩", "value": 100, "hint": "原始标识符名被找回的比例" },
      { "key": "flow",    "label": "控制流欺骗", "value": 58, "hint": "死代码 / 结构扭曲后与原文的相似度" },
      { "key": "density", "label": "混淆密度",   "value": 16, "hint": "Omni-Reverser 静态探测器打分" },
      { "key": "time",    "label": "逆向耗时",   "value": 62, "hint": "蓝方耗时相对红方的对数压力" }
    ],
    "weights": { "string": 0.35, "ident": 0.2, "flow": 0.15, "density": 0.15, "time": 0.15 },
    "formula": "score = Σ(axis.value × weight)"
  },

  "report": {
    "filename": "battle-report-20261101-103622-a1b2c3.md",
    "path": "reports/battle-report-....md",
    "bytes": 4200,
    "markdown": "# ⚔️ Omni-Attack-Lab 战报\n..."
  },

  "timeline": [
    { "at": "2026-11-01T02:36:22.000Z", "phase": "red", "message": "Babel AST 引擎启动 · 强度 3/5" },
    { "at": "2026-11-01T02:36:22.040Z", "phase": "red", "message": "字符串加密 2 · 重命名 8 · 死代码 1 · 掐断 2" },
    { "at": "2026-11-01T02:36:22.050Z", "phase": "blue", "message": "静态 vault 解包成功：2 条字符串还原" },
    { "at": "2026-11-01T02:36:22.090Z", "phase": "score", "message": "还原相似度 27% · 防御得分 73 (A)" }
  ]
}
```

### Error behaviour

RPC rejects with `{ code, message }`; the bridge surfaces it as a rejected
promise (`err.message`). Expected codes:

| code | when |
|---|---|
| `EEMPTY` | empty / whitespace-only code |
| `ETOOLARGE` | code exceeds `limits.maxCodeBytes` |
| `EBADINTENSITY` | intensity outside 1..5 |
| `EFORGE` | red engine threw (message contains the reason) |

UI must catch, print the message in the battle log, re-enable the button and
never leave the UI in a spinner state.

---

## 4. UI requirements (hard)

- Files: `lab-ui/index.html`, `lab-ui/styles.css`, `lab-ui/app.js`, plus vendored
  CodeMirror under `lab-ui/vendor/codemirror/` and the vendored SDK at
  `lab-ui/vendor/microdesk.sdk.js`.
- **No WebGL, no canvas 3D, no heavy framework, no runtime CDN.** Everything is
  served from disk by MicroDesk. SVG (2D) + DOM/CSS only. Target a Win7-era
  Chromium: avoid `backdrop-filter`, `conic-gradient`, CSS `gap` in flex
  layouts, and `:has()`.
- Layout: left = original code editor; right = two side-by-side output editors
  (`密文 / CIPHERTEXT`, `AI 逆向还原 / RESTORED`). On narrow windows the two
  output panes stack.
- One giant primary button: `⚔️ 启动攻防对抗 / LAUNCH ATTACK`.
- A 5-axis SVG radar chart + a big numeric score (0-100) + grade badge, driven
  by `verdict.axes` / `verdict.score` / `verdict.grade`.
- Intensity slider 1..5 and sample picker from `lab.samples()`.
- Battle log with timestamps (`timeline` events + client-side phases).
- 「下载战报」button: `Blob` + `<a download>` from `report.markdown`; no server
  round-trip required.
- Copy buttons for each editor.
- Offline preview: if `lab.status` fails, show a clearly-labelled
  `DEMO DATA / 演示模式` banner and render a bundled fixture so the page can be
  reviewed without the server. The real path must light up automatically once
  the bridge connects (listen to `open`).
- Keyboard: `Ctrl+Enter` = run, `Ctrl+Shift+C` = clear log.
- All user-facing copy bilingual (中文 primary, English secondary) in the
  cyberpunk style: monospace, neon cyan/magenta, scanline/CRT look with cheap
  CSS gradients only.
