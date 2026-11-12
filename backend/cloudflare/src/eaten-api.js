// 吃过记录跟账号走（阶段 4-5，REQUIREMENTS.md R-025）。
//
//   POST /api/my/eaten/sync  { userId, ops: [...] }  要登录。按顺序执行网页攒下的改动，再返回账号里现在的全部记录：
//     { type: 'add', uid, id, label, at }   记一条（点“就吃这个”）。不收的：uid 已经有了（重发）、uid 删过（撤销过）、
//                                           at 不晚于最近一次清空、at 超过 31 天——所以重发、晚到的改动不会让删掉的记录复活
//     { type: 'remove', uid }               删一条（撤销“就吃这个”），并留下删除记号
//     { type: 'clear', at }                 清空：删掉 at 之前（含）记的，之后别的手机新记的留着；记下“清到哪儿了”。
//                                           “以后不再收”的边界最多算到后台的“现在”（Codex 第 48 轮：手机时间快了的话，
//                                           会把之后正常记的都挡掉）
//   返回 { userId, version, records: [{ uid, id, label, at }] }（30 天内、最多 200 条，从旧到新）。
//   version：这个账号的记录版本号，每次同步加 1，和记录在同一个事务里读出；网页用它判断哪份记录更新
//
// 网页连不上时改动先攒在本机，连上再一起发（用户 2026-11-12 选 2A）。
// userId：这些改动是谁的（网页登录时记下的账号编号）。有改动时必须带上，和现在登录的人对不上就不执行，
// 回 409 和现在的 userId（Codex 第 47 轮：不能把上一个账号攒下的改动记到别人头上）。不带改动时可以不带，用来拿记录。

import { json, readJson, TOO_LARGE } from './http.js'
import { currentUser } from './my-menu-api.js'
import { eatenSyncLimits, takeQuotas } from './send-limits.js'

const BODY_LIMIT = 64 * 1024
const MAX_OPS = 200
/** 账号里留多少：和本机一样 30 天、200 条（用户选 4A）；多留一天，免得时区不同时把网页还要的删掉 */
const KEEP_MS = 31 * 24 * 60 * 60 * 1000
const MAX_RECORDS = 200
const UID_RE = /^[A-Za-z0-9_-]{8,64}$/

const isText = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max
const atMs = (at) => (typeof at === 'string' && at.length <= 40 ? Date.parse(at) : Number.NaN)

/** 检查一条改动；不对返回 null */
function checkOp(op) {
  if (!op || typeof op !== 'object') return null
  if (op.type === 'add') {
    const ms = atMs(op.at)
    if (!UID_RE.test(op.uid ?? '') || !isText(op.id, 200) || Number.isNaN(ms)) return null
    const label = typeof op.label === 'string' ? op.label.slice(0, 100) : null
    return { type: 'add', uid: op.uid, id: op.id, label, at: new Date(ms).toISOString(), ms }
  }
  if (op.type === 'remove') return UID_RE.test(op.uid ?? '') ? { type: 'remove', uid: op.uid } : null
  if (op.type === 'clear') {
    const ms = atMs(op.at)
    return Number.isNaN(ms) ? null : { type: 'clear', ms }
  }
  return null
}

/**
 * 处理吃过记录的接口；不是这些接口返回 null。
 */
