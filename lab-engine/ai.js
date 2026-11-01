'use strict';
/**
 * lab-engine/ai.js — optional cloud brain for the BLUE team.
 *
 * The lab is fully functional without any key: we always run the deterministic
 * static restoration first, and only *refine* it with an LLM when one is
 * configured. Supported providers (OpenAI-compatible or Anthropic native):
 *
 *   OMNI_AI_API_KEY / OMNI_AI_BASE_URL / OMNI_AI_MODEL / OMNI_AI_PROVIDER
 *   DEEPSEEK_API_KEY   -> https://api.deepseek.com/v1   (deepseek-chat)
 *   OPENAI_API_KEY     -> https://api.openai.com/v1     (gpt-4o-mini)
 *   ANTHROPIC_API_KEY  -> https://api.anthropic.com     (claude-3-5-haiku-latest)
 *
 * Never logs the key, never sends the code anywhere unless a key exists.
 */

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_PROMPT_BYTES = 60000;

function resolveConfig() {
  const env = process.env;
  const explicitKey = env.OMNI_AI_API_KEY || '';
  const deepseek = env.DEEPSEEK_API_KEY || '';
  const openai = env.OPENAI_API_KEY || '';
  const anthropic = env.ANTHROPIC_API_KEY || '';

  let provider = (env.OMNI_AI_PROVIDER || '').toLowerCase() || null;
  let key = explicitKey;
  let baseUrl = env.OMNI_AI_BASE_URL || '';
  let model = env.OMNI_AI_MODEL || '';

  if (!key) {
    if (deepseek) {
      key = deepseek;
      provider = provider || 'openai';
      baseUrl = baseUrl || 'https://api.deepseek.com/v1';
      model = model || 'deepseek-chat';
    } else if (openai) {
      key = openai;
      provider = provider || 'openai';
      baseUrl = baseUrl || 'https://api.openai.com/v1';
      model = model || 'gpt-4o-mini';
    } else if (anthropic) {
      key = anthropic;
      provider = provider || 'anthropic';
      baseUrl = baseUrl || 'https://api.anthropic.com';
      model = model || 'claude-3-5-haiku-latest';
    }
  }

  if (!provider) provider = 'openai';
  if (!baseUrl) baseUrl = provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';
  if (!model) model = provider === 'anthropic' ? 'claude-3-5-haiku-latest' : 'gpt-4o-mini';
  baseUrl = baseUrl.replace(/\/+$/, '');

  const enabled = !!key;
  return {
    enabled,
    provider,
    key,
    baseUrl,
    model,
    timeoutMs: Number(env.OMNI_AI_TIMEOUT_MS) > 0 ? Number(env.OMNI_AI_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
  };
}

function status() {
  const cfg = resolveConfig();
  if (!cfg.enabled) {
    return {
      enabled: false,
      provider: null,
      model: null,
      mode: 'local-fallback',
      note: '云端模型未配置，使用本地静态还原引擎（结果可复现）',
    };
  }
  return {
    enabled: true,
    provider: cfg.provider,
    model: cfg.model,
    mode: 'cloud-refine',
    note: '云端模型已就绪，蓝方将在本地还原之上做语义级重命名',
  };
}

const SYSTEM_PROMPT = [
  'You are the BLUE team in a local obfuscation research sandbox.',
  'You receive already-statically-decoded JavaScript (strings restored). Your job:',
  '1. restore readable, semantically meaningful identifier names from usage context;',
  '2. remove remaining obfuscation noise (dead stubs, decoder wrappers) without changing behavior;',
  '3. keep the code runnable as ES5/ES2015 with no new imports or dependencies;',
  '4. never invent features that were not in the code.',
  'Output ONLY one ```js code block. No explanation, no analysis, no tool calls.',
].join('\n');

function buildUserPrompt(code) {
  return 'Here is the statically decoded JavaScript. Restore it for a human analyst:\n\n```js\n' + code + '\n```';
}

function extractCode(text) {
  if (typeof text !== 'string') return '';
  const fence = text.match(/```(?:js|javascript)?\s*\r?\n([\s\S]*?)```/i);
  if (fence && fence[1]) return fence[1].trim();
  return text.trim();
}

async function callOpenAi(cfg, prompt) {
  const endpoint = cfg.baseUrl + '/chat/completions';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + cfg.key,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      max_tokens: 4096,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('provider HTTP ' + res.status + ' ' + body.slice(0, 200));
  }
  const data = await res.json();
  const choice = data && data.choices && data.choices[0];
  return (choice && (choice.message ? choice.message.content : choice.text)) || '';
}

async function callAnthropic(cfg, prompt) {
  const endpoint = cfg.baseUrl + '/v1/messages';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      temperature: 0.1,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('provider HTTP ' + res.status + ' ' + body.slice(0, 200));
  }
  const data = await res.json();
  const parts = (data && data.content) || [];
  return parts
    .filter((p) => p && p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

/**
 * Ask the model for a semantic restoration.
 * @returns {Promise<{code:string, ms:number, provider:string, model:string}>}
 */
async function deobfuscate(code) {
  const cfg = resolveConfig();
  if (!cfg.enabled) {
    const err = new Error('cloud model not configured');
    err.code = 'ENOAI';
    throw err;
  }
  const input = code.length > MAX_PROMPT_BYTES ? code.slice(0, MAX_PROMPT_BYTES) : code;
  const prompt = buildUserPrompt(input);
  const started = Date.now();
  const raw = cfg.provider === 'anthropic' ? await callAnthropic(cfg, prompt) : await callOpenAi(cfg, prompt);
  const restored = extractCode(raw);
  if (!restored || restored.length < 20) throw new Error('model returned an empty restoration');
  if (!/[{};]/.test(restored) && !/=>/.test(restored)) throw new Error('model output does not look like JavaScript');
  return {
    code: restored,
    ms: Date.now() - started,
    provider: cfg.provider,
    model: cfg.model,
  };
}

module.exports = { status, deobfuscate, resolveConfig, extractCode };
