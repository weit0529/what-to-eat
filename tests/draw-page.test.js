// 抽取页面（src/components/DrawPage.vue 及其子组件）的测试
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import DrawPage from '../src/components/DrawPage.vue'
import { makeItemId } from '../src/core/menu-data.js'

function dish(name, category, meals, extra = {}) {
  const shop = extra.shop ?? null
  return { id: makeItemId(name, shop), name, shop, category, meals, tags: [], price: null, description: null, image: null, ...extra }
}

const MENU = [
  dish('包子', '早点', ['breakfast']),
  dish('牛肉面', '面食', ['lunch', 'dinner']),
  dish('牛肉面', '面食', ['lunch', 'dinner'], { shop: '楼下' }),
  dish('麻辣烫', '火锅串串', ['lunch', 'dinner']),
  dish('火锅', '火锅串串', ['dinner']),
]

const wrappers = []
function mountPage(props = {}) {
  const wrapper = mount(DrawPage, { props: { items: MENU, rollDuration: 0, ...props } })
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  vi.useRealTimers()
})

const mealButton = (w, label) => w.findAll('.meal').find((b) => b.find('.label').text() === label)
// 分类按钮的文字是“emoji 分类名 数量”，按分类名找
const chip = (w, name) => w.findAll('.chip').find((b) => b.text().split(/\s+/).includes(name))
const drawButton = (w) => w.find('.draw-button')
const resultName = (w) => (w.find('.result-card').exists() ? w.find('.result-card .name').text() : null)
const resultShop = (w) =>
  w.find('.result-card .shop').exists() ? w.find('.result-card .shop').text().replace('📍', '').trim() : null

describe('选餐次', () => {
  it('打开时没有选中任何餐次，先提示选餐次，也没有抽取按钮', () => {
    const w = mountPage()
    expect(w.findAll('.meal.selected')).toHaveLength(0)
    expect(w.find('.prompt').text()).toContain('先选这是哪一餐')
    expect(drawButton(w).exists()).toBe(false)
  })

  it('按钮上显示每一餐有几道菜', () => {
    const w = mountPage()
    expect(w.findAll('.meal').map((b) => `${b.find('.label').text()} ${b.find('.count').text()}`)).toEqual([
      '早餐 1 道',
      '午餐 3 道',
      '晚餐 4 道',
    ])
  })

  it('选中后按钮高亮，显示可选数量', async () => {
    const w = mountPage()
    await mealButton(w, '晚餐').trigger('click')
    expect(mealButton(w, '晚餐').attributes('aria-pressed')).toBe('true')
    expect(w.find('.candidate-count').text()).toBe('晚餐有 4 道可选')
    expect(drawButton(w).find('.btn-label').text()).toBe('帮我选！')
  })
})

describe('抽取（A-02、A-04）', () => {
  it('抽中的是这一餐的菜，按钮变成“再抽一次”', async () => {
    const w = mountPage({ random: () => 0 })
    await mealButton(w, '早餐').trigger('click')
    await drawButton(w).trigger('click')
    expect(resultName(w)).toBe('包子')
    expect(drawButton(w).find('.btn-label').text()).toBe('再抽一次')
  })

  it('真实随机抽 30 次，结果都属于这一餐', async () => {
    const w = mountPage({ random: Math.random })
    await mealButton(w, '午餐').trigger('click')
    for (let i = 0; i < 30; i++) {
      await drawButton(w).trigger('click')
      expect(['牛肉面', '麻辣烫']).toContain(resultName(w))
    }
  })

  it('“再抽一次”不会连续抽到同一道', async () => {
    const w = mountPage({ random: () => 0 })
    await mealButton(w, '午餐').trigger('click')
    await drawButton(w).trigger('click')
    const first = [resultName(w), resultShop(w)]
    await drawButton(w).trigger('click')
    expect([resultName(w), resultShop(w)]).not.toEqual(first)
  })

  it('换餐次时清掉上一次的结果', async () => {
    const w = mountPage({ random: () => 0 })
    await mealButton(w, '早餐').trigger('click')
    await drawButton(w).trigger('click')
    await mealButton(w, '晚餐').trigger('click')
    expect(resultName(w)).toBeNull()
    expect(drawButton(w).find('.btn-label').text()).toBe('帮我选！')
  })

  it('这一餐没有菜时给出提示，按钮不能点', async () => {
    const w = mountPage({ items: MENU.filter((item) => !item.meals.includes('breakfast')) })
    await mealButton(w, '早餐').trigger('click')
    expect(w.find('.empty').text()).toContain('还没有适合早餐的菜')
    expect(drawButton(w).attributes('disabled')).toBeDefined()
    expect(w.find('.exclude-panel').exists()).toBe(false)
  })
})

