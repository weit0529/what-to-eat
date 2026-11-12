// @vitest-environment node
// 阶段 4-4a 后台的测试：三层菜单（通用 / 共享 / 我的）、加菜、审核、加菜权限（REQUIREMENTS.md R-024、R-029）。
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
  const headers = { origin: ORIGIN, 'cf-connecting-ip': from ?? `10.9.${ip % 250}.${Math.floor(Math.random() * 250)}` }
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
  return { status: res.status, data }
}

async function adminToken() {
  await call('POST', '/api/admin/bootstrap', {
    body: { token: 'boot-token', username: '阿涛', email: 'tao@example.com', password: 'admin-pass-1' },
  })
  return signInToken('阿涛', 'admin-pass-1')
}

async function signInToken(username, password) {
  const res = await handle(
    new Request('https://api.example/api/auth/sign-in/username', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': `10.8.0.${ip % 250}` },
      body: JSON.stringify({ username, password }),
    }),
    env,
    clock,
    { authOptions: { iterations: 1000 } },
  )
  return res.headers.get('set-auth-token')
}

/** 用邀请码注册一个普通用户，返回 { token, id } */
async function newUser(admin, username, email) {
  const invite = (await call('POST', '/api/admin/invites', { token: admin })).data.invite.code
  await call('POST', '/api/account/send-code', { body: { invite, email } })
  const code = mails.at(-1).text.match(/\d{6}/)[0]
  const res = await call('POST', '/api/account/register', { body: { invite, email, code, username, password: 'user-pass-1' } })
  expect(res.status).toBe(201)
  const token = await signInToken(username, 'user-pass-1')
  const session = await call('GET', '/api/auth/get-session', { token })
  return { token, id: session.data.user.id }
}

const GENERAL = { name: '麻辣烫', shop: '楼下', category: '火锅串串', meals: ['lunch', 'dinner'], tags: ['辣'], price: 25 }
const MINE = { name: '妈妈的红烧肉', category: '家常菜', meals: ['dinner'], tags: ['下饭'], price: 0, description: '周末才有' }

/** 准备：一个管理员 + 一道通用菜 + 两个用户 */
async function setup() {
  const admin = await adminToken()
  const general = (await call('POST', '/api/admin/dishes', { body: GENERAL, token: admin })).data.dish
  const ming = await newUser(admin, '小明', 'ming@example.com')
  const hong = await newUser(admin, '小红', 'hong@example.com')
  return { admin, general, ming, hong }
}

const ids = (items) => items.map((item) => item.id)

/** 待审核列表里这道菜现在的版本号（审核时要带上） */
async function revisionOf(admin, id) {
  return (await call('GET', '/api/admin/reviews', { token: admin })).data.reviews.find((r) => r.id === id)?.revision
}
/** 管理员按列表里看到的版本通过（body 可以带改过的 dish） */
async function approve(admin, id, body = {}) {
  return call('POST', `/api/admin/reviews/${id}/approve`, { body: { revision: await revisionOf(admin, id), ...body }, token: admin })
}
async function reject(admin, id, note) {
  return call('POST', `/api/admin/reviews/${id}/reject`, { body: { revision: await revisionOf(admin, id), note }, token: admin })
}

