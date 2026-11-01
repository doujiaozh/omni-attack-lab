#!/usr/bin/env node
'use strict';
/**
 * lab-server/server.js — MicroDesk host for Omni-Attack-Lab.
 *
 * The page gets exactly three RPC methods and no filesystem/exec access:
 *   lab.status / lab.samples / lab.run
 *
 * Zero frameworks, one HTTP server, one WebSocket, loopback only.
 */

const path = require('path');
const fs = require('fs');
const { createCore, createBridge, launchWindow } = require('./vendor/micro-desk/lib');
const engine = require('../lab-engine');

const ROOT = path.resolve(__dirname, '..');
const UI_ROOT = path.join(ROOT, 'lab-ui');
const DEFAULT_PORT = Number(process.env.OMNI_LAB_PORT) || 7799;
const MAX_CODE_BYTES = engine.MAX_CODE_BYTES;

function parseArgs(argv) {
  const out = { open: true, port: DEFAULT_PORT, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-open' || a === '--headless') out.open = false;
    else if (a === '--open') out.open = true;
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a.indexOf('--port=') === 0) out.port = Number(a.slice(7));
    else if (a === '--help' || a === '-h') out.help = true;
  }
  if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) out.port = DEFAULT_PORT;
  return out;
}

function banner(url, port) {
  const line = '─'.repeat(62);
  const text = [
    '',
    '  ' + line,
    '   ⚔️   O M N I - A T T A C K - L A B',
    '  ' + line,
    '   混淆器 vs 逆向器 · 可视化红蓝对抗沙盒 / obfuscator vs deobfuscator',
    '',
    '   ARENA   ' + url,
    '   RPC     ws://127.0.0.1:' + port + '/ws',
    '   ENGINE  ' + (engine.VERSION),
    '',
    '   Ctrl+C 停止 / press Ctrl+C to stop',
    '  ' + line,
    '',
  ];
  return text.join('\n');
}

function defineMethods(bridge) {
  bridge.define('lab.status', () => engine.status(), { description: 'engine + AI capability probe' });

  bridge.define('lab.samples', () => engine.listSamples(), { description: 'built-in battle specimens' });

  bridge.define('lab.run', async (params) => {
    const started = Date.now();
    const result = await engine.runBattle(params);
    console.log(
      '[lab] ' + result.runId + ' · ' + result.input.bytes + 'B · red ' + result.red.ms +
        'ms · blue ' + result.blue.ms + 'ms · score ' + result.verdict.score + ' (' + result.verdict.grade + ')' +
        ' · total ' + (Date.now() - started) + 'ms'
    );
    return result;
  }, { description: 'run one red/blue battle' });
}

async function createArena(port, opts) {
  const bridge = createBridge({
    appId: 'omni-attack-lab',
    rendererRoot: UI_ROOT,
    tickMs: 0,
    maxReadBytes: 1024 * 1024,
    maxWriteBytes: 1024 * 1024,
    execTimeout: 5000,
    permissions: { fs: false, exec: false, open: false, env: false },
  });
  defineMethods(bridge);

  const core = createCore({
    root: UI_ROOT,
    host: '127.0.0.1',
    port: port,
    bridge: bridge,
    verbose: false,
    manifest: {
      name: 'Omni-Attack-Lab',
      id: 'omni-attack-lab',
      version: engine.VERSION,
      entry: 'index.html',
      rpc: { transport: 'websocket', path: '/ws' },
      limits: { maxCodeBytes: MAX_CODE_BYTES },
    },
  });

  try {
    await core.listen();
    return { core: core, bridge: bridge, url: core.url, port: core.port };
  } catch (err) {
    try {
      core.close();
    } catch (_) {
      /* ignore */
    }
    if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES') && port !== 0) {
      console.warn('[lab] port ' + port + ' unavailable (' + err.code + '), falling back to a random port');
      return createArena(0, opts);
    }
    throw err;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node lab-server/server.js [--port 7799] [--no-open]');
    return;
  }
  if (!fs.existsSync(path.join(UI_ROOT, 'index.html'))) {
    console.error('[lab] lab-ui/index.html is missing — cannot start the arena.');
    process.exit(1);
  }

  engine.warmup();
  const arena = await createArena(args.port, args);

  console.log(banner(arena.url, arena.port));

  if (args.open) {
    try {
      const launched = launchWindow(arena.url, { appId: 'omni-attack-lab', width: 1500, height: 940 });
      console.log('[lab] window: ' + (launched.mode || 'unknown') + (launched.browser ? ' · ' + launched.browser.label : ''));
    } catch (e) {
      console.warn('[lab] could not open a browser window: ' + e.message);
    }
  }

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.log('\n[lab] shutting down arena…');
    try {
      arena.core.close();
    } catch (_) {
      /* ignore */
    }
    setTimeout(() => process.exit(0), 50);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[lab] fatal: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
  });
}

module.exports = { createArena, defineMethods, parseArgs };
