// 周四特典（REQUIREMENTS.md R-033）：判断逻辑（src/core/thursday.js）和抽取页（DrawPage）里的表现
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import DrawPage from '../src/components/DrawPage.vue'
import { beijingDay, markUsed, nextBeijingMidnight, readUsedDay, resetMemory, thursdaySpecial, THURSDAY_KEY } from '../src/core/thursday.js'

// 2026-11-19 是周四。北京时间周四 0 点 = UTC 周三 16 点
const THU_START = Date.parse('2026-11-18T16:00:00Z')
const THU_END = Date.parse('2026-11-19T15:59:59Z')
const THU_NOON = Date.parse('2026-11-19T04:00:00Z')
const KFC = { id: 'd_kfc', name: 'KFC', shop: null, category: '西式快餐', meals: ['lunch', 'dinner'], tags: [], price: 40, description: null, image: null }

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v)
    },
  }
}

afterEach(() => {
  resetMemory()
  localStorage.clear()
  vi.useRealTimers()
})

describe('判断：今天是不是周四、用过没有（北京时间，4B）', () => {
  it('按北京时间算哪一天、星期几', () => {
    expect(beijingDay(THU_START)).toEqual({ day: '2026-11-19', weekday: 4 })
    expect(beijingDay(THU_START - 1)).toEqual({ day: '2026-11-18', weekday: 3 })
    expect(beijingDay(THU_END)).toEqual({ day: '2026-11-19', weekday: 4 })
    expect(beijingDay(THU_END + 1000)).toEqual({ day: '2026-11-20', weekday: 5 })
  })

  it('北京时间周四 0 点到 24 点、今天还没用过、有这道菜时才出特典', () => {
    expect(thursdaySpecial(KFC, THU_START, '')).toBe(KFC)
    expect(thursdaySpecial(KFC, THU_END, '2026-11-12')).toBe(KFC) // 上周四用过不影响
    expect(thursdaySpecial(KFC, THU_START - 1, '')).toBeNull() // 周三 23:59:59
    expect(thursdaySpecial(KFC, THU_END + 1000, '')).toBeNull() // 周五 0 点
    expect(thursdaySpecial(KFC, THU_NOON, '2026-11-19')).toBeNull() // 今天用过了
    expect(thursdaySpecial(null, THU_NOON, '')).toBeNull() // 没有这道菜（或管理员关了）
  })

  it('用过的日子存在浏览器里；存不了时记在这一页里', () => {
    const storage = memoryStorage()
    markUsed(storage, THU_NOON)
    expect(storage.data[THURSDAY_KEY]).toBe('2026-11-19')
    expect(readUsedDay(storage)).toBe('2026-11-19')

    resetMemory()
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readUsedDay(broken)).toBe('')
    markUsed(broken, THU_NOON)
    expect(readUsedDay(broken)).toBe('2026-11-19')
    expect(readUsedDay(null)).toBe('2026-11-19')
  })
})

// ---- 抽取页 ----
function dish(id, name, category, meals) {
  return { id, name, shop: null, category, meals, tags: [], price: null, description: null, image: null }
}
const MENU = [
  dish('d_bao', '包子', '早点', ['breakfast']),
  dish('d_mian', '牛肉面', '面食', ['lunch', 'dinner']),
  dish('d_mlt', '麻辣烫', '火锅串串', ['lunch', 'dinner']),
  KFC,
]

const wrappers = []
function mountPage(props = {}) {
  const wrapper = mount(DrawPage, {
    props: { items: MENU, rollDuration: 0, random: () => 0, storage: null, thursdayDish: KFC, ...props },
  })
  wrappers.push(wrapper)
  return wrapper
}
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
})

/** 只假装“现在”的时间，定时器照常 */
function setNow(ms) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(ms)
}

const mealButton = (w, label) => w.findAll('.meal').find((b) => b.find('.label').text() === label)
const chip = (w, name) => w.findAll('.exclude-panel .chip').find((b) => b.find('.chip-name').text() === name)
const drawButton = (w) => w.find('.draw-button')
const resultName = (w) => (w.find('.result-card').exists() ? w.find('.result-card .name').text() : null)
const badge = (w) => (w.find('.result-card .badge').exists() ? w.find('.result-card .badge').text() : null)

