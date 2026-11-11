// 普通用户注册和邀请码（阶段 4-3，REQUIREMENTS.md R-022、D-03）。
//
// 注册分两步（用户 2026-11-10 选 2A：注册时先确认邮箱是自己的）：
//   POST /api/account/send-code  { invite, email }                         检查邀请码，往邮箱发 6 位验证码
//   POST /api/account/register   { invite, email, code, username, password }  验证码对了才建账号，邀请码作废
// 管理员（要登录、role = admin）：
//   GET    /api/admin/invites      邀请码列表（只显示最后 4 位）
//   POST   /api/admin/invites      生成一个邀请码（原文只在这一次返回）
//   DELETE /api/admin/invites/:id  作废一个还没用的邀请码
//
// 邀请码 7 天有效、用一次就作废（用户选 3A）。邀请码和验证码在库里都只存哈希。
// 登录、找回密码走 Better Auth（auth-setup.js）。

import { isAllowedEmail, USERNAME_RE } from './auth-setup.js'
import { hashToken, randomHex } from './auth.js'
import { json, readJson, TOO_LARGE } from './http.js'
import { codeMail, sendMail } from './mailer.js'
import { signupLimits, takeQuotas } from './send-limits.js'

const BODY_LIMIT = 4 * 1024
const INVITE_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
/** 注册验证码：10 分钟有效，最多试 5 次（发送次数的限制见 send-limits.js） */
const CODE_MS = 10 * 60 * 1000
const CODE_TRIES = 5
/** 邀请码用的字符：去掉容易看错的 0/O、1/l/I */
const INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const INVITE_LENGTH = 8

/** 统一邮箱写法：去空格、转小写 */
const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '')
/** 统一邀请码写法：去空格和横线、转大写（用户抄写时可能带空格或小写） */
const normalizeInvite = (value) => (typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : '')

/** 随机邀请码 */
function newInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_LENGTH))
  return [...bytes].map((b) => INVITE_CHARS[b % INVITE_CHARS.length]).join('')
}

/** 随机 6 位数字验证码 */
function newCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000
  return String(n).padStart(6, '0')
}

/** 验证码的哈希和邮箱绑在一起，换个邮箱就对不上 */
const codeHash = (email, code) => hashToken(`${email}\u0000${code}`)

/** 有效的邀请码（没用过、没作废、没过期）；没有返回 null */
async function findValidInvite(env, invite, now) {
  if (!invite) return null
  return env.DB.prepare(
    'SELECT id FROM invites WHERE code_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?',
  )
    .bind(await hashToken(invite), now)
    .first()
}

async function requireAdmin(request, auth) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return { error: '请先登录', status: 401 }
  if (session.user.role !== 'admin') return { error: '只有管理员能做这件事', status: 403 }
  return { user: session.user }
}

/**
 * 处理注册和邀请码的接口；不是这些接口返回 null。
 */
