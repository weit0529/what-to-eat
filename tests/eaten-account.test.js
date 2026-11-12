// 阶段 4-5 网页的测试：登录用户的“吃过”记录跟着账号走（REQUIREMENTS.md R-025），含 Codex 第 47、48 轮的场景
import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { OP_PREFIX, SNAPSHOT_PREFIX, USER_ID_KEY, USER_TOKEN_KEY, applyOps, createAccountEatenStore, firstBatch } from '../src/ui/eaten-account.js'
import DrawPage from '../src/components/DrawPage.vue'
import App from '../src/App.vue'

const NOW = new Date('2026-11-12T12:00:00')
const rec = (uid, id, at = NOW) => ({ uid, id, label: `${id} 的名字`, at: new Date(at).toISOString() })
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

/** 内存里的 localStorage；token / userId：这台手机上现在登录的 */
function memoryStorage(token = 'tok-A', userId = 'user-A') {
  const map = new Map()
  const s = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
    map,
  }
  if (token) s.setItem(USER_TOKEN_KEY, token)
  if (userId) s.setItem(USER_ID_KEY, userId)
  return s
}
const opsOf = (storage, userId = 'user-A') => [...storage.map.keys()].filter((k) => k.startsWith(`${OP_PREFIX}${userId}:`))
const snapshotOf = (storage, userId = 'user-A') => JSON.parse(storage.getItem(`${SNAPSHOT_PREFIX}${userId}`) || 'null')

/** 假后台：维护记录（按后台的规则执行改动），记下每次请求；版本号每次加 1 */
function fakeServer(userId = 'user-A') {
  let records = []
  let version = 0
  const requests = []
  const fetchImpl = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    requests.push(body)
    if (body.ops.length > 0 && body.userId !== userId) return json({ error: '不是这个账号', userId }, 409)
    records = applyOps(records, body.ops)
    return json({ userId, version: ++version, records })
  })
  return { fetchImpl, requests, records: () => records, put: (list) => (records = list) }
}

const makeStore = (opts) => createAccountEatenStore({ token: 'tok-A', userId: 'user-A', now: () => NOW, ...opts })
const down = () =>
  vi.fn(async () => {
    throw new TypeError('Failed to fetch')
  })

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('账号记录：基本', () => {
  it('点“就吃这个”：马上显示，带上编号和账号编号上传，拿回账号里的记录', async () => {
    const server = fakeServer()
    const storage = memoryStorage()
    const store = makeStore({ fetchImpl: server.fetchImpl, storage })
    store.add({ id: 'd_1', label: '面', at: NOW.toISOString() })
    expect(store.records.value.map((r) => r.id)).toEqual(['d_1'])
    await flushPromises()
    const [url, init] = server.fetchImpl.mock.calls[0]
    expect(url).toMatch(/\/api\/my\/eaten\/sync$/)
    expect(init.headers.authorization).toBe('Bearer tok-A')
    expect(server.requests[0]).toMatchObject({ userId: 'user-A', ops: [{ type: 'add', id: 'd_1' }] })
    expect(server.requests[0].ops[0]).not.toHaveProperty('opId')
    expect(opsOf(storage)).toEqual([])
    expect(snapshotOf(storage).records.map((r) => r.id)).toEqual(['d_1'])
  })

  it('连不上：照样显示、标“暂时连不上”，改动存在手机上；刷新后还在；连上后补传', async () => {
    const storage = memoryStorage()
    let online = false
    const server = fakeServer()
    const fetchImpl = vi.fn((url, init) => (online ? server.fetchImpl(url, init) : Promise.reject(new TypeError('Failed to fetch'))))
    const store = makeStore({ fetchImpl, storage })
    store.add({ id: 'd_1', label: '面', at: NOW.toISOString() })
    await flushPromises()
    expect(store.offline.value).toBe(true)
    expect(opsOf(storage)).toHaveLength(1)
    const reopened = makeStore({ fetchImpl, storage })
    expect(reopened.records.value.map((r) => r.id)).toEqual(['d_1'])
    online = true
    await reopened.sync()
    expect(reopened.offline.value).toBe(false)
    expect(server.records().map((r) => r.id)).toEqual(['d_1'])
    expect(opsOf(storage)).toEqual([])
  })

  it('同步还没回来时又点了：不并发，回来后再发一次，两条都在', async () => {
    const server = fakeServer()
    let release
    const gate = new Promise((r) => (release = r))
    const fetchImpl = vi.fn(async (url, init) => {
      if (fetchImpl.mock.calls.length === 1) await gate
      return server.fetchImpl(url, init)
    })
    const store = makeStore({ fetchImpl, storage: memoryStorage() })
    store.add({ id: 'd_1', label: '面', at: NOW.toISOString() })
    store.add({ id: 'd_2', label: '粉', at: NOW.toISOString() })
    expect(store.records.value).toHaveLength(2)
    release()
    await flushPromises()
    await flushPromises()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(server.records().map((r) => r.id)).toEqual(['d_1', 'd_2'])
  })
})

