'use strict';
/**
 * lab-engine/samples.js — three self-contained battle specimens.
 * Every sample is plain ES5/ES2015 JavaScript: no DOM, no Node API, safe to
 * display and (if a human wants) run in a browser console.
 */

const SAMPLES = [
  {
    id: 'billing',
    label: '计费核心 / Billing core',
    note: '字符串、闭包、分支、数组方法',
    code: [
      '// Pricing engine — computes base, tax and total for an order.',
      'function calcPrice(items, taxRate) {',
      '  const base = items.reduce((sum, it) => sum + it.price * it.qty, 0);',
      '  const tax = base * taxRate;',
      '  if (base > 1000) {',
      '    console.log("VIP order detected");',
      '  }',
      '  return { base: base, tax: tax, total: (base + tax).toFixed(2) };',
      '}',
      'const order = calcPrice([{ price: 120, qty: 2 }, { price: 30, qty: 1 }], 0.08);',
      'console.log("TOTAL=" + order.total);',
    ].join('\n'),
  },
  {
    id: 'token',
    label: '令牌签发 / Auth token',
    note: '十六进制/Base64 字符串、循环、校验分支',
    code: [
      '// Token issuer: builds a short-lived signed token from a user record.',
      'function hex(text) {',
      '  var out = "";',
      '  for (var k = 0; k < text.length; k++) {',
      '    var h = text.charCodeAt(k).toString(16);',
      '    out += h.length < 2 ? "0" + h : h;',
      '  }',
      '  return out;',
      '}',
      'function signToken(user, secret) {',
      '  var payload = JSON.stringify({',
      '    sub: user.id,',
      '    role: user.role || "guest",',
      '    exp: 900',
      '  });',
      '  var hash = 0;',
      '  var material = payload + ":" + secret;',
      '  for (var i = 0; i < material.length; i++) {',
      '    hash = ((hash << 5) - hash + material.charCodeAt(i)) | 0;',
      '  }',
      '  var signature = Math.abs(hash).toString(16).padStart(8, "0");',
      '  return "Bearer " + hex(payload) + "." + signature;',
      '}',
      'function verifyToken(token, secret) {',
      '  if (!token || token.indexOf("Bearer ") !== 0) {',
      '    throw new Error("malformed authorization header");',
      '  }',
      '  return token.length > 32;',
      '}',
      'var demo = signToken({ id: "u_42", role: "admin" }, "s3cr3t-key");',
      'console.log("token issued for admin:", verifyToken(demo, "s3cr3t-key"));',
    ].join('\n'),
  },
  {
    id: 'state-machine',
    label: '状态机 / Order state machine',
    note: 'switch 控制流、事件表、死代码友好',
    code: [
      '// A tiny order state machine used by a checkout flow.',
      'var TRANSITIONS = {',
      '  created: { pay: "paid", cancel: "cancelled" },',
      '  paid: { ship: "shipped", refund: "refunded" },',
      '  shipped: { deliver: "delivered" },',
      '  delivered: { refund: "refunded" }',
      '};',
      'function transition(state, event) {',
      '  var row = TRANSITIONS[state];',
      '  if (!row || !row[event]) {',
      '    return { ok: false, state: state, reason: "illegal transition: " + state + " -> " + event };',
      '  }',
      '  return { ok: true, state: row[event], audit: "EVENT=" + event };',
      '}',
      'function runCheckout() {',
      '  var state = "created";',
      '  var events = ["pay", "ship", "deliver", "refund"];',
      '  var trail = [];',
      '  for (var i = 0; i < events.length; i++) {',
      '    var result = transition(state, events[i]);',
      '    trail.push(result.state);',
      '    if (!result.ok) {',
      '      console.warn("checkout stopped: " + result.reason);',
      '      break;',
      '    }',
      '    state = result.state;',
      '  }',
      '  return trail;',
      '}',
      'console.log("final trail:", runTrail(runCheckout()));',
      'function runTrail(trail) { return trail.join(" > "); }',
    ].join('\n'),
  },
];

function list() {
  return SAMPLES.map((s) => ({ id: s.id, label: s.label, note: s.note, code: s.code }));
}

function get(id) {
  return SAMPLES.filter((s) => s.id === id)[0] || null;
}

module.exports = { list, get };