describe('三层菜单：我的菜只有自己看得到', () => {
  it('没登录只看通用菜单；登录后的内部菜单 = 通用 + 我的，别人的菜看不到', async () => {
    const { general, ming, hong } = await setup()
    const added = await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })
    expect(added.status).toBe(201)
    const mine = added.data.dish
    expect(mine).toMatchObject({ name: '妈妈的红烧肉', status: 'private', reviewNote: null })
    expect(mine.id).toMatch(/^u_/)

    expect(ids((await call('GET', '/api/menu')).data.items)).toEqual([general.id])
    expect((await call('GET', '/api/my/menu')).status).toBe(401)

    const mingMenu = (await call('GET', '/api/my/menu', { token: ming.token })).data
    expect(mingMenu.version).toBe(2)
    expect(mingMenu.items.map((i) => [i.id, i.source, i.mine])).toEqual([
      [general.id, 'admin', false],
      [mine.id, 'mine', true],
    ])
    expect(ids((await call('GET', '/api/my/menu', { token: hong.token })).data.items)).toEqual([general.id])
  })

  it('加菜的规则和管理员一样；图片先不能填；自己的菜不能重复，但可以和通用菜单同名', async () => {
    const { ming } = await setup()
    const bad = await call('POST', '/api/my/dishes', { body: { name: '没分类', meals: ['lunch'] }, token: ming.token })
    expect(bad.status).toBe(400)
    expect(bad.data.errors.map((e) => e.field)).toContain('category')
    const withImage = await call('POST', '/api/my/dishes', { body: { ...MINE, image: 'malatang.jpg' }, token: ming.token })
    expect(withImage.data.dish.image).toBe(null)
    expect((await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).status).toBe(400)
    expect((await call('POST', '/api/my/dishes', { body: GENERAL, token: ming.token })).status).toBe(201)
  })

  it('只能改、删自己的菜', async () => {
    const { ming, hong } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    expect((await call('PUT', `/api/my/dishes/${dish.id}`, { body: { ...MINE, price: 1 }, token: hong.token })).status).toBe(404)
    expect((await call('DELETE', `/api/my/dishes/${dish.id}`, { token: hong.token })).status).toBe(404)
    const edited = await call('PUT', `/api/my/dishes/${dish.id}`, { body: { ...MINE, price: 18 }, token: ming.token })
    expect(edited.data.dish.price).toBe(18)
    expect((await call('DELETE', `/api/my/dishes/${dish.id}`, { token: ming.token })).status).toBe(200)
    expect((await call('GET', '/api/my/dishes', { token: ming.token })).data.dishes).toEqual([])
  })
})

describe('提交审核', () => {
  it('提交后锁住：不能改、不能删、不能再提交；管理员的待审核列表里有，标出重名', async () => {
    const { admin, ming } = await setup()
    const a = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    const b = (await call('POST', '/api/my/dishes', { body: GENERAL, token: ming.token })).data.dish
    for (const d of [a, b]) expect((await call('POST', `/api/my/dishes/${d.id}/submit`, { token: ming.token })).data.dish.status).toBe('pending')
    expect((await call('PUT', `/api/my/dishes/${a.id}`, { body: MINE, token: ming.token })).status).toBe(409)
    expect((await call('DELETE', `/api/my/dishes/${a.id}`, { token: ming.token })).status).toBe(409)
    expect((await call('POST', `/api/my/dishes/${a.id}/submit`, { token: ming.token })).status).toBe(409)
    // 审核中的菜自己照样能抽
    const menu = (await call('GET', '/api/my/menu', { token: ming.token })).data.items
    expect(menu.find((i) => i.id === a.id).status).toBe('pending')

    const reviews = (await call('GET', '/api/admin/reviews', { token: admin })).data.reviews
    expect(reviews.map((r) => [r.id, r.author, r.duplicate])).toEqual([
      [a.id, '小明', false],
      [b.id, '小明', true],
    ])
    expect((await call('GET', '/api/admin/reviews', { token: ming.token })).status).toBe(403)
  })

  it('退回要写理由；退回后用户看到理由，能改了再提交', async () => {
    const { admin, ming } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    expect((await reject(admin, dish.id, '')).status).toBe(400)
    expect((await reject(admin, dish.id, '写一下是哪家店')).status).toBe(200)
    const mine = (await call('GET', '/api/my/dishes', { token: ming.token })).data.dishes[0]
    expect(mine).toMatchObject({ status: 'rejected', reviewNote: '写一下是哪家店' })
    expect((await call('PUT', `/api/my/dishes/${dish.id}`, { body: { ...MINE, shop: '家里' }, token: ming.token })).status).toBe(200)
    const again = (await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })).data.dish
    expect(again).toMatchObject({ status: 'pending', reviewNote: null })
  })

  it('通过（管理员先改再通过）：编号不变，变成共享菜；所有登录用户能抽到，没登录的看不到；作者不能再改', async () => {
    const { admin, general, ming, hong } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    const approved = await approve(admin, dish.id, { dish: { ...MINE, name: '红烧肉', shop: '小明家' } })
    expect(approved.status).toBe(200)
    expect(approved.data.dish).toMatchObject({ id: dish.id, name: '红烧肉', source: 'shared' })

    const hongMenu = (await call('GET', '/api/my/menu', { token: hong.token })).data.items
    expect(hongMenu.map((i) => [i.id, i.source, i.mine])).toEqual([
      [general.id, 'admin', false],
      [dish.id, 'shared', false],
    ])
    const mingMenu = (await call('GET', '/api/my/menu', { token: ming.token })).data.items
    expect(mingMenu.find((i) => i.id === dish.id)).toMatchObject({ source: 'shared', mine: true })
    expect(ids((await call('GET', '/api/menu')).data.items)).toEqual([general.id])

    const my = (await call('GET', '/api/my/dishes', { token: ming.token })).data
    expect(my.dishes).toEqual([])
    expect(my.approved.map((d) => d.id)).toEqual([dish.id])
    expect((await call('PUT', `/api/my/dishes/${dish.id}`, { body: MINE, token: ming.token })).status).toBe(404)
    expect((await call('GET', '/api/admin/reviews', { token: admin })).data.reviews).toEqual([])

    const adminMenu = (await call('GET', '/api/admin/menu', { token: admin })).data.dishes
    expect(adminMenu.find((d) => d.id === dish.id)).toMatchObject({ scope: 'shared', author: '小明' })
  })

  it('和已有的菜重名时不能直接通过，改个名字就行', async () => {
    const { admin, ming } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: GENERAL, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    expect((await approve(admin, dish.id)).status).toBe(400)
    const ok = await approve(admin, dish.id, { dish: { ...GENERAL, shop: '学校门口' } })
    expect(ok.status).toBe(200)
  })

  it('两个管理员同时通过同一道菜：只有一个成功，菜只有一份', async () => {
    const { admin, ming } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    const revision = await revisionOf(admin, dish.id)
    const results = await Promise.all([1, 2].map(() => call('POST', `/api/admin/reviews/${dish.id}/approve`, { body: { revision }, token: admin })))
    const statuses = results.map((r) => r.status).sort()
    expect(statuses[0]).toBe(200)
    expect([404, 409]).toContain(statuses[1])
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM dishes WHERE id = ?').bind(dish.id).first()).n).toBe(1)
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM user_dishes').first()).n).toBe(0)
  })

  it('共享菜一键移到通用菜单，没登录的人也能看到；通用菜不能再“移”', async () => {
    const { admin, general, ming } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    await approve(admin, dish.id)
    expect((await call('POST', `/api/admin/dishes/${dish.id}/promote`, { token: admin })).status).toBe(200)
    expect(ids((await call('GET', '/api/menu')).data.items)).toEqual([general.id, dish.id])
    expect((await call('POST', `/api/admin/dishes/${general.id}/promote`, { token: admin })).status).toBe(404)
    expect((await call('POST', `/api/admin/dishes/${dish.id}/promote`, { token: ming.token })).status).toBe(403)
  })
})

