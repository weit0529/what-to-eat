// 阶段 4-4b 网页的测试：首页登录后用内部菜单、“全部 / 只看我加的”；账号页“我的菜”（REQUIREMENTS.md R-024、R-029）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../src/App.vue'
import DrawPage from '../src/components/DrawPage.vue'
import MyDishesView from '../src/account/MyDishesView.vue'

const TOKEN_KEY = 'what-to-eat:user-token:v1'
const NAME_KEY = 'what-to-eat:user-name:v1'
const MEALS = [
  { id: 'breakfast', label: '早餐', builtIn: true },
  { id: 'lunch', label: '午餐', builtIn: true },
  { id: 'dinner', label: '晚餐', builtIn: true },
]
const item = (id, name, extra = {}) => ({
  id,
  name,
  shop: null,
  category: '家常菜',
  meals: ['lunch', 'dinner'],
  tags: [],
  price: null,
  description: null,
  image: null,
  ...extra,
})
const general = { version: 2, meals: MEALS, items: [item('g1', '通用的面'), item('g2', '通用的粉')] }
const mine = {
  version: 2,
  meals: MEALS,
  items: [
    item('g1', '通用的面', { source: 'admin', mine: false }),
    item('u_shared', '大家的饭', { source: 'shared', mine: false }),
    item('u_a', '我的红烧肉', { source: 'mine', status: 'private', mine: true }),
    item('u_b', '我交的菜', { source: 'shared', mine: true }),
  ],
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => localStorage.clear())
afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('首页：登录后用内部菜单', () => {
  it('本机有登录凭证：带凭证取 /api/my/menu，出现“全部 / 只看我加的”，切换后只在我加的菜里选', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-1')
    localStorage.setItem(NAME_KEY, '小明')
    const fetchImpl = vi.fn(async () => json(mine))
    const w = mount(App, { props: { fetchImpl } })
    await flushPromises()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toMatch(/\/api\/my\/menu$/)
    expect(init.headers.authorization).toBe('Bearer tok-1')

    const tabs = w.findAll('.scope-tab')
    expect(tabs.map((t) => t.text())).toEqual(['全部', '只看我加的（2）'])
    expect(w.findComponent(DrawPage).props('items').map((i) => i.id)).toEqual(['g1', 'u_shared', 'u_a', 'u_b'])
    await tabs[1].trigger('click')
    expect(w.findComponent(DrawPage).props('items').map((i) => i.id)).toEqual(['u_a', 'u_b'])
    await tabs[0].trigger('click')
    expect(w.findComponent(DrawPage).props('items')).toHaveLength(4)
    expect(w.find('.account-link').text()).toBe('我的账号（小明）')
  })

  it('还没加过菜时“只看我加的”点不了', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-1')
    const only = { ...mine, items: mine.items.map((i) => ({ ...i, mine: false })) }
    const w = mount(App, { props: { fetchImpl: vi.fn(async () => json(only)) } })
    await flushPromises()
    expect(w.findAll('.scope-tab')[1].attributes('disabled')).toBeDefined()
  })

  it('凭证失效（401）：清掉凭证，改取通用菜单，底部变回“登录 / 注册”，没有切换', async () => {
    localStorage.setItem(TOKEN_KEY, 'old')
    localStorage.setItem(NAME_KEY, '小明')
    const fetchImpl = vi.fn(async (url) => (url.endsWith('/api/my/menu') ? json({ error: '请先登录' }, 401) : json(general)))
    const w = mount(App, { props: { fetchImpl } })
    await flushPromises()
    expect(fetchImpl.mock.calls.map(([url]) => url.replace(/^.*\/api/, '/api'))).toEqual(['/api/my/menu', '/api/menu'])
    expect(localStorage.getItem(TOKEN_KEY)).toBe(null)
    expect(w.find('.account-link').text()).toBe('登录 / 注册')
    expect(w.find('.scope-tabs').exists()).toBe(false)
    expect(w.findComponent(DrawPage).props('items').map((i) => i.id)).toEqual(['g1', 'g2'])
  })

  it('内部菜单取不到（后台出错）：凭证留着，改用通用菜单', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-1')
    const fetchImpl = vi.fn(async (url) => (url.endsWith('/api/my/menu') ? json({ error: '后台出错了' }, 500) : json(general)))
    const w = mount(App, { props: { fetchImpl } })
    await flushPromises()
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-1')
    expect(w.findComponent(DrawPage).props('items').map((i) => i.id)).toEqual(['g1', 'g2'])
  })

  it('没登录：只取通用菜单，不带凭证', async () => {
    const fetchImpl = vi.fn(async () => json(general))
    mount(App, { props: { fetchImpl } })
    await flushPromises()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/api\/menu$/)
    expect(fetchImpl.mock.calls[0][1].headers).toBeUndefined()
  })
})

