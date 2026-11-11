// 测试用：用 Node 自带的 SQLite 模拟 Cloudflare D1 数据库（prepare/bind/first/run/all、batch、exec），
// 并按顺序执行 backend/cloudflare/migrations 里的建表 SQL。
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS = new URL('../../backend/cloudflare/migrations/', import.meta.url)

/** D1 不接受 undefined；布尔值存成 0/1（和 D1 一样） */
const toSqlite = (value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value)

export function fakeD1() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }

  const run = (sql, args) => {
    const stmt = db.prepare(sql)
    const params = args.map(toSqlite)
    if (stmt.columns().length > 0) {
      const rows = stmt.all(...params).map((row) => ({ ...row }))
      return { results: rows, success: true, meta: { changes: rows.length, last_row_id: null } }
    }
    const info = stmt.run(...params)
    return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }
  }

  const statement = (sql, args = []) => ({
    sql,
    args,
    bind: (...a) => statement(sql, a),
    first: async (column) => {
      const row = run(sql, args).results[0] ?? null
      return column && row ? row[column] : row
    },
    run: async () => run(sql, args),
    all: async () => run(sql, args),
  })

  return {
    raw: db,
    prepare: (sql) => statement(sql),
    exec: async (sql) => {
      db.exec(sql)
      return { count: 1 }
    },
    // D1 的 batch 是一个事务：要么全成功，要么全不变
    batch: async (statements) => {
      db.exec('BEGIN')
      try {
        const results = statements.map((s) => run(s.sql, s.args))
        db.exec('COMMIT')
        return results
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
  }
}
