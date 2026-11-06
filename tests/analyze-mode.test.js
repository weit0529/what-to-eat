// “帮我分析”页面、模式切换、临时小名单的组件测试（M7）
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import DrawPage from '../src/components/DrawPage.vue'
import { makeItemId } from '../src/core/menu-data.js'

function dish(name, category, meals, tags, price = null, shop = null) {
  return { id: makeItemId(name, shop), name, shop, category, meals, tags, price, description: null, image: null }
}

const MENU = [
  dish('包子', '早点', ['breakfast'], ['热乎', '实惠'], 8),
  dish('麻辣烫', '火锅串串', ['lunch', 'dinner'], ['辣', '热乎', '适合一个人', '适合下雨'], 25),
  dish('火锅', '火锅串串', ['dinner'], ['辣', '热乎', '适合多人', '犒劳自己'], 100),
  dish('馄饨', '饺子馄饨', ['lunch', 'dinner'], ['热乎', '清淡', '汤', '适合下雨'], 15),
  dish('寿司', '日韩料理', ['lunch', 'dinner'], ['清淡', '冷食', '畅饮'], 50),
  dish('黄焖鸡', '米饭快餐', ['lunch', 'dinner'], ['下饭', '适合一个人'], null),
]

const wrappers = []
function mountPage(props = {}) {
  const w = mount(DrawPage, { props: { items: MENU, rollDuration: 0, random: () => 0, ...props } })
  wrappers.push(w)
  return w
}
afterEach(() => {
  localStorage.clear() // “最近吃过”存在浏览器里，测试之间不能串
  wrappers.splice(0).forEach((w) => w.unmount())
  vi.useRealTimers()
})

const click = (el) => el.trigger('click')
const mealButton = (w, label) => w.findAll('.meal').find((b) => b.find('.label').text() === label)
const modeTab = (w, mode) => w.find(`.mode-tab[data-mode="${mode}"]`)
const tagChip = (w, tag) => w.find(`.tag-chip[data-tag="${tag}"]`)
const categoryChip = (w, name) => w.findAll('.chip').find((b) => b.text().split(/\s+/).includes(name))
const recommendButton = (w) => w.find('.recommend-button')
const pickName = (w) => (w.find('.result-card .name').exists() ? w.find('.result-card .name').text() : null)
const altNames = (w) => w.findAll('.alt-name').map((e) => e.text())
const reasons = (w) => w.findAll('.reasons li').map((li) => li.text().replace(/\s+/g, ' ').trim())

async function openAnalyze(meal = '午餐', props) {
  const w = mountPage(props)
  await click(mealButton(w, meal))
  await click(modeTab(w, 'analyze'))
  return w
}

describe('模式切换', () => {
  it('选了餐次才出现切换，默认是随机抽', async () => {
    const w = mountPage()
    expect(w.find('.mode-tabs').exists()).toBe(false)
    await click(mealButton(w, '午餐'))
    expect(modeTab(w, 'random').attributes('aria-pressed')).toBe('true')
    expect(w.find('.draw-button').exists()).toBe(true)
    expect(w.find('.analyze-panel').exists()).toBe(false)
  })

  it('切到“帮我分析”，餐次和“不想吃的”两边共用', async () => {
    const w = mountPage()
    await click(mealButton(w, '午餐'))
    await click(categoryChip(w, '火锅串串'))
    await click(modeTab(w, 'analyze'))
    expect(w.find('.analyze-panel').exists()).toBe(true)
    expect(w.find('.draw-button').exists()).toBe(false)
    expect(categoryChip(w, '火锅串串').classes()).toContain('excluded')
    // 被排除的分类不会被推荐
    for (let i = 0; i < 5; i++) {
      await click(recommendButton(w))
      expect(pickName(w)).not.toBe('麻辣烫')
    }
    await click(modeTab(w, 'random'))
    expect(categoryChip(w, '火锅串串').classes()).toContain('excluded')
  })
})

