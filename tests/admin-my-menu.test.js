// 阶段 4-4c 管理页的测试：审核、共享菜“移到通用菜单”、加菜权限、Excel 只导出通用菜（REQUIREMENTS.md R-024、R-029）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ReviewsView from '../src/admin/ReviewsView.vue'
import AccessView from '../src/admin/AccessView.vue'
import DishesView from '../src/admin/DishesView.vue'

const menuToSheets = vi.hoisted(() => vi.fn(() => []))
vi.mock('../src/core/menu-excel.js', async (importOriginal) => ({ ...(await importOriginal()), menuToSheets }))
vi.mock('write-excel-file/browser', () => ({ default: () => ({ toFile: async () => {} }) }))
const { default: ExcelView } = await import('../src/admin/ExcelView.vue')

const MEALS = [
  { id: 'breakfast', label: '早餐', builtIn: true },
  { id: 'lunch', label: '午餐', builtIn: true },
  { id: 'dinner', label: '晚餐', builtIn: true },
]
const dish = (id, name, extra = {}) => ({
  id,
  name,
  shop: null,
  category: '家常菜',
  meals: ['dinner'],
  tags: [],
  price: null,
  description: null,
  image: null,
  enabled: true,
  scope: 'general',
  author: null,
  ...extra,
})
const MENU = {
  meals: MEALS,
  dishes: [dish('g1', '麻辣烫'), dish('u_s', '红烧肉', { scope: 'shared', author: '小明' })],
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

/** 假后台：GET 按网址回答，写操作记下来 */
function backend(routes) {
  const calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const path = url.replace(/^.*?(\/api\/)/, '/api/')
      const method = init.method || 'GET'
      if (method !== 'GET') {
        calls.push([method, path, init.body ? JSON.parse(init.body) : undefined])
        const handler = routes[`${method} ${path}`]
        return handler ? handler(init) : json({ ok: true })
      }
      return json(routes[path]())
    }),
  )
  return calls
}

