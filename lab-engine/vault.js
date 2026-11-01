'use strict';
/**
 * lab-engine/vault.js — static decoding of Omni-Forger's string vault.
 *
 * The forger turns every literal into `V(i)` where V is an IIFE that carries a
 * base64 array. Each entry is encoded as:
 *
 *     byte pair (little endian) = charCode + 3 + (idx % 11) + charIndex * 5
 *
 * We never execute the target code. We locate the bootstrap, base64-decode the
 * entries and invert the shift arithmetic — that is the whole trick, and it is
 * exactly the kind of "the obfuscator was deterministic" crack an analyst does
 * by hand.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Decode(input) {
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '=') break;
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}

function decodeEntry(encoded, index) {
  const bytes = base64Decode(encoded);
  let out = '';
  for (let j = 0; j + 1 < bytes.length; j += 2) {
    const pair = (bytes[j] | (bytes[j + 1] << 8)) & 0xffff;
    const charCode = (pair - 3 - (index % 11) - (j / 2) * 5) & 0xffff;
    out += String.fromCharCode(charCode);
  }
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Find `arr = [ '....', '....' ]` and return every quoted element. */
function readStringArray(code, openBracket) {
  const values = [];
  let i = openBracket + 1;
  const n = code.length;
  const WS = /^\s$/;
  while (i < n) {
    const ch = code[i];
    if (ch === ']') return { values, end: i + 1 };
    if (ch === ',' || WS.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let raw = '';
      while (j < n && code[j] !== quote) {
        if (code[j] === '\\') {
          raw += code[j] + (code[j + 1] || '');
          j += 2;
        } else {
          raw += code[j];
          j++;
        }
      }
      values.push({ text: raw, start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    return null; // anything but strings/commas means this is not a vault array
  }
  return null;
}

/**
 * Crack every forger vault found in `code`.
 * @returns {{found:boolean, vaults:Array, entries:Array, replacedCalls:number, cleaned:string}}
 */
function crackVault(code) {
  let working = code;
  const vaults = [];
  const allEntries = [];
  let replacedCalls = 0;

  for (let pass = 0; pass < 4; pass++) {
    // Accept both forger spellings: `var V=(function(){var A=[…]` and the
    // Babel-normalised `var V=function(){var A=[…]` (redguard reprints the
    // ciphertext through @babel/generator, which drops the IIFE parens).
    const re = /var\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(\s*)?function\s*\(\s*\)\s*\{\s*var\s+[A-Za-z_$][\w$]*\s*=\s*\[/g;
    const m = re.exec(working);
    if (!m) break;
    const name = m[1];
    const openBracket = m.index + m[0].length - 1;
    const arr = readStringArray(working, openBracket);
    if (!arr || arr.values.length === 0) break;

    // The bootstrap must end with the standard IIFE tail: `})();` (forger) or
    // `}();` (Babel-normalised) — take whichever appears first.
    const tailA = working.indexOf('}();', arr.end);
    const tailB = working.indexOf('})();', arr.end);
    let tail = -1;
    if (tailA >= 0 && (tailB < 0 || tailA < tailB)) tail = tailA;
    else if (tailB >= 0) tail = tailB;
    if (tail < 0 || tail - arr.end > 6000) break;
    const tailLen = working.charCodeAt(tail + 1) === 0x29 ? 5 : 4; // ')' right after '}' ⇒ parenthesised
    const bootstrapEnd = tail + tailLen;

    const encodedValues = arr.values.map((v) => v.text);
    const entries = encodedValues.map((enc, idx) => ({
      index: idx,
      encoded: enc.slice(0, 48) + (enc.length > 48 ? '…' : ''),
      value: decodeEntry(enc, idx),
    }));

    const values = entries.map((e) => e.value);
    const codeWithoutBootstrap = working.slice(0, m.index) + working.slice(bootstrapEnd);
    const callRe = new RegExp('(^|[^\\w$.])' + escapeRegExp(name) + '\\s*\\(\\s*(\\d+)\\s*\\)', 'g');
    let calls = 0;
    const replaced = codeWithoutBootstrap.replace(callRe, (full, prefix, idxText) => {
      const idx = Number(idxText);
      if (!values[idx] && values[idx] !== '') return full;
      calls++;
      return prefix + JSON.stringify(values[idx]);
    });

    replacedCalls += calls;
    vaults.push({
      name,
      count: entries.length,
      calls,
      entries,
      bootstrap: working.slice(m.index, bootstrapEnd),
    });
    allEntries.push.apply(allEntries, entries);
    working = replaced;
  }

  return {
    found: vaults.length > 0,
    vaults,
    entries: allEntries,
    replacedCalls,
    cleaned: working,
  };
}

module.exports = { crackVault, decodeEntry, base64Decode };
