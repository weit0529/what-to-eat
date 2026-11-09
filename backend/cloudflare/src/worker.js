// 备用后台（Cloudflare Workers + D1）：阶段 4-1 连通测试用（REQUIREMENTS.md R-019）。
//
// 接口（都返回 JSON，每个响应都带 serverMs = 后台自己花的毫秒数，用来和总耗时对比出网络耗时）：
//   GET  /api/ping                     不碰数据库，测纯网络往返
//   POST /api/register {username, password, invite}   注册测试账号（要测试邀请码，防止陌生人乱注册）
//   POST /api/login    {username, password, invite}    登录，返回 token（同一个用户名 15 分钟内输错 10 次就暂停）
//   POST /api/notes    {text}   （要登录）写一条数据
//   GET  /api/notes             （要登录）读自己最近 5 条
//
// 环境变量（wrangler.jsonc / wrangler secret）：
//   DB               D1 数据库
//   TEST_INVITE      测试邀请码（secret，不写进代码）
//   ALLOWED_ORIGINS  允许调用的网页地址，逗号分隔（如 GitHub Pages 和本机开发地址）

import { hashPassword, hashToken, randomHex, validateCredentials, verifyPassword } from './auth.js'

/** 登录凭证有效期：7 天 */
const SESSION_MS = 7 * 24 * 60 * 60 * 1000
/** 测试数据一条最长多少字 */
const NOTE_MAX = 200
/** 请求体最大字节数：这些接口的正常请求都远小于它，超了直接拒绝，不浪费计算 */
const BODY_MAX_BYTES = 2048
/** 登录失败限制：同一个用户名在这段时间内最多输错几次 */
const LOGIN_FAIL_LIMIT = 10
const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000

/** 带耗时和跨域头的 JSON 响应 */
function json(body, status, started, cors) {
  return new Response(JSON.stringify({ ...body, serverMs: Date.now() - started }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  })
}

/** 只给允许的网页地址返回跨域头；其他来源的浏览器请求会被浏览器拦下 */
function corsHeaders(request, env) {
  const origin = request.headers.get('origin')
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!origin || !allowed.includes(origin)) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
}

/** 请求体太大时 readJson 返回它（没写 content-length 头的请求也要拦住） */
const TOO_LARGE = Symbol('too-large')

/**
 * 读 JSON 请求体；太大返回 TOO_LARGE，不是 JSON 返回 null。
 * 一块一块地读并累计字节数，一超过上限就停止读取、取消剩下的部分，
 * 不会把很大的请求整个读进内存（Codex 第 24 轮）。
 */
