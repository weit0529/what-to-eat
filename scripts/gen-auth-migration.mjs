// 生成登录（Better Auth）要用的建表 SQL，写到 backend/cloudflare/migrations/0003_auth.sql。
// 只在第一次、或者以后改了 auth-setup.js 里的插件时运行：node scripts/gen-auth-migration.mjs
// 原理：在内存里建一个空的 SQLite 数据库，让 Better Auth 算出要建哪些表，把 SQL 存下来。
// 存下来的 SQL 文件要人看一遍再提交（它决定线上数据库的表结构）。

import { writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { getMigrations } from 'better-auth/db/migration'
import { authOptions } from '../backend/cloudflare/src/auth-setup.js'

const out = new URL('../backend/cloudflare/migrations/0003_auth.sql', import.meta.url)
const options = authOptions({
  DB: new DatabaseSync(':memory:'),
  BETTER_AUTH_SECRET: 'only-for-generating-sql-only-for-generating-sql',
  AUTH_BASE_URL: 'http://localhost',
  ALLOWED_ORIGINS: '',
})
const { compileMigrations } = await getMigrations(options)
const sql = await compileMigrations()
const header = `-- 登录（Better Auth 1.7.18，插件：username、admin、bearer；登录次数限制存数据库）要用的表。
-- 由 scripts/gen-auth-migration.mjs 生成，不要手改；改了 auth-setup.js 的插件后重新生成。
-- 表名、列名是 Better Auth 定的（user、session、account、verification、rateLimit）。

`
writeFileSync(out, header + sql.trim().replace(/;\s*(?=\S)/g, ';\n') + '\n')
console.log(`已写出 ${out.pathname}`)
