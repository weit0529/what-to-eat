// 阶段 3 页面测试：条件区默认收起（1A）、额外餐次按钮（2B）、“最近吃过”（5A、6A、7A）
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import DrawPage from '../src/components/DrawPage.vue'
import { makeItemId, MEALS } from '../src/core/menu-data.js'
import { STORAGE_KEY } from '../src/ui/eaten-store.js'

function dish(name, category, meals, tags = [], price = null) {
  return { id: makeItemId(name, ''), name, shop: null, category, meals, tags, price, description: null, image: null }
}

const MENU = [
  dish('麻辣烫', '火锅串串', ['lunch', 'dinner', '夜宵'], ['辣', '热乎'], 25),
  dish('馄饨', '饺子馄饨', ['lunch', 'dinner'], ['热乎', '汤'], 15),
  dish('寿司', '日韩料理', ['lunch', 'dinner'], ['清淡'], 50),
  dish('奶茶', '饮品甜点', ['下午茶'], ['甜'], 18),
  dish('烧烤', '烧烤', ['dinner', '夜宵'], ['重口'], 80),
]
const ALL_MEALS = [
  ...MEALS.map((m) => ({ ...m, emoji: null, builtIn: true })),
  { id: '下午茶', label: '下午茶', emoji: '🧋', builtIn: false },
  { id: '夜宵', label: '夜宵', emoji: null, builtIn: false },
]

/** 内存里的假 localStorage */
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  }
}

const wrappers = []
function mountPage(props = {}) {
  const w = mount(DrawPage, {
    props: { items: MENU, meals: ALL_MEALS, rollDuration: 0, random: () => 0, storage: fakeStorage(), ...props },
    attachTo: document.body, // 需要真实的可见性判断（v-show）
  })
  wrappers.push(w)
  return w
}
afterEach(() => {
  vi.useRealTimers()
  wrappers.splice(0).forEach((w) => w.unmount())
  document.body.innerHTML = ''
})

const click = (el) => el.trigger('click')
const mealButton = (w, label) => w.findAll('.meal').find((b) => b.find('.label').text() === label)
const modeTab = (w, mode) => w.find(`.mode-tab[data-mode="${mode}"]`)
const resultName = (w) => (w.find('.result-card .name').exists() ? w.find('.result-card .name').text() : null)

describe('额外餐次按钮（2B）', () => {
  it('早午晚还是第一行三个；下午茶、夜宵在下面，带图标和数量', async () => {
    const w = mountPage()
    const all = w.findAll('.meal')
    expect(all.slice(0, 3).map((b) => b.find('.label').text())).toEqual(['早餐', '午餐', '晚餐'])
    expect(all.slice(0, 3).every((b) => !b.classes().includes('extra'))).toBe(true)
    const extra = w.findAll('.meal.extra')
    expect(extra.map((b) => b.find('.label').text())).toEqual(['下午茶', '夜宵'])
    expect(extra.map((b) => b.find('.emoji').text())).toEqual(['🧋', '🌃'])
    expect(extra.map((b) => b.find('.count').text())).toEqual(['1 道', '2 道'])
  })

  it('选夜宵后只抽夜宵的菜，提示里写“夜宵”', async () => {
    const w = mountPage({ random: Math.random })
    await click(mealButton(w, '夜宵'))
    expect(w.find('.candidate-count').text()).toBe('夜宵有 2 道可选')
    for (let i = 0; i < 10; i++) {
      await click(w.find('.draw-button'))
      expect(['麻辣烫', '烧烤']).toContain(resultName(w))
    }
  })

  it('不传 meals 时只有早午晚（兼容旧数据）', () => {
    const w = mount(DrawPage, { props: { items: MENU, storage: null } })
    wrappers.push(w)
    expect(w.findAll('.meal.extra')).toHaveLength(0)
    expect(w.findAll('.meal')).toHaveLength(3)
  })
})