describe('加菜权限（总开关 + 黑白名单）', () => {
  it('总开关关上：用户不能加改删提交，已有的菜照常能用；白名单里的人可以；管理员不受限', async () => {
    const { admin, ming, hong } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    expect((await call('PUT', '/api/admin/dish-access', { body: { open: false }, token: admin })).status).toBe(200)

    const blocked = await call('POST', '/api/my/dishes', { body: GENERAL, token: ming.token })
    expect(blocked).toMatchObject({ status: 403, data: { error: '管理员暂时关闭了加菜' } })
    expect((await call('PUT', `/api/my/dishes/${dish.id}`, { body: MINE, token: ming.token })).status).toBe(403)
    expect((await call('DELETE', `/api/my/dishes/${dish.id}`, { token: ming.token })).status).toBe(403)
    expect((await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })).status).toBe(403)
    expect((await call('GET', '/api/my/dishes', { token: ming.token })).data).toMatchObject({ canEdit: false, reason: '管理员暂时关闭了加菜' })
    expect(ids((await call('GET', '/api/my/menu', { token: ming.token })).data.items)).toContain(dish.id)

    await call('PUT', `/api/admin/dish-access/${hong.id}`, { body: { list: 'white' }, token: admin })
    expect((await call('POST', '/api/my/dishes', { body: MINE, token: hong.token })).status).toBe(201)
    expect((await call('POST', '/api/my/dishes', { body: MINE, token: admin })).status).toBe(201)
  })

  it('总开关打开：黑名单里的人不能加；拿出名单就恢复', async () => {
    const { admin, ming, hong } = await setup()
    await call('PUT', `/api/admin/dish-access/${ming.id}`, { body: { list: 'black' }, token: admin })
    expect((await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).status).toBe(403)
    expect((await call('POST', '/api/my/dishes', { body: MINE, token: hong.token })).status).toBe(201)
    const access = (await call('GET', '/api/admin/dish-access', { token: admin })).data
    expect(access.open).toBe(true)
    expect(access.users.map((u) => [u.username, u.list, u.dishCount])).toEqual([
      ['小明', 'black', 0],
      ['小红', null, 1],
    ])
    await call('PUT', `/api/admin/dish-access/${ming.id}`, { body: { list: null }, token: admin })
    expect((await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).status).toBe(201)
  })

  it('用户列表里“加了几道”也算审核通过的', async () => {
    const { admin, ming } = await setup()
    const a = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    await call('POST', '/api/my/dishes', { body: GENERAL, token: ming.token })
    await call('POST', `/api/my/dishes/${a.id}/submit`, { token: ming.token })
    await approve(admin, a.id)
    const users = (await call('GET', '/api/admin/dish-access', { token: admin })).data.users
    expect(users.find((u) => u.username === '小明').dishCount).toBe(2)
  })

  it('名单的规则：不能把管理员放进名单；格式不对、没有这个人都报错；普通用户不能改设置', async () => {
    const { admin, ming } = await setup()
    const adminId = (await call('GET', '/api/auth/get-session', { token: admin })).data.user.id
    expect((await call('PUT', `/api/admin/dish-access/${adminId}`, { body: { list: 'black' }, token: admin })).status).toBe(400)
    expect((await call('PUT', `/api/admin/dish-access/${ming.id}`, { body: { list: 'grey' }, token: admin })).status).toBe(400)
    expect((await call('PUT', '/api/admin/dish-access/nobody', { body: { list: 'black' }, token: admin })).status).toBe(404)
    expect((await call('PUT', '/api/admin/dish-access', { body: { open: 'no' }, token: admin })).status).toBe(400)
    expect((await call('PUT', '/api/admin/dish-access', { body: { open: false }, token: ming.token })).status).toBe(403)
    expect((await call('GET', '/api/admin/dish-access', { token: ming.token })).status).toBe(403)
  })

  it('每人每分钟最多改动 30 次，过一分钟恢复；被禁止的人不占次数', async () => {
    const { ming } = await setup()
    for (let i = 0; i < 30; i++) {
      expect((await call('POST', '/api/my/dishes', { body: { ...MINE, name: `菜${i}` }, token: ming.token })).status).toBe(201)
    }
    expect((await call('POST', '/api/my/dishes', { body: { ...MINE, name: '第 31 道' }, token: ming.token })).status).toBe(429)
    const later = await call('POST', '/api/my/dishes', { body: { ...MINE, name: '第 31 道' }, token: ming.token, now: clock + 61000 })
    expect(later.status).toBe(201)
  })
})