export async function accountRoute(method, path, request, env, getAuth, now, started, cors) {
  const reply = (body, status = 200) => json(body, status, started, cors)

  if (method === 'POST' && path === '/api/account/send-code') {
    const body = await readJson(request, BODY_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '请求太大' }, 413)
    const email = normalizeEmail(body?.email)
    const invite = normalizeInvite(body?.invite)
    if (!isAllowedEmail(email)) return reply({ error: '邮箱格式不对' }, 400)
    if (!(await findValidInvite(env, invite, now))) return reply({ error: '邀请码不对，或者已经用过、过期了' }, 400)
    const taken = await env.DB.prepare('SELECT 1 FROM "user" WHERE lower(email) = ?').bind(email).first()
    if (taken) return reply({ error: '这个邮箱已经注册过了。忘了密码的话，用“找回密码”' }, 409)
    // 先抢发信名额（60 秒冷却、邮箱 / IP / 全站上限），判断和占用在同一条 SQL 里，并发请求挤不过去（Codex 第 31 轮）；
    // 没抢到就不换验证码、不发信
    const ip = request.headers.get('cf-connecting-ip') || 'unknown'
    if (!(await takeQuotas(env, signupLimits(email, ip), now))) {
      return reply({ error: '验证码刚发过，或者发的次数太多了，请过一会儿再试' }, 429)
    }

    const code = newCode()
    await env.DB.prepare(
      `INSERT INTO signup_codes (email, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`,
    )
      .bind(email, await codeHash(email, code), now + CODE_MS, now)
      .run()
    try {
      await sendMail(env, { to: email, ...codeMail('register', code, CODE_MS / 60000) })
    } catch (err) {
      console.error('发注册验证码失败', err)
      await env.DB.prepare('DELETE FROM signup_codes WHERE email = ?').bind(email).run()
      return reply({ error: '验证码没发出去，请稍后再试。如果一直不行，请联系管理员' }, 502)
    }
    return reply({ ok: true })
  }

  if (method === 'POST' && path === '/api/account/register') {
    const body = await readJson(request, BODY_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '请求太大' }, 413)
    const email = normalizeEmail(body?.email)
    const invite = normalizeInvite(body?.invite)
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!USERNAME_RE.test(username)) return reply({ error: '用户名要 2～20 个字，只能用中文、英文字母、数字、下划线' }, 400)
    if (password.length < 8 || password.length > 64) return reply({ error: '密码要 8～64 位' }, 400)
    if (!isAllowedEmail(email) || !/^\d{6}$/.test(code)) return reply({ error: '邮箱或验证码不对' }, 400)

    // 验证码：先数一次尝试，再比对（同一条 SQL 里累加，并发也不会多试）
    const counted = await env.DB.prepare(
      'UPDATE signup_codes SET attempts = attempts + 1 WHERE email = ? AND expires_at > ? AND attempts < ?',
    )
      .bind(email, now, CODE_TRIES)
      .run()
    if (counted.meta.changes === 0) return reply({ error: '验证码过期了或者试错太多次，请重新要一个' }, 400)
    const row = await env.DB.prepare('SELECT code_hash FROM signup_codes WHERE email = ?').bind(email).first()
    if (!row || row.code_hash !== (await codeHash(email, code))) return reply({ error: '验证码不对' }, 400)

    const nameTaken = await env.DB.prepare('SELECT 1 FROM "user" WHERE username = ?').bind(username.toLowerCase()).first()
    if (nameTaken) return reply({ error: '这个用户名已经有人用了，换一个' }, 409)
    const emailTaken = await env.DB.prepare('SELECT 1 FROM "user" WHERE lower(email) = ?').bind(email).first()
    if (emailTaken) return reply({ error: '这个邮箱已经注册过了' }, 409)

    // 邀请码在同一条 SQL 里判断有效并占用：两个人同时用同一个码，只有一个成功
    const inviteHash = await hashToken(invite)
    const used = await env.DB.prepare(
      `UPDATE invites SET used_at = ?, used_by = ?
       WHERE code_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    )
      .bind(now, `pending:${username}`, inviteHash, now)
      .run()
    if (used.meta.changes === 0) return reply({ error: '邀请码不对，或者已经用过、过期了' }, 400)

    let userId = null
    try {
      const { user } = await getAuth().api.createUser({
        body: {
          email,
          password,
          name: username,
          role: 'user',
          data: { username: username.toLowerCase(), displayUsername: username, emailVerified: true },
        },
      })
      userId = user.id
    } catch (err) {
      // createUser 不是一个事务（先写 user，再写密码；D1 上 Better Auth 不开事务），报错时可能：
      // 什么都没写 / 只写了 user / 都写好了只是回应丢了。查清楚再决定邀请码怎么办（Codex 第 31、32 轮）
      const message = String(err?.body?.message || err?.message || '')
      const conflict = /exist|already|unique/i.test(message)
      const fail = (error, status) => reply({ error }, status)
      // 查不清的时候不还邀请码：宁可浪费一个码，也不能一个码注册两个人
      const unknown = () => fail('注册时出错了，不确定账号建好没有。请先试试登录；登录不了请联系管理员', 500)
      let found
      try {
        found = await env.DB.prepare(
          `SELECT u.id, EXISTS (
             SELECT 1 FROM "account" a WHERE a."userId" = u.id AND a."providerId" = 'credential' AND a.password IS NOT NULL
           ) AS complete
           FROM "user" u WHERE u.username = ? AND lower(u.email) = ?`,
        )
          .bind(username.toLowerCase(), email)
          .first()
      } catch (checkErr) {
        console.error('建账号报错，查账号在不在也出错', err, checkErr)
        return unknown()
      }

      if (found?.complete) {
        // 账号和密码都写好了，只是回应出了错：注册算成功
        console.error('建账号时报错，但账号已经建好了', err)
        userId = found.id
      } else {
        if (found && !conflict) {
          // 只写了 user、没有密码：谁也登录不了，删掉这个半成品，让用户能重新注册
          // （报“已存在”时查到的可能是别人正在建的账号，不能删）
          try {
            const removed = await env.DB.prepare(
              'DELETE FROM "user" WHERE id = ? AND NOT EXISTS (SELECT 1 FROM "account" WHERE "userId" = ?)',
            )
              .bind(found.id, found.id)
              .run()
            if (removed.meta.changes === 0) return unknown()
          } catch (delErr) {
            console.error('删掉只建了一半的账号时出错', err, delErr)
            return unknown()
          }
        }
        console.error('建账号失败，邀请码还回去', err)
        await env.DB.prepare('UPDATE invites SET used_at = NULL, used_by = NULL WHERE code_hash = ? AND used_by = ?')
          .bind(inviteHash, `pending:${username}`)
          .run()
        if (conflict) return fail('这个用户名或邮箱已经有人用了', 409)
        return fail('注册没成功，请再试一次', 500)
      }
    }

    // 账号已经建好：收尾（记下邀请码给了谁、删掉验证码）出错也不影响注册成功，更不能把邀请码还回去
    try {
      await env.DB.batch([
        env.DB.prepare('UPDATE invites SET used_by = ? WHERE code_hash = ?').bind(userId, inviteHash),
        env.DB.prepare('DELETE FROM signup_codes WHERE email = ?').bind(email),
      ])
    } catch (err) {
      console.error('注册收尾出错（账号已建好，邀请码保持已用）', err)
    }
    return reply({ ok: true, username }, 201)
  }

  if (!path.startsWith('/api/admin/invites')) return null

  const who = await requireAdmin(request, getAuth())
  if (who.error) return reply({ error: who.error }, who.status)

  if (method === 'GET' && path === '/api/admin/invites') {
    const { results } = await env.DB.prepare(
      `SELECT i.id, i.hint, i.created_at, i.expires_at, i.used_at, i.revoked_at, u.displayUsername AS used_by_name
       FROM invites i LEFT JOIN "user" u ON u.id = i.used_by
       ORDER BY i.created_at DESC LIMIT 100`,
    ).all()
    const status = (row) =>
      row.used_at ? 'used' : row.revoked_at ? 'revoked' : row.expires_at <= now ? 'expired' : 'valid'
    return reply({
      invites: results.map((row) => ({
        id: row.id,
        hint: row.hint,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        usedAt: row.used_at,
        usedBy: row.used_by_name ?? null,
        status: status(row),
      })),
    })
  }

  if (method === 'POST' && path === '/api/admin/invites') {
    const code = newInviteCode()
    const id = `i_${randomHex(8)}`
    const expiresAt = now + INVITE_DAYS * DAY_MS
    await env.DB.prepare('INSERT INTO invites (id, code_hash, hint, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, await hashToken(code), code.slice(-4), who.user.id, now, expiresAt)
      .run()
    return reply({ invite: { id, code, hint: code.slice(-4), expiresAt } }, 201)
  }

  const match = path.match(/^\/api\/admin\/invites\/([^/]{1,100})$/)
  if (match && method === 'DELETE') {
    const res = await env.DB.prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL')
      .bind(now, decodeURIComponent(match[1]))
      .run()
    if (res.meta.changes === 0) return reply({ error: '没有这个邀请码，或者它已经用过、作废了' }, 404)
    return reply({ ok: true })
  }

  return reply({ error: '没有这个接口' }, 404)
}
