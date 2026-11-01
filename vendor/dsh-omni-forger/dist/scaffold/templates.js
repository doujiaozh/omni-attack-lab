"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFiles = buildFiles;
function tableize(entity) {
    if (/(s|x|z|ch|sh)$/i.test(entity))
        return entity + 'es';
    return entity + 's';
}
/** 领域实体的默认字段（id / 时间戳之外的业务列） */
const ENTITY_COLUMNS = {
    account: [['name', 'TEXT NOT NULL'], ['currency', 'TEXT DEFAULT \'CNY\''], ['balance', 'REAL DEFAULT 0']],
    transaction: [['amount', 'REAL NOT NULL'], ['note', 'TEXT'], ['category_id', 'INTEGER'], ['account_id', 'INTEGER']],
    category: [['name', 'TEXT NOT NULL'], ['type', 'TEXT DEFAULT \'expense\'']],
    user: [['email', 'TEXT UNIQUE NOT NULL'], ['password_hash', 'TEXT NOT NULL'], ['role', 'TEXT DEFAULT \'user\'']],
    role: [['name', 'TEXT UNIQUE NOT NULL'], ['permissions', 'TEXT']],
    post: [['title', 'TEXT NOT NULL'], ['content', 'TEXT'], ['author_id', 'INTEGER'], ['published', 'INTEGER DEFAULT 0']],
    comment: [['content', 'TEXT NOT NULL'], ['post_id', 'INTEGER'], ['author_id', 'INTEGER']],
    author: [['name', 'TEXT NOT NULL'], ['bio', 'TEXT']],
    product: [['name', 'TEXT NOT NULL'], ['price', 'REAL NOT NULL'], ['stock', 'INTEGER DEFAULT 0']],
    order: [['total', 'REAL DEFAULT 0'], ['status', 'TEXT DEFAULT \'pending\''], ['user_id', 'INTEGER']],
    cart: [['user_id', 'INTEGER'], ['items', 'TEXT']],
    task: [['title', 'TEXT NOT NULL'], ['done', 'INTEGER DEFAULT 0'], ['board_id', 'INTEGER']],
    board: [['name', 'TEXT NOT NULL']],
    message: [['content', 'TEXT NOT NULL'], ['room_id', 'INTEGER'], ['user_id', 'INTEGER']],
    room: [['name', 'TEXT NOT NULL']],
    note: [['title', 'TEXT'], ['content', 'TEXT']],
    notebook: [['name', 'TEXT NOT NULL']],
    event: [['title', 'TEXT NOT NULL'], ['start_at', 'TEXT'], ['end_at', 'TEXT']],
    reminder: [['content', 'TEXT'], ['remind_at', 'TEXT']],
    file: [['name', 'TEXT NOT NULL'], ['path', 'TEXT'], ['size', 'INTEGER DEFAULT 0'], ['folder_id', 'INTEGER']],
    folder: [['name', 'TEXT NOT NULL']],
    metric: [['name', 'TEXT NOT NULL'], ['value', 'REAL'], ['recorded_at', 'TEXT']],
    alert: [['message', 'TEXT'], ['level', 'TEXT DEFAULT \'info\'']],
    item: [['name', 'TEXT NOT NULL'], ['description', 'TEXT']],
};
function columnsFor(entity) {
    var _a;
    return (_a = ENTITY_COLUMNS[entity]) !== null && _a !== void 0 ? _a : [['name', 'TEXT NOT NULL'], ['description', 'TEXT']];
}
function depsFor(spec) {
    const deps = {};
    deps[spec.framework] = '^4';
    if (spec.framework === 'express')
        deps.express = '^4.19.2';
    if (spec.framework === 'fastify') {
        deps.fastify = '^4.27.0';
        delete deps.express;
    }
    if (spec.framework === 'koa') {
        deps.koa = '^2.15.0';
        deps['@koa/router'] = '^12.0.1';
        deps['koa-bodyparser'] = '^5.0.0';
        delete deps.express;
    }
    if (spec.auth === 'jwt')
        deps.jsonwebtoken = '^9.0.2';
    if (spec.auth === 'oauth')
        deps.passport = '^0.7.0';
    if (spec.db === 'sqlite')
        deps['better-sqlite3'] = '^11.0.0';
    if (spec.db === 'postgres')
        deps.pg = '^8.12.0';
    if (spec.db === 'mysql')
        deps.mysql2 = '^3.10.0';
    if (spec.db === 'mongo')
        deps.mongoose = '^8.5.0';
    if (spec.websocket)
        deps.ws = '^8.18.0';
    if (spec.validation)
        deps.zod = '^3.23.8';
    if (spec.rateLimit)
        deps['express-rate-limit'] = '^7.4.0';
    return deps;
}
function devDepsFor(spec) {
    const dev = {
        typescript: '^5.4.0',
        '@types/node': '^20.11.0',
    };
    if (spec.framework === 'express')
        dev['@types/express'] = '^4.17.21';
    if (spec.auth === 'jwt')
        dev['@types/jsonwebtoken'] = '^9.0.6';
    return dev;
}
function scriptsFor(spec) {
    return {
        build: 'tsc -p tsconfig.json',
        start: 'node dist/index.js',
        dev: 'node src/index.ts',
    };
}
function pkgJson(spec) {
    return JSON.stringify({
        name: spec.name,
        version: '0.1.0',
        description: spec.description,
        type: 'commonjs',
        main: 'dist/index.js',
        scripts: scriptsFor(spec),
        dependencies: depsFor(spec),
        devDependencies: devDepsFor(spec),
        license: 'MIT',
    }, null, 2);
}
function tsconfig() {
    return JSON.stringify({
        compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
            lib: ['ES2020'],
            outDir: 'dist',
            rootDir: 'src',
            strict: false,
            noImplicitAny: false, // 生成的项目不强制安装 @types，避免 tsc 噪音阻断流水线
            esModuleInterop: true,
            skipLibCheck: true,
            resolveJsonModule: true,
        },
        include: ['src/**/*.ts'],
    }, null, 2);
}
function envExample(spec) {
    const lines = [
        '# Omni-Forger 生成 · 永远不要把真实密钥提交进仓库',
        'PORT=3000',
        'NODE_ENV=development',
        'JWT_SECRET=change-me-in-production-please',
    ];
    if (spec.db === 'postgres')
        lines.push('DATABASE_URL=postgres://user:pass@localhost:5432/' + spec.name);
    if (spec.db === 'mysql')
        lines.push('DATABASE_URL=mysql://user:pass@localhost:3306/' + spec.name);
    if (spec.db === 'mongo')
        lines.push('MONGO_URL=mongodb://localhost:27017/' + spec.name);
    if (spec.db === 'sqlite')
        lines.push('DB_PATH=./data/' + spec.name + '.db');
    return lines.join('\n') + '\n';
}
function configTs(spec) {
    return `/**
 * ${spec.name} · 配置入口（从环境变量读取，绝不硬编码密钥）
 */
export interface AppConfig {
  port: number;
  env: string;
  jwtSecret: string;
  ${spec.db === 'postgres' || spec.db === 'mysql' ? 'databaseUrl: string;\n' : ''}${spec.db === 'mongo' ? 'mongoUrl: string;\n' : ''}${spec.db === 'sqlite' ? 'dbPath: string;\n' : ''}}

export function loadConfig(): AppConfig {
  const required = (key: string, fallback?: string): string => {
    const v = process.env[key] ?? fallback;
    if (v === undefined) throw new Error('Missing env: ' + key);
    return v;
  };
  return {
    port: Number(required('PORT', '3000')),
    env: required('NODE_ENV', 'development'),
    jwtSecret: required('JWT_SECRET', process.env.NODE_ENV === 'production' ? undefined : 'omni-forger-dev-secret-do-not-use-in-prod'),${spec.db === 'postgres' || spec.db === 'mysql'
        ? "\n    databaseUrl: required('DATABASE_URL'),"
        : ''}${spec.db === 'mongo' ? "\n    mongoUrl: required('MONGO_URL')," : ''}${spec.db === 'sqlite' ? "\n    dbPath: required('DB_PATH', './data/" + spec.name + ".db')," : ''}
  };
}

export const config = loadConfig();
`;
}
function schemaSql(spec) {
    const tables = [];
    if (spec.db && (spec.db === 'sqlite' || spec.db === 'postgres' || spec.db === 'mysql') && spec.entities.length) {
        for (const ent of spec.entities) {
            const cols = columnsFor(ent);
            const auto = spec.db === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'SERIAL PRIMARY KEY';
            const intType = spec.db === 'postgres' ? 'INTEGER' : 'INTEGER';
            const body = cols
                .map(([name, type]) => `  ${name} ${type.replace(/INTEGER/g, intType)}`)
                .join(',\n');
            tables.push(`CREATE TABLE IF NOT EXISTS ${tableize(ent)} (\n  id ${auto},\n${body},\n  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),\n  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))\n);`);
        }
    }
    if (tables.length === 0) {
        tables.push('-- 本项目未启用关系型数据库，此文件保留为占位。');
    }
    return `-- ${spec.name} · 数据库 Schema（Omni-Forger 生成）\n\n` + tables.join('\n\n') + '\n';
}
function dbTs(spec) {
    if (spec.db === 'sqlite') {
        return `/**
 * SQLite 数据层（better-sqlite3，同步 API）
 * 带优雅降级：缺少预编译二进制（打包外置后宿主机未装）时服务仍可启动，
 * 仅数据库接口返回 503 —— 绝不为数据库把整个进程拖死。
 */
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

let db: any = null;
try {
  const BetterSqlite = require('better-sqlite3');
  db = new BetterSqlite(config.dbPath);
  db.pragma('journal_mode = WAL');
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) db.exec(fs.readFileSync(schemaPath, 'utf8'));
} catch (e) {
  process.stderr.write('[omni-forger] 原生 SQLite 不可用（缺少预编译二进制？），数据库接口将返回 503。\\n');
}

export function isDbReady(): boolean {
  return db !== null;
}

export function queryAll<T = any>(sql: string, params: any[] = []): T[] {
  if (!db) throw new Error('SQLite unavailable on this host');
  return db.prepare(sql).all(...params) as T[];
}

export function queryRun(sql: string, params: any[] = []): any {
  if (!db) throw new Error('SQLite unavailable on this host');
  return db.prepare(sql).run(...params);
}

export function queryOne<T = any>(sql: string, params: any[] = []): T | undefined {
  if (!db) throw new Error('SQLite unavailable on this host');
  return db.prepare(sql).get(...params) as T | undefined;
}
`;
    }
    if (spec.db === 'postgres' || spec.db === 'mysql') {
        const lib = spec.db === 'postgres' ? 'pg' : 'mysql2/promise';
        return `/**
 * ${spec.db} 数据层（连接池）
 */
import { Pool } from '${lib}';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl });

export async function queryAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return (res.rows ?? res[0]) as T[];
}

export async function queryRun(sql: string, params: any[] = []): Promise<any> {
  return pool.query(sql, params);
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  const rows = await queryAll<T>(sql, params);
  return rows[0];
}
`;
    }
    if (spec.db === 'mongo') {
        return `/**
 * MongoDB 数据层（mongoose）
 */
import * as mongoose from 'mongoose';
import { config } from './config';

export async function connectMongo(): Promise<void> {
  await mongoose.connect(config.mongoUrl);
}

export { mongoose };
`;
    }
    return `/**
 * 无数据库项目 · 数据层占位
 */
export const placeholder = true;
`;
}
function authMiddlewareTs(spec) {
    if (spec.auth === 'jwt') {
        return `/**
 * JWT 鉴权中间件
 */
import * as jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthRequest {
  userId?: number;
  headers: any;
}

export function authMiddleware(req: any, res: any, next: any): void {
  const header = req.headers['authorization'] as string | undefined;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing token' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: number };
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
}

export function signToken(userId: number): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '7d' });
}
`;
    }
    return `/** 本项目未启用鉴权，占位文件 */\nexport const authPlaceholder = true;\n`;
}
function routerTs(spec, entity) {
    const table = tableize(entity);
    const cols = columnsFor(entity).map(([n]) => n);
    const routePath = ``;
    const authLine = spec.auth === 'jwt' ? `${entity}Router.use(authMiddleware);\n` : '';
    const zodLine = spec.validation ? `const createSchema = z.object({ ${cols.map((c) => `${c}: z.unknown().optional()`).join(', ')} });\n` : '';
    return `/**
 * ${entity} 路由 · 自动生成 CRUD（统一 try/catch，数据库不可用时返回 503 而非崩进程）
 */
import { Router } from 'express';
${spec.validation
        ? "import { z } from 'zod';\n"
        : ''}${spec.auth === 'jwt' ? "import { authMiddleware } from '../middleware/auth';\n" : ''}${spec.db === 'mongo'
        ? "import { mongoose } from '../db';\n"
        : "import { queryAll, queryOne, queryRun, isDbReady } from '../db';\n"}
export const ${entity}Router = Router();
const base = '';
${authLine}${zodLine}
${entity}Router.get(base, async (req: any, res: any) => {
  try {
    ${spec.db === 'mongo'
        ? `const rows = await mongoose.connection.collection('${table}').find({}).toArray();`
        : `const rows = queryAll('SELECT * FROM ${table}');`}
    res.json(rows);
  } catch (e) {
    res.status(503).json({ error: (e as Error).message });
  }
});

${entity}Router.get(base + '/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    ${spec.db === 'mongo'
        ? `const row = await mongoose.connection.collection('${table}').findOne({ _id: id });`
        : `const row = queryOne('SELECT * FROM ${table} WHERE id = ?', [id]);`}
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) {
    res.status(503).json({ error: (e as Error).message });
  }
});

${entity}Router.post(base, async (req: any, res: any) => {
  try {
    const body = ${spec.validation ? 'createSchema.parse(req.body)' : 'req.body'};
    ${spec.db === 'mongo'
        ? `const result = await mongoose.connection.collection('${table}').insertOne(body);\n    res.status(201).json(result);`
        : `const keys = [${cols.map((c) => `'${c}'`).join(', ')}];\n    const vals = keys.map((k) => (body as any)[k] ?? null);\n    const result = queryRun('INSERT INTO ${table} (${cols.join(', ')}) VALUES (${'?'.repeat(cols.length).split('').join(', ')})', vals);\n    res.status(201).json({ id: (result as any).lastInsertRowid });`}
  } catch (e) {
    res.status(503).json({ error: (e as Error).message });
  }
});

${entity}Router.put(base + '/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    const body = ${spec.validation ? 'createSchema.parse(req.body)' : 'req.body'};
    ${spec.db === 'mongo'
        ? `await mongoose.connection.collection('${table}').updateOne({ _id: id }, { $set: body });`
        : `const keys = [${cols.map((c) => `'${c}'`).join(', ')}];\n    const sets = keys.map((k) => k + ' = ?').join(', ');\n    const vals = keys.map((k) => (body as any)[k] ?? null);\n    queryRun('UPDATE ${table} SET ' + sets + ' WHERE id = ?', [...vals, id]);`}
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ error: (e as Error).message });
  }
});

${entity}Router.delete(base + '/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    ${spec.db === 'mongo'
        ? `await mongoose.connection.collection('${table}').deleteOne({ _id: id });`
        : `queryRun('DELETE FROM ${table} WHERE id = ?', [id]);`}
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ error: (e as Error).message });
  }
});
`;
}
function indexTs(spec) {
    const routerImports = spec.entities
        .map((e) => `import { ${e}Router } from './routes/${e}';`)
        .join('\n');
    const routerUses = spec.entities.map((e) => `app.use('/api/${tableize(e)}', ${e}Router);`).join('\n  ');
    const authImport = spec.auth === 'jwt'
        ? "import { authMiddleware, signToken } from './middleware/auth';\nimport { config } from './config';\n"
        : '';
    const authRoute = spec.auth === 'jwt'
        ? `
// 登录签发 JWT（示例：id 为 1 的用户）
app.post('/api/login', (req: any, res: any) => {
  const token = signToken(1);
  res.json({ token });
});
app.get('/api/me', authMiddleware, (req: any, res: any) => {
  res.json({ userId: req.userId });
});
`
        : '';
    const wsBlock = spec.websocket
        ? `
const wss = new WebSocketServer({ server });
wss.on('connection', (ws: any) => {
  ws.on('message', (data: any) => {
    wss.clients.forEach((client: any) => {
      if (client.readyState === 1) client.send(String(data));
    });
  });
});
`
        : '';
    return `/**
 * ${spec.name} · 应用入口（Omni-Forger 生成）
 */
import express = require('express');
${spec.websocket
        ? "import { WebSocketServer } from 'ws';\n"
        : ''}${authImport}${routerImports}

const app = express();
app.use(express.json());

app.get('/health', (req: any, res: any) => {
  res.json({ status: 'ok', app: '${spec.name}' });
});

${authRoute}
${routerUses || '// 无业务路由'}

const PORT = Number(process.env.PORT ?? 3000);
const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log('[${spec.name}] listening on :' + PORT);
});
${wsBlock}
export { app, server };
`;
}
function dockerfile(spec) {
    return `# Omni-Forger 生成 · 多阶段构建
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/schema.sql ./dist/schema.sql
EXPOSE 3000
CMD ["node", "dist/index.js"]
`;
}
function ciYml(spec) {
    return `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm test${spec.db === 'sqlite' ? '\n        env:\n          JWT_SECRET: ci-secret\n          DB_PATH: ./data/ci.db' : ''}
`;
}
function composeYml(spec) {
    const dbBlock = spec.db === 'postgres'
        ? `\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_USER: user\n      POSTGRES_PASSWORD: pass\n      POSTGRES_DB: ${spec.name}\n    ports:\n      - '5432:5432'\n    volumes:\n      - pgdata:/var/lib/postgresql/data\nvolumes:\n  pgdata:\n`
        : spec.db === 'mysql'
            ? `\n  db:\n    image: mysql:8\n    environment:\n      MYSQL_ROOT_PASSWORD: pass\n      MYSQL_DATABASE: ${spec.name}\n    ports:\n      - '3306:3306'\n`
            : spec.db === 'mongo'
                ? `\n  db:\n    image: mongo:7\n    ports:\n      - '27017:27017'\n`
                : '';
    return `# Omni-Forger 生成 · 本地编排
services:
  app:
    build: .
    ports:
      - '3000:3000'
    environment:
      NODE_ENV: production
      JWT_SECRET: \${JWT_SECRET}${dbBlock ? `\n      ${spec.db === 'mongo' ? 'MONGO_URL' : 'DATABASE_URL'}: ${spec.db === 'mongo' ? 'mongodb://db:27017/' + spec.name : spec.db === 'postgres' ? 'postgres://user:pass@db:5432/' + spec.name : 'mysql://root:pass@db:3306/' + spec.name}` : ''}${spec.db === 'sqlite' ? `\n      DB_PATH: /data/${spec.name}.db` : ''}
    depends_on:\n      - db${dbBlock ? '' : ''}
${dbBlock}`;
}
function readme(spec) {
    return `# ${spec.name}

> 由 Omni-Forger 从一句话生成：${spec.description}

## 开发

\`\`\`bash
npx tsc -w        # 类型检查 + 编译到 dist
npm start         # node dist/index.js
\`\`\`

默认端口 3000，健康检查 \`GET /health\`。
${spec.auth === 'jwt' ? '\n鉴权：`POST /api/login` 拿 token，后续请求带 `Authorization: Bearer <token>`。\n' : ''}
`;
}
/** 组装整个项目的文件映射（相对路径 -> 内容） */
function buildFiles(spec) {
    const files = {};
    files['package.json'] = pkgJson(spec);
    files['tsconfig.json'] = tsconfig();
    files['.env.example'] = envExample(spec);
    files['.gitignore'] = 'node_modules/\ndist/\ndata/\n.env\n*.log\n';
    files['README.md'] = readme(spec);
    files['src/config.ts'] = configTs(spec);
    files['src/index.ts'] = indexTs(spec);
    files['src/db.ts'] = dbTs(spec);
    files['src/schema.sql'] = schemaSql(spec);
    if (spec.auth)
        files['src/middleware/auth.ts'] = authMiddlewareTs(spec);
    for (const ent of spec.entities) {
        files[`src/routes/${ent}.ts`] = routerTs(spec, ent);
    }
    files['Dockerfile'] = dockerfile(spec);
    files['.github/workflows/ci.yml'] = ciYml(spec);
    if (spec.db && spec.db !== 'sqlite') {
        files['docker-compose.yml'] = composeYml(spec);
    }
    return files;
}
