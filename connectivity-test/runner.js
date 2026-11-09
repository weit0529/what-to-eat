// 连通测试的步骤（不碰页面，方便测试）。每一步记下：后台、步骤名、耗时（毫秒）、成功与否、说明。
//
// 腾讯云开发：匿名登录 → 写一条 → 读回来（要在控制台开“匿名登录”，数据库建 conn_test 集合并允许登录用户读写自己的数据）
// Cloudflare：ping ×3 → 注册随机测试账号 → 登录 → 写一条 → 读回来（注册要测试邀请码）

/** 随机测试用户名和密码：t_ + 8 位随机字母数字 */
export function randomTestUser(random = Math.random) {
  const pick = (n) => Array.from({ length: n }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(random() * 31)]).join('')
  return { username: `t_${pick(8)}`, password: `pw_${pick(12)}` }
}

/** 每一步最多等多久（毫秒）；网络卡住时记成失败，不让页面一直转圈 */
export const STEP_TIMEOUT_MS = 20000

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`超过 ${ms / 1000} 秒没有回应`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** 跑一步并计时；出错不往外抛，记成失败继续往下（后面依赖它的步骤会被跳过） */
async function step(results, backend, name, fn, now, timeoutMs = STEP_TIMEOUT_MS) {
  const started = now()
  try {
    const detail = await withTimeout(Promise.resolve().then(fn), timeoutMs)
    results.push({ backend, name, ms: Math.round(now() - started), ok: true, detail: detail ?? '' })
    return true
  } catch (err) {
    results.push({ backend, name, ms: Math.round(now() - started), ok: false, detail: String(err?.message || err) })
    return false
  }
}

/** 调 Cloudflare 接口；HTTP 状态不是 2xx 就抛出后台给的错误说明 */
async function api(fetchImpl, base, path, { method = 'GET', body, token } = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetchImpl(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  let data = {}
  try {
    data = await res.json()
  } catch {
    // 不是 JSON（比如被拦截后返回的网页），下面按状态码报错
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

const serverPart = (data) => (typeof data?.serverMs === 'number' ? `后台 ${data.serverMs}ms` : '')

/**
 * Cloudflare 测试。
 * @param {{base: string, invite: string, fetchImpl?: Function, now?: () => number, random?: () => number}} opts
 */
export async function runCloudflare({ base, invite, fetchImpl = fetch, now = () => performance.now(), random }) {
  const results = []
  const B = 'Cloudflare'
  if (!base) {
    results.push({ backend: B, name: '配置', ms: 0, ok: false, detail: '还没填 Cloudflare 地址' })
    return results
  }
  for (let i = 1; i <= 3; i++) {
    await step(results, B, `网络往返 ${i}`, async () => serverPart(await api(fetchImpl, base, '/api/ping')), now)
  }
  const user = randomTestUser(random)
  let token = ''
  const registered = await step(
    results,
    B,
    '注册测试账号',
    async () => serverPart(await api(fetchImpl, base, '/api/register', { method: 'POST', body: { ...user, invite } })),
    now,
  )
  const loggedIn =
    registered &&
    (await step(
      results,
      B,
      '登录',
      async () => {
        const data = await api(fetchImpl, base, '/api/login', { method: 'POST', body: { ...user, invite } })
        token = data.token
        return serverPart(data)
      },
      now,
    ))
  if (!loggedIn) return results
  const text = `连通测试 ${new Date().toISOString()}`
  const wrote = await step(
    results,
    B,
    '写一条数据',
    async () => serverPart(await api(fetchImpl, base, '/api/notes', { method: 'POST', body: { text }, token })),
    now,
  )
  if (wrote) {
    await step(
      results,
      B,
      '读回来',
      async () => {
        const data = await api(fetchImpl, base, '/api/notes', { token })
        if (data.notes?.[0]?.text !== text) throw new Error('读回来的内容对不上')
        return serverPart(data)
      },
      now,
    )
  }
  return results
}

/**
 * 腾讯云开发测试。
 * @param {{env: string, loadSdk: () => Promise<any>, now?: () => number}} opts loadSdk 返回 cloudbase 模块
 */
export async function runCloudBase({ env, loadSdk, now = () => performance.now() }) {
  const results = []
  const B = '腾讯云'
  if (!env) {
    results.push({ backend: B, name: '配置', ms: 0, ok: false, detail: '还没填云开发环境 ID' })
    return results
  }
  let app
  const loaded = await step(
    results,
    B,
    '加载 SDK',
    async () => {
      const cloudbase = await loadSdk()
      app = cloudbase.init({ env })
    },
    now,
  )
  if (!loaded) return results
  const signedIn = await step(
    results,
    B,
    '匿名登录',
    async () => {
      const { error } = await app.auth.signInAnonymously({})
      if (error) throw new Error(error.message || String(error))
    },
    now,
  )
  if (!signedIn) return results
  const db = app.database()
  const text = `连通测试 ${new Date().toISOString()}`
  let id = ''
  const wrote = await step(
    results,
    B,
    '写一条数据',
    async () => {
      const res = await db.collection('conn_test').add({ text, createdAt: Date.now() })
      id = res.id || res._id
      if (!id) throw new Error(res.message || '没有返回编号')
    },
    now,
  )
  if (wrote) {
    await step(
      results,
      B,
      '读回来',
      async () => {
        const res = await db.collection('conn_test').doc(id).get()
        if (res.data?.[0]?.text !== text) throw new Error(res.message || '读回来的内容对不上')
      },
      now,
    )
  }
  return results
}

/** 把结果拼成一段文字，方便朋友复制发回来 */
export function formatReport(results, meta = {}) {
  const lines = ['【今天吃什么 连通测试】']
  if (meta.time) lines.push(`时间：${meta.time}`)
  if (meta.network) lines.push(`网络：${meta.network}`)
  if (meta.userAgent) lines.push(`设备：${meta.userAgent}`)
  for (const r of results) {
    lines.push(`${r.backend} | ${r.name} | ${r.ms}ms | ${r.ok ? '成功' : '失败'}${r.detail ? ` | ${r.detail}` : ''}`)
  }
  return lines.join('\n')
}