describe('账号页“我的菜”', () => {
  const myDishes = (extra = {}) => ({
    canEdit: true,
    reason: null,
    dishes: [
      { ...item('u_a', '我的红烧肉'), status: 'private', reviewNote: null },
      { ...item('u_p', '审核中的菜'), status: 'pending', reviewNote: null },
      { ...item('u_r', '被退回的菜'), status: 'rejected', reviewNote: '写一下是哪家店' },
    ],
    approved: [{ ...item('u_b', '我交的菜'), enabled: true }],
    ...extra,
  })
  /** 假后台：按网址回答，记下写操作 */
  function backend(data) {
    const calls = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init = {}) => {
        const path = url.replace(/^.*?(\/api\/)/, '/api/')
        const method = init.method || 'GET'
        if (method !== 'GET') calls.push([method, path, init.body ? JSON.parse(init.body) : undefined])
        if (path === '/api/my/dishes' && method === 'GET') return json(data())
        if (path === '/api/my/menu') return json(mine)
        return json({ ok: true, dish: {} })
      }),
    )
    return calls
  }

  it('列出我的菜和状态；被退回的显示理由；审核中的没有按钮；已通过的单独列出、不能改', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-1')
    backend(() => myDishes())
    const w = mount(MyDishesView)
    await flushPromises()
    const rows = w.findAll('.dish-row')
    expect(rows.map((r) => r.find('strong').text())).toEqual(['我的红烧肉', '审核中的菜', '被退回的菜', '我交的菜'])
    expect(rows[0].find('.badge').text()).toBe('只有自己看得到')
    expect(rows[1].find('.badge').text()).toBe('审核中')
    expect(rows[1].find('.dish-actions').exists()).toBe(false)
    expect(rows[2].text()).toContain('管理员说：写一下是哪家店')
    expect(rows[2].findAll('button').map((b) => b.text())).toEqual(['改', '重新提交', '删'])
    expect(rows[3].find('.dish-actions').exists()).toBe(false)
    expect(w.find('.toolbar .primary').text()).toBe('加一道菜')
  })

  it('管理员关了加菜：显示原因，没有加、改、删、提交的按钮', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-1')
    backend(() => myDishes({ canEdit: false, reason: '管理员暂时关闭了加菜' }))
    const w = mount(MyDishesView)
    await flushPromises()
    expect(w.find('.notice').text()).toContain('管理员暂时关闭了加菜')
    expect(w.find('.toolbar').exists()).toBe(false)
    expect(w.findAll('.dish-actions')).toHaveLength(0)
  })

  it('提交审核要先确认；确认后发请求，取消就不发', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-1')
    const calls = backend(() => myDishes())
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const w = mount(MyDishesView)
    await flushPromises()
    const submitButton = () => w.findAll('.dish-row')[0].findAll('button')[1]
    await submitButton().trigger('click')
    expect(confirm).toHaveBeenCalled()
    expect(calls).toEqual([])
    confirm.mockReturnValue(true)
    await submitButton().trigger('click')
    await flushPromises()
    expect(calls).toEqual([['POST', '/api/my/dishes/u_a/submit', undefined]])
    expect(w.find('.ok').text()).toContain('等管理员审核')
  })

  it('加菜：表单里没有图片和“启用”；填好保存后发 POST', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-1')
    const calls = backend(() => myDishes())
    const w = mount(MyDishesView)
    await flushPromises()
    await w.find('.toolbar .primary').trigger('click')
    const form = w.find('form.dish-form')
    expect(form.find('select').exists()).toBe(false)
    expect(form.text()).not.toContain('启用')
    const inputs = form.findAll('input')
    await inputs[0].setValue('番茄炒蛋')
    await form.find('input[list="category-options"]').setValue('家常菜')
    await form.find('input[type="checkbox"][value="dinner"]').setValue(true)
    await form.trigger('submit')
    await flushPromises()
    expect(calls[0][0]).toBe('POST')
    expect(calls[0][1]).toBe('/api/my/dishes')
    expect(calls[0][2]).toMatchObject({ name: '番茄炒蛋', category: '家常菜', meals: ['dinner'] })
    expect(w.find('.ok').text()).toContain('加好了')
  })
})