describe('和管理员原有功能的配合', () => {
  it('Excel 导入只换通用菜单，共享菜留着；表格里和共享菜重名的报错', async () => {
    const { admin, ming } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    await approve(admin, dish.id)

    const imported = await call('POST', '/api/admin/import', {
      token: admin,
      body: { mealLabels: [], dishes: [{ name: '粥', category: '粥', meals: ['breakfast'] }] },
    })
    expect(imported.status).toBe(200)
    const all = (await call('GET', '/api/admin/menu', { token: admin })).data.dishes
    expect(all.map((d) => [d.name, d.scope])).toEqual([
      ['粥', 'general'],
      ['妈妈的红烧肉', 'shared'],
    ])

    const clash = await call('POST', '/api/admin/import', {
      token: admin,
      body: { mealLabels: [], dishes: [{ name: '粥', category: '粥', meals: ['breakfast'] }, MINE] },
    })
    expect(clash.status).toBe(400)
    expect(clash.data.problems[0]).toContain('共享菜')
  })

  it('“至少留一道启用的菜”只算通用菜：有共享菜也不能停掉最后一道通用菜；共享菜随便停', async () => {
    const { admin, general, ming } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    await approve(admin, dish.id)
    expect((await call('PUT', `/api/admin/dishes/${general.id}`, { body: { ...GENERAL, enabled: false }, token: admin })).status).toBe(409)
    expect((await call('DELETE', `/api/admin/dishes/${general.id}`, { token: admin })).status).toBe(409)
    const paused = await call('PUT', `/api/admin/dishes/${dish.id}`, { body: { ...MINE, enabled: false }, token: admin })
    expect(paused.data.dish).toMatchObject({ enabled: false, scope: 'shared', author: '小明' })
    expect(ids((await call('GET', '/api/my/menu', { token: ming.token })).data.items)).not.toContain(dish.id)
  })
})

