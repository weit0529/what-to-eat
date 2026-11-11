// @vitest-environment node
// 阶段 4-3 后台的测试：邀请码、注册（邮箱验证码）、找回密码。发信用假的 env.SEND_MAIL 代替。
import { describe, it, expect, beforeEach } from 'vitest'
import { handle } from '../backend/cloudflare/src/worker.js'
import { fakeD1 } from './helpers/fake-d1.js'

const ORIGIN = 'https://weit0529.github.io'
let env
let mails
let ip = 0
let clock

beforeEach(() => {
  mails = []
  clock = Date.now()
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

async function call(method, path, { body, token, from, now } = {}) {
  const headers = { origin: ORIGIN, 'cf-connecting-ip': from ?? `10.1.0.${ip}` }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const res = await handle(
    new Request(`https://api.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
    now ?? clock,
    { authOptions: { iterations: 1000 } },
  )
  let data = null
  try {
    data = await res.clone().json()
  } catch {
    // 没有正文
  }
  return { status: res.status, headers: res.headers, data }
}

async function adminToken() {
  await call('POST', '/api/admin/bootstrap', {
    body: { token: 'boot-token', username: '阿涛', email: 'tao@example.com', password: 'admin-pass-1' },
  })
  const res = await call('POST', '/api/auth/sign-in/username', { body: { username: '阿涛', password: 'admin-pass-1' } })
  return res.headers.get('set-auth-token')
}

async function newInvite(token) {
  return (await call('POST', '/api/admin/invites', { token })).data.invite
}

/** 从最近一封邮件里取出 6 位验证码 */
const lastCode = () => mails.at(-1).text.match(/\d{6}/)[0]

async function register({ invite, email = 'ming@example.com', username = '小明', password = 'ming-pass-1' }) {
  const sent = await call('POST', '/api/account/send-code', { body: { invite, email } })
  if (sent.status !== 200) return sent
  return call('POST', '/api/account/register', { body: { invite, email, code: lastCode(), username, password } })
}

describe('邀请码（管理员）', () => {
  it('生成的邀请码原文只返回一次，列表里只显示最后 4 位；7 天后过期', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    expect(inv.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(inv.expiresAt - clock).toBe(7 * 24 * 60 * 60 * 1000)
    const list = (await call('GET', '/api/admin/invites', { token })).data.invites
    expect(list).toEqual([expect.objectContaining({ id: inv.id, hint: inv.code.slice(-4), status: 'valid' })])
    expect(JSON.stringify(list)).not.toContain(inv.code)
    const row = await env.DB.prepare('SELECT * FROM invites').first()
    expect(JSON.stringify(row)).not.toContain(inv.code)
  })

  it('不是管理员不能生成、看、作废邀请码', async () => {
    expect((await call('POST', '/api/admin/invites')).status).toBe(401)
    expect((await call('GET', '/api/admin/invites')).status).toBe(401)
  })

  it('作废后不能再用；用过的不能作废', async () => {
    const token = await adminToken()
    const a = await newInvite(token)
    expect((await call('DELETE', `/api/admin/invites/${a.id}`, { token })).status).toBe(200)
    expect((await call('POST', '/api/account/send-code', { body: { invite: a.code, email: 'x@example.com' } })).status).toBe(400)
    const b = await newInvite(token)
    expect((await register({ invite: b.code })).status).toBe(201)
    expect((await call('DELETE', `/api/admin/invites/${b.id}`, { token })).status).toBe(404)
  })
})

describe('注册（D-03）', () => {
  it('邀请码 + 邮箱验证码 + 用户名密码 → 注册成功，能登录，是普通用户，邮箱已验证；邀请码作废', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    const res = await register({ invite: inv.code })
    expect(res.status).toBe(201)
    expect(mails[0].to).toBe('ming@example.com')
    expect(mails[0].subject).toContain('注册账号')
    const login = await call('POST', '/api/auth/sign-in/username', { body: { username: '小明', password: 'ming-pass-1' } })
    expect(login.status).toBe(200)
    expect(login.data.user.role).toBe('user')
    const user = await env.DB.prepare('SELECT emailVerified, role FROM "user" WHERE email = ?').bind('ming@example.com').first()
    expect(user).toMatchObject({ emailVerified: 1, role: 'user' })
    const list = (await call('GET', '/api/admin/invites', { token })).data.invites
    expect(list[0]).toMatchObject({ status: 'used', usedBy: '小明' })
    // 同一个邀请码不能再注册第二个人
    expect((await register({ invite: inv.code, email: 'hong@example.com', username: '小红' })).status).toBe(400)
  })

  it('没有邀请码、邀请码不对、过期了都不能要验证码', async () => {
    const token = await adminToken()
    expect((await call('POST', '/api/account/send-code', { body: { email: 'a@example.com' } })).status).toBe(400)
    expect((await call('POST', '/api/account/send-code', { body: { invite: 'WRONG123', email: 'a@example.com' } })).status).toBe(400)
    const inv = await newInvite(token)
    const later = clock + 8 * 24 * 60 * 60 * 1000
    expect((await call('POST', '/api/account/send-code', { body: { invite: inv.code, email: 'a@example.com' }, now: later })).status).toBe(400)
    expect(mails).toHaveLength(0)
  })

  it('邀请码抄写时带空格、小写也认', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    const messy = ` ${inv.code.slice(0, 4).toLowerCase()} ${inv.code.slice(4)} `
    expect((await register({ invite: messy })).status).toBe(201)
  })

  it('验证码错了不行，错 5 次后作废；过期也不行', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    await call('POST', '/api/account/send-code', { body: { invite: inv.code, email: 'a@example.com' } })
    const good = lastCode()
    const bad = good === '000000' ? '111111' : '000000'
    const attempt = (code, now) =>
      call('POST', '/api/account/register', { body: { invite: inv.code, email: 'a@example.com', code, username: '小明', password: 'ming-pass-1' }, now })
    for (let i = 0; i < 5; i++) expect((await attempt(bad)).status).toBe(400)
    expect((await attempt(good)).status).toBe(400)
    // 重新要一个码（过了 1 分钟），过期后再用也不行
    await call('POST', '/api/account/send-code', { body: { invite: inv.code, email: 'a@example.com' }, now: clock + 61000 })
    expect((await attempt(lastCode(), clock + 61000 + 11 * 60 * 1000)).status).toBe(400)
  })

  it('验证码和邮箱绑在一起：拿 A 邮箱的码注册 B 邮箱不行', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    await call('POST', '/api/account/send-code', { body: { invite: inv.code, email: 'a@example.com' } })
    const res = await call('POST', '/api/account/register', {
      body: { invite: inv.code, email: 'b@example.com', code: lastCode(), username: '小明', password: 'ming-pass-1' },
    })
    expect(res.status).toBe(400)
  })

  it('已注册的邮箱不能再要验证码；用户名被占用时不注册，邀请码还能用', async () => {
    const token = await adminToken()
    const a = await newInvite(token)
    await register({ invite: a.code })
    const b = await newInvite(token)
    expect((await call('POST', '/api/account/send-code', { body: { invite: b.code, email: 'ming@example.com' } })).status).toBe(409)
    const taken = await register({ invite: b.code, email: 'other@example.com', username: '小明' })
    expect(taken.status).toBe(409)
    // 换个用户名再提交就行，不用重新要验证码
    const retry = await call('POST', '/api/account/register', {
      body: { invite: b.code, email: 'other@example.com', code: lastCode(), username: '小刚', password: 'ming-pass-1' },
    })
    expect(retry.status).toBe(201)
  })

  it('同一个邮箱 1 分钟内只能要一次；同一个 IP 一小时最多 10 封', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    const send = (email, now) => call('POST', '/api/account/send-code', { body: { invite: inv.code, email }, from: '10.200.0.1', now })
    expect((await send('a@example.com')).status).toBe(200)
    expect((await send('a@example.com')).status).toBe(429)
    for (let i = 1; i < 10; i++) expect((await send(`u${i}@example.com`)).status).toBe(200)
    expect((await send('u10@example.com')).status).toBe(429)
    expect(mails).toHaveLength(10)
  })

  it('发信失败时说清楚，验证码不留着', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    env.SEND_MAIL = async () => {
      throw new Error('smtp down')
    }
    const res = await call('POST', '/api/account/send-code', { body: { invite: inv.code, email: 'a@example.com' } })
    expect(res.status).toBe(502)
    expect(await env.DB.prepare('SELECT * FROM signup_codes').first()).toBe(null)
  })

  it('库里不存验证码和邀请码的原文', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    await call('POST', '/api/account/send-code', { body: { invite: inv.code, email: 'a@example.com' } })
    const row = await env.DB.prepare('SELECT * FROM signup_codes').first()
    expect(JSON.stringify(row)).not.toContain(lastCode())
  })
})

describe('找回密码（D-03）', () => {
  async function registered() {
    const token = await adminToken()
    const inv = await newInvite(token)
    await register({ invite: inv.code })
    mails.length = 0
  }

  it('邮箱收验证码 → 设新密码 → 新密码能登录、旧密码不行', async () => {
    await registered()
    expect((await call('POST', '/api/auth/email-otp/request-password-reset', { body: { email: 'ming@example.com' } })).status).toBe(200)
    expect(mails).toHaveLength(1)
    expect(mails[0].subject).toContain('重置密码')
    const reset = await call('POST', '/api/auth/email-otp/reset-password', {
      body: { email: 'ming@example.com', otp: lastCode(), password: 'new-pass-123' },
    })
    expect(reset.status).toBe(200)
    expect((await call('POST', '/api/auth/sign-in/username', { body: { username: '小明', password: 'new-pass-123' } })).status).toBe(200)
    expect((await call('POST', '/api/auth/sign-in/username', { body: { username: '小明', password: 'ming-pass-1' } })).status).toBe(401)
  })

  it('没注册的邮箱：接口照样说“已发送”（不暴露哪个邮箱注册过），但不发信', async () => {
    await registered()
    const res = await call('POST', '/api/auth/email-otp/request-password-reset', { body: { email: 'nobody@example.com' } })
    expect(res.status).toBe(200)
    expect(mails).toHaveLength(0)
  })

  it('验证码不对不能重置；同一个地址 10 分钟内最多要 3 次验证码', async () => {
    await registered()
    await call('POST', '/api/auth/email-otp/request-password-reset', { body: { email: 'ming@example.com' }, from: '10.7.7.7' })
    const good = lastCode()
    const bad = good === '000000' ? '111111' : '000000'
    const wrong = await call('POST', '/api/auth/email-otp/reset-password', {
      body: { email: 'ming@example.com', otp: bad, password: 'new-pass-123' },
    })
    expect(wrong.status).toBe(400)
    // 同一个邮箱 60 秒内只发一封（send-limits.js），所以换几个邮箱来测“同一个 IP”的限制
    await call('POST', '/api/auth/email-otp/request-password-reset', { body: { email: 'a1@example.com' }, from: '10.7.7.7' })
    await call('POST', '/api/auth/email-otp/request-password-reset', { body: { email: 'a2@example.com' }, from: '10.7.7.7' })
    const fourth = await call('POST', '/api/auth/email-otp/request-password-reset', { body: { email: 'a3@example.com' }, from: '10.7.7.7' })
    expect(fourth.status).toBe(429)
  })

  it('别的验证码接口（用验证码登录、验证邮箱）不开放', async () => {
    await registered()
    expect((await call('POST', '/api/auth/email-otp/send-verification-otp', { body: { email: 'ming@example.com', type: 'sign-in' } })).status).toBe(404)
    expect((await call('POST', '/api/auth/sign-in/email-otp', { body: { email: 'ming@example.com', otp: '123456' } })).status).toBe(404)
  })
})

describe('Codex 第 31 轮的修复', () => {
  it('找回密码后，所有旧登录都作废', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    await register({ invite: inv.code })
    const signInMing = async () =>
      (await call('POST', '/api/auth/sign-in/username', { body: { username: '小明', password: 'ming-pass-1' } })).headers.get('set-auth-token')
    const t1 = await signInMing()
    const t2 = await signInMing()
    for (const t of [t1, t2]) {
      expect(t).toBeTruthy()
      expect((await call('GET', '/api/auth/get-session', { token: t })).data?.user?.username).toBe('小明')
    }
    await call('POST', '/api/auth/email-otp/request-password-reset', { body: { email: 'ming@example.com' } })
    expect((await call('POST', '/api/auth/email-otp/reset-password', { body: { email: 'ming@example.com', otp: lastCode(), password: 'new-pass-123' } })).status).toBe(200)
    for (const t of [t1, t2]) {
      const session = await call('GET', '/api/auth/get-session', { token: t })
      expect(session.data).toBe(null)
    }
  })

  it('找回密码按邮箱限次：换 IP、改大小写也只能 60 秒一封、一天 5 封；超了照样回答“已发送”', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    await register({ invite: inv.code })
    mails.length = 0
    const ask = (i, now) =>
      call('POST', '/api/auth/email-otp/request-password-reset', {
        body: { email: i % 2 ? 'MING@example.com' : 'ming@example.com' },
        from: `10.50.0.${i}`,
        now,
      })
    for (let i = 0; i < 6; i++) expect((await ask(i)).status).toBe(200)
    expect(mails).toHaveLength(1)
    for (let n = 1; n <= 6; n++) expect((await ask(100 + n, clock + n * 61000)).status).toBe(200)
    expect(mails).toHaveLength(5)
  })

  it('并发要注册验证码也挤不过限次：同一 IP 24 个请求最多发 10 封；同一邮箱 12 个请求只发 1 封', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    const sameIp = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        call('POST', '/api/account/send-code', { body: { invite: inv.code, email: `p${i}@example.com` }, from: '10.60.0.1' }),
      ),
    )
    expect(sameIp.filter((r) => r.status === 200)).toHaveLength(10)
    expect(mails).toHaveLength(10)
    mails.length = 0
    const sameEmail = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        call('POST', '/api/account/send-code', { body: { invite: inv.code, email: 'q@example.com' }, from: `10.61.0.${i}` }),
      ),
    )
    expect(sameEmail.filter((r) => r.status === 200)).toHaveLength(1)
    expect(mails).toHaveLength(1)
  })

  it('注册收尾出错时：账号已经建好，注册算成功，邀请码不还回去（不能再用它注册第二个人）', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    await call('POST', '/api/account/send-code', { body: { invite: inv.code, email: 'ming@example.com' } })
    const code = lastCode()
    const realBatch = env.DB.batch
    env.DB.batch = async () => {
      throw new Error('D1 临时出错')
    }
    const res = await call('POST', '/api/account/register', {
      body: { invite: inv.code, email: 'ming@example.com', code, username: '小明', password: 'ming-pass-1' },
    })
    env.DB.batch = realBatch
    expect(res.status).toBe(201)
    expect((await call('POST', '/api/auth/sign-in/username', { body: { username: '小明', password: 'ming-pass-1' } })).status).toBe(200)
    const row = await env.DB.prepare('SELECT used_at FROM invites').first()
    expect(row.used_at).not.toBe(null)
    expect((await register({ invite: inv.code, email: 'hong@example.com', username: '小红' })).status).toBe(400)
  })

  it('建账号失败、账号确实没建出来时：邀请码还回去，还能用', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    await call('POST', '/api/account/send-code', { body: { invite: inv.code, email: 'ming@example.com' } })
    const code = lastCode()
    const realPrepare = env.DB.prepare.bind(env.DB)
    env.DB.prepare = (sql) => {
      if (/insert into "?user"?\s*\(/i.test(sql)) throw new Error('D1 临时出错')
      return realPrepare(sql)
    }
    const res = await call('POST', '/api/account/register', {
      body: { invite: inv.code, email: 'ming@example.com', code, username: '小明', password: 'ming-pass-1' },
    }).catch((err) => err)
    env.DB.prepare = realPrepare
    expect(res.status === undefined || res.status >= 500).toBe(true)
    expect(await env.DB.prepare('SELECT 1 FROM "user" WHERE username = ?').bind('小明').first()).toBe(null)
    const row = await env.DB.prepare('SELECT used_at, used_by FROM invites').first()
    expect(row).toEqual({ used_at: null, used_by: null })
    expect((await register({ invite: inv.code, email: 'hong@example.com', username: '小红' })).status).toBe(201)
  })
})

/**
 * 让数据库在某条 SQL 上出错（Codex 第 32 轮的故障注入）。
 * when = 'before'：不执行就报错；'after'：执行了（写进去了）再报错，模拟“写成功了但回应丢了”。
 * 返回恢复函数。
 */
function breakDb(pattern, when = 'before') {
  const real = env.DB.prepare
  const fail = async (exec) => {
    if (when === 'after') await exec()
    throw new Error('D1 临时出错')
  }
  env.DB.prepare = (sql) => {
    const stmt = real(sql)
    if (!pattern.test(sql)) return stmt
    const wrap = (st) => ({
      ...st,
      bind: (...a) => wrap(st.bind(...a)),
      first: (...a) => fail(() => st.first(...a)),
      run: () => fail(() => st.run()),
      all: () => fail(() => st.all()),
    })
    return wrap(stmt)
  }
  return () => {
    env.DB.prepare = real
  }
}

const inviteRow = () => env.DB.prepare('SELECT used_at, used_by FROM invites').first()
const userCount = async () => (await env.DB.prepare('SELECT count(*) AS n FROM "user" WHERE role = ?').bind('user').first()).n
const askReset = (email, from) => call('POST', '/api/auth/email-otp/request-password-reset', { body: { email }, from })
/** 找回密码要验证码的完整回应：状态码、正文、回应的 content-type（可以指定请求的 content-type） */
async function resetReply(email, from, contentType = 'application/json') {
  const res = await handle(
    new Request('https://api.example/api/auth/email-otp/request-password-reset', {
      method: 'POST',
      headers: { origin: ORIGIN, 'cf-connecting-ip': from, 'content-type': contentType },
      body: JSON.stringify({ email }),
    }),
    env,
    clock,
    { authOptions: { iterations: 1000 } },
  )
  // serverMs 是处理用时（两种邮箱都会走到的 IP 限次分支里有），数值每次不同，比对时统一掉
  const body = (await res.text()).replace(/"serverMs":\d+/, '"serverMs":N')
  return { status: res.status, type: res.headers.get('content-type'), body }
}

describe('Codex 第 32 轮的修复', () => {
  it('找回密码：乱写的、没注册的邮箱和被拒的请求不占全站名额，真实用户照样能收到', async () => {
    const token = await adminToken()
    await register({ invite: (await newInvite(token)).code })
    mails.length = 0
    for (let i = 0; i < 30; i++) await askReset(i % 2 ? `not-an-email-${i}` : `nobody${i}@example.com`, '10.70.0.1')
    expect(await env.DB.prepare("SELECT count FROM send_limits WHERE key = 'reset-total'").first()).toBe(null)
    expect(mails).toHaveLength(0)
    expect((await askReset('ming@example.com', '10.70.0.2')).status).toBe(200)
    expect(mails).toHaveLength(1)
  })

  it('找回密码：真实邮箱的请求被按 IP 拒掉时，不占邮箱名额，换个 IP 马上能要', async () => {
    const token = await adminToken()
    await register({ invite: (await newInvite(token)).code })
    mails.length = 0
    for (let i = 0; i < 3; i++) await askReset(`x${i}@example.com`, '10.71.0.1')
    expect((await askReset('ming@example.com', '10.71.0.1')).status).toBe(429)
    expect(mails).toHaveLength(0)
    expect(await env.DB.prepare("SELECT count FROM send_limits WHERE key = 'reset-cool:ming@example.com'").first()).toBe(null)
    expect((await askReset('ming@example.com', '10.71.0.2')).status).toBe(200)
    expect(mails).toHaveLength(1)
  })

  it('找回密码的回应看不出邮箱注册过没有：连着要、隔一阵要，注册过和没注册的回应（状态码 + 正文）一样（Codex 第 33、34 轮）', async () => {
    const token = await adminToken()
    await register({ invite: (await newInvite(token)).code })
    const sequence = async (email, from) => {
      const out = []
      for (const gap of [0, 1000, 1000, 1000, 1000, 240000, 240000, 240000, 361000, 1000, 600000, 600000, 600000, 600000, 600000]) {
        clock += gap
        out.push(await resetReply(email, from))
      }
      return out
    }
    const start = clock
    const known = await sequence('ming@example.com', '10.72.0.1')
    clock = start
    const unknown = await sequence('nobody@example.com', '10.72.0.2')
    expect(known).toEqual(unknown)
    expect(known.map((r) => r.status)).toContain(429)
  })

  it('找回密码：邮箱名额用完后，用别的请求格式（text/plain）要，注册过和没注册的回应也一样（Codex 第 34 轮）', async () => {
    const token = await adminToken()
    await register({ invite: (await newInvite(token)).code })
    const probe = async (email, from) => {
      const first = await resetReply(email, from)
      const plain = await resetReply(email, from, 'text/plain')
      return [first, plain]
    }
    const known = await probe('ming@example.com', '10.73.0.1')
    const unknown = await probe('nobody@example.com', '10.73.0.2')
    expect(known).toEqual(unknown)
    expect(known[1].status).toBe(415)
  })

  it('找回密码：邮箱名额用完时不发信，也不换掉用户已经收到的验证码', async () => {
    const token = await adminToken()
    await register({ invite: (await newInvite(token)).code })
    mails.length = 0
    await askReset('ming@example.com', '10.74.0.1')
    const code = lastCode()
    expect((await askReset('ming@example.com', '10.74.0.2')).data).toEqual({ success: true })
    expect(mails).toHaveLength(1)
    const reset = await call('POST', '/api/auth/email-otp/reset-password', {
      body: { email: 'ming@example.com', otp: code, password: 'new-pass-123' },
    })
    expect(reset.status).toBe(200)
  })

  it('退名额只退自己那个窗口的：窗口换了以后，退旧名额不会减掉新窗口别人的次数', async () => {
    const { takeQuota, releaseQuotas } = await import('../backend/cloudflare/src/send-limits.js')
    const limit = { key: 'k', windowMs: 60000, max: 1 }
    const a = await takeQuota(env, limit, clock)
    const b = await takeQuota(env, limit, clock + 60000)
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    await releaseQuotas(env, [a])
    expect(await takeQuota(env, limit, clock + 60001)).toBe(null)
    await releaseQuotas(env, [b])
    expect(await takeQuota(env, limit, clock + 60002)).toBeTruthy()
  })

  it('占后面的名额时数据库出错：前面已经占的退回，错误照样抛出', async () => {
    const { takeQuotas } = await import('../backend/cloudflare/src/send-limits.js')
    const limits = [
      { key: 'first', windowMs: 60000, max: 1 },
      { key: 'second', windowMs: 60000, max: 1 },
    ]
    let calls = 0
    const real = env.DB.prepare
    env.DB.prepare = (sql) => {
      if (/INSERT INTO send_limits/.test(sql) && ++calls === 2) throw new Error('D1 临时出错')
      return real(sql)
    }
    await expect(takeQuotas(env, limits, clock)).rejects.toThrow('D1 临时出错')
    env.DB.prepare = real
    expect(await takeQuotas(env, limits, clock + 1)).toHaveLength(2)
  })

  it('建账号回应丢了、接着查账号也出错：邀请码保持已用，不能再注册第二个人', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    await call('POST', '/api/account/send-code', { body: { invite: inv.code, email: 'ming@example.com' } })
    const code = lastCode()
    const restoreA = breakDb(/insert into "?account"?\s*\(/i, 'after')
    const restoreB = breakDb(/EXISTS \(\s*SELECT 1 FROM "account"/i)
    const res = await call('POST', '/api/account/register', {
      body: { invite: inv.code, email: 'ming@example.com', code, username: '小明', password: 'ming-pass-1' },
    })
    restoreB()
    restoreA()
    expect(res.status).toBe(500)
    expect(res.data.error).toMatch(/登录/)
    expect((await inviteRow()).used_at).not.toBe(null)
    expect((await register({ invite: inv.code, email: 'hong@example.com', username: '小红' })).status).toBe(400)
    expect(await userCount()).toBe(1)
    expect((await call('POST', '/api/auth/sign-in/username', { body: { username: '小明', password: 'ming-pass-1' } })).status).toBe(200)
  })

  it('建账号回应丢了但账号和密码都写好了：注册算成功', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    await call('POST', '/api/account/send-code', { body: { invite: inv.code, email: 'ming@example.com' } })
    const code = lastCode()
    const restore = breakDb(/insert into "?account"?\s*\(/i, 'after')
    const res = await call('POST', '/api/account/register', {
      body: { invite: inv.code, email: 'ming@example.com', code, username: '小明', password: 'ming-pass-1' },
    })
    restore()
    expect(res.status).toBe(201)
    expect((await call('POST', '/api/auth/sign-in/username', { body: { username: '小明', password: 'ming-pass-1' } })).status).toBe(200)
  })

  it('只写了用户、密码没写进去：删掉半成品，邀请码还回去，用同一个码和验证码重试能成功', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    await call('POST', '/api/account/send-code', { body: { invite: inv.code, email: 'ming@example.com' } })
    const code = lastCode()
    const body = { invite: inv.code, email: 'ming@example.com', code, username: '小明', password: 'ming-pass-1' }
    const restore = breakDb(/insert into "?account"?\s*\(/i)
    const res = await call('POST', '/api/account/register', { body })
    restore()
    expect(res.status).toBe(500)
    expect(await userCount()).toBe(0)
    expect(await inviteRow()).toEqual({ used_at: null, used_by: null })
    expect((await call('POST', '/api/account/register', { body })).status).toBe(201)
    expect((await call('POST', '/api/auth/sign-in/username', { body: { username: '小明', password: 'ming-pass-1' } })).status).toBe(200)
  })
})

describe('Codex 第 35 轮的修复', () => {
  it('邮箱格式规则和 Better Auth 用的 z.email() 一致', async () => {
    const { z } = await import('zod')
    const { EMAIL_RE } = await import('../backend/cloudflare/src/auth-setup.js')
    const samples = [
      'ming@example.com', 'a.b+c@x.co', "o'neil@x.io", 'a_b-c@sub.domain.cn', '123456789@qq.com',
      ' ming@example.com', 'ming@example.com ', '\tming@example.com\n', 'a..b@x.com', '.a@x.com', 'a.@x.com',
      'a@-x.com', 'a@x', 'a@x.c', 'a@x..com', 'a@@x.com', 'a b@x.com', '中文@x.com', 'a@中文.com', 'a@x.com.',
      'a@x.invalid', 'A@X.COM', '', '@x.com', 'a@', 'a@1.23', 'a@x.c0m',
    ]
    for (const s of samples) expect([s, EMAIL_RE.test(s)]).toEqual([s, z.email().safeParse(s).success])
  })

  it('找回密码：邮箱两边带空白时，冷却 / 每天上限 / 全站上限三种情况下注册过和没注册的回应都一样', async () => {
    const token = await adminToken()
    await register({ invite: (await newInvite(token)).code })
    const fill = async (kind, email) => {
      if (kind === 'cool') await resetReply(email, `10.80.${email.length}.1`)
      if (kind === 'day') {
        await env.DB.prepare('INSERT INTO send_limits (key, count, window_start) VALUES (?, 5, ?)').bind(`reset-email:${email}`, clock).run()
      }
      if (kind === 'total') {
        await env.DB.prepare("INSERT OR REPLACE INTO send_limits (key, count, window_start) VALUES ('reset-total', 200, ?)").bind(clock).run()
      }
    }
    let n = 0
    for (const kind of ['cool', 'day', 'total']) {
      for (const pad of [[' ', ' '], ['\t', '\n'], ['', ' ']]) {
        const replies = []
        for (const email of ['ming@example.com', 'nobody@example.com']) {
          await env.DB.prepare('DELETE FROM send_limits').run()
          await fill(kind, email)
          replies.push(await resetReply(`${pad[0]}${email}${pad[1]}`, `10.81.0.${++n}`))
        }
        expect([kind, pad, replies[0]]).toEqual([kind, pad, replies[1]])
        expect(replies[0].status).toBe(400)
      }
    }
  })

  it('.invalid 结尾的邮箱不能注册、不能加成管理员（留给占位邮箱用）', async () => {
    const token = await adminToken()
    const inv = await newInvite(token)
    const sent = await call('POST', '/api/account/send-code', { body: { invite: inv.code, email: 'nobody@quota-exhausted.invalid' } })
    expect(sent.status).toBe(400)
    const admin = await call('POST', '/api/admin/admins', {
      token,
      body: { username: '占位', email: 'nobody@quota-exhausted.invalid', password: 'some-pass-1' },
    })
    expect(admin.status).toBe(400)
    expect(await env.DB.prepare('SELECT 1 FROM "user" WHERE email LIKE ?').bind('%.invalid').first()).toBe(null)
  })
})