describe('临时排除（A-03）', () => {
  it('排除分类后，抽 20 次都不会出现', async () => {
    const w = mountPage({ random: Math.random })
    await mealButton(w, '晚餐').trigger('click')
    await chip(w, '火锅串串').trigger('click')
    expect(w.find('.candidate-count').text()).toBe('晚餐有 2 道可选')
    expect(w.find('.summary').text()).toBe('已排除 1 类')
    for (let i = 0; i < 20; i++) {
      await drawButton(w).trigger('click')
      expect(resultName(w)).toBe('牛肉面')
    }
  })

  it('按菜排除：同品类不同店铺分开算', async () => {
    const w = mountPage({ random: () => 0 })
    await mealButton(w, '午餐').trigger('click')
    await w.find('.toggle-dishes').trigger('click')
    const box = w.findAll('.dish').find((d) => d.text() === '牛肉面 · 楼下').find('input')
    await box.setValue(true)
    expect(w.find('.candidate-count').text()).toBe('午餐有 2 道可选')
    expect(w.find('.summary').text()).toBe('已排除 1 道')
    for (let i = 0; i < 5; i++) {
      await drawButton(w).trigger('click')
      expect(resultShop(w)).toBeNull()
    }
  })

  it('整类排除时，这一类的菜显示为已勾上且不能单独改', async () => {
    const w = mountPage()
    await mealButton(w, '晚餐').trigger('click')
    await w.find('.toggle-dishes').trigger('click')
    await chip(w, '火锅串串').trigger('click')
    const fire = w.findAll('.dish').find((d) => d.text() === '火锅').find('input')
    expect(fire.element.checked).toBe(true)
    expect(fire.attributes('disabled')).toBeDefined()
  })

  it('全部排除时提示，“全部恢复”后又能抽', async () => {
    const w = mountPage()
    await mealButton(w, '午餐').trigger('click')
    await chip(w, '面食').trigger('click')
    await chip(w, '火锅串串').trigger('click')
    expect(w.find('.empty').text()).toContain('都被排除了')
    expect(drawButton(w).attributes('disabled')).toBeDefined()
    await w.find('.head .link').trigger('click')
    expect(w.find('.empty').exists()).toBe(false)
    expect(w.find('.candidate-count').text()).toBe('午餐有 3 道可选')
  })

  it('排除了当前结果时，结果被清掉', async () => {
    const w = mountPage({ random: () => 0.99 })
    await mealButton(w, '午餐').trigger('click')
    await drawButton(w).trigger('click')
    expect(resultName(w)).toBe('麻辣烫')
    await chip(w, '火锅串串').trigger('click')
    expect(resultName(w)).toBeNull()
  })

  it('排除跨餐次保留，但“已排除”只算这一餐有关的', async () => {
    const w = mountPage()
    await mealButton(w, '晚餐').trigger('click')
    await chip(w, '火锅串串').trigger('click')
    await mealButton(w, '早餐').trigger('click')
    expect(w.find('.summary').text()).toBe('都可以')
    await mealButton(w, '午餐').trigger('click')
    expect(w.find('.summary').text()).toBe('已排除 1 类')
  })

  it('重新打开页面（刷新）后，排除全部恢复', async () => {
    const w = mountPage()
    await mealButton(w, '晚餐').trigger('click')
    await chip(w, '火锅串串').trigger('click')
    w.unmount()
    const fresh = mountPage()
    await mealButton(fresh, '晚餐').trigger('click')
    expect(fresh.find('.summary').text()).toBe('都可以')
    expect(fresh.find('.candidate-count').text()).toBe('晚餐有 4 道可选')
  })
})

