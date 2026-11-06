// “帮我分析”推荐逻辑（src/core/recommend.js）和标签分组（src/core/tags.js）的测试
import { describe, it, expect } from 'vitest'
import { recommend, assessItem, shortlistItems, toggleShortlist, MAX_ALTERNATIVES } from '../src/core/recommend.js'
import { groupTags, TAG_GROUPS, OTHER_GROUP } from '../src/core/tags.js'
import { makeItemId } from '../src/core/menu-data.js'

function dish(name, tags, { category = '分类', meals = ['lunch', 'dinner'], price = null, shop = '' } = {}) {
  return { id: makeItemId(name, shop), name, shop: shop || null, category, meals, tags, price }
}

const MENU = [
  dish('麻辣烫', ['辣', '热乎', '适合一个人'], { category: '火锅串串', price: 25 }),
  dish('火锅', ['辣', '热乎', '适合多人', '适合下雨'], { category: '火锅串串', price: 100, meals: ['dinner'] }),
  dish('馄饨', ['热乎', '清淡', '汤'], { category: '饺子馄饨', price: 15 }),
  dish('寿司', ['清淡', '冷食'], { category: '日韩料理', price: 50 }),
  dish('黄焖鸡', ['下饭', '适合一个人'], { category: '米饭快餐', price: null }),
  dish('包子', ['热乎', '实惠'], { category: '早点', price: 8, meals: ['breakfast'] }),
]

const names = (list) => list.map((a) => a.item.name)
const LUNCH = { meal: 'lunch' }

describe('assessItem', () => {
  it('列出命中和缺少的标签，分数是命中个数', () => {
    const a = assessItem(MENU[0], { wantTags: ['辣', '汤', '热乎'] })
    expect(a).toMatchObject({ matched: ['辣', '热乎'], missing: ['汤'], score: 2, priceStatus: null })
  })

  it('想要的标签重复时只算一次', () => {
    expect(assessItem(MENU[0], { wantTags: ['辣', '辣'] }).score).toBe(1)
  })

  it('价格状态：没设预算为 null；设了预算时，没填价格为 unknown，否则 within', () => {
    expect(assessItem(MENU[0], { budget: 30 }).priceStatus).toBe('within')
    expect(assessItem(MENU[4], { budget: 30 }).priceStatus).toBe('unknown')
    expect(assessItem(MENU[4], {}).priceStatus).toBeNull()
  })
})

describe('recommend：筛选', () => {
  it('只推荐这一餐的菜，不想吃的不推荐（和随机抽取一致）', () => {
    for (let i = 0; i < 30; i++) {
      const r = recommend(MENU, { meal: 'lunch', excludedCategories: ['火锅串串'], excludedIds: [makeItemId('寿司', '')] })
      expect(['馄饨', '黄焖鸡']).toContain(r.pick.item.name)
      for (const a of [r.pick, ...r.alternatives]) expect(a.item.meals).toContain('lunch')
    }
  })

  it('带“不要”标签的菜直接筛掉，并计数', () => {
    const r = recommend(MENU, { ...LUNCH, avoidTags: ['辣'] }, { random: () => 0 })
    expect([r.pick, ...r.alternatives].every((a) => !a.item.tags.includes('辣'))).toBe(true)
    expect(r.filtered).toEqual({ byAvoid: 1, byBudget: 0, byRecent: 0 })
  })

  it('超出预算的筛掉；没填价格的保留并标“价格未填”', () => {
    const r = recommend(MENU, { ...LUNCH, budget: 20, wantTags: ['适合一个人'] }, { random: () => 0 })
    expect(r.filtered).toEqual({ byAvoid: 0, byBudget: 2, byRecent: 0 }) // 麻辣烫 25、寿司 50
    expect(r.pick.item.name).toBe('黄焖鸡')
    expect(r.pick.priceStatus).toBe('unknown')
    expect(names(r.alternatives)).toEqual([])
  })

  it('预算等于价格时算在预算内；预算 0 只剩没填价格的', () => {
    expect(recommend(MENU, { ...LUNCH, budget: 15, wantTags: ['汤'] }).pick.item.name).toBe('馄饨')
    expect(recommend(MENU, { ...LUNCH, budget: 0 }).pick.item.name).toBe('黄焖鸡')
  })

  it('筛完没菜了：说明原因和各筛掉几道', () => {
    const r = recommend(MENU, { ...LUNCH, budget: 10, avoidTags: ['下饭'] })
    expect(r).toMatchObject({ status: 'empty', emptyReason: 'all-filtered', pick: null, alternatives: [] })
    expect(r.filtered).toEqual({ byAvoid: 1, byBudget: 3, byRecent: 0 })
  })

  it('这一餐本来没菜、或全被“不想吃的”排除：沿用随机抽取的原因', () => {
    expect(recommend(MENU.slice(0, 1), { meal: 'breakfast' }).emptyReason).toBe('no-items-for-meal')
    expect(recommend(MENU, { meal: 'breakfast', excludedCategories: ['早点'] }).emptyReason).toBe('all-excluded')
  })

  it('预算不是合法数字时报错（属于程序写错）', () => {
    for (const bad of [-1, NaN, '30', Infinity]) {
      expect(() => recommend(MENU, { ...LUNCH, budget: bad }), String(bad)).toThrow(RangeError)
    }
    expect(() => recommend(MENU, { ...LUNCH, budget: undefined })).not.toThrow()
  })
})

