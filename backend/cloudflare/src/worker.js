// 后台入口（Cloudflare Pages 的 _worker.js 和 Workers 版都用它）：按网址把请求分给各部分处理。
//
//   /api/auth/*     登录（Better Auth，见 auth-setup.js）
//   /api/menu       网站读菜单（公开）
//   /api/admin/*    管理员管菜单、管理员名单（见 menu-api.js）、邀请码（见 account-api.js）
//   /api/account/*  普通用户注册（见 account-api.js）
//   /api/ping 等    阶段 4-1 连通测试（见 connectivity.js）
//
// 环境变量（wrangler.jsonc / wrangler secret）：
//   DB                 D1 数据库
//   ALLOWED_ORIGINS    允许调用的网页地址，逗号分隔（GitHub Pages 和本机开发地址）
//   AUTH_BASE_URL      后台自己的网址（Better Auth 要用）
//   BETTER_AUTH_SECRET 登录用的密钥（secret，不写进代码）
//   BOOTSTRAP_TOKEN    建第一个管理员用的一次性口令（secret；建好后可以删掉）
//   TEST_INVITE        连通测试的邀请码（secret）
//   SMTP_USER / SMTP_PASS / SMTP_HOST / SMTP_PORT  发验证码邮件（见 mailer.js；SMTP_PASS 是 secret）

import { createAuth, EMAIL_RE } from './auth-setup.js'
import { connectivityRoute } from './connectivity.js'
import { corsHeaders, json, readBody, TOO_LARGE } from './http.js'
import { accountRoute } from './account-api.js'
import { menuRoute } from './menu-api.js'
import { myMenuRoute } from './my-menu-api.js'
import { imagesRoute } from './images-api.js'
import { releaseQuotas, resetIpLimits, resetLimits, takeQuotas } from './send-limits.js'

/** 请求体的总上限（导入整份菜单最大 512KB，其他接口在各自的地方再限得更小） */
const BODY_MAX_BYTES = 512 * 1024
/** 登录接口的请求体上限 */
const AUTH_BODY_MAX_BYTES = 16 * 1024

/**
 * 只开放管理页真正用到的登录接口（Codex 第 28 轮）。Better Auth 默认还带邮箱登录、改角色、建用户等接口：
 * 邮箱登录会绕过用户名登录的 15 分钟限次；改角色能把最后一个管理员降级。这些一律不开放，
 * 建管理员、删管理员走我们自己的 /api/admin/admins（有“至少留一个、不能删自己”的保护）。
 */
const AUTH_ROUTES = new Set([
  'POST /api/auth/sign-in/username',
  'POST /api/auth/sign-out',
  'GET /api/auth/get-session',
  'POST /api/auth/change-password',
  // 忘记密码：发验证码、凭验证码设新密码（阶段 4-3）
  'POST /api/auth/email-otp/request-password-reset',
  'POST /api/auth/email-otp/reset-password',
])

/** 给 Better Auth 的响应加上跨域头（保留它自己设的 Access-Control-Expose-Headers） */
function withCors(response, cors) {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(cors)) {
    if (key === 'access-control-expose-headers' && headers.has(key)) continue
    headers.set(key, value)
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/**
 * 找回密码请求里的邮箱，处理方式和 Better Auth 完全一样：只转小写、不去空格（Codex 第 35 轮：
 * 这里多去了空格的话，带空格的注册邮箱会被当成注册过、换成合法的占位邮箱，跳过 Better Auth 的格式检查）。
 * 读不出来返回空字符串，交给 Better Auth 去报错
 */
function resetEmail(body) {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body))
    return typeof parsed?.email === 'string' ? parsed.email.toLowerCase() : ''
  } catch {
    return ''
  }
}

/** 发信名额用完时换上的邮箱：.invalid 是保留域名，收不到信，所以也不可能注册 */
const NO_SUCH_EMAIL = 'nobody@quota-exhausted.invalid'

/** 同样的请求，只把 JSON 里的 email 换掉（其他字段、请求头原样；正文长度变了，去掉 content-length） */
function withEmail(request, body, email) {
  const parsed = JSON.parse(new TextDecoder().decode(body))
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  return new Request(request.url, { method: request.method, headers, body: JSON.stringify({ ...parsed, email }) })
}