describe('Codex 第 47 轮的场景', () => {
  it('F-47-03 撤销本机最后一条：只删这一条，别的手机记的留着', async () => {
    const server = fakeServer()
    server.put([rec('uaaaaaaa', 'd_a')])
    const store = makeStore({ fetchImpl: server.fetchImpl, storage: memoryStorage() })
    await store.sync()
    server.put([...server.records(), rec('ubbbbbbb', 'd_b')])
    store.remove('uaaaaaaa')
    await flushPromises()
    expect(server.requests.at(-1).ops).toEqual([{ type: 'remove', uid: 'uaaaaaaa' }])
    expect(server.records().map((r) => r.id)).toEqual(['d_b'])
  })

  it('F-47-01 副本按账号分开：A 攒下的改动不会出现在 B 那里，也不会被 B 的凭证传上去', async () => {
    const storage = memoryStorage('tok-A', 'user-A')
    const a = makeStore({ fetchImpl: down(), storage })
    a.add({ id: 'A-private', label: 'A 的', at: NOW.toISOString() })
    await flushPromises()
    storage.setItem(USER_TOKEN_KEY, 'tok-B')
    storage.setItem(USER_ID_KEY, 'user-B')
    const serverB = fakeServer('user-B')
    const b = createAccountEatenStore({ token: 'tok-B', userId: 'user-B', fetchImpl: serverB.fetchImpl, storage, now: () => NOW })
    expect(b.records.value).toEqual([])
    await b.sync()
    expect(serverB.requests.every((req) => req.ops.length === 0)).toBe(true)
    expect(opsOf(storage, 'user-A')).toHaveLength(1)
  })

  it('F-47-06 攒了很多长名字的记录：按字节分批；后台还嫌大（413）就减半再发，最后都传上去', async () => {
    const long = '很长的菜名'.repeat(8) + ' · ' + '很长的店名'.repeat(8)
    const ops = Array.from({ length: 200 }, (_, i) => ({ opId: `op${String(i).padStart(4, '0')}`, type: 'add', uid: `uid${String(i).padStart(9, '0')}`, id: `d_${i}`, label: long, at: NOW.toISOString() }))
    const batch = firstBatch(ops, 'user-A')
    expect(batch.length).toBeLessThan(200)
    expect(new TextEncoder().encode(JSON.stringify({ userId: 'user-A', ops: batch })).length).toBeLessThanOrEqual(48 * 1024)

    const storage = memoryStorage()
    for (const op of ops) storage.setItem(`${OP_PREFIX}user-A:${op.opId}`, JSON.stringify(op))
    const server = fakeServer()
    const fetchImpl = vi.fn(async (url, init) => {
      if (JSON.parse(init.body).ops.length > 30) return json({ error: '一次发的改动太多了' }, 413)
      return server.fetchImpl(url, init)
    })
    const store = makeStore({ fetchImpl, storage })
    await store.sync()
    expect(server.records()).toHaveLength(200)
    expect(opsOf(storage)).toEqual([])
  })
})

