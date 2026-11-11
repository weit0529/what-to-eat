// 后台入口（Cloudflare Pages 的 _worker.js 和 Workers 版都用它）：按网址把请求分给各部分处理。
//
//   /api/auth/*     登录（Better Auth，见 auth-setup.js）
//   /api/menu       网站读菜单（公开）
//   /api/admin/*    管理员管菜单、管理员名单（见 menu-api.js）
//   /api/ping 等    阶段 4-1 连通测试（见 connectivity.js）
//
// 环境变量（wrangler.jsonc / wrangler secret）：
//   DB                 D1 数据库
//   ALLOWED_ORIGINS    允许调用的网页地址，逗号分隔（GitHub Pages 和本机开发地址）
//   AUTH_BASE_URL      后台自己的网址（Better Auth 要用）
//   BETTER_AUTH_SECRET 登录用的密钥（secret，不写进代码）
//   BOOTSTRAP_TOKEN    建第一个管理员用的一次性口令（secret；建好后可以删掉）
//   TEST_INVITE        连通测试的邀请码（secret）

import { createAuth } from './auth-setup.js'
import { connectivityRoute } from './connectivity.js'
import { corsHeaders, json, readBody, TOO_LARGE } from './http.js'
import { menuRoute } from './menu-api.js'

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
  const getAuth = () => (auth ||= createAuth(env, opts.authOptions))

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
      }
      return withCors(await getAuth().handler(forward), cors)
    }

    const menu = await menuRoute(request.method, url.pathname, request, env, getAuth, now, started, cors)
    if (menu) return menu

    return json({ error: '没有这个接口' }, 404, started, cors)
  } catch (err) {
    // 不把内部错误细节返回给网页，只在 Cloudflare 日志里留一条
    console.error(err)
    return json({ error: '后台出错了' }, 500, started, cors)
  }
}

export default { fetch: (request, env) => handle(request, env) }