/**
 * 处理一个请求（单独导出，测试里可以直接调用）。
 * @param {{ authOptions?: object }} [opts] 测试里可以把 PBKDF2 次数调小
 */
export async function handle(request, env, now = Date.now(), opts = {}) {
  const started = Date.now()
  const cors = corsHeaders(request, env)
  const url = new URL(request.url)
  const route = `${request.method} ${url.pathname}`

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (Number(request.headers.get('content-length') || 0) > BODY_MAX_BYTES) {
    return json({ error: '请求太大' }, 413, started, cors)
  }

  let auth = null
  const getAuth = () => (auth ||= createAuth(env, { ...opts.authOptions, waitUntil: opts.waitUntil }))

  try {
    const test = await connectivityRoute(route, request, env, now, started, cors)
    if (test) return test

    if (url.pathname.startsWith('/api/auth/')) {
      if (!AUTH_ROUTES.has(route)) return json({ error: '没有这个接口' }, 404, started, cors)
      // 先限长读出请求体，再交给 Better Auth（它会整个读进内存）
      let forward = request
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const body = await readBody(request, AUTH_BODY_MAX_BYTES)
        if (body === TOO_LARGE) return json({ error: '请求太大' }, 413, started, cors)
        if (body === null) return json({ error: '请求读不出来' }, 400, started, cors)
        forward = new Request(request.url, { method: request.method, headers: request.headers, body })
        // 找回密码发信，三层限次：
        // 1. 按 IP（所有请求都算，不退还）：放在最前面，注册过和没注册的邮箱回应完全一样（Codex 第 33 轮）
        // 2. 按收件邮箱、全站上限（Codex 第 31 轮：只按 IP 的话，换 IP 能一直给同一个邮箱发）：
        //    只给注册过的邮箱占（第 32 轮：否则乱写的邮箱就能把全站名额耗光），Better Auth 没接受就退回。
        //    超了：把邮箱换成一个不存在的邮箱再交给 Better Auth，回应就是它对“没注册的邮箱”的原样回答
        //    （状态码、正文、请求格式检查都一样；第 34 轮：自己写回答总有细节对不上），也不会发信、换验证码
        if (route === 'POST /api/auth/email-otp/request-password-reset') {
          const ip = request.headers.get('cf-connecting-ip') || 'unknown'
          if (!(await takeQuotas(env, resetIpLimits(ip), now))) {
            return json({ error: '要验证码太频繁了，请过 10 分钟再试' }, 429, started, cors)
          }
          const email = resetEmail(body)
          const registered =
            email && EMAIL_RE.test(email) &&
            (await env.DB.prepare('SELECT 1 FROM "user" WHERE lower(email) = ?').bind(email).first())
          if (registered) {
            const taken = await takeQuotas(env, resetLimits(email), now)
            if (!taken) return withCors(await getAuth().handler(withEmail(forward, body, NO_SUCH_EMAIL)), cors)
            let res
            try {
              res = await getAuth().handler(forward)
            } catch (err) {
              await releaseQuotas(env, taken)
              throw err
            }
            if (res.status !== 200) await releaseQuotas(env, taken)
            return withCors(res, cors)
          }
        }
      }
      return withCors(await getAuth().handler(forward), cors)
    }

    const images = await imagesRoute(request.method, url.pathname, request, env, getAuth, now, started, cors)
    if (images) return images

    const account = await accountRoute(request.method, url.pathname, request, env, getAuth, now, started, cors)
    if (account) return account

    // 我的菜单、审核、加菜权限要在 menuRoute 前面：menuRoute 把不认识的 /api/admin/ 接口都回 404
    const myMenu = await myMenuRoute(request.method, url.pathname, request, env, getAuth, now, started, cors)
    if (myMenu) return myMenu

    const menu = await menuRoute(request.method, url.pathname, request, env, getAuth, now, started, cors)
    if (menu) return menu

    return json({ error: '没有这个接口' }, 404, started, cors)
  } catch (err) {
    // 不把内部错误细节返回给网页，只在 Cloudflare 日志里留一条
    console.error(err)
    return json({ error: '后台出错了' }, 500, started, cors)
  }
}

export default {
  fetch: (request, env, ctx) => handle(request, env, Date.now(), { waitUntil: ctx?.waitUntil ? (p) => ctx.waitUntil(p) : undefined }),
}
