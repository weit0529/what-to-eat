// @vitest-environment node
// 备用后台（backend/cloudflare）的测试：用 Node 自带的 SQLite 模拟 D1 数据库，直接调用 handle()
import { describe, it, expect, beforeEach } from 'vitest'
import { handle } from '../backend/cloudflare/src/worker.js'
import { hashPassword, validateCredentials, verifyPassword } from '../backend/cloudflare/src/auth.js'
import { fakeD1 } from './helpers/fake-d1.js'

const ORIGIN = 'https://weit0529.github.io'
let env
beforeEach(() => {
  env = { DB: fakeD1(), TEST_INVITE: 'test-code', ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173` }
})

function call(method, path, { body, token, origin = ORIGIN, now } = {}) {
  const headers = { origin }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const req = new Request(`https://api.example${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return handle(req, env, now)
}
const data = async (res) => ({ status: res.status, ...(await res.json()) })

async function registerAndLogin(username = '小明', password = 'password123') {
  await call('POST', '/api/register', { body: { username, password, invite: 'test-code' } })
  return (await data(await call('POST', '/api/login', { body: { username, password, invite: 'test-code' } }))).token
}

describe('密码工具', () => {
  it('同一个密码每次加密结果不同（随机盐），但都能核对通过；错的密码核对不过', async () => {
    const a = await hashPassword('password123', 1000)
    const b = await hashPassword('password123', 1000)
    expect(a.hash).not.toBe(b.hash)
    expect(await verifyPassword('password123', a)).toBe(true)
    expect(await verifyPassword('password124', a)).toBe(false)
  })

  it('用户名、密码格式检查', () => {
    expect(validateCredentials('小明_01', 'password123')).toBe(null)
    expect(validateCredentials('a', 'password123')).toMatch(/用户名/)
    expect(validateCredentials('有 空格', 'password123')).toMatch(/用户名/)
    expect(validateCredentials('小明', 'short')).toMatch(/密码/)
  })
})

describe('Cloudflare 测试后台', () => {
  it('ping 返回 ok 和后台耗时', async () => {
    const res = await data(await call('GET', '/api/ping'))
    expect(res).toMatchObject({ status: 200, ok: true })
    expect(typeof res.serverMs).toBe('number')
  })

  it('注册 → 登录 → 写一条 → 读回来', async () => {
    const token = await registerAndLogin()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect((await call('POST', '/api/notes', { body: { text: '连通测试' }, token })).status).toBe(201)
    const read = await data(await call('GET', '/api/notes', { token }))
    expect(read.notes.map((n) => n.text)).toEqual(['连通测试'])
  })

  it('邀请码不对不能注册；用户名重复不能注册', async () => {
    expect((await call('POST', '/api/register', { body: { username: '小明', password: 'password123', invite: 'x' } })).status).toBe(403)
    await registerAndLogin()
    const dup = await call('POST', '/api/register', { body: { username: '小明', password: 'password123', invite: 'test-code' } })
    expect(dup.status).toBe(409)
  })

  it('密码错和用户名不存在返回同一句话', async () => {
    await registerAndLogin()
    const wrong = await data(await call('POST', '/api/login', { body: { username: '小明', password: 'wrongpass1', invite: 'test-code' } }))
    const none = await data(await call('POST', '/api/login', { body: { username: '没有这人', password: 'password123', invite: 'test-code' } }))
    expect(wrong.status).toBe(401)
    expect(none.status).toBe(401)
    expect(wrong.error).toBe(none.error)
  })

  it('没登录、凭证错、凭证过期都不能读写', async () => {
    const token = await registerAndLogin()
    expect((await call('GET', '/api/notes')).status).toBe(401)
    expect((await call('GET', '/api/notes', { token: 'f'.repeat(64) })).status).toBe(401)
    const eightDaysLater = Date.now() + 8 * 24 * 60 * 60 * 1000
    expect((await call('GET', '/api/notes', { token, now: eightDaysLater })).status).toBe(401)
  })

  it('每个人只读到自己的数据', async () => {
    const a = await registerAndLogin('小明', 'password123')
    const b = await registerAndLogin('小红', 'password123')
    await call('POST', '/api/notes', { body: { text: '小明的' }, token: a })
    const readB = await data(await call('GET', '/api/notes', { token: b }))
    expect(readB.notes).toEqual([])
  })

  it('数据库里不存密码原文，也不存登录凭证原文', async () => {
    const token = await registerAndLogin('小明', 'password123')
    const user = await env.DB.prepare('SELECT * FROM users').first()
    expect(JSON.stringify(user)).not.toContain('password123')
    const session = await env.DB.prepare('SELECT * FROM sessions').first()
    expect(session.token_hash).not.toBe(token)
  })

  it('只给允许的网页返回跨域头；预检请求返回 204', async () => {
    expect((await call('GET', '/api/ping')).headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect((await call('GET', '/api/ping', { origin: 'https://evil.example' })).headers.get('access-control-allow-origin')).toBe(null)
    const pre = await call('OPTIONS', '/api/notes')
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization')
  })

  it('空内容不能写；超长内容截到 200 字；没有的接口返回 404', async () => {
    const token = await registerAndLogin()
    expect((await call('POST', '/api/notes', { body: { text: '   ' }, token })).status).toBe(400)
    await call('POST', '/api/notes', { body: { text: '饭'.repeat(300) }, token })
    const read = await data(await call('GET', '/api/notes', { token }))
    expect(read.notes[0].text).toHaveLength(200)
    expect((await call('GET', '/api/nothing')).status).toBe(404)
  })

  it('请求体不是 JSON 时不报 500', async () => {
    const req = new Request('https://api.example/api/login', { method: 'POST', headers: { origin: ORIGIN }, body: 'not json' })
    expect((await handle(req, env)).status).toBe(403)
  })

  it('登录也要邀请码（Codex 第 23 轮）', async () => {
    await registerAndLogin()
    const res = await call('POST', '/api/login', { body: { username: '小明', password: 'password123' } })
    expect(res.status).toBe(403)
  })

  it('同一个用户名 15 分钟内输错 10 次就暂停，连对的密码也不行；过了 15 分钟恢复；登录成功清零', async () => {
    await registerAndLogin()
    const t0 = Date.now()
    const login = (password, now) => call('POST', '/api/login', { body: { username: '小明', password, invite: 'test-code' }, now })
    for (let i = 0; i < 10; i++) expect((await login('wrongpass1', t0 + i)).status).toBe(401)
    expect((await login('password123', t0 + 20)).status).toBe(429)
    expect((await login('password123', t0 + 16 * 60 * 1000)).status).toBe(200)
    // 成功后清零：再错 9 次还能登录
    for (let i = 0; i < 9; i++) await login('wrongpass1', t0 + 17 * 60 * 1000 + i)
    expect((await login('password123', t0 + 17 * 60 * 1000 + 20)).status).toBe(200)
  })

  it('不存在的用户名输错也计数，和存在的用户名表现一样', async () => {
    const t0 = Date.now()
    for (let i = 0; i < 10; i++) {
      await call('POST', '/api/login', { body: { username: '没有这人', password: 'x', invite: 'test-code' }, now: t0 + i })
    }
    const res = await call('POST', '/api/login', { body: { username: '没有这人', password: 'x', invite: 'test-code' }, now: t0 + 20 })
    expect(res.status).toBe(429)
  })

  it('没写长度的超大请求：读到超过 2KB 就停，不整个读进内存（Codex 第 24 轮）', async () => {
    let pulled = 0
    const chunk = new Uint8Array(65536).fill(97)
    const stream = new ReadableStream({
      pull(controller) {
        pulled += chunk.byteLength
        if (pulled > 64 * 65536) controller.close()
        else controller.enqueue(chunk)
      },
    })
    const req = new Request('https://api.example/api/register', {
      method: 'POST',
      headers: { origin: ORIGIN },
      body: stream,
      duplex: 'half',
    })
    expect((await handle(req, env)).status).toBe(413)
    // 只读了开头几块就停了（流可能预读一两块），远少于 4MB
    expect(pulled).toBeLessThanOrEqual(3 * 65536)
  })

  it('请求体太大直接拒绝；超长密码不做加密计算直接算错', async () => {
    const big = await call('POST', '/api/register', { body: { username: '小明', password: 'p'.repeat(5000), invite: 'test-code' } })
    expect(big.status).toBe(413)
    await registerAndLogin()
    const long = await call('POST', '/api/login', { body: { username: '小明', password: 'p'.repeat(65), invite: 'test-code' } })
    expect(long.status).toBe(401)
  })
})
