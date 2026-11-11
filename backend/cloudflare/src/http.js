// 后台各接口共用的小工具：JSON 响应、跨域头、限长读取请求体。

/** 带耗时的 JSON 响应；serverMs = 后台自己花的毫秒数（连通测试用来区分网络耗时） */
export function json(body, status, started, cors, extraHeaders = {}) {
  return new Response(JSON.stringify({ ...body, serverMs: Date.now() - started }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors, ...extraHeaders },
  })
}

/** 允许调用后台的网页地址（逗号分隔的环境变量 ALLOWED_ORIGINS） */
export function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 只给允许的网页地址返回跨域头；其他来源的浏览器请求会被浏览器拦下。
 * 登录后的凭证在响应头 set-auth-token 里，要允许网页读到它。
 */
export function corsHeaders(request, env) {
  const origin = request.headers.get('origin')
  if (!origin || !allowedOrigins(env).includes(origin)) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-expose-headers': 'set-auth-token',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
}

/** 请求体太大时 readBody / readJson 返回它（没写 content-length 头的请求也要拦住） */
export const TOO_LARGE = Symbol('too-large')

/**
 * 限长读取请求体，返回字节；太大返回 TOO_LARGE，读出错返回 null。
 * 一块一块地读并累计字节数，一超过上限就停止读取、取消剩下的部分，
 * 不会把很大的请求整个读进内存（Codex 第 24 轮）。
 */
export async function readBody(request, maxBytes) {
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
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
  return bytes
}

/** 读 JSON 请求体；太大返回 TOO_LARGE，没有或不是 JSON 返回 null */
export async function readJson(request, maxBytes = 2048) {
  const bytes = await readBody(request, maxBytes)
  if (bytes === TOO_LARGE || bytes === null) return bytes
  if (bytes.byteLength === 0) return null
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}