beforeEach(() => {
  localStorage.setItem('what-to-eat:admin-token:v1', 'admin-token')
})
afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('审核', () => {
  const reviews = () => ({
    reviews: [
      { ...dish('u_a', '妈妈的红烧肉'), author: '小明', submittedAt: Date.now(), duplicate: false, revision: 1 },
      { ...dish('u_d', '麻辣烫'), author: '小红', submittedAt: Date.now(), duplicate: true, revision: 3 },
    ],
  })

  it('列出待审核的菜和提交人；重名的没有“通过”按钮、有提示', async () => {
    backend({ '/api/admin/reviews': reviews })
    const w = mount(ReviewsView, { props: { menu: MENU } })
    await flushPromises()
    const rows = w.findAll('.review-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('小明')
    expect(rows[0].findAll('.dish-actions button').map((b) => b.text())).toEqual(['通过', '改了再通过', '退回'])
    expect(rows[1].text()).toContain('和已有的菜重名')
    expect(rows[1].findAll('.dish-actions button').map((b) => b.text())).toEqual(['改了再通过', '退回'])
  })

  it('通过：发请求，通知外面重新读菜单', async () => {
    const calls = backend({ '/api/admin/reviews': reviews })
    const w = mount(ReviewsView, { props: { menu: MENU } })
    await flushPromises()
    await w.findAll('.review-row')[0].find('.dish-actions .primary').trigger('click')
    await flushPromises()
    expect(calls).toEqual([['POST', '/api/admin/reviews/u_a/approve', { revision: 1 }]])
    expect(w.emitted('changed')).toHaveLength(1)
    expect(w.find('.ok').text()).toContain('已通过')
  })

  it('退回要写理由：空着不发请求；写了才发', async () => {
    const calls = backend({ '/api/admin/reviews': reviews })
    const w = mount(ReviewsView, { props: { menu: MENU } })
    await flushPromises()
    await w.findAll('.review-row')[0].findAll('.dish-actions button')[2].trigger('click')
    const form = w.find('.reject-form')
    await form.trigger('submit')
    expect(calls).toEqual([])
    expect(w.find('.error').text()).toContain('要写一句理由')
    await form.find('textarea').setValue('写一下是哪家店')
    await form.trigger('submit')
    await flushPromises()
    expect(calls).toEqual([['POST', '/api/admin/reviews/u_a/reject', { revision: 1, note: '写一下是哪家店' }]])
  })

  it('改了再通过：表单里带着用户填的内容，改名后发出改过的菜', async () => {
    const calls = backend({ '/api/admin/reviews': reviews })
    const w = mount(ReviewsView, { props: { menu: MENU } })
    await flushPromises()
    await w.findAll('.review-row')[1].findAll('.dish-actions button')[0].trigger('click')
    const form = w.find('form.dish-form')
    expect(form.find('input').element.value).toBe('麻辣烫')
    await form.find('input[placeholder="可以不填"]').setValue('学校门口')
    await form.trigger('submit')
    await flushPromises()
    expect(calls[0][0]).toBe('POST')
    expect(calls[0][1]).toBe('/api/admin/reviews/u_d/approve')
    expect(calls[0][2].revision).toBe(3)
    expect(calls[0][2].dish).toMatchObject({ name: '麻辣烫', shop: '学校门口', enabled: true })
  })
})

describe('菜单页的共享菜', () => {
  it('共享菜标出提交人，有“移到通用菜单”；通用菜没有；可以只看共享菜', async () => {
    const calls = backend({})
    vi.stubGlobal('confirm', vi.fn(() => true))
    const w = mount(DishesView, { props: { menu: MENU } })
    const rows = w.findAll('.dish-row')
    expect(rows[0].text()).not.toContain('移到通用菜单')
    expect(rows[1].find('.badge.shared').text()).toBe('共享 · 小明 提交')
    const promote = rows[1].findAll('button').find((b) => b.text() === '移到通用菜单')
    await promote.trigger('click')
    await flushPromises()
    expect(calls).toEqual([['POST', '/api/admin/dishes/u_s/promote', {}]])

    await w.find('select[aria-label="看哪些菜"]').setValue('shared')
    expect(w.findAll('.dish-row').map((r) => r.find('strong').text())).toEqual(['红烧肉'])
  })
})

describe('加菜权限', () => {
  const access = (open) => () => ({
    open,
    users: [
      { id: 'a', username: '小明', email: 'ming@example.com', list: 'black', dishCount: 2 },
      { id: 'b', username: '小红', email: 'hong@example.com', list: 'white', dishCount: 0 },
      { id: 'c', username: '小刚', email: 'gang@example.com', list: null, dishCount: 1 },
    ],
  })

  it('开着时黑名单的人不能加；关着时只有白名单的人能加', async () => {
    backend({ '/api/admin/dish-access': access(true) })
    let w = mount(AccessView)
    await flushPromises()
    expect(w.findAll('.dish-row .badge').map((b) => b.text())).toEqual(['不能加菜', '能加菜', '能加菜'])
    w.unmount()

    backend({ '/api/admin/dish-access': access(false) })
    w = mount(AccessView)
    await flushPromises()
    expect(w.findAll('.dish-row .badge').map((b) => b.text())).toEqual(['不能加菜', '能加菜', '不能加菜'])
  })

  it('总开关要先确认；放进 / 拿出名单发对应的请求', async () => {
    const calls = backend({ '/api/admin/dish-access': access(true) })
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const w = mount(AccessView)
    await flushPromises()
    await w.find('.switch-line input').trigger('click')
    expect(confirm).toHaveBeenCalled()
    expect(calls).toEqual([])
    confirm.mockReturnValue(true)
    await w.find('.switch-line input').trigger('click')
    await flushPromises()
    expect(calls).toEqual([['PUT', '/api/admin/dish-access', { open: false }]])

    await w.findAll('.dish-row select')[2].setValue('black')
    await flushPromises()
    await w.findAll('.dish-row select')[0].setValue('')
    await flushPromises()
    expect(calls.slice(1)).toEqual([
      ['PUT', '/api/admin/dish-access/c', { list: 'black' }],
      ['PUT', '/api/admin/dish-access/a', { list: null }],
    ])
  })
})

describe('Excel 导出', () => {
  it('只导出通用菜，共享菜不进表格', async () => {
    const w = mount(ExcelView, { props: { menu: MENU } })
    await w.findAll('button').find((b) => b.text() === '导出 Excel').trigger('click')
    await flushPromises()
    expect(menuToSheets).toHaveBeenCalledTimes(1)
    expect(menuToSheets.mock.calls[0][0].dishes.map((d) => d.id)).toEqual(['g1'])
  })
})

describe('验收时提的小改进（R-032）', () => {
  it('点“改”：表单出现后自动滚过去，光标在第一个格子；换一道菜再点“改”也会再滚一次', async () => {
    backend({})
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    const w = mount(DishesView, { props: { menu: MENU }, attachTo: document.body })
    const editOf = (i) => w.findAll('.dish-row')[i].findAll('button').find((b) => b.text() === '改')
    await editOf(0).trigger('click')
    expect(scrolled).toHaveBeenCalledTimes(1)
    expect(scrolled.mock.calls[0][0]).toMatchObject({ block: 'start' })
    expect(document.activeElement).toBe(w.find('form.dish-form input').element)
    await editOf(1).trigger('click')
    await flushPromises()
    expect(scrolled).toHaveBeenCalledTimes(2)
    w.unmount()
    delete Element.prototype.scrollIntoView
  })

  it('表单开着时再点同一道菜的“改”：也滚回去，填了一半的内容留着（Codex 第 45 轮）', async () => {
    backend({})
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    const w = mount(DishesView, { props: { menu: MENU }, attachTo: document.body })
    const editFirst = () => w.findAll('.dish-row')[0].findAll('button').find((b) => b.text() === '改').trigger('click')
    await editFirst()
    await flushPromises()
    await w.find('form.dish-form input').setValue('改了一半的名字')
    await editFirst()
    await flushPromises()
    expect(scrolled).toHaveBeenCalledTimes(2)
    expect(w.find('form.dish-form input').element.value).toBe('改了一半的名字')
    w.unmount()
    delete Element.prototype.scrollIntoView
  })

  it('审核页“改了再通过”、账号页“改”也会滚过去，同一道再点也滚', async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    backend({
      '/api/admin/reviews': () => ({ reviews: [{ ...dish('u_a', '妈妈的红烧肉'), author: '小明', submittedAt: Date.now(), duplicate: false, revision: 1 }] }),
    })
    const reviews = mount(ReviewsView, { props: { menu: MENU }, attachTo: document.body })
    await flushPromises()
    const editReview = () => reviews.find('.review-row').findAll('button').find((b) => b.text() === '改了再通过').trigger('click')
    await editReview()
    await flushPromises()
    await editReview()
    await flushPromises()
    expect(scrolled).toHaveBeenCalledTimes(2)
    reviews.unmount()

    const { default: MyDishesView } = await import('../src/account/MyDishesView.vue')
    backend({
      '/api/my/dishes': () => ({ canEdit: true, reason: null, dishes: [{ ...dish('u_m', '我的菜'), status: 'private', reviewNote: null }], approved: [] }),
      '/api/my/menu': () => ({ version: 2, meals: MEALS, items: [] }),
    })
    const mine = mount(MyDishesView, { attachTo: document.body })
    await flushPromises()
    const editMine = () => mine.find('.dish-row').findAll('button').find((b) => b.text() === '改').trigger('click')
    await editMine()
    await flushPromises()
    await editMine()
    await flushPromises()
    expect(scrolled).toHaveBeenCalledTimes(4)
    mine.unmount()
    delete Element.prototype.scrollIntoView
  })

  it('菜单列表里有图片的菜标“有图”（跟在“某某 提交”后面），没图的不标', async () => {
    backend({})
    const menu = { meals: MEALS, dishes: [dish('g1', '麻辣烫'), dish('u_s', '红烧肉', { scope: 'shared', author: '小明', image: `up_${'a'.repeat(32)}.webp` })] }
    const w = mount(DishesView, { props: { menu } })
    const rows = w.findAll('.dish-row')
    expect(rows[0].text()).not.toContain('有图')
    expect(rows[1].findAll('.badge').map((b) => b.text())).toEqual(['共享 · 小明 提交', '有图'])
  })
})