describe('标签（B-02）', () => {
  it('只列出这一餐的菜里出现过的标签，按建议分组，其余归“其他”', async () => {
    const w = await openAnalyze('早餐')
    expect(w.findAll('.tag-group h3').map((h) => h.text())).toEqual(['吃起来', '价格和速度'])
    await click(mealButton(w, '午餐'))
    const groups = w.findAll('.tag-group h3').map((h) => h.text())
    expect(groups).toContain('天气')
    expect(groups[groups.length - 1]).toBe('其他')
    expect(tagChip(w, '畅饮').exists()).toBe(true)
    expect(tagChip(w, '犒劳自己').exists()).toBe(false) // 只有晚餐的火锅有
  })

  it('点一下想要，再点不要，第三下取消；摘要跟着变', async () => {
    const w = await openAnalyze()
    const chip = () => tagChip(w, '辣')
    expect(w.find('.conditions .summary').text()).toBe('还没选')
    await click(chip())
    expect(chip().classes()).toContain('want')
    expect(chip().text()).toContain('（想要）')
    expect(w.find('.conditions .summary').text()).toBe('想要 1 个')
    await click(chip())
    expect(chip().classes()).toContain('avoid')
    expect(w.find('.conditions .summary').text()).toBe('不要 1 个')
    await click(chip())
    expect(chip().classes()).not.toContain('want')
    expect(chip().classes()).not.toContain('avoid')
    expect(w.find('.conditions .summary').text()).toBe('还没选')
  })

  it('什么都不选也能推荐', async () => {
    const w = await openAnalyze()
    await click(recommendButton(w))
    expect(pickName(w)).toBe('麻辣烫')
    expect(w.find('.notice').exists()).toBe(false)
  })

  it('“清空条件”把标签和预算都清掉', async () => {
    const w = await openAnalyze()
    await click(tagChip(w, '辣'))
    await w.find('.budget-input').setValue('30')
    await click(w.find('.conditions .link'))
    expect(w.find('.conditions .summary').text()).toBe('还没选')
    expect(w.find('.budget-input').element.value).toBe('')
  })
})