export async function eatenRoute(method, path, request, env, getAuth, now, started, cors) {
  if (path !== '/api/my/eaten/sync') return null
  const reply = (body, status = 200) => json(body, status, started, cors)
  if (method !== 'POST') return reply({ error: '没有这个接口' }, 404)

  const user = await currentUser(request, getAuth())
  if (!user) return reply({ error: '请先登录' }, 401)
  const body = await readJson(request, BODY_LIMIT)
  if (body === TOO_LARGE) return reply({ error: '一次发的改动太多了' }, 413)
  const rawOps = Array.isArray(body?.ops) ? body.ops : null
  if (!rawOps) return reply({ error: '格式不对' }, 400)
  if (rawOps.length > MAX_OPS) return reply({ error: '一次发的改动太多了' }, 413)
  if (rawOps.length > 0 && body.userId !== user.id) {
    return reply({ error: '这些改动不是现在登录的账号的，不上传', userId: user.id }, 409)
  }
  const ops = rawOps.map(checkOp)
  if (ops.some((op) => op === null)) return reply({ error: '改动的格式不对' }, 400)
  if (!(await takeQuotas(env, eatenSyncLimits(user.id), now))) return reply({ error: '同步得太频繁了，请过一会儿再试' }, 429)

  const keepFrom = now - KEEP_MS
  const statements = ops.map((op) => {
    if (op.type === 'add') {
      return env.DB.prepare(
        `INSERT INTO eaten_records (user_id, uid, dish_id, label, at, at_ms, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
         WHERE ?6 >= ?8
           AND NOT EXISTS (SELECT 1 FROM eaten_deleted WHERE user_id = ?1 AND uid = ?2)
           AND ?6 > COALESCE((SELECT cleared_before FROM eaten_state WHERE user_id = ?1), -1)
         ON CONFLICT(user_id, uid) DO NOTHING`,
      ).bind(user.id, op.uid, op.id, op.label, op.at, op.ms, now, keepFrom)
    }
    if (op.type === 'remove') {
      return [
        env.DB.prepare('INSERT INTO eaten_deleted (user_id, uid, deleted_at) VALUES (?, ?, ?) ON CONFLICT(user_id, uid) DO NOTHING')
          .bind(user.id, op.uid, now),
        env.DB.prepare('DELETE FROM eaten_records WHERE user_id = ? AND uid = ?').bind(user.id, op.uid),
      ]
    }
    // 删：按手机点清空的那一刻，删掉已有的（包括手机时间快了记的“未来”记录，Codex 第 49 轮）；
    //     这些“未来”记录超出了下面的边界，给它们留删除记号，晚到的重发不会复活
    // 以后不再收的边界：最多到后台的“现在”（Codex 第 48 轮：手机时间快了不能锁住之后正常记的）
    const until = Math.min(op.ms, now)
    return [
      env.DB.prepare(
        `INSERT INTO eaten_deleted (user_id, uid, deleted_at)
         SELECT user_id, uid, ?3 FROM eaten_records WHERE user_id = ?1 AND at_ms > ?2 AND at_ms <= ?4
         ON CONFLICT(user_id, uid) DO NOTHING`,
      ).bind(user.id, until, now, op.ms),
      env.DB.prepare(
        `INSERT INTO eaten_state (user_id, cleared_before) VALUES (?1, ?2)
         ON CONFLICT(user_id) DO UPDATE SET cleared_before = MAX(cleared_before, excluded.cleared_before)`,
      ).bind(user.id, until),
      env.DB.prepare('DELETE FROM eaten_records WHERE user_id = ? AND at_ms <= ?').bind(user.id, Math.max(op.ms, until)),
    ]
  }).flat()
  // 顺便清理：太旧的记录、超过 200 条的、太旧的删除记号
  statements.push(
    env.DB.prepare('DELETE FROM eaten_records WHERE user_id = ? AND at_ms < ?').bind(user.id, keepFrom),
    env.DB.prepare(
      `DELETE FROM eaten_records WHERE user_id = ? AND uid NOT IN (
         SELECT uid FROM eaten_records WHERE user_id = ? ORDER BY at_ms DESC, uid DESC LIMIT ?)`,
    ).bind(user.id, user.id, MAX_RECORDS),
    env.DB.prepare('DELETE FROM eaten_deleted WHERE user_id = ? AND deleted_at < ?').bind(user.id, keepFrom),
  )
  // 版本号：每次同步加 1，和记录在同一个事务里读出来，网页按它判断哪份记录更新（Codex 第 49 轮：
  // 后台时间可能同一毫秒，先开始的请求也可能后做完，不能当版本用）
  statements.push(
    env.DB.prepare(
      `INSERT INTO eaten_state (user_id, cleared_before, version) VALUES (?, -1, 1)
       ON CONFLICT(user_id) DO UPDATE SET version = version + 1`,
    ).bind(user.id),
    env.DB.prepare('SELECT version FROM eaten_state WHERE user_id = ?').bind(user.id),
    env.DB.prepare('SELECT uid, dish_id, label, at FROM eaten_records WHERE user_id = ? ORDER BY at_ms, uid').bind(user.id),
  )
  // 一个事务里做完：要么这批改动全生效，要么全不生效（网页没收到成功就会整批重发，add 按 uid 不会重复）
  const results = await env.DB.batch(statements)
  const version = results.at(-2).results[0].version
  const rows = results.at(-1).results
  return reply({
    userId: user.id,
    version,
    records: rows.map((r) => ({ uid: r.uid, id: r.dish_id, label: r.label, at: r.at })),
  })
}