describe('recommend：打分和推荐（B-01）', () => {
  it('命中想要的标签越多越优先，全部命中时 match 为 all', () => {
    const r = recommend(MENU, { meal: 'dinner', wantTags: ['辣', '适合下雨'] }, { random: () => 0.99 })
    expect(r).toMatchObject({ status: 'ok', match: 'all' })
    expect(r.pick.item.name).toBe('火锅')
    expect(r.pick.matched).toEqual(['辣', '适合下雨'])
    expect(names(r.alternatives)).toEqual(['麻辣烫']) // 只命中“辣”；一个没命中的不算备选
  })

  it('同分时在最高分里随机，每道都可能被选中', () => {
    const want = { ...LUNCH, wantTags: ['热乎'] } // 麻辣烫、馄饨 同为 1 分
    expect(recommend(MENU, want, { random: () => 0 }).pick.item.name).toBe('麻辣烫')
    expect(recommend(MENU, want, { random: () => 0.99 }).pick.item.name).toBe('馄饨')
  })

  it('没有完全符合的：推荐最接近的，match 为 partial，并列出缺少的标签（B-03）', () => {
    const r = recommend(MENU, { ...LUNCH, wantTags: ['清淡', '汤', '适合多人'] }, { random: () => 0 })
    expect(r).toMatchObject({ status: 'ok', match: 'partial' })
    expect(r.pick.item.name).toBe('馄饨')
    expect(r.pick.missing).toEqual(['适合多人'])
    expect(names(r.alternatives)).toEqual(['寿司'])
  })

  it('一个想要的标签都没命中：status 为 none，不硬推（B-03）', () => {
    const r = recommend(MENU, { ...LUNCH, wantTags: ['夜宵'] })
    expect(r).toMatchObject({ status: 'none', pick: null, alternatives: [], match: null })
  })

  it('没选想要的标签：在筛完的菜里随机推荐，match 为 all，备选按表格顺序', () => {
    const r = recommend(MENU, LUNCH, { random: () => 0 })
    expect(r).toMatchObject({ status: 'ok', match: 'all' })
    expect(r.pick.item.name).toBe('麻辣烫')
    expect(names(r.alternatives)).toEqual(['馄饨', '寿司', '黄焖鸡'])
  })

  it(`备选最多 ${MAX_ALTERNATIVES} 道，不包含主推`, () => {
    const r = recommend(MENU, { meal: 'dinner' }, { random: () => 0.5 })
    expect(r.alternatives.length).toBeLessThanOrEqual(MAX_ALTERNATIVES)
    expect(r.alternatives).not.toContain(r.pick)
  })

  it('不改动传进来的菜单和条件', () => {
    const menu = structuredClone(MENU)
    const criteria = { ...LUNCH, wantTags: ['热乎'], avoidTags: ['辣'], budget: 30 }
    const copy = structuredClone(criteria)
    recommend(menu, criteria)
    expect(menu).toEqual(MENU)
    expect(criteria).toEqual(copy)
  })
})

