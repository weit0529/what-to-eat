// @vitest-environment node
// 连通测试页的步骤（connectivity-test/runner.js、config.js）的测试
import { describe, it, expect, vi } from 'vitest'
import { formatReport, randomTestUser, runCloudBase, runCloudflare } from '../connectivity-test/runner.js'
import { readConfig } from '../connectivity-test/config.js'

/** 假的 Cloudflare 后台：按路径返回结果，记下收到的请求 */
function fakeFetch(handlers) {
  const calls = []
  const fn = vi.fn(async (url, init = {}) => {
    const path = new URL(url).pathname
    calls.push({ path, init })
    const [status, body] = (handlers[`${init.method || 'GET'} ${path}`] || (() => [404, { error: '没有' }]))(init)
    return new Response(JSON.stringify(body), { status })
  })
  fn.calls = calls
  return fn
}

const okBackend = () => {
  let saved = ''
  return fakeFetch({
    'GET /api/ping': () => [200, { ok: true, serverMs: 0 }],
    'POST /api/register': () => [201, { ok: true, serverMs: 40 }],
    'POST /api/login': () => [200, { ok: true, token: 'tok', serverMs: 30 }],
    'POST /api/notes': (init) => ((saved = JSON.parse(init.body).text), [201, { ok: true, serverMs: 5 }]),
    'GET /api/notes': () => [200, { ok: true, notes: [{ text: saved }], serverMs: 3 }],
  })
}

describe('runCloudflare', () => {
  it('全部成功：3 次网络往返、注册、登录、写、读，带上后台耗时', async () => {
    const fetchImpl = okBackend()
    const results = await runCloudflare({ base: 'https://api.test', invite: 'code', fetchImpl })
    expect(results.map((r) => r.name)).toEqual(['网络往返 1', '网络往返 2', '网络往返 3', '注册测试账号', '登录', '写一条数据', '读回来'])
    expect(results.every((r) => r.ok)).toBe(true)
    expect(results[3].detail).toBe('后台 40ms')
    // 注册带邀请码；写和读带登录凭证
    expect(JSON.parse(fetchImpl.calls[3].init.body).invite).toBe('code')
    expect(JSON.parse(fetchImpl.calls[4].init.body).invite).toBe('code')
    expect(fetchImpl.calls[5].init.headers.authorization).toBe('Bearer tok')
  })

  it('注册失败时记下后台给的原因，后面的步骤跳过', async () => {
    const fetchImpl = fakeFetch({
      'GET /api/ping': () => [200, { ok: true }],
      'POST /api/register': () => [403, { error: '邀请码不对' }],
    })
    const results = await runCloudflare({ base: 'https://api.test', invite: 'x', fetchImpl })
    expect(results.at(-1)).toMatchObject({ name: '注册测试账号', ok: false, detail: '邀请码不对' })
    expect(results).toHaveLength(4)
  })

  it('网络出错、返回的不是 JSON 都记成失败，不抛出', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const r1 = await runCloudflare({ base: 'https://api.test', invite: 'x', fetchImpl: down })
    expect(r1.slice(0, 3).every((r) => !r.ok && r.detail === 'Failed to fetch')).toBe(true)
    const html = vi.fn(async () => new Response('<html>blocked</html>', { status: 502 }))
    const r2 = await runCloudflare({ base: 'https://api.test', invite: 'x', fetchImpl: html })
    expect(r2[0]).toMatchObject({ ok: false, detail: 'HTTP 502' })
  })

  it('读回来的内容不对时算失败', async () => {
    const fetchImpl = okBackend()
    const orig = fetchImpl.getMockImplementation()
    fetchImpl.mockImplementation(async (url, init = {}) =>
      new URL(url).pathname === '/api/notes' && init.method === 'GET' ?new Response(JSON.stringify({ notes: [{ text: '别的' }] })) : orig(url, init),
    )
    const results = await runCloudflare({ base: 'https://api.test', invite: 'code', fetchImpl })
    expect(results.at(-1)).toMatchObject({ name: '读回来', ok: false })
  })

  it('没填地址时直接提示', async () => {
    expect(await runCloudflare({ base: '', invite: '' })).toEqual([
      { backend: 'Cloudflare', name: '配置', ms: 0, ok: false, detail: '还没填 Cloudflare 地址' },
    ])
  })

  it('一步卡住超过时限记成失败', async () => {
    vi.useFakeTimers()
    const hang = vi.fn(() => new Promise(() => {}))
    const pending = runCloudflare({ base: 'https://api.test', invite: 'x', fetchImpl: hang })
    await vi.advanceTimersByTimeAsync(20000 * 4)
    const results = await pending
    vi.useRealTimers()
    expect(results[0]).toMatchObject({ ok: false, detail: '超过 20 秒没有回应' })
  })
})