describe('推荐结果（B-01、B-03）', () => {
  it('推荐命中想要的标签的菜，理由里列出命中的标签', async () => {
    const w = await openAnalyze()
    await click(tagChip(w, '适合下雨'))
    await click(tagChip(w, '清淡'))
    await click(recommendButton(w))
    expect(pickName(w)).toBe('馄饨')
    expect(w.find('.result-card .ribbon').text()).toContain('最推荐！')
    // 理由按标签分组的顺序（口味在天气前面）
    expect(reasons(w)).toEqual(['✔ 清淡', '✔ 适合下雨'])
    expect(altNames(w)).toEqual(['麻辣烫', '寿司'])
  })

  it('“不要”的标签：带它的菜不会被推荐，也不会出现在备选里', async () => {
    const w = await openAnalyze('晚餐', { random: Math.random })
    await click(tagChip(w, '辣'))
    await click(tagChip(w, '辣')) // 变成“不要”
    for (let i = 0; i < 10; i++) {
      await click(recommendButton(w))
      expect(['馄饨', '寿司', '黄焖鸡']).toContain(pickName(w))
      expect(altNames(w)).not.toContain('麻辣烫')
      expect(altNames(w)).not.toContain('火锅')
    }
  })

  it('预算：超预算的不推荐；没填价格的照样参与并标“价格未填”', async () => {
    const w = await openAnalyze()
    await click(tagChip(w, '适合一个人'))
    await w.find('.budget-input').setValue('20')
    await click(recommendButton(w))
    expect(pickName(w)).toBe('黄焖鸡')
    expect(reasons(w)).toContain('❔ 价格未填')
  })

  it('在预算内时理由里写“在预算内”', async () => {
    const w = await openAnalyze()
    await click(tagChip(w, '汤'))
    await w.find('.budget-input').setValue('15')
    await click(recommendButton(w))
    expect(pickName(w)).toBe('馄饨')
    expect(reasons(w)).toContain('✔ 在预算内')
  })

  it('预算的各种写法：空、0、小数、首尾空格可以；全角数字、负号、中间空格、超长数字算填错', async () => {
    const w = await openAnalyze()
    const input = w.find('.budget-input')
    for (const ok of ['', '0', '12.5', ' 30 ']) {
      await input.setValue(ok)
      expect(w.find('.error').exists(), JSON.stringify(ok)).toBe(false)
    }
    for (const bad of ['３０', '-5', '3 0', '30元', '9'.repeat(400)]) {
      await input.setValue(bad)
      expect(w.find('.error').exists(), bad.slice(0, 10)).toBe(true)
      expect(input.attributes('aria-invalid'), bad.slice(0, 10)).toBe('true')
    }
  })

  it('超长数字预算：提示填错，按不限照样推荐，不会没反应（Codex 第 10 轮审核）', async () => {
    const w = await openAnalyze()
    await w.find('.budget-input').setValue('9'.repeat(400))
    await click(recommendButton(w))
    expect(pickName(w)).toBe('麻辣烫')
  })

  it('预算填错时提示，并按不限处理', async () => {
    const w = await openAnalyze()
    await w.find('.budget-input').setValue('三十')
    expect(w.find('.error').text()).toContain('只填数字')
    expect(w.find('.budget-input').attributes('aria-invalid')).toBe('true')
    await click(recommendButton(w))
    expect(pickName(w)).toBe('麻辣烫')
  })

  it('没有完全符合的：提示“最接近”，并写出缺少的标签', async () => {
    const w = await openAnalyze()
    await click(tagChip(w, '辣'))
    await click(tagChip(w, '汤'))
    await click(recommendButton(w))
    expect(w.find('.notice').text()).toContain('最接近')
    expect(pickName(w)).toBe('麻辣烫')
    expect(reasons(w)).toEqual(['✔ 辣', '✘ 缺少 汤'])
  })

  it('一个都没命中：明确提示没有，不硬推', async () => {
    const w = await openAnalyze()
    await click(tagChip(w, '冷食'))
    await click(categoryChip(w, '日韩料理')) // 唯一带“冷食”的寿司被排除
    await click(recommendButton(w))
    expect(pickName(w)).toBeNull()
    expect(w.find('.empty').text()).toContain('没有菜带这些标签：冷食')
  })

  it('全被筛掉：说明各被筛掉几道', async () => {
    const w = await openAnalyze()
    for (const tag of ['热乎', '下饭']) {
      await click(tagChip(w, tag))
      await click(tagChip(w, tag)) // 变成“不要”
    }
    await w.find('.budget-input').setValue('10')
    await click(recommendButton(w))
    // 麻辣烫、馄饨带热乎，黄焖鸡带下饭；寿司 50 元超预算
    expect(w.find('.empty').text()).toContain('3 道带“不要”的标签，1 道超出预算')
  })

  describe('改了条件，旧的推荐就消失', () => {
    const changes = {
      标签: (w) => click(tagChip(w, '辣')),
      预算: (w) => w.find('.budget-input').setValue('20'),
      不想吃的分类: (w) => click(categoryChip(w, '日韩料理')),
      不想吃的单道菜: async (w) => {
        await click(w.find('.toggle-dishes'))
        await w.findAll('.dish').find((d) => d.text() === '寿司').find('input').setValue(true)
      },
      餐次: (w) => click(mealButton(w, '晚餐')),
    }
    for (const [name, change] of Object.entries(changes)) {
      it(name, async () => {
        const w = await openAnalyze()
        await click(recommendButton(w))
        expect(pickName(w)).not.toBeNull()
        await change(w)
        expect(pickName(w)).toBeNull()
        expect(recommendButton(w).find('.btn-label').text()).toBe('帮我推荐')
      })
    }
  })

  it('“换一个”换成另一道', async () => {
    const w = await openAnalyze()
    await click(tagChip(w, '热乎'))
    await click(recommendButton(w))
    const first = pickName(w)
    expect(recommendButton(w).find('.btn-label').text()).toBe('换一个')
    await click(recommendButton(w))
    expect(pickName(w)).not.toBe(first)
  })
})

