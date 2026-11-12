// @vitest-environment node
// 阶段 4-5 后台的测试：吃过记录跟账号走（REQUIREMENTS.md R-025）。
import { describe, it, expect, beforeEach } from 'vitest'
import { handle } from '../backend/cloudflare/src/worker.js'
import { fakeD1 } from './helpers/fake-d1.js'

const ORIGIN = 'https://weit0529.github.io'
const OPTS = { authOptions: { iterations: 1000 } }
const DAY = 24 * 60 * 60 * 1000
let env
let mails
let ip = 0
let clock

beforeEach(() => {
  mails = []
  clock = Date.parse('2026-11-12T04:00:00Z')
  env = {
    DB: fakeD1(),
    ALLOWED_ORIGINS: ORIGIN,
    AUTH_BASE_URL: 'https://api.example',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
    BOOTSTRAP_TOKEN: 'boot-token',
    SEND_MAIL: async (mail) => {
      mails.push(mail)
    },
  }
  ip++
})

async function call(method, path, { body, token, now } = {}) {
  const headers = { origin: ORIGIN, 'cf-connecting-ip': `10.30.${ip % 250}.${Math.floor(Math.random() * 250)}` }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const res = await handle(
    new Request(`https://api.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
    now ?? clock,
    OPTS,
  )
  let data = null
  try {
    data = await res.clone().json()
  } catch {
    // 没有正文
  }
  return { status: res.status, data }
}

async function signInToken(username, password) {
  const res = await handle(
    new Request('https://api.example/api/auth/sign-in/username', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': `10.31.0.${ip % 250}` },
      body: JSON.stringify({ username, password }),
    }),
    env,
    clock,
    OPTS,
  )
  return res.headers.get('set-auth-token')
}

async function setup() {
  await call('POST', '/api/admin/bootstrap', {
    body: { token: 'boot-token', username: '阿涛', email: 'tao@example.com', password: 'admin-pass-1' },
  })
  const admin = await signInToken('阿涛', 'admin-pass-1')
  const newUser = async (username, email) => {
    const invite = (await call('POST', '/api/admin/invites', { token: admin })).data.invite.code
    await call('POST', '/api/account/send-code', { body: { invite, email } })
    const code = mails.at(-1).text.match(/\d{6}/)[0]
    await call('POST', '/api/account/register', { body: { invite, email, code, username, password: 'user-pass-1' } })
    const token = await signInToken(username, 'user-pass-1')
    const id = (await call('GET', '/api/auth/get-session', { token })).data.user.id
    return { token, id }
  }
  return { ming: await newUser('小明', 'ming@example.com'), hong: await newUser('小红', 'hong@example.com') }
}

/** 同步：默认带上这个人的账号编号（有改动时后台要求带） */
const sync = (who, ops, extra = {}) =>
  call('POST', '/api/my/eaten/sync', { body: { userId: who.id, ops, ...extra }, token: who.token, now: extra.now })
const add = (uid, id, at) => ({ type: 'add', uid, id, label: `${id} 的名字`, at: new Date(at).toISOString() })
const uids = (res) => res.data.records.map((r) => r.uid)

describe('吃过记录同步', () => {
  it('记一条、再拿：返回账号里的记录；同一条重发不会记两次', async () => {
    const { ming } = await setup()
    const res = await sync(ming, [add('aaaaaaaa1', 'd_1', clock)])
    expect(res.status).toBe(200)
    expect(res.data.userId).toBe(ming.id)
    expect(res.data.records).toEqual([{ uid: 'aaaaaaaa1', id: 'd_1', label: 'd_1 的名字', at: new Date(clock).toISOString() }])
    expect(uids(await sync(ming, [add('aaaaaaaa1', 'd_1', clock)]))).toEqual(['aaaaaaaa1'])
  })

  it('换一台手机（同一个账号）也看得到；别人的看不到、删不掉', async () => {
    const { ming, hong } = await setup()
    await sync(ming, [add('aaaaaaaa1', 'd_1', clock)])
    const phone2 = { token: await signInToken('小明', 'user-pass-1'), id: ming.id }
    expect(uids(await sync(phone2, []))).toEqual(['aaaaaaaa1'])
    expect((await sync(hong, [])).data.records).toEqual([])
    // 小红用同一个编号删、清空，只影响她自己
    await sync(hong, [{ type: 'remove', uid: 'aaaaaaaa1' }, { type: 'clear', at: new Date(clock).toISOString() }])
    expect(uids(await sync(ming, []))).toEqual(['aaaaaaaa1'])
  })

  it('撤销按编号删；清空只删清空那一刻之前的（别的手机后来记的留着）', async () => {
    const { ming } = await setup()
    await sync(ming, [add('aaaaaaaa1', 'd_1', clock - 2000), add('aaaaaaaa2', 'd_2', clock - 1000)])
    expect(uids(await sync(ming, [{ type: 'remove', uid: 'aaaaaaaa1' }]))).toEqual(['aaaaaaaa2'])
    await sync(ming, [add('aaaaaaaa3', 'd_3', clock + 1000)])
    const cleared = await sync(ming, [{ type: 'clear', at: new Date(clock).toISOString() }])
    expect(uids(cleared)).toEqual(['aaaaaaaa3'])
  })

  it('攒下的改动按顺序执行：先记后撤销', async () => {
    const { ming } = await setup()
    const res = await sync(ming, [add('aaaaaaaa1', 'd_1', clock), { type: 'remove', uid: 'aaaaaaaa1' }, add('aaaaaaaa2', 'd_2', clock)])
    expect(uids(res)).toEqual(['aaaaaaaa2'])
  })

  it('有改动却没带账号编号、或者是别人的编号：不执行，回 409 和现在的账号；没有改动时照常返回', async () => {
    const { ming, hong } = await setup()
    for (const userId of [ming.id, undefined, null, '']) {
      const res = await call('POST', '/api/my/eaten/sync', { body: { userId, ops: [add('aaaaaaaa1', 'd_1', clock)] }, token: hong.token })
      expect(res.status).toBe(409)
      expect(res.data.userId).toBe(hong.id)
    }
    expect((await sync(hong, [])).data.records).toEqual([])
    expect((await call('POST', '/api/my/eaten/sync', { body: { ops: [] }, token: hong.token })).data).toMatchObject({ userId: hong.id, records: [] })
  })

  it('有一条格式不对：整批都不执行', async () => {
    const { ming } = await setup()
    for (const bad of [
      { type: 'add', uid: 'short', id: 'd_1', at: new Date(clock).toISOString() },
      { type: 'add', uid: 'aaaaaaaa9', id: '', at: new Date(clock).toISOString() },
      { type: 'add', uid: 'aaaaaaaa9', id: 'd_1', at: 'not a date' },
      { type: 'remove', uid: '../x' },
      { type: 'clear' },
      { type: 'eat-everything' },
      null,
    ]) {
      expect((await sync(ming, [add('aaaaaaaa1', 'd_1', clock), bad])).status).toBe(400)
    }
    expect((await sync(ming, [])).data.records).toEqual([])
    expect((await call('POST', '/api/my/eaten/sync', { body: { ops: 'x' }, token: ming.token })).status).toBe(400)
  })

  it('没登录 401；一次超过 200 条改动 413', async () => {
    const { ming } = await setup()
    expect((await sync({ token: '', id: 'x' }, [])).status).toBe(401)
    const many = Array.from({ length: 201 }, (_, i) => add(`uid${String(i).padStart(6, '0')}`, 'd_1', clock))
    expect((await sync(ming, many)).status).toBe(413)
  })

  it('账号里只留 31 天内、最新 200 条；超过 31 天的“记一条”不收', async () => {
    const { ming } = await setup()
    await sync(ming, [add('oldoldold', 'd_old', clock - 40 * DAY), add('recent01', 'd_1', clock - 5 * DAY)])
    expect(uids(await sync(ming, []))).toEqual(['recent01'])
    const batch = Array.from({ length: 200 }, (_, i) => add(`many${String(i).padStart(6, '0')}`, 'd_2', clock - 200 + i))
    const res = await sync(ming, batch)
    expect(res.data.records).toHaveLength(200)
    expect(uids(res)).not.toContain('recent01')
  })

  it('每人每分钟最多同步 60 次', async () => {
    const { ming } = await setup()
    for (let i = 0; i < 60; i++) expect((await sync(ming, [])).status).toBe(200)
    expect((await sync(ming, [])).status).toBe(429)
    expect((await sync(ming, [], { now: clock + 61000 })).status).toBe(200)
  })
})

describe('Codex 第 47 轮：晚到、重发的改动不会让删掉的记录复活', () => {
  it('手机 A 记的已经存上了（回应丢了），手机 B 撤销了它；A 重发同一条：不复活', async () => {
    const { ming } = await setup()
    await sync(ming, [add('aaaaaaaa1', 'd_A', clock)])
    await sync(ming, [{ type: 'remove', uid: 'aaaaaaaa1' }])
    expect(uids(await sync(ming, [add('aaaaaaaa1', 'd_A', clock)]))).toEqual([])
  })

  it('手机 B 清空之后，A 晚到的、时间在清空之前的记录不收；清空之后才记的照收', async () => {
    const { ming } = await setup()
    await sync(ming, [add('aaaaaaaa1', 'd_A', clock - 1000)])
    await sync(ming, [{ type: 'clear', at: new Date(clock).toISOString() }])
    expect(uids(await sync(ming, [add('aaaaaaaa1', 'd_A', clock - 1000), add('aaaaaaaa2', 'd_B', clock - 500)]))).toEqual([])
    expect(uids(await sync(ming, [add('aaaaaaaa3', 'd_C', clock + 1000)]))).toEqual(['aaaaaaaa3'])
    // 清空边界只会往后挪：再发一个更早的清空不会让更早的记录又收得进来
    await sync(ming, [{ type: 'clear', at: new Date(clock - 5000).toISOString() }])
    expect(uids(await sync(ming, [add('aaaaaaaa4', 'd_D', clock - 100)]))).toEqual(['aaaaaaaa3'])
  })

  it('删除记号 31 天后清掉', async () => {
    const { ming } = await setup()
    await sync(ming, [add('aaaaaaaa1', 'd_A', clock), { type: 'remove', uid: 'aaaaaaaa1' }])
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM eaten_deleted').first()).n).toBe(1)
    await sync(ming, [], { now: clock + 32 * DAY })
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM eaten_deleted').first()).n).toBe(0)
  })
})

describe('Codex 第 48 轮：手机时间快了也不会锁住账号', () => {
  it('快一天的手机点清空：清空边界只算到后台的“现在”，之后正常记的照收', async () => {
    const { ming } = await setup()
    await sync(ming, [add('aaaaaaaa1', 'd_A', clock - 1000)])
    await sync(ming, [{ type: 'clear', at: new Date(clock + DAY).toISOString() }])
    expect(uids(await sync(ming, []))).toEqual([])
    const later = await sync(ming, [add('aaaaaaaa2', 'd_B', clock + 60000)], { now: clock + 60000 })
    expect(uids(later)).toEqual(['aaaaaaaa2'])
  })

  it('回应带版本号：每次同步加 1，同一毫秒的两次也不一样（Codex 第 49 轮）', async () => {
    const { ming, hong } = await setup()
    const v1 = (await sync(ming, [])).data.version
    const v2 = (await sync(ming, [], { now: clock })).data.version
    const v3 = (await sync(ming, [add('aaaaaaaa1', 'd_1', clock)], { now: clock })).data.version
    expect([v2 - v1, v3 - v2]).toEqual([1, 1])
    // 每个账号自己数
    expect((await sync(hong, [])).data.version).toBe(1)
  })

  it('快一天的手机先记一条、再清空：这条也删掉，晚到的重发不复活；之后正常记的照收（Codex 第 49 轮）', async () => {
    const { ming } = await setup()
    await sync(ming, [add('future01', 'd_F', clock + DAY)])
    expect(uids(await sync(ming, [{ type: 'clear', at: new Date(clock + DAY + 1000).toISOString() }]))).toEqual([])
    expect(uids(await sync(ming, [add('future01', 'd_F', clock + DAY)]))).toEqual([])
    expect(uids(await sync(ming, [add('normal01', 'd_N', clock + 60000)], { now: clock + 60000 }))).toEqual(['normal01'])
  })
})