describe('抽取页：周四第一次抽到 KFC（2A、3A）', () => {
  it('周四第一次抽：早餐也抽到 KFC，标“周四特典”；再抽恢复正常；用过的日子记在浏览器里', async () => {
    setNow(THU_NOON)
    const storage = memoryStorage()
    const w = mountPage({ thursdayStorage: storage })
    await mealButton(w, '早餐').trigger('click')
    await drawButton(w).trigger('click')
    expect(resultName(w)).toBe('KFC')
    expect(badge(w)).toBe('周四特典')
    expect(storage.data[THURSDAY_KEY]).toBe('2026-11-19')

    await drawButton(w).trigger('click')
    expect(resultName(w)).toBe('包子')
    expect(badge(w)).toBeNull()
  })

  it('刷新页面（重新打开）后，今天不会再来一次', async () => {
    setNow(THU_NOON)
    const storage = memoryStorage()
    const first = mountPage({ thursdayStorage: storage })
    await mealButton(first, '午餐').trigger('click')
    await drawButton(first).trigger('click')
    expect(resultName(first)).toBe('KFC')

    const again = mountPage({ thursdayStorage: storage })
    await mealButton(again, '午餐').trigger('click')
    await drawButton(again).trigger('click')
    expect(resultName(again)).toBe('牛肉面')
  })

  it('排除了 KFC 的分类也照样抽到；之后再改排除，特典结果不被清掉', async () => {
    setNow(THU_NOON)
    const w = mountPage({ thursdayStorage: memoryStorage() })
    await mealButton(w, '午餐').trigger('click')
    await chip(w, '西式快餐').trigger('click')
    await drawButton(w).trigger('click')
    expect(resultName(w)).toBe('KFC')
    await chip(w, '面食').trigger('click')
    expect(resultName(w)).toBe('KFC')
  })

  it('“只看我加的”时（菜单里没有 KFC）也照样抽到', async () => {
    setNow(THU_NOON)
    const w = mountPage({ items: [MENU[1]], thursdayStorage: memoryStorage() })
    await mealButton(w, '午餐').trigger('click')
    await drawButton(w).trigger('click')
    expect(resultName(w)).toBe('KFC')
  })

  it('不是周四、今天用过了、没有特典菜时，都照常抽', async () => {
    setNow(THU_START - 1)
    let w = mountPage({ thursdayStorage: memoryStorage() })
    await mealButton(w, '午餐').trigger('click')
    await drawButton(w).trigger('click')
    expect(resultName(w)).toBe('牛肉面')

    setNow(THU_NOON)
    w = mountPage({ thursdayStorage: memoryStorage({ [THURSDAY_KEY]: '2026-11-19' }) })
    await mealButton(w, '午餐').trigger('click')
    await drawButton(w).trigger('click')
    expect(resultName(w)).toBe('牛肉面')

    w = mountPage({ thursdayDish: null, thursdayStorage: memoryStorage() })
    await mealButton(w, '午餐').trigger('click')
    await drawButton(w).trigger('click')
    expect(resultName(w)).toBe('牛肉面')
  })

  it('动画中途被取消的不算用过，下次还是 KFC；动画播完才算', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(THU_NOON)
    const storage = memoryStorage()
    const w = mountPage({ thursdayStorage: storage, rollDuration: 700 })
    await mealButton(w, '午餐').trigger('click')
    await drawButton(w).trigger('click')
    await chip(w, '面食').trigger('click') // 动画期间改排除 → 取消
    await vi.advanceTimersByTimeAsync(1000)
    expect(resultName(w)).toBeNull()
    expect(storage.data[THURSDAY_KEY]).toBeUndefined()

    await drawButton(w).trigger('click')
    await vi.advanceTimersByTimeAsync(700)
    expect(resultName(w)).toBe('KFC')
    expect(storage.data[THURSDAY_KEY]).toBe('2026-11-19')
  })

  it('浏览器存不了时，这一页里只来一次', async () => {
    setNow(THU_NOON)
    const w = mountPage({ thursdayStorage: null })
    await mealButton(w, '午餐').trigger('click')
    await drawButton(w).trigger('click')
    expect(resultName(w)).toBe('KFC')
    await drawButton(w).trigger('click')
    expect(resultName(w)).not.toBe('KFC')
  })

  it('“就吃这个”照常能记 KFC', async () => {
    setNow(THU_NOON)
    const w = mountPage({ thursdayStorage: memoryStorage() })
    await mealButton(w, '早餐').trigger('click')
    await drawButton(w).trigger('click')
    await w.find('.result-card .eat-button').trigger('click')
    expect(w.find('.result-card .eat-button').attributes('aria-pressed')).toBe('true')
  })
})