describe('抽取动画', () => {
  it('动画期间闪过名字、按钮不能点，结束后显示结果', async () => {
    vi.useFakeTimers()
    const w = mountPage({ random: () => 0, rollDuration: 700 })
    await mealButton(w, '晚餐').trigger('click')
    await drawButton(w).trigger('click')
    expect(w.find('.rolling').exists()).toBe(true)
    expect(drawButton(w).attributes('disabled')).toBeDefined()
    expect(resultName(w)).toBeNull()

    await vi.advanceTimersByTimeAsync(700)
    expect(w.find('.rolling').exists()).toBe(false)
    expect(resultName(w)).toBe('牛肉面')
  })

  it('动画期间换餐次，动画停止且不会冒出旧结果', async () => {
    vi.useFakeTimers()
    const w = mountPage({ random: () => 0, rollDuration: 700 })
    await mealButton(w, '晚餐').trigger('click')
    await drawButton(w).trigger('click')
    await mealButton(w, '早餐').trigger('click')
    await vi.advanceTimersByTimeAsync(1000)
    expect(w.find('.rolling').exists()).toBe(false)
    expect(resultName(w)).toBeNull()
  })

  // Codex 第 5 轮审核发现：动画开始时结果已定，动画期间排除它，结束后仍会显示。
  // 用户选的修法：动画期间改排除就取消这次抽取
  describe('动画期间改排除，取消这次抽取', () => {
    async function startRolling() {
      vi.useFakeTimers()
      // random 固定为 0：午餐会抽中第一道“牛肉面”
      const w = mountPage({ random: () => 0, rollDuration: 700 })
      await mealButton(w, '午餐').trigger('click')
      await drawButton(w).trigger('click')
      expect(w.find('.rolling').exists()).toBe(true)
      return w
    }

    async function expectCancelled(w) {
      expect(w.find('.rolling').exists()).toBe(false)
      expect(w.find('.empty').text()).toContain('这次没抽完')
      expect(drawButton(w).attributes('disabled')).toBeUndefined()
      expect(drawButton(w).find('.btn-label').text()).toBe('帮我选！')
      await vi.advanceTimersByTimeAsync(2000)
      expect(resultName(w)).toBeNull()
    }

    it('排除了将要抽中的分类', async () => {
      const w = await startRolling()
      await chip(w, '面食').trigger('click')
      await expectCancelled(w)
    })

    it('单独勾掉了将要抽中的菜', async () => {
      const w = await startRolling()
      await w.find('.toggle-dishes').trigger('click')
      await w.findAll('.dish').find((d) => d.text() === '牛肉面').find('input').setValue(true)
      await expectCancelled(w)
    })

    it('改的是别的分类也取消（规则简单：动画期间一改就取消）', async () => {
      const w = await startRolling()
      await chip(w, '火锅串串').trigger('click')
      await expectCancelled(w)
    })

    it('点“全部恢复”也取消', async () => {
      vi.useFakeTimers()
      const w = mountPage({ random: () => 0, rollDuration: 700 })
      await mealButton(w, '午餐').trigger('click')
      await chip(w, '火锅串串').trigger('click')
      await drawButton(w).trigger('click')
      await w.find('.head .link').trigger('click')
      await expectCancelled(w)
    })

    it('取消后再抽一次，按新的排除抽，提示消失', async () => {
      const w = await startRolling()
      await chip(w, '面食').trigger('click')
      await drawButton(w).trigger('click')
      expect(w.find('.empty').exists()).toBe(false)
      await vi.advanceTimersByTimeAsync(700) // 只剩麻辣烫一道时不放动画，这里只是保险
      expect(resultName(w)).toBe('麻辣烫')
    })

    it('动画期间不显示上一次的结果，取消后也不会冒出旧结果', async () => {
      vi.useFakeTimers()
      const w = mountPage({ random: () => 0, rollDuration: 700 })
      await mealButton(w, '午餐').trigger('click')
      await drawButton(w).trigger('click')
      await vi.advanceTimersByTimeAsync(700)
      expect(resultName(w)).toBe('牛肉面')
      await drawButton(w).trigger('click') // 再抽一次，开始动画
      expect(resultName(w)).toBeNull()
      await chip(w, '火锅串串').trigger('click')
      expect(resultName(w)).toBeNull()
    })

    it('换餐次不显示“没抽完”的提示', async () => {
      const w = await startRolling()
      await mealButton(w, '晚餐').trigger('click')
      expect(w.find('.empty').exists()).toBe(false)
    })
  })

  it('只有一道可选时不播放动画', async () => {
    vi.useFakeTimers()
    const w = mountPage({ rollDuration: 700 })
    await mealButton(w, '早餐').trigger('click')
    await drawButton(w).trigger('click')
    expect(resultName(w)).toBe('包子')
  })
})