describe('条件区默认收起（1A）', () => {
  it('“不想吃的”“最近吃过”默认收起，只显示摘要；点标题展开、再点收起', async () => {
    const w = mountPage()
    await click(mealButton(w, '午餐'))
    for (const panel of ['.exclude-panel', '.recent-panel']) {
      const toggle = w.find(`${panel} .panel-toggle`)
      expect(toggle.attributes('aria-expanded'), panel).toBe('false')
      expect(w.find(`${panel} .body`).isVisible(), panel).toBe(false)
      expect(w.find(`${panel} .summary`).isVisible(), panel).toBe(true)
      await click(toggle)
      expect(toggle.attributes('aria-expanded'), panel).toBe('true')
      expect(w.find(`${panel} .body`).isVisible(), panel).toBe(true)
      await click(toggle)
      expect(w.find(`${panel} .body`).isVisible(), panel).toBe(false)
    }
  })

  it('“想吃点什么样的？”默认收起；摘要里写出想要、不要和预算', async () => {
    const w = mountPage()
    await click(mealButton(w, '午餐'))
    await click(modeTab(w, 'analyze'))
    expect(w.find('.conditions .body').isVisible()).toBe(false)
    expect(w.find('.conditions .summary').text()).toBe('还没选')
    await click(w.find('.conditions .panel-toggle'))
    expect(w.find('.conditions .body').isVisible()).toBe(true)
    await click(w.find('.tag-chip[data-tag="辣"]'))
    await click(w.find('.tag-chip[data-tag="汤"]'))
    await click(w.find('.tag-chip[data-tag="汤"]'))
    await w.find('.budget-input').setValue('30')
    expect(w.find('.conditions .summary').text()).toBe('想要 1 个、不要 1 个、预算 30 元')
    await w.find('.budget-input').setValue('三十')
    expect(w.find('.conditions .summary').text()).toBe('想要 1 个、不要 1 个、预算填错了')
  })

  it('收起时“全部恢复”“清空条件”仍然能用', async () => {
    const w = mountPage()
    await click(mealButton(w, '午餐'))
    await click(w.find('.exclude-panel .panel-toggle'))
    await click(w.findAll('.chip').find((c) => c.text().includes('寿司') || c.text().includes('日韩料理')))
    await click(w.find('.exclude-panel .panel-toggle')) // 收起
    expect(w.find('.exclude-panel .summary').text()).toBe('已排除 1 类')
    await click(w.find('.exclude-panel .head .link'))
    expect(w.find('.exclude-panel .summary').text()).toBe('都可以')
  })
})