describe('小名单（B-04）', () => {
  it('在分析结果上加入小名单，随机模式里打开开关后只在名单里抽', async () => {
    const w = await openAnalyze('午餐', { random: Math.random })
    await click(tagChip(w, '清淡'))
    await click(recommendButton(w))
    await click(w.find('.shortlist-button'))
    expect(w.find('.shortlist-button').text()).toContain('已在小名单')
    await click(w.findAll('.alt-add')[0])
    const names = [pickName(w), ...altNames(w)].slice(0, 2).sort()

    await click(modeTab(w, 'random'))
    expect(w.findAll('.shortlist-panel .chips li').map((li) => li.text().replace('✕', '').replace('移出', '').trim()).sort()).toEqual(names)
    await w.find('.switch-input').setValue(true)
    expect(w.find('.candidate-count').text()).toBe('小名单里有 2 道')
    expect(w.find('.exclude-panel').exists()).toBe(false) // 小名单不受“不想吃的”影响，先收起
    for (let i = 0; i < 20; i++) {
      await click(w.find('.draw-button'))
      expect(names).toContain(w.find('.result-card .name').text())
    }
  })

  it('小名单不受餐次限制：早餐时也能抽午餐加进来的菜', async () => {
    const w = mountPage()
    await click(mealButton(w, '午餐'))
    await click(w.find('.picker-toggle'))
    await click(w.findAll('.pick').find((b) => b.text().includes('寿司')))
    await click(mealButton(w, '早餐'))
    await w.find('.switch-input').setValue(true)
    await click(w.find('.draw-button'))
    expect(w.find('.result-card .name').text()).toBe('寿司')
  })

  it('开关打开但名单是空的：提示，按钮不能点', async () => {
    const w = mountPage()
    await click(mealButton(w, '午餐'))
    await w.find('.switch-input').setValue(true)
    expect(w.find('.empty').text()).toContain('小名单还是空的')
    expect(w.find('.draw-button').attributes('disabled')).toBeDefined()
  })

  it('移出、清空', async () => {
    const w = mountPage()
    await click(mealButton(w, '午餐'))
    await click(w.find('.picker-toggle'))
    for (const name of ['寿司', '馄饨']) await click(w.findAll('.pick').find((b) => b.text().includes(name)))
    expect(w.findAll('.shortlist-panel .chips li')).toHaveLength(2)
    await click(w.find('.shortlist-panel .chips .chip'))
    expect(w.findAll('.shortlist-panel .chips li')).toHaveLength(1)
    await click(w.find('.shortlist-panel .clear'))
    expect(w.findAll('.shortlist-panel .chips li')).toHaveLength(0)
  })

  it('动画期间改小名单或开关，这次抽取取消', async () => {
    vi.useFakeTimers()
    const w = mountPage({ rollDuration: 700 })
    await click(mealButton(w, '午餐'))
    await click(w.find('.draw-button'))
    expect(w.find('.rolling').exists()).toBe(true)
    await w.find('.switch-input').setValue(true)
    expect(w.find('.rolling').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(w.find('.result-card').exists()).toBe(false)
  })

  it('小名单开着时，动画期间从名单里移出一道，这次抽取取消（Codex 第 10 轮审核）', async () => {
    vi.useFakeTimers()
    const w = mountPage({ rollDuration: 700 })
    await click(mealButton(w, '午餐'))
    await click(w.find('.picker-toggle'))
    for (const name of ['寿司', '馄饨']) await click(w.findAll('.pick').find((b) => b.text().includes(name)))
    await w.find('.switch-input').setValue(true)
    await click(w.find('.draw-button'))
    expect(w.find('.rolling').exists()).toBe(true)
    await click(w.find('.shortlist-panel .chips .chip')) // 移出第一道（寿司，random 为 0 时本来会抽中它）
    expect(w.find('.rolling').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(w.find('.result-card').exists()).toBe(false)
    expect(w.find('.empty').text()).toContain('这次没抽完')
  })

  it('动画期间切到“帮我分析”，抽取取消，切回来提示没抽完', async () => {
    vi.useFakeTimers()
    const w = mountPage({ rollDuration: 700 })
    await click(mealButton(w, '午餐'))
    await click(w.find('.draw-button'))
    await click(modeTab(w, 'analyze'))
    await vi.advanceTimersByTimeAsync(1000)
    await click(modeTab(w, 'random'))
    expect(w.find('.result-card').exists()).toBe(false)
    expect(w.find('.empty').text()).toContain('这次没抽完')
  })

  it('刷新（重新打开）后小名单清空', async () => {
    const w = mountPage()
    await click(mealButton(w, '午餐'))
    await click(w.find('.picker-toggle'))
    await click(w.findAll('.pick')[0])
    w.unmount()
    const fresh = mountPage()
    await click(mealButton(fresh, '午餐'))
    expect(fresh.findAll('.shortlist-panel .chips li')).toHaveLength(0)
  })
})

// 用户 2026-11-05 11:56 的修改：加第一道菜自动启用小名单；分析页下方气泡“去随机抽食物”
describe('小名单自动启用和“去随机抽”气泡', () => {
  async function addFromAnalyze(w) {
    await click(recommendButton(w))
    await click(w.find('.shortlist-button'))
  }

  it('分析页里还没加菜时没有气泡；加了第一道就出现，写着几道', async () => {
    const w = await openAnalyze()
    expect(w.find('.shortlist-bubble').exists()).toBe(false)
    await addFromAnalyze(w)
    const bubble = w.find('.shortlist-bubble')
    expect(bubble.text()).toContain('选好小名单了，去随机抽食物')
    expect(bubble.find('.bubble-badge').text()).toBe('1 道')
    await click(w.findAll('.alt-add')[0])
    expect(w.find('.shortlist-bubble .bubble-badge').text()).toBe('2 道')
  })

  it('点气泡：跳到随机抽，开关已打开，只在小名单里抽', async () => {
    const w = await openAnalyze('午餐', { random: Math.random })
    await addFromAnalyze(w)
    const picked = pickName(w)
    await click(w.find('.shortlist-bubble'))
    expect(modeTab(w, 'random').attributes('aria-pressed')).toBe('true')
    expect(w.find('.switch-input').element.checked).toBe(true)
    expect(w.find('.candidate-count').text()).toBe('小名单里有 1 道')
    expect(w.find('.shortlist-bubble').exists()).toBe(false) // 随机抽页面不显示气泡
    await click(w.find('.draw-button'))
    expect(w.find('.result-card .name').text()).toBe(picked)
  })

  it('在随机抽页面挑第一道菜，也自动打开开关', async () => {
    const w = mountPage()
    await click(mealButton(w, '午餐'))
    expect(w.find('.switch-input').element.checked).toBe(false)
    await click(w.find('.picker-toggle'))
    await click(w.findAll('.pick').find((b) => b.text().includes('寿司')))
    expect(w.find('.switch-input').element.checked).toBe(true)
    expect(w.find('.candidate-count').text()).toBe('小名单里有 1 道')
  })

  it('手动关掉开关后再加菜，不会又被自动打开（只在从空变成有菜时自动打开）', async () => {
    const w = mountPage()
    await click(mealButton(w, '午餐'))
    await click(w.find('.picker-toggle'))
    await click(w.findAll('.pick').find((b) => b.text().includes('寿司')))
    await w.find('.switch-input').setValue(false)
    await click(w.findAll('.pick').find((b) => b.text().includes('馄饨')))
    expect(w.find('.switch-input').element.checked).toBe(false)
  })

  it('清空小名单：开关自动关掉，气泡消失', async () => {
    const w = await openAnalyze()
    await addFromAnalyze(w)
    await click(w.find('.shortlist-button')) // 再点一下移出
    expect(w.find('.shortlist-bubble').exists()).toBe(false)
    await click(modeTab(w, 'random'))
    expect(w.find('.switch-input').element.checked).toBe(false)
    expect(w.find('.candidate-count').text()).toBe('午餐有 4 道可选')
  })
})
