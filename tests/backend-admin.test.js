// @vitest-environment node
// 阶段 4-2 后台的测试：登录（Better Auth）、管理员权限、菜单的增删改、导入、餐次、管理员名单。
// 用 Node 自带的 SQLite 模拟 D1，直接调用 handle()。
import { describe, it, expect, beforeEach } from 'vitest'
import { handle } from '../backend/cloudflare/src/worker.js'
import { createAuth } from '../backend/cloudflare/src/auth-setup.js'
import { fakeD1 } from './helpers/fake-d1.js'

const ORIGIN = 'https://weit0529.github.io'
const OPTS = { authOptions: { iterations: 1000 } } // 测试里把 PBKDF2 次数调小，跑得快
let env
let ip = 0

beforeEach(() => {
  env = {
    DB: fakeD1(),
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`,
    AUTH_BASE_URL: 'https://api.example',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
    BOOTSTRAP_TOKEN: 'boot-token',
  }
  ip++
})

async function call(method, path, { body, token, origin = ORIGIN, from } = {}) {
  const headers = { origin, 'cf-connecting-ip': from ?? `10.0.0.${ip}` }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const res = await handle(
    new Request(`https://api.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
    Date.now(),
    OPTS,
  )
  let data = null
  try {
    data = await res.clone().json()
  } catch {
    // 没有 JSON 正文
  }
  return { status: res.status, headers: res.headers, data }
}

const ADMIN = { username: '阿涛', email: 'tao@example.com', password: 'admin-pass-1' }

async function bootstrap() {
  return call('POST', '/api/admin/bootstrap', { body: { token: 'boot-token', ...ADMIN } })
}

async function signIn(username = ADMIN.username, password = ADMIN.password, from) {
  const res = await call('POST', '/api/auth/sign-in/username', { body: { username, password }, from })
  return { ...res, token: res.headers.get('set-auth-token') }
}

async function adminToken() {
  await bootstrap()
  return (await signIn()).token
}

const DISH = { name: '麻辣烫', shop: '楼下', category: '火锅串串', meals: ['lunch', 'dinner'], tags: ['辣'], price: 25 }

describe('第一个管理员（bootstrap）', () => {
  it('口令不对不能建；口令对建好后，再调就不行了', async () => {
    expect((await call('POST', '/api/admin/bootstrap', { body: { token: 'x', ...ADMIN } })).status).toBe(403)
    expect((await bootstrap()).status).toBe(201)
    expect((await bootstrap()).status).toBe(409)
  })

  it('没设 BOOTSTRAP_TOKEN 时这个接口一律不能用', async () => {
    delete env.BOOTSTRAP_TOKEN
    expect((await call('POST', '/api/admin/bootstrap', { body: { token: undefined, ...ADMIN } })).status).toBe(403)
  })

  it('用户名、邮箱、密码格式不对时拒绝', async () => {
    const bad = (patch) => call('POST', '/api/admin/bootstrap', { body: { token: 'boot-token', ...ADMIN, ...patch } })
    expect((await bad({ username: 'a' })).status).toBe(400)
    expect((await bad({ email: 'not-an-email' })).status).toBe(400)
    expect((await bad({ password: 'short' })).status).toBe(400)
  })
})

describe('登录（Better Auth）', () => {
  it('用户名 + 密码登录成功，凭证在响应头 set-auth-token，网页读得到', async () => {
    await bootstrap()
    const res = await signIn()
    expect(res.status).toBe(200)
    expect(res.token).toBeTruthy()
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(res.headers.get('access-control-expose-headers')).toContain('set-auth-token')
  })

  it('密码错不能登录；不开放注册', async () => {
    await bootstrap()
    expect((await signIn(ADMIN.username, 'wrong-pass-1')).status).toBe(401)
    const signUp = await call('POST', '/api/auth/sign-up/email', {
      body: { email: 'x@example.com', password: 'whatever-123', name: 'x' },
    })
    expect(signUp.status).not.toBe(200)
  })

  it('数据库里的密码是 PBKDF2 加密后的，不是原文', async () => {
    await bootstrap()
    const row = await env.DB.prepare('SELECT password FROM "account"').first()
    expect(row.password).toMatch(/^pbkdf2\$1000\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
    expect(row.password).not.toContain(ADMIN.password)
  })

  it('同一个地址 15 分钟内登录超过 10 次就被限制', async () => {
    await bootstrap()
    const statuses = []
    for (let i = 0; i < 11; i++) statuses.push((await signIn(ADMIN.username, 'wrong-pass-1', '10.9.9.9')).status)
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})

describe('管理员权限', () => {
  it('没登录、凭证不对都不能用管理接口', async () => {
    await bootstrap()
    expect((await call('GET', '/api/admin/menu')).status).toBe(401)
    expect((await call('GET', '/api/admin/menu', { token: 'nope' })).status).toBe(401)
  })

  it('普通用户（不是管理员）不能改菜单', async () => {
    await bootstrap()
    const auth = createAuth(env, OPTS.authOptions)
    await auth.api.createUser({
      body: { email: 'u@example.com', password: 'user-pass-1', name: '小明', role: 'user', data: { username: '小明', displayUsername: '小明' } },
    })
    const { token } = await signIn('小明', 'user-pass-1')
    expect(token).toBeTruthy()
    expect((await call('POST', '/api/admin/dishes', { body: DISH, token })).status).toBe(403)
  })
})

describe('菜单的增删改', () => {
  it('空菜单：网站读到早午晚三个餐次、没有菜', async () => {
    const res = await call('GET', '/api/menu')
    expect(res.status).toBe(200)
    expect(res.data.version).toBe(2)
    expect(res.data.meals.map((m) => m.id)).toEqual(['breakfast', 'lunch', 'dinner'])
    expect(res.data.items).toEqual([])
  })

  it('加一道菜 → 网站马上读到；停用的菜网站上看不到，管理页看得到', async () => {
    const token = await adminToken()
    const add = await call('POST', '/api/admin/dishes', { body: DISH, token })
    expect(add.status).toBe(201)
    expect(add.data.dish.id).toMatch(/^d_[0-9a-f]{16}$/)
    let menu = (await call('GET', '/api/menu')).data
    expect(menu.items).toEqual([
      expect.objectContaining({ name: '麻辣烫', shop: '楼下', meals: ['lunch', 'dinner'], tags: ['辣'], price: 25, status: 'approved' }),
    ])
    await call('POST', '/api/admin/dishes', { body: { ...DISH, name: '烧烤', enabled: false }, token })
    menu = (await call('GET', '/api/menu')).data
    expect(menu.items.map((i) => i.name)).toEqual(['麻辣烫'])
    const admin = (await call('GET', '/api/admin/menu', { token })).data
    expect(admin.dishes.map((d) => [d.name, d.enabled])).toEqual([
      ['麻辣烫', true],
      ['烧烤', false],
    ])
  })

  it('改名后编号不变；“品类 + 店铺”和别的菜重复时不让改', async () => {
    const token = await adminToken()
    const a = (await call('POST', '/api/admin/dishes', { body: DISH, token })).data.dish
    await call('POST', '/api/admin/dishes', { body: { ...DISH, name: '黄焖鸡' }, token })
    const renamed = await call('PUT', `/api/admin/dishes/${a.id}`, { body: { ...DISH, name: '冒菜' }, token })
    expect(renamed.status).toBe(200)
    expect(renamed.data.dish).toMatchObject({ id: a.id, name: '冒菜' })
    const dup = await call('PUT', `/api/admin/dishes/${a.id}`, { body: { ...DISH, name: '黄焖鸡' }, token })
    expect(dup.status).toBe(400)
    expect(dup.data.errors[0].message).toContain('已经有这道菜')
  })

  it('填写有误时说明哪一项错了；不存在的餐次不收', async () => {
    const token = await adminToken()
    const res = await call('POST', '/api/admin/dishes', { body: { ...DISH, name: '', meals: ['夜宵'], price: -1 }, token })
    expect(res.status).toBe(400)
    expect(res.data.errors.map((e) => e.field).sort()).toEqual(['meals', 'name', 'price'])
  })

  it('删一道菜；删不存在的菜返回 404', async () => {
    const token = await adminToken()
    const a = (await call('POST', '/api/admin/dishes', { body: DISH, token })).data.dish
    await call('POST', '/api/admin/dishes', { body: { ...DISH, name: '黄焖鸡' }, token })
    expect((await call('DELETE', `/api/admin/dishes/${a.id}`, { token })).status).toBe(200)
    expect((await call('GET', '/api/menu')).data.items.map((i) => i.name)).toEqual(['黄焖鸡'])
    expect((await call('DELETE', `/api/admin/dishes/${a.id}`, { token })).status).toBe(404)
  })
})

describe('额外餐次', () => {
  it('加了以后网站读得到，菜也能选它；还有菜在用时不让去掉', async () => {
    const token = await adminToken()
    expect((await call('PUT', '/api/admin/meals', { body: { labels: ['下午茶', '夜宵'] }, token })).status).toBe(200)
    expect((await call('GET', '/api/menu')).data.meals.map((m) => m.id)).toEqual(['breakfast', 'lunch', 'dinner', '下午茶', '夜宵'])
    await call('POST', '/api/admin/dishes', { body: { ...DISH, meals: ['夜宵'] }, token })
    const remove = await call('PUT', '/api/admin/meals', { body: { labels: ['下午茶'] }, token })
    expect(remove.status).toBe(409)
    expect(remove.data.error).toContain('麻辣烫（楼下）')
  })

  it('名字不合规时拒绝', async () => {
    const token = await adminToken()
    expect((await call('PUT', '/api/admin/meals', { body: { labels: ['午餐'] }, token })).status).toBe(400)
    expect((await call('PUT', '/api/admin/meals', { body: { labels: ['下 午'] }, token })).status).toBe(400)
  })
})

describe('Excel 导入（整个替换菜单）', () => {
  const legacy = (name, shop = '') => JSON.stringify([name, shop])

  it('新菜沿用原来的编号（["品类","店铺"]）；已有的菜按品类 + 店铺认出来，编号不变；表格里没有的菜被删掉', async () => {
    const token = await adminToken()
    const kept = (await call('POST', '/api/admin/dishes', { body: DISH, token })).data.dish
    await call('POST', '/api/admin/dishes', { body: { ...DISH, name: '要被删掉的菜' }, token })
    const res = await call('POST', '/api/admin/import', {
      token,
      body: {
        mealLabels: ['夜宵'],
        dishes: [
          { ...DISH, id: legacy('麻辣烫', '楼下'), price: 30 },
          { name: '烧烤', category: '烧烤', meals: ['夜宵'], id: legacy('烧烤'), enabled: false },
          { name: '粥', category: '粥', meals: ['breakfast'], id: legacy('粥') },
        ],
      },
    })
    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({ count: 3, enabled: 2 })
    const admin = (await call('GET', '/api/admin/menu', { token })).data
    expect(admin.dishes.map((d) => [d.id, d.name, d.enabled])).toEqual([
      [kept.id, '麻辣烫', true],
      [legacy('烧烤'), '烧烤', false],
      [legacy('粥'), '粥', true],
    ])
    expect(admin.dishes[0].price).toBe(30)
    expect(admin.meals.map((m) => m.id)).toContain('夜宵')
  })

  it('表格有错时一道都不改，并说明第几道菜错了', async () => {
    const token = await adminToken()
    await call('POST', '/api/admin/dishes', { body: DISH, token })
    const res = await call('POST', '/api/admin/import', {
      token,
      body: { mealLabels: [], dishes: [{ ...DISH }, { ...DISH }, { name: '', category: 'x', meals: ['lunch'] }] },
    })
    expect(res.status).toBe(400)
    expect(res.data.problems.join('\n')).toMatch(/第 2 道菜：和前面的菜重复[\s\S]*第 3 道菜/)
    expect((await call('GET', '/api/admin/menu', { token })).data.dishes).toHaveLength(1)
  })

  it('全部停用时拒绝（网站上就没有菜了）', async () => {
    const token = await adminToken()
    const res = await call('POST', '/api/admin/import', {
      token,
      body: { mealLabels: [], dishes: [{ ...DISH, enabled: false }] },
    })
    expect(res.status).toBe(400)
  })
})

describe('管理员名单', () => {
  it('加一个管理员，他能登录、能管菜单；不能去掉自己；能去掉别人，去掉后他的登录失效', async () => {
    const token = await adminToken()
    const add = await call('POST', '/api/admin/admins', {
      token,
      body: { username: '小红', email: 'hong@example.com', password: 'hong-pass-1' },
    })
    expect(add.status).toBe(201)
    const list = (await call('GET', '/api/admin/admins', { token })).data.admins
    expect(list.map((a) => [a.username, a.isMe])).toEqual([
      ['阿涛', true],
      ['小红', false],
    ])
    const hong = await signIn('小红', 'hong-pass-1')
    expect((await call('POST', '/api/admin/dishes', { body: DISH, token: hong.token })).status).toBe(201)
    const me = list.find((a) => a.isMe)
    expect((await call('DELETE', `/api/admin/admins/${me.id}`, { token })).status).toBe(400)
    const other = list.find((a) => !a.isMe)
    expect((await call('DELETE', `/api/admin/admins/${other.id}`, { token })).status).toBe(200)
    expect((await call('GET', '/api/admin/menu', { token: hong.token })).status).toBe(401)
  })

  it('用户名或邮箱重复时拒绝', async () => {
    const token = await adminToken()
    const dup = await call('POST', '/api/admin/admins', { token, body: { ...ADMIN, email: 'other@example.com' } })
    expect(dup.status).toBe(409)
  })
})

describe('跨域和请求大小', () => {
  it('预检请求允许 PUT、DELETE 和 authorization 头', async () => {
    const res = await call('OPTIONS', '/api/admin/dishes/x')
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toContain('DELETE')
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization')
  })

  it('不在名单里的网页拿不到跨域许可', async () => {
    const res = await call('GET', '/api/menu', { origin: 'https://evil.example' })
    expect(res.headers.get('access-control-allow-origin')).toBe(null)
  })

  it('登录接口的请求体超过 16KB 直接拒绝', async () => {
    const res = await call('POST', '/api/auth/sign-in/username', { body: { username: 'x', password: 'p'.repeat(20000) } })
    expect(res.status).toBe(413)
  })
})

describe('Codex 第 28 轮的修复', () => {
  it('只开放用得到的登录接口：邮箱登录、改角色、建用户都不开放（不能绕过限次、不能把最后一个管理员降级）', async () => {
    const token = await adminToken()
    const email = await call('POST', '/api/auth/sign-in/email', { body: { email: ADMIN.email, password: ADMIN.password } })
    expect(email.status).toBe(404)
    const me = (await call('GET', '/api/admin/admins', { token })).data.admins[0]
    const setRole = await call('POST', '/api/auth/admin/set-role', { token, body: { userId: me.id, role: 'user' } })
    expect(setRole.status).toBe(404)
    const createUser = await call('POST', '/api/auth/admin/create-user', {
      token,
      body: { email: 'x@example.com', password: 'whatever-123', name: 'x', role: 'admin' },
    })
    expect(createUser.status).toBe(404)
    // 自己仍是管理员
    expect((await call('GET', '/api/admin/menu', { token })).status).toBe(200)
  })

  it('改密码后后台换发新凭证；新凭证能继续管菜单，旧凭证失效', async () => {
    const token = await adminToken()
    const res = await call('POST', '/api/auth/change-password', {
      token,
      body: { currentPassword: ADMIN.password, newPassword: 'new-pass-123', revokeOtherSessions: true },
    })
    expect(res.status).toBe(200)
    const renewed = res.headers.get('set-auth-token')
    expect(renewed).toBeTruthy()
    expect(renewed).not.toBe(token)
    expect((await call('GET', '/api/admin/menu', { token: renewed })).status).toBe(200)
    expect((await call('GET', '/api/admin/menu', { token })).status).toBe(401)
    expect((await signIn(ADMIN.username, 'new-pass-123')).status).toBe(200)
  })

  it('至少留一道启用的菜：最后一道启用的菜不能暂停、不能删；暂停的菜随便删', async () => {
    const token = await adminToken()
    const a = (await call('POST', '/api/admin/dishes', { body: DISH, token })).data.dish
    const b = (await call('POST', '/api/admin/dishes', { body: { ...DISH, name: '烧烤', enabled: false }, token })).data.dish
    const pause = await call('PUT', `/api/admin/dishes/${a.id}`, { body: { ...DISH, enabled: false }, token })
    expect(pause.status).toBe(409)
    expect(pause.data.error).toContain('至少要留一道启用的通用菜')
    expect((await call('DELETE', `/api/admin/dishes/${a.id}`, { token })).status).toBe(409)
    // 改别的项（不停用）照样可以
    expect((await call('PUT', `/api/admin/dishes/${a.id}`, { body: { ...DISH, price: 30 }, token })).status).toBe(200)
    expect((await call('DELETE', `/api/admin/dishes/${b.id}`, { token })).status).toBe(200)
    // 加了第二道启用的菜之后，就能暂停第一道了
    await call('POST', '/api/admin/dishes', { body: { ...DISH, name: '黄焖鸡' }, token })
    expect((await call('PUT', `/api/admin/dishes/${a.id}`, { body: { ...DISH, enabled: false }, token })).status).toBe(200)
  })
})