describe('runCloudBase', () => {
  /** 假的云开发 SDK（PG 模式：app.rdb().from(表).insert().select() / .select().eq()，返回 { data, error }） */
  function fakeSdk({ signInError = null, insertError = null, insertData } = {}) {
    const rows = []
    const db = {
      from: () => ({
        insert: (row) => ({
          select: async () => {
            if (insertError) return { data: null, error: insertError }
            rows.push({ id: rows.length + 1, ...row })
            return { data: insertData ?? [{ id: rows.length }], error: null }
          },
        }),
        select: () => ({ eq: async (col, val) => ({ data: rows.filter((r) => r[col] === val), error: null }) }),
      }),
    }
    const app = { auth: { signInAnonymously: async () => ({ data: {}, error: signInError }) }, rdb: () => db }
    return async () => ({ init: () => app })
  }

  it('全部成功：加载 SDK、匿名登录、写、读', async () => {
    const results = await runCloudBase({ env: 'env-1', loadSdk: fakeSdk() })
    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ['加载 SDK', true],
      ['匿名登录', true],
      ['写一条数据', true],
      ['读回来', true],
    ])
  })

  it('匿名登录没开时记下错误说明，后面跳过', async () => {
    const results = await runCloudBase({ env: 'env-1', loadSdk: fakeSdk({ signInError: { message: '登录方式未开启' } }) })
    expect(results.at(-1)).toMatchObject({ name: '匿名登录', ok: false, detail: '登录方式未开启' })
  })

  it('写入被权限规则拒绝时记下数据库给的说明，后面跳过', async () => {
    const results = await runCloudBase({
      env: 'env-1',
      loadSdk: fakeSdk({ insertError: { message: 'new row violates row-level security policy' } }),
    })
    expect(results.at(-1)).toMatchObject({ name: '写一条数据', ok: false, detail: 'new row violates row-level security policy' })
  })

  it('写入成功但没返回编号时算失败', async () => {
    const results = await runCloudBase({ env: 'env-1', loadSdk: fakeSdk({ insertData: [] }) })
    expect(results.at(-1)).toMatchObject({ name: '写一条数据', ok: false, detail: '没有返回编号' })
  })

  it('没填环境 ID 时直接提示；SDK 下载失败记成失败', async () => {
    expect((await runCloudBase({ env: '', loadSdk: fakeSdk() }))[0].detail).toBe('还没填云开发环境 ID')
    const broken = async () => {
      throw new Error('下载失败')
    }
    expect((await runCloudBase({ env: 'e', loadSdk: broken }))[0]).toMatchObject({ name: '加载 SDK', ok: false })
  })
})

describe('配置和报告', () => {
  it('本机调试时网址参数覆盖配置；邀请码从 # 后面读；地址末尾的 / 去掉', () => {
    const cfg = readConfig({ hostname: 'localhost', search: '?env=e1&cf=https://w.dev/', hash: '#invite=abc' })
    expect(cfg).toEqual({ cloudbaseEnv: 'e1', cloudflareApi: 'https://w.dev', invite: 'abc' })
  })

  it('发布到网上的页面不认网址里的后台地址，免得邀请码被发到别人的服务器（Codex 第 23 轮）', () => {
    const cfg = readConfig({ hostname: 'weit0529.github.io', search: '?env=evil&cf=https://evil.example', hash: '#invite=abc' })
    expect(cfg.cloudflareApi).not.toContain('evil')
    expect(cfg.cloudbaseEnv).not.toBe('evil')
    expect(cfg.invite).toBe('abc')
  })

  it('随机测试账号格式符合后台的要求', () => {
    const { username, password } = randomTestUser()
    expect(username).toMatch(/^t_[a-z0-9]{8}$/)
    expect(password.length).toBeGreaterThanOrEqual(8)
  })

  it('报告每一步一行', () => {
    const text = formatReport([{ backend: 'Cloudflare', name: '登录', ms: 53, ok: true, detail: '后台 37ms' }], { network: '4g' })
    expect(text).toContain('网络：4g')
    expect(text).toContain('Cloudflare | 登录 | 53ms | 成功 | 后台 37ms')
  })
})