describe('Codex 第 48 轮的场景', () => {
  it('F-48-02 两个标签页同时离线记：每条改动单独一格，谁也覆盖不了谁', async () => {
    const storage = memoryStorage()
    const tab1 = makeStore({ fetchImpl: down(), storage })
    const tab2 = makeStore({ fetchImpl: down(), storage })
    // 交替着记（以前的做法里，后写的会盖掉先写的）
    tab1.add({ id: 'dish-A', label: 'A', at: NOW.toISOString() })
    tab2.add({ id: 'dish-B', label: 'B', at: NOW.toISOString() })
    tab1.add({ id: 'dish-C', label: 'C', at: NOW.toISOString() })
    await flushPromises()
    expect(opsOf(storage)).toHaveLength(3)
    const reopened = makeStore({ fetchImpl: down(), storage })
    expect(reopened.records.value.map((r) => r.id).sort()).toEqual(['dish-A', 'dish-B', 'dish-C'])
  })

  it('F-48-04 回应头到了、正文还没读完时退出了：不再写回', async () => {
    const storage = memoryStorage()
    let releaseBody
    const body = new Promise((r) => (releaseBody = r))
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: () => body }))
    const old = makeStore({ fetchImpl, storage })
    const pending = old.sync()
    await flushPromises()
    // 另一个标签页退出 A、登录 B
    storage.removeItem(`${SNAPSHOT_PREFIX}user-A`)
    storage.setItem(USER_TOKEN_KEY, 'tok-B')
    storage.setItem(USER_ID_KEY, 'user-B')
    releaseBody({ userId: 'user-A', version: 5, records: [rec('u1aaaaaa', 'A-private')] })
    await pending
    expect(storage.getItem(`${SNAPSHOT_PREFIX}user-A`)).toBe(null)
    expect(old.expired.value).toBe(true)
  })

  it('F-48-05 / F-49-01 先发的请求晚回来（版本号更小或一样）：不会盖掉更新的记录；手机时间怎么调都不影响', async () => {
    const storage = memoryStorage()
    let releaseOld
    const oldReply = new Promise((r) => (releaseOld = r))
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      if (calls === 1) return oldReply
      return json({ userId: 'user-A', version: 7, records: [rec('ubbbbbbb', 'd_b')] })
    })
    const tab1 = makeStore({ fetchImpl, storage, now: () => new Date('2030-01-01') })
    const first = tab1.sync()
    const tab2 = makeStore({ fetchImpl, storage })
    await tab2.sync()
    releaseOld(json({ userId: 'user-A', version: 7, records: [] }))
    await first
    expect(snapshotOf(storage)).toMatchObject({ version: 7 })
    expect(snapshotOf(storage).records.map((r) => r.id)).toEqual(['d_b'])
  })

  it('F-48-06 以前登录的、这次连不上（不知道账号编号）：不碰本机自己的记录，改动先记在内存里，知道编号后存进这个账号再上传', async () => {
    localStorage.setItem('what-to-eat:eaten:v1', JSON.stringify([{ id: 'local-private', at: new Date().toISOString() }]))
    const storage = memoryStorage('tok-A', null)
    const server = fakeServer()
    let online = false
    const fetchImpl = vi.fn((url, init) => (online ? server.fetchImpl(url, init) : Promise.reject(new TypeError('x'))))
    const store = createAccountEatenStore({ token: 'tok-A', userId: null, fetchImpl, storage })
    const MENU = [{ id: 'd_1', name: '面', shop: null, category: '面食', meals: ['lunch'], tags: [], price: null, description: null, image: null }]
    const w = mount(DrawPage, { props: { items: MENU, rollDuration: 0, random: () => 0, eatenStore: store } })
    await w.findAll('.meal').find((b) => b.find('.label').text() === '午餐').trigger('click')
    expect(w.text()).not.toContain('local-private')
    expect(w.text()).toContain('正在确认账号')
    await w.find('.draw-button').trigger('click')
    await w.find('.eat-button').trigger('click')
    await flushPromises()
    expect(server.requests).toEqual([])
    expect([...storage.map.keys()].filter((k) => k.startsWith(OP_PREFIX))).toEqual([])
    // F-49-02 连上以后：切回前台（或者再点一下）时自己去问账号编号，存进这个账号再上传
    online = true
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    await flushPromises()
    expect(store.bound.value).toBe(true)
    expect(storage.getItem(USER_ID_KEY)).toBe('user-A')
    expect(server.records().map((r) => r.id)).toEqual(['d_1'])
    // 本机自己的记录没动
    expect(JSON.parse(localStorage.getItem('what-to-eat:eaten:v1'))[0].id).toBe('local-private')
  })
})