describe('recommend：换一个', () => {
  it('同分的有多道时，换成同分的另一道', () => {
    const want = { ...LUNCH, wantTags: ['热乎'] }
    for (const r of [0, 0.5, 0.99]) {
      const next = recommend(MENU, want, { random: () => r, avoidId: makeItemId('麻辣烫', '') })
      expect(next.pick.item.name).toBe('馄饨')
    }
  })

  it('最高分只有一道时，换成次一档的，match 变成 partial', () => {
    const r = recommend(MENU, { meal: 'dinner', wantTags: ['辣', '适合下雨'] }, { avoidId: makeItemId('火锅', '') })
    expect(r.pick.item.name).toBe('麻辣烫')
    expect(r.match).toBe('partial')
    expect(names(r.alternatives)).toEqual(['火锅'])
  })

  it('其他的都一个没命中时，还是推荐上一道', () => {
    const r = recommend(MENU, { ...LUNCH, wantTags: ['汤'] }, { avoidId: makeItemId('馄饨', '') })
    expect(r.pick.item.name).toBe('馄饨')
  })

  it('只剩一道菜时，换一个还是它', () => {
    const r = recommend(MENU, { meal: 'breakfast' }, { avoidId: makeItemId('包子', '') })
    expect(r.pick.item.name).toBe('包子')
  })
})

describe('临时小名单（B-04）', () => {
  const ids = [makeItemId('寿司', ''), makeItemId('包子', ''), makeItemId('已删掉的菜', ''), makeItemId('寿司', '')]

  it('按加入顺序列出，忽略菜单里没有的和重复的；不受餐次限制', () => {
    expect(shortlistItems(MENU, ids).map((i) => i.name)).toEqual(['寿司', '包子'])
  })

  it('加入和移出，不改原数组', () => {
    const list = [makeItemId('寿司', '')]
    const added = toggleShortlist(list, makeItemId('包子', ''))
    expect(added).toEqual([makeItemId('寿司', ''), makeItemId('包子', '')])
    expect(toggleShortlist(added, makeItemId('寿司', ''))).toEqual([makeItemId('包子', '')])
    expect(list).toEqual([makeItemId('寿司', '')])
  })
})

describe('groupTags', () => {
  it('按建议标签分组和顺序，不在建议里的放“其他”，按出现次数排', () => {
    const items = [
      { tags: ['热乎', '辣', '畅饮', '网红'] },
      { tags: ['辣', '畅饮', '适合下雨'] },
      { tags: ['微辣', '网红', '畅饮'] },
    ]
    expect(groupTags(items)).toEqual([
      { name: '口味', tags: [{ tag: '辣', count: 2 }, { tag: '微辣', count: 1 }] },
      { name: '吃起来', tags: [{ tag: '热乎', count: 1 }] },
      { name: '天气', tags: [{ tag: '适合下雨', count: 1 }] },
      { name: OTHER_GROUP, tags: [{ tag: '畅饮', count: 3 }, { tag: '网红', count: 2 }] },
    ])
  })

  it('没有标签时返回空列表', () => {
    expect(groupTags([{ tags: [] }])).toEqual([])
  })

  it('建议标签分组和填写说明第六节一致，且没有重复的标签', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    // 测试从项目根目录运行
    const doc = fs.readFileSync(path.resolve(process.cwd(), 'docs', '菜单填写说明.md'), 'utf8')
    const all = []
    for (const group of TAG_GROUPS) {
      const line = doc.split('\n').find((l) => l.startsWith(`| ${group.name} |`))
      expect(line, group.name).toBeDefined()
      expect(line.split('|')[2].trim().split('、')).toEqual(group.tags)
      all.push(...group.tags)
    }
    expect(new Set(all).size).toBe(all.length)
  })
})
