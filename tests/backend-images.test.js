// @vitest-environment node
// 阶段 4-4d 后台的测试：菜的图片上传和转发（REQUIREMENTS.md R-030）。R2 用内存里的假存储代替。
import { describe, it, expect, beforeEach } from 'vitest'
import { handle } from '../backend/cloudflare/src/worker.js'
import { fakeD1 } from './helpers/fake-d1.js'

const ORIGIN = 'https://weit0529.github.io'
let env
let mails
let ip = 0
let clock

/** 假的 R2：put / get，记下内容和类型 */
function fakeR2() {
  const store = new Map()
  return {
    store,
    put: async (key, value, opts) => {
      store.set(key, { bytes: new Uint8Array(value), contentType: opts?.httpMetadata?.contentType })
    },
    get: async (key) => {
      const hit = store.get(key)
      return hit ? { body: hit.bytes, httpMetadata: { contentType: hit.contentType } } : null
    },
    // 和 R2 一样分页：每页最多 limit 个，cursor 是下一页从第几个开始
    list: async ({ limit = 1000, cursor } = {}) => {
      const keys = [...store.keys()].sort()
      const start = cursor ? Number(cursor) : 0
      const page = keys.slice(start, start + limit)
      const truncated = start + limit < keys.length
      return {
        objects: page.map((key) => ({ key, size: store.get(key).bytes.length })),
        truncated,
        cursor: truncated ? String(start + limit) : undefined,
      }
    },
  }
}