describe('Codex 第 37 轮的修复', () => {
  it('旧页面上的“通过”：这期间用户被退回、改了又重新提交，按旧版本通过会被拒，新内容留着等审', async () => {
    const { admin, ming } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    const seen = await revisionOf(admin, dish.id)
    await reject(admin, dish.id, '写一下是哪家店')
    await call('PUT', `/api/my/dishes/${dish.id}`, { body: { ...MINE, name: '新的红烧肉' }, token: ming.token })
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })

    const stale = await call('POST', `/api/admin/reviews/${dish.id}/approve`, { body: { revision: seen }, token: admin })
    expect(stale.status).toBe(409)
    expect((await call('POST', `/api/admin/reviews/${dish.id}/reject`, { body: { revision: seen, note: '旧理由' }, token: admin })).status).toBe(409)
    const pending = (await call('GET', '/api/admin/reviews', { token: admin })).data.reviews
    expect(pending.map((r) => [r.id, r.name])).toEqual([[dish.id, '新的红烧肉']])
    expect((await approve(admin, dish.id)).data.dish.name).toBe('新的红烧肉')
  })

  it('没带版本号的审核请求不处理', async () => {
    const { admin, ming } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    expect((await call('POST', `/api/admin/reviews/${dish.id}/approve`, { body: {}, token: admin })).status).toBe(400)
  })

  it('通过的请求已经检查完、还没写入时，菜被退回改过又重新提交：不写入旧内容，也不删掉新提交', async () => {
    const { admin, ming } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    const revision = await revisionOf(admin, dish.id)
    const realBatch = env.DB.batch
    env.DB.batch = async (statements) => {
      env.DB.batch = realBatch
      // 模拟另一个管理员退回、作者改了又重新提交（版本号 +2）
      env.DB.raw.prepare("UPDATE user_dishes SET name = '作者的新内容', revision = revision + 2 WHERE id = ?").run(dish.id)
      return realBatch(statements)
    }
    const res = await call('POST', `/api/admin/reviews/${dish.id}/approve`, { body: { revision }, token: admin })
    expect(res.status).toBe(409)
    expect(await env.DB.prepare('SELECT id FROM dishes WHERE id = ?').bind(dish.id).first()).toBe(null)
    expect((await env.DB.prepare('SELECT name, status FROM user_dishes WHERE id = ?').bind(dish.id).first())).toEqual({
      name: '作者的新内容',
      status: 'pending',
    })
  })

  it('去掉餐次：用户自己的菜（没公开的）还在用时不让去掉，提示里只说几道、不说内容', async () => {
    const { admin, ming } = await setup()
    await call('PUT', '/api/admin/meals', { body: { labels: ['夜宵'] }, token: admin })
    const dish = (await call('POST', '/api/my/dishes', { body: { ...MINE, meals: ['夜宵'] }, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    const res = await call('PUT', '/api/admin/meals', { body: { labels: [] }, token: admin })
    expect(res.status).toBe(409)
    expect(res.data.error).toContain('1 道用户自己的菜（其中 1 道在等审核，可以先退回）')
    expect(res.data.error).not.toContain('红烧肉')
    expect((await call('GET', '/api/admin/menu', { token: admin })).data.meals.map((m) => m.id)).toContain('夜宵')
    // 审核时餐次还在，可以原样通过
    expect((await approve(admin, dish.id)).status).toBe(200)
  })

  it('Excel 导入：表格的“餐次”页少了共享菜还在用的餐次，不导入', async () => {
    const { admin, ming } = await setup()
    await call('PUT', '/api/admin/meals', { body: { labels: ['夜宵'] }, token: admin })
    const dish = (await call('POST', '/api/my/dishes', { body: { ...MINE, meals: ['夜宵'] }, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    await approve(admin, dish.id)
    const res = await call('POST', '/api/admin/import', {
      token: admin,
      body: { mealLabels: [], dishes: [{ name: '粥', category: '粥', meals: ['dinner'] }] },
    })
    expect(res.status).toBe(400)
    expect(res.data.problems.join('')).toContain('妈妈的红烧肉')
    expect((await call('GET', '/api/admin/menu', { token: admin })).data.meals.map((m) => m.id)).toContain('夜宵')
  })

  it('检查完餐次、还没写入时有人加了用它的菜：这次去掉餐次不生效', async () => {
    const { admin, ming } = await setup()
    await call('PUT', '/api/admin/meals', { body: { labels: ['夜宵'] }, token: admin })
    const realBatch = env.DB.batch
    env.DB.batch = async (statements) => {
      env.DB.batch = realBatch
      env.DB.raw
        .prepare(
          `INSERT INTO user_dishes (id, owner_id, name, shop, category, meals, status, created_at, updated_at)
           VALUES ('u_race', ?, '抢先加的菜', '', '小吃', '["夜宵"]', 'private', 0, 0)`,
        )
        .run(ming.id)
      return realBatch(statements)
    }
    const res = await call('PUT', '/api/admin/meals', { body: { labels: [] }, token: admin })
    expect(res.status).toBe(409)
    expect((await call('GET', '/api/admin/menu', { token: admin })).data.meals.map((m) => m.id)).toContain('夜宵')
  })

  it('用户加菜：检查完、还没写入时餐次被删了，这次不写入，提示刷新', async () => {
    const { admin, ming } = await setup()
    await call('PUT', '/api/admin/meals', { body: { labels: ['夜宵'] }, token: admin })
    const realPrepare = env.DB.prepare
    env.DB.prepare = (sql) => {
      if (/^\s*INSERT INTO user_dishes/.test(sql)) env.DB.raw.prepare("DELETE FROM meal_types WHERE id = '夜宵'").run()
      return realPrepare(sql)
    }
    const res = await call('POST', '/api/my/dishes', { body: { ...MINE, meals: ['夜宵'] }, token: ming.token })
    env.DB.prepare = realPrepare
    expect(res.status).toBe(409)
    expect(res.data.error).toContain('餐次')
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM user_dishes').first()).n).toBe(0)
  })

  it('移到通用菜单后，作者那边仍算“我加的”，账号页也看得到；别人那边不算', async () => {
    const { admin, ming, hong } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    await approve(admin, dish.id)
    await call('POST', `/api/admin/dishes/${dish.id}/promote`, { token: admin })
    const mingMenu = (await call('GET', '/api/my/menu', { token: ming.token })).data.items
    expect(mingMenu.find((i) => i.id === dish.id)).toMatchObject({ source: 'admin', mine: true })
    const my = (await call('GET', '/api/my/dishes', { token: ming.token })).data
    expect(my.approved.map((d) => [d.id, d.scope])).toEqual([[dish.id, 'general']])
    const hongMenu = (await call('GET', '/api/my/menu', { token: hong.token })).data.items
    expect(hongMenu.find((i) => i.id === dish.id).mine).toBe(false)
  })
})

describe('Codex 第 38 轮的修复', () => {
  /** 下一条匹配 pattern 的 SQL 执行前，先删掉“夜宵”这个餐次（模拟另一个管理员恰好在这时删了它） */
  function dropMealBefore(pattern) {
    const realPrepare = env.DB.prepare
    env.DB.prepare = (sql) => {
      if (pattern.test(sql)) {
        env.DB.prepare = realPrepare
        env.DB.raw.prepare("DELETE FROM meal_types WHERE id = '夜宵'").run()
      }
      return realPrepare(sql)
    }
    return () => {
      env.DB.prepare = realPrepare
    }
  }

  it('管理员加菜：检查完、还没写入时餐次被删了，这次不写入', async () => {
    const { admin } = await setup()
    await call('PUT', '/api/admin/meals', { body: { labels: ['夜宵'] }, token: admin })
    const restore = dropMealBefore(/^\s*INSERT INTO dishes/)
    const res = await call('POST', '/api/admin/dishes', { body: { ...GENERAL, name: '烧烤', meals: ['夜宵'] }, token: admin })
    restore()
    expect(res.status).toBe(409)
    expect(res.data.error).toContain('餐次')
    expect(await env.DB.prepare("SELECT id FROM dishes WHERE name = '烧烤'").first()).toBe(null)
  })

  it('管理员改菜：检查完、还没写入时餐次被删了，这次不改，提示的是餐次而不是“最后一道菜”', async () => {
    const { admin, general } = await setup()
    await call('PUT', '/api/admin/meals', { body: { labels: ['夜宵'] }, token: admin })
    const restore = dropMealBefore(/^\s*UPDATE dishes SET name/)
    const res = await call('PUT', `/api/admin/dishes/${general.id}`, { body: { ...GENERAL, meals: ['夜宵'] }, token: admin })
    restore()
    expect(res.status).toBe(409)
    expect(res.data.error).toContain('餐次')
    expect(JSON.parse((await env.DB.prepare('SELECT meals FROM dishes WHERE id = ?').bind(general.id).first()).meals)).toEqual(['lunch', 'dinner'])
  })

  it('移到通用菜单的菜，Excel 原样导出再导入后，仍算作者加的', async () => {
    const { admin, general, ming } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    await approve(admin, dish.id)
    await call('POST', `/api/admin/dishes/${dish.id}/promote`, { token: admin })
    const res = await call('POST', '/api/admin/import', {
      token: admin,
      body: { mealLabels: [], dishes: [{ ...GENERAL, id: general.id }, { ...MINE, id: dish.id }] },
    })
    expect(res.status).toBe(200)
    expect((await call('GET', '/api/my/menu', { token: ming.token })).data.items.find((i) => i.id === dish.id).mine).toBe(true)
    expect((await call('GET', '/api/my/dishes', { token: ming.token })).data.approved.map((d) => d.id)).toEqual([dish.id])
    // 表格里写别的编号、换了菜，也不会凭空变成谁加的
    const row = await env.DB.prepare('SELECT author_id FROM dishes WHERE id = ?').bind(general.id).first()
    expect(row.author_id).toBe(null)
  })
})

describe('Codex 第 39 轮的修复：改菜失败时提示的原因', () => {
  /**
   * 包住下一次“改菜”的 batch：执行前、后各做一件事（模拟别的管理员恰好在这时改了数据）。
   * 只认第一条是 UPDATE dishes 的 batch（登录检查等别的 batch 照常执行）
   */
  function aroundNextBatch(before, after = () => {}) {
    const realBatch = env.DB.batch
    env.DB.batch = async (statements) => {
      if (!/^\s*UPDATE dishes SET name/.test(statements[0]?.sql ?? '')) return realBatch(statements)
      env.DB.batch = realBatch
      before()
      try {
        return await realBatch(statements)
      } finally {
        after()
      }
    }
  }
  const dropNight = () => env.DB.raw.prepare("DELETE FROM meal_types WHERE id = '夜宵'").run()
  const addNight = () => env.DB.raw.prepare("INSERT INTO meal_types (id, label, sort) VALUES ('夜宵', '夜宵', 0)").run()

  it('写入时餐次被删、写完马上又加回来：仍提示餐次，不会说成“最后一道菜”', async () => {
    const { admin, general } = await setup()
    await call('PUT', '/api/admin/meals', { body: { labels: ['夜宵'] }, token: admin })
    aroundNextBatch(dropNight, addNight)
    const res = await call('PUT', `/api/admin/dishes/${general.id}`, { body: { ...GENERAL, meals: ['夜宵'] }, token: admin })
    expect(res.status).toBe(409)
    expect(res.data.error).toContain('餐次')
    // 原菜没变，马上重试就能成功
    expect((await call('PUT', `/api/admin/dishes/${general.id}`, { body: { ...GENERAL, meals: ['夜宵'] }, token: admin })).status).toBe(200)
  })

  it('因为“最后一道启用的通用菜”没改成、之后餐次才被删：提示的是“最后一道菜”', async () => {
    const { admin, general } = await setup()
    await call('PUT', '/api/admin/meals', { body: { labels: ['夜宵'] }, token: admin })
    aroundNextBatch(() => {}, dropNight)
    const res = await call('PUT', `/api/admin/dishes/${general.id}`, { body: { ...GENERAL, meals: ['夜宵'], enabled: false }, token: admin })
    expect(res.status).toBe(409)
    expect(res.data.error).toContain('至少要留一道启用的通用菜')
  })

  it('写入时菜刚被别的管理员删了：回 404', async () => {
    const { admin, ming } = await setup()
    const dish = (await call('POST', '/api/my/dishes', { body: MINE, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    await approve(admin, dish.id)
    aroundNextBatch(() => env.DB.raw.prepare('DELETE FROM dishes WHERE id = ?').run(dish.id))
    expect((await call('PUT', `/api/admin/dishes/${dish.id}`, { body: MINE, token: admin })).status).toBe(404)
  })
})