describe('Codex 第 49 轮的场景', () => {
  it('F-49-04 删和记的排序反了（不同标签页、手机时间回拨）：删过的照样不显示；清空之前的也不显示', () => {
    const add = { type: 'add', uid: 'uaaaaaaa', id: 'd_a', label: 'a', at: NOW.toISOString() }
    expect(applyOps([], [{ type: 'remove', uid: 'uaaaaaaa' }, add])).toEqual([])
    const before = { ...add, uid: 'ubbbbbbb', at: new Date(NOW.getTime() - 1000).toISOString() }
    expect(applyOps([], [{ type: 'clear', at: NOW.toISOString() }, before]).map((r) => r.uid)).toEqual([])
  })

  it('F-49-03 存满了（写不进、读得出）：以前存的照样显示、照样上传；退出时照样删得掉', async () => {
    const real = memoryStorage()
    real.setItem(`${SNAPSHOT_PREFIX}user-A`, JSON.stringify({ records: [rec('u1aaaaaa', 'old')], version: 3 }))
    real.setItem(`${OP_PREFIX}user-A:0001`, JSON.stringify({ opId: '0001', type: 'add', uid: 'u2aaaaaa', id: 'queued', label: 'q', at: NOW.toISOString() }))
    const full = { ...real, key: real.key, getItem: real.getItem, removeItem: real.removeItem, get length() { return real.length }, setItem: () => { throw new DOMException('full', 'QuotaExceededError') } }
    vi.stubGlobal('localStorage', full)
    const { readableStorage, clearAccountEaten } = await import('../src/ui/eaten-account.js')
    expect(readableStorage()).toBe(full)
    const server = fakeServer()
    server.put([rec('u1aaaaaa', 'old')])
    const store = createAccountEatenStore({ token: 'tok-A', userId: 'user-A', fetchImpl: server.fetchImpl, now: () => NOW })
    expect(store.records.value.map((r) => r.id).sort()).toEqual(['old', 'queued'])
    await store.sync()
    expect(server.requests[0].ops.map((op) => op.id)).toEqual(['queued'])
    clearAccountEaten('user-A')
    expect(real.getItem(`${SNAPSHOT_PREFIX}user-A`)).toBe(null)
    expect(real.getItem(`${OP_PREFIX}user-A:0001`)).toBe(null)
  })

  it('F-49-05 快一天的手机先记再清空：本机也不再显示这条', () => {
    const future = { type: 'add', uid: 'ufffffff', id: 'd_f', label: 'f', at: new Date(NOW.getTime() + 86400000).toISOString() }
    const clear = { type: 'clear', at: new Date(NOW.getTime() + 86401000).toISOString() }
    expect(applyOps([], [future, clear])).toEqual([])
  })
})

describe('首页（App）', () => {
  const MEALS = [{ id: 'breakfast', label: '早餐' }, { id: 'lunch', label: '午餐' }, { id: 'dinner', label: '晚餐' }]
  const item = (id, extra) => ({ id, name: id, shop: null, category: '面食', meals: ['lunch'], tags: [], price: null, description: null, image: null, ...extra })
  const myMenu = { version: 2, meals: MEALS, items: [item('g1', { mine: false }), item('private-dish', { source: 'mine', mine: true })], userId: 'user-A' }
  const general = { version: 2, meals: MEALS, items: [item('g1')] }
  const signIn = (token = 'tok-A', userId = 'user-A') => {
    localStorage.setItem('what-to-eat:user-token:v1', token)
    localStorage.setItem('what-to-eat:user-name:v1', '小明')
    if (userId) localStorage.setItem('what-to-eat:user-id:v1', userId)
  }

  it('F-47-07 / F-48-07 用着时同步发现凭证失效：改回本机记录、撤下私有菜、底部变回“登录 / 注册”', async () => {
    signIn()
    let eatenStatus = 200
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/api/my/eaten/sync')) return eatenStatus === 200 ? json({ userId: 'user-A', version: 1, records: [] }) : json({ error: '请先登录' }, 401)
      if (url.endsWith('/api/my/menu')) return json(myMenu)
      return json(general)
    })
    const w = mount(App, { props: { fetchImpl } })
    await flushPromises()
    expect(w.findComponent(DrawPage).props('items').map((i) => i.id)).toEqual(['g1', 'private-dish'])
    await w.findAll('.scope-tab')[1].trigger('click')
    eatenStatus = 401
    await w.findComponent(DrawPage).props('eatenStore').sync()
    await flushPromises()
    expect(localStorage.getItem('what-to-eat:user-token:v1')).toBe(null)
    expect(w.find('.account-link').text()).toBe('登录 / 注册')
    expect(w.findComponent(DrawPage).props('eatenStore')).toBe(null)
    expect(w.findComponent(DrawPage).props('items').map((i) => i.id)).toEqual(['g1'])
    expect(w.find('.scope-tabs').exists()).toBe(false)
  })

  it('F-48-01 老登录的首页等菜单时，别的标签页换成 B 登录：A 的回应不写账号编号、不用', async () => {
    signIn('tok-A', null)
    let releaseMenu
    const fetchImpl = vi.fn((url) => {
      if (url.endsWith('/api/my/menu')) return new Promise((r) => (releaseMenu = () => r(json(myMenu))))
      return Promise.resolve(json(general))
    })
    const w = mount(App, { props: { fetchImpl } })
    await flushPromises()
    // 另一个标签页登录了 B
    signIn('tok-B', 'user-B')
    releaseMenu()
    await flushPromises()
    expect(localStorage.getItem('what-to-eat:user-id:v1')).toBe('user-B')
    expect(localStorage.getItem('what-to-eat:user-token:v1')).toBe('tok-B')
    expect(w.findComponent(DrawPage).props('items').map((i) => i.id)).toEqual(['g1'])
  })

  it('老登录（没记账号编号）：从内部菜单拿到编号后记下来，改用这个账号的记录', async () => {
    signIn('tok-A', null)
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/api/my/eaten/sync')) return json({ userId: 'user-A', version: 1, records: [rec('u1aaaaaa', 'g1')] })
      return json(myMenu)
    })
    const w = mount(App, { props: { fetchImpl } })
    await flushPromises()
    expect(localStorage.getItem('what-to-eat:user-id:v1')).toBe('user-A')
    const store = w.findComponent(DrawPage).props('eatenStore')
    expect(store.bound.value).toBe(true)
    expect(store.records.value.map((r) => r.id)).toEqual(['g1'])
  })
})