async function readJson(request) {
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > BODY_MAX_BYTES) {
        await reader.cancel().catch(() => {})
        return TOO_LARGE
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

/** 这个用户名现在是不是因为输错太多次被暂停了 */
async function loginLocked(env, username, now) {
  const row = await env.DB.prepare('SELECT count, window_start FROM login_failures WHERE username = ?').bind(username).first()
  return Boolean(row && now - row.window_start < LOGIN_FAIL_WINDOW_MS && row.count >= LOGIN_FAIL_LIMIT)
}

/** 记一次登录失败；上一个时间窗口过了就从 1 重新数 */
async function recordLoginFailure(env, username, now) {
  await env.DB.prepare(
    `INSERT INTO login_failures (username, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(username) DO UPDATE SET
       count = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END`,
  )
    .bind(username, now, LOGIN_FAIL_WINDOW_MS)
    .run()
}

/** 从 Authorization: Bearer <token> 找到当前用户；没登录或过期返回 null */
async function currentUser(request, env, now) {
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return null
  const row = await env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .bind(await hashToken(token))
    .first()
  if (!row || row.expires_at <= now) return null
  return row.user_id
}

/** 处理一个请求（单独导出，测试里可以直接调用） */
export async function handle(request, env, now = Date.now()) {
  const started = Date.now()
  const cors = corsHeaders(request, env)
  const url = new URL(request.url)
  const route = `${request.method} ${url.pathname}`

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (Number(request.headers.get('content-length') || 0) > BODY_MAX_BYTES) {
    return json({ error: '请求太大' }, 413, started, cors)
  }

  try {
    if (route === 'GET /api/ping') return json({ ok: true }, 200, started, cors)

    if (route === 'POST /api/register') {
      const body = await readJson(request)
      if (body === TOO_LARGE) return json({ error: '请求太大' }, 413, started, cors)
      if (!env.TEST_INVITE || body?.invite !== env.TEST_INVITE) return json({ error: '邀请码不对' }, 403, started, cors)
      const problem = validateCredentials(body.username, body.password)
      if (problem) return json({ error: problem }, 400, started, cors)
      const exists = await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(body.username).first()
      if (exists) return json({ error: '这个用户名已经有人用了' }, 409, started, cors)
      const pw = await hashPassword(body.password)
      await env.DB.prepare(
        'INSERT INTO users (username, pw_salt, pw_hash, pw_iterations, created_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(body.username, pw.salt, pw.hash, pw.iterations, now)
        .run()
      return json({ ok: true }, 201, started, cors)
    }

    if (route === 'POST /api/login') {
      const body = await readJson(request)
      if (body === TOO_LARGE) return json({ error: '请求太大' }, 413, started, cors)
      // 测试后台登录也要邀请码：没有邀请码的人连猜密码的机会都没有（Codex 第 23 轮）
      if (!env.TEST_INVITE || body?.invite !== env.TEST_INVITE) return json({ error: '邀请码不对' }, 403, started, cors)
      const username = typeof body.username === 'string' ? body.username : ''
      if (!username || username.length > 20) return json({ error: '用户名或密码不对' }, 401, started, cors)
      if (await loginLocked(env, username, now)) {
        return json({ error: '输错太多次，请 15 分钟后再试' }, 429, started, cors)
      }
      const user = await env.DB.prepare('SELECT id, pw_salt, pw_hash, pw_iterations FROM users WHERE username = ?')
        .bind(username)
        .first()
      // 密码格式不对（如超过 64 位）直接算错，不做加密计算
      const ok =
        user &&
        typeof body.password === 'string' &&
        body.password.length <= 64 &&
        (await verifyPassword(body.password, { salt: user.pw_salt, hash: user.pw_hash, iterations: user.pw_iterations }))
      // 用户名不存在和密码错用同一句话，不告诉别人哪个用户名存在
      if (!ok) {
        await recordLoginFailure(env, username, now)
        return json({ error: '用户名或密码不对' }, 401, started, cors)
      }
      await env.DB.prepare('DELETE FROM login_failures WHERE username = ?').bind(username).run()
      const token = randomHex(32)
      await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(await hashToken(token), user.id, now + SESSION_MS)
        .run()
      return json({ ok: true, token }, 200, started, cors)
    }

    if (route === 'POST /api/notes' || route === 'GET /api/notes') {
      const userId = await currentUser(request, env, now)
      if (!userId) return json({ error: '请先登录' }, 401, started, cors)
      if (request.method === 'POST') {
        const body = await readJson(request)
        if (body === TOO_LARGE) return json({ error: '请求太大' }, 413, started, cors)
        const text = typeof body?.text === 'string' ? body.text.trim().slice(0, NOTE_MAX) : ''
        if (!text) return json({ error: '内容不能为空' }, 400, started, cors)
        await env.DB.prepare('INSERT INTO notes (user_id, text, created_at) VALUES (?, ?, ?)').bind(userId, text, now).run()
        return json({ ok: true }, 201, started, cors)
      }
      const { results } = await env.DB.prepare(
        'SELECT id, text, created_at FROM notes WHERE user_id = ? ORDER BY id DESC LIMIT 5',
      )
        .bind(userId)
        .all()
      return json({ ok: true, notes: results }, 200, started, cors)
    }

    return json({ error: '没有这个接口' }, 404, started, cors)
  } catch (err) {
    // 不把内部错误细节返回给网页，只在 Cloudflare 日志里留一条
    console.error(err)
    return json({ error: '后台出错了' }, 500, started, cors)
  }
}

export default { fetch: (request, env) => handle(request, env) }