beforeEach(() => {
  mails = []
  clock = Date.now()
  env = {
    DB: fakeD1(),
    IMAGES: fakeR2(),
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

const OPTS = { authOptions: { iterations: 1000 } }
const headersFor = (token, extra = {}) => ({
  origin: ORIGIN,
  'cf-connecting-ip': `10.20.${ip % 250}.${Math.floor(Math.random() * 250)}`,
  ...(token ? { authorization: `Bearer ${token}` } : {}),
  ...extra,
})

async function call(method, path, { body, token, now } = {}) {
  const headers = headersFor(token, body !== undefined ? { 'content-type': 'application/json' } : {})
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
    // 不是 JSON（比如图片本身）
  }
  return { status: res.status, data, res }
}

/** 上传一张图片（原样发字节） */
async function upload(token, bytes, { type = 'image/webp', now } = {}) {
  const res = await handle(
    new Request('https://api.example/api/images', { method: 'POST', headers: headersFor(token, { 'content-type': type }), body: bytes }),
    env,
    now ?? clock,
    OPTS,
  )
  return { status: res.status, data: await res.json() }
}

async function signInToken(username, password) {
  const res = await handle(
    new Request('https://api.example/api/auth/sign-in/username', {
      method: 'POST',
      headers: headersFor('', { 'content-type': 'application/json' }),
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
  return { admin, ming: await newUser('小明', 'ming@example.com'), hong: await newUser('小红', 'hong@example.com') }
}

/** 最小的 webp / jpg / png 文件头，后面补几个字节 */
const WEBP = new Uint8Array([...new TextEncoder().encode('RIFF'), 0x10, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 '), 1, 2, 3, 4])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
const MINE = { name: '妈妈的红烧肉', category: '家常菜', meals: ['dinner'] }

describe('上传和转发图片', () => {
  it('登录用户上传 webp：得到 up_ 开头的随机文件名；公开转发，带长期缓存和 nosniff', async () => {
    const { ming } = await setup()
    const res = await upload(ming.token, WEBP)
    expect(res.status).toBe(201)
    expect(res.data.image).toMatch(/^up_[0-9a-f]{32}\.webp$/)
    const got = await call('GET', `/api/images/${res.data.image}`)
    expect(got.status).toBe(200)
    expect(got.res.headers.get('content-type')).toBe('image/webp')
    expect(got.res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(got.res.headers.get('cache-control')).toContain('immutable')
    expect(got.res.headers.get('access-control-allow-origin')).toBe('*')
    expect(new Uint8Array(await got.res.arrayBuffer())).toEqual(WEBP)
    // 再传一张，名字不一样
    expect((await upload(ming.token, WEBP)).data.image).not.toBe(res.data.image)
  })

  it('按文件头认格式（jpg、png 也行），和请求里写的类型无关', async () => {
    const { ming } = await setup()
    expect((await upload(ming.token, JPEG, { type: 'image/webp' })).data.image).toMatch(/\.jpg$/)
    expect((await upload(ming.token, PNG, { type: 'application/octet-stream' })).data.image).toMatch(/\.png$/)
  })

  it('不是图片（svg、网页、空的）不收；太大不收；没登录不收', async () => {
    const { ming } = await setup()
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect((await upload(ming.token, svg, { type: 'image/svg+xml' })).status).toBe(400)
    expect((await upload(ming.token, new TextEncoder().encode('<html>'), { type: 'text/html' })).status).toBe(400)
    expect((await upload(ming.token, new Uint8Array(0))).status).toBe(400)
    const big = new Uint8Array(300 * 1024 + 1)
    big.set(JPEG)
    expect((await upload(ming.token, big)).status).toBe(413)
    expect((await upload('', WEBP)).status).toBe(401)
    expect(env.IMAGES.store.size).toBe(0)
  })

  it('乱写的文件名、没有的图片：404', async () => {
    expect((await call('GET', '/api/images/../secret')).status).toBe(404)
    expect((await call('GET', '/api/images/up_123.webp')).status).toBe(404)
    expect((await call('GET', `/api/images/up_${'a'.repeat(32)}.webp`)).status).toBe(404)
  })

  it('还没开通 R2（没有 IMAGES）：上传、读图都说清楚', async () => {
    const { ming } = await setup()
    delete env.IMAGES
    expect((await upload(ming.token, WEBP)).status).toBe(503)
    expect((await call('GET', `/api/images/up_${'a'.repeat(32)}.webp`)).status).toBe(503)
  })

  it('被禁止加菜的人不能传图片；管理员不受限', async () => {
    const { admin, ming } = await setup()
    await call('PUT', `/api/admin/dish-access/${ming.id}`, { body: { list: 'black' }, token: admin })
    expect((await upload(ming.token, WEBP)).status).toBe(403)
    await call('PUT', '/api/admin/dish-access', { body: { open: false }, token: admin })
    expect((await upload(admin, WEBP)).status).toBe(201)
  })

  it('次数限制：每分钟和改菜共用 30 次；每人一天 50 张', async () => {
    const { ming } = await setup()
    for (let i = 0; i < 30; i++) expect((await upload(ming.token, WEBP)).status).toBe(201)
    expect((await upload(ming.token, WEBP)).status).toBe(429)
    for (let i = 0; i < 20; i++) expect((await upload(ming.token, WEBP, { now: clock + 61000 * (i + 1) })).status).toBe(201)
    expect((await upload(ming.token, WEBP, { now: clock + 61000 * 30 })).status).toBe(429)
    // 传错格式不占次数
    expect((await upload(ming.token, new Uint8Array([1, 2, 3]), { now: clock + 61000 * 31 })).status).toBe(400)
  })
})

describe('菜里引用图片的规则', () => {
  it('用户的菜只能用自己传的图；别人的、随网站发布的、不存在的都不行', async () => {
    const { ming, hong } = await setup()
    const mine = (await upload(ming.token, WEBP)).data.image
    const hers = (await upload(hong.token, WEBP)).data.image
    const ok = await call('POST', '/api/my/dishes', { body: { ...MINE, image: mine }, token: ming.token })
    expect(ok.status).toBe(201)
    expect(ok.data.dish.image).toBe(mine)
    for (const [i, image] of [hers, 'malatang.jpg', `up_${'b'.repeat(32)}.webp`].entries()) {
      const bad = await call('POST', '/api/my/dishes', { body: { ...MINE, name: `别的菜${i}`, image }, token: ming.token })
      expect(bad.status).toBe(400)
      expect(bad.data.errors[0].field).toBe('image')
    }
  })

  it('用户带图提交，管理员审核通过后，共享菜照样用这张图', async () => {
    const { admin, ming, hong } = await setup()
    const image = (await upload(ming.token, WEBP)).data.image
    const dish = (await call('POST', '/api/my/dishes', { body: { ...MINE, image }, token: ming.token })).data.dish
    await call('POST', `/api/my/dishes/${dish.id}/submit`, { token: ming.token })
    const review = (await call('GET', '/api/admin/reviews', { token: admin })).data.reviews[0]
    expect(review.image).toBe(image)
    const approved = await call('POST', `/api/admin/reviews/${dish.id}/approve`, { body: { revision: review.revision }, token: admin })
    expect(approved.status).toBe(200)
    const hongMenu = (await call('GET', '/api/my/menu', { token: hong.token })).data.items
    expect(hongMenu.find((i) => i.id === dish.id).image).toBe(image)
  })

  it('管理员加菜：上传的图要真的存在；随网站发布的图照旧能用', async () => {
    const { admin } = await setup()
    const image = (await upload(admin, JPEG)).data.image
    const base = { name: '麻辣烫', category: '火锅串串', meals: ['lunch'] }
    expect((await call('POST', '/api/admin/dishes', { body: { ...base, image }, token: admin })).status).toBe(201)
    const missing = await call('POST', '/api/admin/dishes', { body: { ...base, name: '烧烤', image: `up_${'c'.repeat(32)}.jpg` }, token: admin })
    expect(missing.status).toBe(400)
    expect((await call('POST', '/api/admin/dishes', { body: { ...base, name: '粥', image: 'zhou.jpg' }, token: admin })).status).toBe(201)
  })

  it('Excel 导入：表格里写了没上传过的 up_ 图片，报错', async () => {
    const { admin } = await setup()
    const image = (await upload(admin, WEBP)).data.image
    const res = await call('POST', '/api/admin/import', {
      token: admin,
      body: {
        mealLabels: [],
        dishes: [
          { name: '粥', category: '粥', meals: ['breakfast'], image },
          { name: '面', category: '面', meals: ['lunch'], image: `up_${'d'.repeat(32)}.webp` },
        ],
      },
    })
    expect(res.status).toBe(400)
    expect(res.data.problems).toEqual([`第 2 道菜：没有上传过“up_${'d'.repeat(32)}.webp”这张图片`])
  })
})

describe('Codex 第 41 轮的修复', () => {
  it('图片存进 R2 失败：回 502，“谁传的”记录也删掉，不留查不到的东西', async () => {
    const { ming } = await setup()
    env.IMAGES.put = async () => {
      throw new Error('R2 临时出错')
    }
    const res = await upload(ming.token, WEBP)
    expect(res.status).toBe(502)
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM images').first()).n).toBe(0)
  })

  it('记录写失败：不往 R2 存图片', async () => {
    const { ming } = await setup()
    const realPrepare = env.DB.prepare
    env.DB.prepare = (sql) => {
      if (/^INSERT INTO images/.test(sql)) throw new Error('D1 临时出错')
      return realPrepare(sql)
    }
    const res = await upload(ming.token, WEBP)
    env.DB.prepare = realPrepare
    expect(res.status).toBe(500)
    expect(env.IMAGES.store.size).toBe(0)
  })
})

describe('图片存储用量（管理页进度条）', () => {
  it('按上传记录加总：用了多少字节、几张；本轮上传次数和什么时候重新计；10 GB 是十进制', async () => {
    const { admin, ming } = await setup()
    await upload(ming.token, WEBP)
    await upload(ming.token, JPEG)
    const res = await call('GET', '/api/admin/storage', { token: admin })
    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({
      available: true,
      limitBytes: 10_000_000_000,
      usedBytes: WEBP.length + JPEG.length,
      objects: 2,
      uploadAttempts: 2,
      uploadLimit: 1000,
      uploadResetsAt: clock + 24 * 60 * 60 * 1000,
    })
    // 这一轮过了，上传次数归零（用量不变）
    const later = await call('GET', '/api/admin/storage', { token: admin, now: clock + 25 * 60 * 60 * 1000 })
    expect(later.data).toMatchObject({ uploadAttempts: 0, uploadResetsAt: null, objects: 2 })
  })

  it('图片再多也算得全（Codex 第 43 轮：4 万张、每张 300 KiB，真用超了要看得出来）', async () => {
    const { admin } = await setup()
    env.DB.raw.exec(`
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 40000)
      INSERT INTO images (name, owner_id, content_type, size, created_at)
      SELECT printf('up_%032x.webp', i), 'someone', 'image/webp', 307200, 0 FROM n`)
    const res = await call('GET', '/api/admin/storage', { token: admin })
    expect(res.data).toMatchObject({ objects: 40000, usedBytes: 40000 * 307200 })
    expect(res.data.usedBytes / res.data.limitBytes).toBeGreaterThan(1)
  })

  it('传失败的不算进用量和张数，但算一次上传次数', async () => {
    const { admin, ming } = await setup()
    env.IMAGES.put = async () => {
      throw new Error('R2 临时出错')
    }
    expect((await upload(ming.token, WEBP)).status).toBe(502)
    expect((await call('GET', '/api/admin/storage', { token: admin })).data).toMatchObject({ usedBytes: 0, objects: 0, uploadAttempts: 1 })
  })

  it('只有管理员能看；还没开通 R2 时说没开通', async () => {
    const { admin, ming } = await setup()
    expect((await call('GET', '/api/admin/storage', { token: ming.token })).status).toBe(403)
    expect((await call('GET', '/api/admin/storage')).status).toBe(401)
    delete env.IMAGES
    expect((await call('GET', '/api/admin/storage', { token: admin })).data).toMatchObject({ available: false })
  })
})