describe('Codex 第 51 轮', () => {
  it('B-51-01：普通候选一道都没有（这一餐没菜 / 全排除 / 都吃过）也能点出特典；用过后按原来的规则', async () => {
    setNow(THU_NOON)
    // 这一餐没菜：只看我加的里只有午餐菜，选早餐
    let w = mountPage({ items: [MENU[1]], thursdayStorage: memoryStorage() })
    await mealButton(w, '早餐').trigger('click')
    expect(w.find('.outcome .empty').exists()).toBe(false)
    expect(drawButton(w).attributes('disabled')).toBeUndefined()
    await drawButton(w).trigger('click')
    expect(resultName(w)).toBe('KFC')
    expect(badge(w)).toBe('周四特典')
    expect(drawButton(w).attributes('disabled')).toBeDefined() // 用过了，普通候选还是没有
    expect(resultName(w)).toBe('KFC') // 卡片留着，能点“就吃这个”

    // 全部排除
    w = mountPage({ thursdayStorage: memoryStorage() })
    await mealButton(w, '早餐').trigger('click')
    await chip(w, '早点').trigger('click')
    expect(drawButton(w).attributes('disabled')).toBeUndefined()
    await drawButton(w).trigger('click')
    expect(resultName(w)).toBe('KFC')

    // 都吃过（避开最近吃过的开着）
    w = mountPage({ thursdayStorage: memoryStorage(), storage: null, items: [MENU[0], KFC] })
    await mealButton(w, '早餐').trigger('click')
    await drawButton(w).trigger('click') // 第一次：特典
    await w.find('.result-card .eat-button').trigger('click') // 记 KFC
    await drawButton(w).trigger('click') // 第二次：包子
    expect(resultName(w)).toBe('包子')
    await w.find('.result-card .eat-button').trigger('click') // 记包子 → 早餐都吃过了
    expect(drawButton(w).attributes('disabled')).toBeDefined() // 特典用过了，照原来的规则不能抽
  })

  it('B-51-01：不是周四时，候选为空照旧不能点、显示提示', async () => {
    setNow(THU_START - 1)
    const w = mountPage({ items: [MENU[1]], thursdayStorage: memoryStorage() })
    await mealButton(w, '早餐').trigger('click')
    expect(drawButton(w).attributes('disabled')).toBeDefined()
    expect(w.find('.outcome .empty').text()).toContain('还没有适合早餐的菜')
  })

  it('B-51-02：特典显示后把这一餐全部排除，卡片还在', async () => {
    setNow(THU_NOON)
    const w = mountPage({ thursdayStorage: memoryStorage() })
    await mealButton(w, '午餐').trigger('click')
    await drawButton(w).trigger('click')
    expect(resultName(w)).toBe('KFC')
    for (const name of ['面食', '火锅串串', '西式快餐']) await chip(w, name).trigger('click')
    expect(w.find('.outcome .empty').exists()).toBe(false)
    expect(resultName(w)).toBe('KFC')
    expect(w.find('.result-card .eat-button').exists()).toBe(true)
  })

  it('B-51-03：两个页面动画重叠，后结束的那个改成普通抽', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(THU_NOON)
    const storage = memoryStorage()
    const a = mountPage({ thursdayStorage: storage, rollDuration: 700 })
    const b = mountPage({ thursdayStorage: storage, rollDuration: 700 })
    await mealButton(a, '午餐').trigger('click')
    await mealButton(b, '午餐').trigger('click')
    await drawButton(a).trigger('click')
    await vi.advanceTimersByTimeAsync(100)
    await drawButton(b).trigger('click')
    await vi.advanceTimersByTimeAsync(600)
    expect(resultName(a)).toBe('KFC')
    expect(badge(a)).toBe('周四特典')
    await vi.advanceTimersByTimeAsync(100)
    expect(resultName(b)).toBe('牛肉面')
    expect(badge(b)).toBeNull()
  })

  it('全新打开的页面（页内没有记录）读到浏览器里存的日期，不再来一次', async () => {
    setNow(THU_NOON)
    resetMemory()
    const w = mountPage({ thursdayStorage: memoryStorage({ [THURSDAY_KEY]: '2026-11-19' }), items: [MENU[1]] })
    await mealButton(w, '早餐').trigger('click')
    expect(drawButton(w).attributes('disabled')).toBeDefined()
  })
})

describe('Codex 第 52 轮：手机不在中国时区、页面一直开着', () => {
  it('下一个北京时间午夜', () => {
    expect(nextBeijingMidnight(THU_START - 1)).toBe(THU_START)
    expect(nextBeijingMidnight(THU_START)).toBe(THU_START + 24 * 3600 * 1000)
    expect(nextBeijingMidnight(THU_NOON)).toBe(THU_START + 24 * 3600 * 1000)
  })

  it('B-52-01：纽约时区，北京时间跨进周四后，没得选的早餐按钮自己变成能点；跨出周四又变回去', async () => {
    const oldTz = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      vi.useFakeTimers()
      vi.setSystemTime(THU_START - 1000) // 北京周三 23:59:59，纽约周三 10:59:59
      expect(new Date().getTimezoneOffset()).toBe(300)
      const w = mountPage({ items: [MENU[1]], thursdayStorage: memoryStorage() })
      await mealButton(w, '早餐').trigger('click')
      expect(drawButton(w).attributes('disabled')).toBeDefined()
      await vi.advanceTimersByTimeAsync(3000)
      expect(drawButton(w).attributes('disabled')).toBeUndefined()
      expect(w.find('.outcome .empty').exists()).toBe(false)

      // 一直开到北京周五 0 点：没点过特典的话，按钮又变回不能点
      await vi.advanceTimersByTimeAsync(24 * 3600 * 1000)
      expect(drawButton(w).attributes('disabled')).toBeDefined()
      expect(w.find('.outcome .empty').text()).toContain('还没有适合早餐的菜')
    } finally {
      if (oldTz === undefined) delete process.env.TZ
      else process.env.TZ = oldTz
    }
  })
})