describe('账号页：登录记下账号编号，退出清掉这个账号的副本', () => {
  it('退出删掉这个账号的副本和没传完的改动，本机自己的记录不动', async () => {
    vi.resetModules()
    localStorage.setItem('what-to-eat:eaten:v1', JSON.stringify([{ id: 'own', at: NOW.toISOString() }]))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        url.includes('sign-in')
          ? new Response(JSON.stringify({ user: { id: 'user-B', username: 'b' } }), { status: 200, headers: { 'set-auth-token': 't' } })
          : json({}),
      ),
    )
    const api = await import('../src/account/api.js')
    await api.signIn('b', 'pw')
    expect(localStorage.getItem('what-to-eat:user-id:v1')).toBe('user-B')
    localStorage.setItem(`${SNAPSHOT_PREFIX}user-B`, JSON.stringify({ records: [rec('u1aaaaaa', 'd_B')], version: 1 }))
    localStorage.setItem(`${OP_PREFIX}user-B:op1`, JSON.stringify({ opId: 'op1', type: 'clear', at: NOW.toISOString() }))
    await api.signOut()
    expect(localStorage.getItem('what-to-eat:user-id:v1')).toBe(null)
    expect(localStorage.getItem(`${SNAPSHOT_PREFIX}user-B`)).toBe(null)
    expect(localStorage.getItem(`${OP_PREFIX}user-B:op1`)).toBe(null)
    expect(localStorage.getItem('what-to-eat:eaten:v1')).not.toBe(null)
  })
})

describe('抽菜页接上账号记录', () => {
  const MENU = [{ id: 'd_1', name: '面', shop: null, category: '面食', meals: ['lunch'], tags: [], price: null, description: null, image: null }]

  it('点“就吃这个”记一条，再点撤销删这一条；“最近吃过”写着跟着账号走；连不上时提示', async () => {
    const server = fakeServer()
    let online = true
    const fetchImpl = vi.fn((url, init) => (online ? server.fetchImpl(url, init) : Promise.reject(new TypeError('x'))))
    const store = createAccountEatenStore({ token: 'tok-A', userId: 'user-A', fetchImpl, storage: memoryStorage() })
    const w = mount(DrawPage, { props: { items: MENU, rollDuration: 0, random: () => 0, eatenStore: store } })
    await w.findAll('.meal').find((b) => b.find('.label').text() === '午餐').trigger('click')
    await w.find('.draw-button').trigger('click')
    await w.find('.eat-button').trigger('click')
    await flushPromises()
    expect(server.records().map((r) => r.id)).toEqual(['d_1'])
    await w.find('.eat-button').trigger('click')
    await flushPromises()
    expect(server.requests.at(-1).ops).toEqual([{ type: 'remove', uid: server.requests[0].ops[0].uid }])
    expect(server.records()).toEqual([])
    expect(w.text()).toContain('记录跟着账号走，换手机登录也在')
    online = false
    store.add({ id: 'd_1', label: '面', at: new Date().toISOString() })
    await flushPromises()
    expect(w.text()).toContain('暂时连不上后台')
  })
})
