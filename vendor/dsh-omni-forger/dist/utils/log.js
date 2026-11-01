"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setVerbose = setVerbose;
exports.log = log;
exports.banner = banner;
const COLORS = {
    success: '\x1b[32m',
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    dim: '\x1b[90m',
};
const RESET = '\x1b[0m';
let verbose = true;
function setVerbose(v) {
    verbose = v;
}
function log(level, msg) {
    if (!verbose && level === 'dim')
        return;
    const stamp = new Date().toISOString().slice(11, 19);
    const prefix = `[${stamp}]`;
    if (process.env.OMNI_NO_COLOR) {
        console.log(`${prefix} ${msg}`);
    }
    else {
        console.log(`${COLORS[level]}${prefix} ${msg}${RESET}`);
    }
}
function banner(text) {
    const line = '═'.repeat(Math.max(text.length + 4, 40));
    console.log(`\n\x1b[35m╔${line}╗\n║  ${text}  ║\n╚${line}╝\x1b[0m\n`);
}
