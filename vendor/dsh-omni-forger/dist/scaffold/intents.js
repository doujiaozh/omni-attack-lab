"use strict";
/**
 * Omni-Forger · forge_scaffold 意图层
 * 把一句自然语言解析成可执行的项目规格（ProjectSpec）。
 * 纯关键词推理，零外部 NLP 依赖 ——Win7 红线下的确定性选择。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseIntent = parseIntent;
const TYPE_RULES = [
    { test: /(全栈|full[\s-]?stack|全栈应用)/i, value: 'fullstack' },
    { test: /(命令行|cli|脚手架工具|命令工具)/i, value: 'cli' },
    { test: /(库|sdk|library|组件库|包)/i, value: 'library' },
    { test: /(网页|前端页面|展示页|落地页|官网|web app|website)/i, value: 'web' },
    { test: /(api|接口|后端|服务端|server|微服务|rest)/i, value: 'api' },
];
const DB_RULES = [
    { test: /(sqlite|轻量数据库|本地数据库)/i, value: 'sqlite' },
    { test: /(postgres|pg|pgsql)/i, value: 'postgres' },
    { test: /(mysql|maria)/i, value: 'mysql' },
    { test: /(mongo|文档数据库|mongodb)/i, value: 'mongo' },
    // 中文「数据库」兜底
    { test: /(数据库|database|db\b)/i, value: 'sqlite' },
];
const AUTH_RULES = [
    { test: /(jwt|json[\s-]?web[\s-]?token|token 鉴权|令牌)/i, value: 'jwt' },
    { test: /(oauth|第三方登录|sso)/i, value: 'oauth' },
    { test: /(session|会话鉴权|cookie)/i, value: 'session' },
    { test: /(鉴权|认证|登录|auth|login|授权)/i, value: 'jwt' },
];
const DOMAINS = [
    { keywords: /(记账|账本|记账本|ledger|accounting|expense|记账应用)/i, entities: ['account', 'transaction', 'category'], name: 'ledger' },
    { keywords: /(博客|blog|文章系统|专栏)/i, entities: ['post', 'comment', 'author'], name: 'blog' },
    { keywords: /(电商|商城|店铺|shop|store|ecommerce|订单系统)/i, entities: ['product', 'order', 'cart'], name: 'shop' },
    { keywords: /(任务|todo|待办|看板|kanban)/i, entities: ['task', 'board'], name: 'tasks' },
    { keywords: /(聊天|chat|即时通讯|消息系统|messaging)/i, entities: ['message', 'room', 'user'], name: 'chat' },
    { keywords: /(笔记|note|备忘)/i, entities: ['note', 'notebook'], name: 'notes' },
    { keywords: /(日历|calendar|日程|schedule)/i, entities: ['event', 'reminder'], name: 'calendar' },
    { keywords: /(文件|网盘|存储|drive|storage)/i, entities: ['file', 'folder'], name: 'drive' },
    { keywords: /(监控|monitor|指标|metrics|dashboard)/i, entities: ['metric', 'alert'], name: 'monitor' },
    { keywords: /(用户|user|账号|account 管理)/i, entities: ['user', 'role'], name: 'users' },
];
function singularize(word) {
    if (/s$/i.test(word) && !/(ss|us|is)$/i.test(word))
        return word.slice(0, -1);
    return word;
}
function toKebab(input) {
    return input
        .toLowerCase()
        .replace(/[^\w\s-]/g, ' ')
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 40) || 'omni-app';
}
/** 主解析入口：一句话 → ProjectSpec（opts 可省略，仅用于覆盖项目名/输出目录） */
function parseIntent(input, opts = {}) {
    var _a;
    const text = input.trim();
    let type = 'api';
    for (const rule of TYPE_RULES) {
        if (rule.test.test(text)) {
            type = rule.value;
            break;
        }
    }
    let db = null;
    for (const rule of DB_RULES) {
        if (rule.test.test(text)) {
            db = rule.value;
            break;
        }
    }
    let auth = null;
    for (const rule of AUTH_RULES) {
        if (rule.test.test(text)) {
            auth = rule.value;
            break;
        }
    }
    let entities = [];
    let domainName = '';
    for (const d of DOMAINS) {
        if (d.keywords.test(text)) {
            entities = [...d.entities];
            domainName = d.name;
            break;
        }
    }
    if (entities.length === 0) {
        // 兜底：从「XX 的 YY」模式抽取，或给通用实体
        const m = text.match(/(?:管理|管理|manage)\s*的?\s*([a-zA-Z\u4e00-\u9fa5]{2,8})/);
        if (m) {
            entities = [toKebab(m[1]) || 'item'];
            domainName = toKebab(m[1]);
        }
        else {
            entities = ['item'];
            domainName = 'app';
        }
    }
    // 无数据库时不应出现 DB 相关实体
    if (!db) {
        entities = entities.map((e) => e).filter(Boolean);
    }
    const websocket = /(websocket|ws|实时|推送|realtime|socket)/i.test(text);
    const graphql = /(graphql|gql)/i.test(text);
    const rateLimit = /(限流|rate[\s-]?limit|防刷|节流)/i.test(text);
    const validation = /(校验|验证|validation|参数检查)/i.test(text) || true;
    const framework = /(fastify)/i.test(text) ? 'fastify' : /(koa)/i.test(text) ? 'koa' : 'express';
    const language = /[\u4e00-\u9fa5]/.test(text) ? 'zh' : 'en';
    const name = opts.name
        ? toKebab(opts.name)
        : domainName
            ? `${domainName}-${type === 'api' ? 'api' : 'app'}`
            : toKebab(text.split(/\s+/).slice(0, 3).join(' ')) || 'omni-app';
    return {
        name,
        type,
        framework,
        language,
        auth,
        db,
        websocket,
        graphql,
        rateLimit,
        validation,
        entities: [...new Set(entities.map((e) => singularize(e)))],
        description: text,
        outDir: (_a = opts.outDir) !== null && _a !== void 0 ? _a : process.cwd(),
    };
}
