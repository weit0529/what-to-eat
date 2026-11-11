// 从后台读菜单（src/core/remote-menu.js）和网站打开时换上最新菜单（src/App.vue）的测试
import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../src/App.vue'
import builtInMenu from '../src/generated/menu.json'
import { fetchMenu, isValidMenu } from '../src/core/remote-menu.js'

const MEALS = [
  { id: 'breakfast', label: '早餐', builtIn: true },
  { id: 'lunch', label: '午餐', builtIn: true },
  { id: 'dinner', label: '晚餐', builtIn: true },
]
const item = (name) => ({ id: JSON.stringify([name, '']), name, shop: null, category: '面食', meals: ['lunch'], tags: [], price: null, description: null, image: null })
const remote = { version: 2, meals: MEALS, items: [item('后台的面'), item('后台的粉')] }
const respond = (body, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe('isValidMenu', () => {
  it('格式对的菜单才收；没有菜、版本不对、缺字段都不收', () => {
    expect(isValidMenu(remote)).toBe(true)
    expect(isValidMenu({ ...remote, items: [] })).toBe(false)
    expect(isValidMenu({ ...remote, version: 1 })).toBe(false)
    expect(isValidMenu({ ...remote, items: [{ ...item('x'), meals: 'lunch' }] })).toBe(false)
    expect(isValidMenu(null)).toBe(false)
  })
})

describe('fetchMenu', () => {
  it('取到就返回菜单（去掉 serverMs 等多余的字段）', async () => {
    const { menu } = await fetchMenu('https://api/api/menu', { fetchImpl: respond({ ...remote, serverMs: 3 }) })
    expect(menu).toEqual(remote)
  })

  it('HTTP 出错、格式不对、连不上、太慢，都返回 null 和原因，不抛错', async () => {
    expect((await fetchMenu('u', { fetchImpl: respond({}, 500) })).reason).toContain('HTTP 500')
    expect((await fetchMenu('u', { fetchImpl: respond({ version: 2 }) })).menu).toBe(null)
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect((await fetchMenu('u', { fetchImpl: down })).reason).toContain('连不上')
    const slow = vi.fn((url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))))
    expect((await fetchMenu('u', { fetchImpl: slow, timeoutMs: 20 })).menu).toBe(null)
  })
})

describe('网站打开时', () => {
  it('先显示内置菜单，后台取到最新菜单后换上', async () => {
    const fetchImpl = respond(remote)
    const w = mount(App, { props: { fetchImpl } })
    expect(w.find('.app-footer span').text()).toBe(`菜单共 ${builtInMenu.items.length} 道`)
    await flushPromises()
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringMatching(/\/api\/menu$/), expect.anything())
    expect(w.find('.app-footer span').text()).toBe('菜单共 2 道')
  })

  it('后台连不上时一直用内置菜单（R-026）', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const w = mount(App, { props: { fetchImpl: down } })
    await flushPromises()
    expect(w.find('.app-footer span').text()).toBe(`菜单共 ${builtInMenu.items.length} 道`)
  })
})

describe('最新菜单什么时候换上（Codex 第 28 轮）', () => {
  /** 一个会等我们放行才返回的假后台 */
  function gate(body) {
    let open
    const ready = new Promise((resolve) => (open = resolve))
    const fetchImpl = vi.fn(async () => {
      await ready
      return new Response(JSON.stringify(body))
    })
    return { fetchImpl, open }
  }

  it('和内置菜单一样时什么都不做', async () => {
    const fetchImpl = respond(builtInMenu)
    const w = mount(App, { props: { fetchImpl } })
    await flushPromises()
    expect(w.find('.menu-update').exists()).toBe(false)
  })

  it('用户已经在用了：不偷偷换，提示“菜单有更新”；点了才换，整页重新开始', async () => {
    const { fetchImpl, open } = gate(remote)
    const w = mount(App, { props: { fetchImpl }, attachTo: document.body })
    await w.find('main').trigger('pointerdown')
    await w.findAll('.meal')[1].trigger('click')
    open()
    await flushPromises()
    expect(w.find('.app-footer span').text()).toBe(`菜单共 ${builtInMenu.items.length} 道`)
    expect(w.find('.meal.selected').exists()).toBe(true)
    expect(w.find('.menu-update').text()).toContain('菜单有更新')
    await w.find('.menu-update button').trigger('click')
    expect(w.find('.app-footer span').text()).toBe('菜单共 2 道')
    expect(w.find('.menu-update').exists()).toBe(false)
    expect(w.find('.meal.selected').exists()).toBe(false)
    w.unmount()
  })

  it('用户还没点过页面：直接换上', async () => {
    const { fetchImpl, open } = gate(remote)
    const w = mount(App, { props: { fetchImpl } })
    open()
    await flushPromises()
    expect(w.find('.app-footer span').text()).toBe('菜单共 2 道')
    expect(w.find('.menu-update').exists()).toBe(false)
  })
})