describe('最近吃过（5A、6A、7A）', () => {
  async function drawLunchAndEat(w) {
    await click(mealButton(w, '午餐'))
    await click(w.find('.draw-button')) // random 0 → 麻辣烫
    await click(w.find('.eat-button'))
  }

  it('点“就吃这个”记一条并存到本机；按钮变成“已记下”，结果卡片不消失', async () => {
    const storage = fakeStorage()
    const w = mountPage({ storage })
    await drawLunchAndEat(w)
    expect(resultName(w)).toBe('麻辣烫')
    expect(w.find('.eat-button').text()).toContain('已记下')
    expect(w.find('.eat-button').attributes('aria-pressed')).toBe('true')
    const saved = JSON.parse(storage.data.get(STORAGE_KEY))
    expect(saved.map((r) => [r.id, r.label])).toEqual([[makeItemId('麻辣烫', ''), '麻辣烫']])
    expect(w.find('.recent-panel .summary').text()).toBe('1 道，已避开')
  })

  it('再点一下撤销', async () => {
    const storage = fakeStorage()
    const w = mountPage({ storage })
    await drawLunchAndEat(w)
    await click(w.find('.eat-button'))
    expect(w.find('.eat-button').text()).toContain('就吃这个')
    expect(storage.data.has(STORAGE_KEY)).toBe(false)
    expect(w.find('.recent-panel .summary').text()).toBe('还没有记录')
  })

  it('避开最近吃过的：再抽 20 次都不出现；关掉开关又能抽到', async () => {
    const w = mountPage()
    await drawLunchAndEat(w)
    expect(w.find('.candidate-count').text()).toBe('午餐有 2 道可选')
    await w.setProps({ random: Math.random })
    for (let i = 0; i < 20; i++) {
      await click(w.find('.draw-button'))
      expect(resultName(w)).not.toBe('麻辣烫')
    }
    await click(w.find('.recent-panel .panel-toggle'))
    await w.find('.avoid-input').setValue(false)
    expect(w.find('.recent-panel .summary').text()).toBe('1 道，没有避开')
    expect(w.find('.candidate-count').text()).toBe('午餐有 3 道可选')
  })

  it('刷新（重新打开）后记录还在，仍然避开', async () => {
    const storage = fakeStorage()
    const w = mountPage({ storage })
    await drawLunchAndEat(w)
    w.unmount()
    const fresh = mountPage({ storage })
    await click(mealButton(fresh, '午餐'))
    expect(fresh.find('.recent-panel .summary').text()).toBe('1 道，已避开')
    expect(fresh.find('.candidate-count').text()).toBe('午餐有 2 道可选')
  })

  it('能选的都最近吃过：提示，按钮不能点', async () => {
    const w = mountPage()
    await click(mealButton(w, '下午茶'))
    await click(w.find('.draw-button'))
    await click(w.find('.eat-button'))
    await click(mealButton(w, '晚餐'))
    await click(mealButton(w, '下午茶'))
    expect(w.find('.empty').text()).toContain('最近几天都吃过了')
    expect(w.find('.draw-button').attributes('disabled')).toBeDefined()
  })

  it('记录列表和清空', async () => {
    const storage = fakeStorage()
    const w = mountPage({ storage })
    await drawLunchAndEat(w)
    await click(w.find('.recent-panel .panel-toggle'))
    expect(w.findAll('.records li').map((li) => [li.find('.record-name').text(), li.find('.record-day').text()])).toEqual([
      ['麻辣烫', '今天'],
    ])
    await click(w.find('.recent-panel .clear'))
    expect(w.findAll('.records li')).toHaveLength(0)
    expect(storage.data.has(STORAGE_KEY)).toBe(false)
  })

  it('分析模式：最近吃过的不推荐；全被筛掉时说明有几道是最近吃过的', async () => {
    const w = mountPage()
    await drawLunchAndEat(w)
    await click(modeTab(w, 'analyze'))
    await click(w.find('.conditions .panel-toggle'))
    await click(w.find('.tag-chip[data-tag="辣"]'))
    await click(w.find('.recommend-button'))
    // 午餐里只有麻辣烫带“辣”，它被避开了，其他菜一个都没命中
    expect(w.find('.empty').text()).toContain('没有菜带这些标签')
    await click(w.find('.tag-chip[data-tag="辣"]'))
    await click(w.find('.tag-chip[data-tag="辣"]')) // 取消
    await w.find('.budget-input').setValue('20')
    await click(w.find('.recommend-button'))
    expect(resultName(w)).toBe('馄饨')
    // 筛的顺序：先“不要”的标签，再预算，再最近吃过
    await click(w.find('.tag-chip[data-tag="汤"]'))
    await click(w.find('.tag-chip[data-tag="汤"]')) // 不要汤 → 馄饨
    await w.find('.budget-input').setValue('30') // 寿司 50 超预算
    await click(w.find('.recommend-button'))
    expect(w.find('.empty').text()).toContain('1 道带“不要”的标签，1 道超出预算，1 道最近吃过')
  })

  it('分析模式里点“就吃这个”：记下来，推荐卡片不消失', async () => {
    const storage = fakeStorage()
    const w = mountPage({ storage })
    await click(mealButton(w, '午餐'))
    await click(modeTab(w, 'analyze'))
    await click(w.find('.recommend-button'))
    const name = resultName(w)
    await click(w.find('.eat-button'))
    expect(resultName(w)).toBe(name)
    expect(w.find('.eat-button').text()).toContain('已记下')
    expect(storage.data.has(STORAGE_KEY)).toBe(true)
  })

  it('小名单模式不避开最近吃过的（7A），也不显示“最近吃过”', async () => {
    const w = mountPage()
    await drawLunchAndEat(w)
    await click(w.find('.picker-toggle'))
    await click(w.findAll('.pick').find((b) => b.text().includes('麻辣烫')))
    expect(w.find('.switch-input').element.checked).toBe(true)
    expect(w.find('.recent-panel').exists()).toBe(false)
    await click(w.find('.draw-button'))
    expect(resultName(w)).toBe('麻辣烫')
  })

  it('浏览器存不了时提示，但当次仍然能记、能避开', async () => {
    const w = mountPage({ storage: null })
    await drawLunchAndEat(w)
    await click(w.find('.recent-panel .panel-toggle'))
    expect(w.find('.recent-panel .warn').text()).toContain('没存住')
    expect(w.find('.recent-panel .summary').text()).toBe('1 道，已避开（没存住）')
    expect(w.find('.candidate-count').text()).toBe('午餐有 2 道可选')
  })
})

