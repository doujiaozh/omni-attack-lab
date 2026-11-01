"use strict";
/**
 * Omni-Forger · forge_verify 红队探针
 * 模拟 Omni-Reverser 的静态提取手段：纯正则与字符串搜索。
 * 每条探针命中即扣分，最终给出「防御分」。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROBES = void 0;
exports.runProbes = runProbes;
exports.PROBES = [
    {
        id: 'api-route',
        severity: 'high',
        description: 'API 路由路径可被正则直接提取（/api/users 等）',
        pattern: /\/api\/[a-zA-Z\-_]{2,}/g,
        perHit: 12,
        maxPenalty: 40,
    },
    {
        id: 'secret-literal',
        severity: 'high',
        description: '疑似密钥/口令字面量（password=..., jwtSecret 等）',
        pattern: /(?:password|passwd|secret|api_?key|jwt_?secret|token)\s*[:=]\s*['"][^'"]{4,}/gi,
        perHit: 20,
        maxPenalty: 60,
    },
    {
        id: 'sql-fragment',
        severity: 'high',
        description: 'SQL 语句片段裸露（SELECT/INSERT INTO ...）',
        pattern: /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/gi,
        perHit: 10,
        maxPenalty: 35,
    },
    {
        id: 'db-identifier',
        severity: 'medium',
        description: '数据库标识符泄露（表名 accounts/users/...）',
        pattern: /\b(accounts|users|transactions|ledgers|orders|products|posts)\b/g,
        perHit: 8,
        maxPenalty: 30,
    },
    {
        id: 'business-word',
        severity: 'medium',
        description: '业务词汇残留（account/transaction/login...）',
        pattern: /\b(account|transaction|ledger|invoice|login|auth|expense|category)\b/gi,
        perHit: 6,
        maxPenalty: 30,
    },
    {
        id: 'console-eval',
        severity: 'medium',
        description: 'eval / new Function / console 泄露点残留',
        pattern: /console\s*\.\s*(?:log|warn|error|info|debug|trace)\s*\(|\beval\s*\(|new\s+Function\s*\(/g,
        perHit: 10,
        maxPenalty: 40,
    },
    {
        id: 'comment',
        severity: 'low',
        description: '代码注释残留（含凭据线索）',
        pattern: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
        perHit: 4,
        maxPenalty: 25,
    },
    {
        id: 'manifest-keys',
        severity: 'low',
        description: '明文清单结构（"dependencies": ... 等包元数据）',
        // 需要真正的键起始边界：否则 `filename:` 里的 `name:` 会被误判
        pattern: /(?:^|[{,\s])"?(?:dependencies|devDependencies|scripts|main|name|version)"?\s*:/g,
        perHit: 3,
        maxPenalty: 15,
    },
];
function runProbes(text) {
    const hits = [];
    let penalty = 0;
    for (const probe of exports.PROBES) {
        const pattern = new RegExp(probe.pattern.source, probe.pattern.flags.includes('g') ? probe.pattern.flags : probe.pattern.flags + 'g');
        const samples = [];
        let count = 0;
        let m;
        pattern.lastIndex = 0;
        while ((m = pattern.exec(text)) !== null) {
            count++;
            if (samples.length < 5)
                samples.push(m[0].slice(0, 80));
        }
        if (count > 0) {
            const p = Math.min(count * probe.perHit, probe.maxPenalty);
            penalty += p;
            hits.push({ probe, count, samples, penalty: p });
        }
    }
    return { hits, score: Math.max(0, 100 - penalty) };
}