// Codex 第 13 轮审核发现的问题（reviews/review-codex-13.md），用户决定按推荐修
describe('阶段 3 审核后的修复', () => {
  it('只剩一道候选时点“就吃这个”：卡片和撤销按钮保留，下面提示；撤销后又能抽', async () => {
    const w = mountPage()
    await click(mealButton(w, '下午茶')) // 只有奶茶
    await click(w.find('.draw-button'))
    await click(w.find('.eat-button'))
    expect(resultName(w)).toBe('奶茶')
    expect(w.find('.eat-button').text()).toContain('已记下')
    expect(w.find('.last-note').text()).toContain('能选的最近都吃过了')
    expect(w.find('.draw-button').attributes('disabled')).toBeDefined()
    await click(w.find('.eat-button')) // 撤销
    expect(w.find('.last-note').exists()).toBe(false)
    expect(w.find('.draw-button').attributes('disabled')).toBeUndefined()
  })

  it('页面开着跨过午夜：换餐次、抽取、推荐时按新的日期重新算“最近 3 天”', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 5, 23, 59))
    const storage = fakeStorage({
      [STORAGE_KEY]: JSON.stringify([{ id: makeItemId('麻辣烫', ''), label: '麻辣烫', at: new Date(2026, 10, 3, 12).toISOString() }]),
    })
    const w = mountPage({ storage })
    await click(mealButton(w, '午餐'))
    expect(w.find('.candidate-count').text()).toBe('午餐有 2 道可选') // 3 号吃的，5 号还算最近
    vi.setSystemTime(new Date(2026, 10, 6, 0, 1)) // 到了 6 号，3 号的不算了
    await click(mealButton(w, '晚餐'))
    await click(mealButton(w, '午餐'))
    expect(w.find('.candidate-count').text()).toBe('午餐有 3 道可选')
    await click(w.find('.draw-button')) // random 0 → 第一道麻辣烫
    expect(resultName(w)).toBe('麻辣烫')
  })

  it('分析推荐的那一刻按当时的日期算', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 5, 23, 59))
    const storage = fakeStorage({
      [STORAGE_KEY]: JSON.stringify([{ id: makeItemId('麻辣烫', ''), label: '麻辣烫', at: new Date(2026, 10, 3, 12).toISOString() }]),
    })
    const w = mountPage({ storage })
    await click(mealButton(w, '午餐'))
    await click(modeTab(w, 'analyze'))
    await click(w.find('.recommend-button'))
    expect(resultName(w)).toBe('馄饨')
    vi.setSystemTime(new Date(2026, 10, 6, 0, 1))
    await click(w.find('.recommend-button')) // 换一个：麻辣烫已经不算最近了，random 0 选到它
    expect(resultName(w)).toBe('麻辣烫')
  })

  it('保存失败：提示没存住，这次照常避开；之后保存成功提示消失', async () => {
    let fail = true
    const data = new Map()
    const storage = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        if (fail) throw new Error('QuotaExceededError')
        data.set(k, v)
      },
      removeItem: (k) => data.delete(k),
    }
    const w = mountPage({ storage })
    await click(mealButton(w, '午餐'))
    await click(w.find('.draw-button'))
    await click(w.find('.eat-button'))
    expect(w.find('.recent-panel .summary').text()).toBe('1 道，已避开（没存住）')
    expect(w.find('.candidate-count').text()).toBe('午餐有 2 道可选')
    fail = false
    await click(w.find('.eat-button')) // 撤销：清空记录（removeItem 成功）
    expect(w.find('.recent-panel .summary').text()).toBe('还没有记录')
  })
})

// Codex 第 14 轮复审发现的两处（reviews/review-codex-14.md）
describe('阶段 3 复审后的修复', () => {
  it('都吃过了、按钮不能点时，页面开着过了午夜会自动刷新', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 5, 23, 59))
    const storage = fakeStorage({
      [STORAGE_KEY]: JSON.stringify([{ id: makeItemId('奶茶', ''), label: '奶茶', at: new Date(2026, 10, 3, 15).toISOString() }]),
    })
    const w = mountPage({ storage })
    await click(mealButton(w, '下午茶')) // 只有奶茶，3 号吃过
    expect(w.find('.draw-button').attributes('disabled')).toBeDefined()
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000) // 过了午夜
    expect(w.find('.draw-button').attributes('disabled')).toBeUndefined()
    expect(w.find('.candidate-count').text()).toBe('下午茶有 1 道可选')
  })

  it('卸载后不留下午夜闹钟', async () => {
    vi.useFakeTimers()
    const w = mountPage()
    expect(vi.getTimerCount()).toBe(1)
    w.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('有时间有误的未来记录时，撤销删的是今天刚记的那条', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 5, 12, 0))
    const id = makeItemId('奶茶', '')
    const future = { id, label: '奶茶', at: new Date(2026, 10, 10, 12).toISOString() }
    const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify([future]) })
    const w = mountPage({ storage })
    await click(mealButton(w, '下午茶'))
    await click(w.find('.draw-button')) // 未来的记录不算最近，奶茶能抽
    await click(w.find('.eat-button'))
    await click(w.find('.eat-button')) // 撤销
    expect(w.find('.eat-button').text()).toContain('就吃这个')
    expect(JSON.parse(storage.data.get(STORAGE_KEY))).toEqual([future])
  })
})
