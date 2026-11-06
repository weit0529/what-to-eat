// 随机抽取核心逻辑（src/core/draw.js）的测试
import { describe, it, expect } from 'vitest'
import { itemsForMeal, listCategories, getCandidates, emptyReason, drawOne } from '../src/core/draw.js'
import { makeItemId } from '../src/core/menu-data.js'

/** 造一道菜，只填抽取用得到的字段 */
function dish(name, category, meals, shop = '') {
  return { id: makeItemId(name, shop), name, shop: shop || null, category, meals }
}

const MENU = [
  dish('包子', '早点', ['breakfast']),
  dish('肠粉', '早点', ['breakfast', 'lunch']),
  dish('牛肉面', '面食', ['breakfast', 'lunch', 'dinner']),
  dish('牛肉面', '面食', ['lunch', 'dinner'], '楼下'),
  dish('火锅', '火锅串串', ['dinner']),
  dish('麻辣烫', '火锅串串', ['lunch', 'dinner']),
]

const names = (items) => items.map((item) => (item.shop ? `${item.name}@${item.shop}` : item.name))

/** 依次返回给定数字的假随机函数 */
function sequence(...values) {
  let i = 0
  return () => values[i++ % values.length]
}

describe('itemsForMeal', () => {
  it('只留下适合这一餐的菜，保持表格顺序', () => {
    expect(names(itemsForMeal(MENU, 'breakfast'))).toEqual(['包子', '肠粉', '牛肉面'])
    expect(names(itemsForMeal(MENU, 'dinner'))).toEqual(['牛肉面', '牛肉面@楼下', '火锅', '麻辣烫'])
  })

  it('没传餐次或不是文字时报错（属于程序写错）', () => {
    for (const bad of [undefined, null, '', 3]) {
      expect(() => itemsForMeal(MENU, bad), String(bad)).toThrow('餐次必须是')
    }
  })

  it('额外餐次（id 就是名字）也能筛；没有菜适合时返回空', () => {
    const menu = [...MENU, dish('奶茶', '饮品甜点', ['下午茶']), dish('烧烤', '烧烤', ['dinner', '夜宵'])]
    expect(names(itemsForMeal(menu, '下午茶'))).toEqual(['奶茶'])
    expect(names(itemsForMeal(menu, '夜宵'))).toEqual(['烧烤'])
    expect(itemsForMeal(menu, '早午餐')).toEqual([])
  })
})

describe('listCategories', () => {
  it('按第一次出现的顺序列出分类和数量', () => {
    expect(listCategories(MENU)).toEqual([
      { name: '早点', count: 2 },
      { name: '面食', count: 2 },
      { name: '火锅串串', count: 2 },
    ])
    expect(listCategories(itemsForMeal(MENU, 'breakfast'))).toEqual([
      { name: '早点', count: 2 },
      { name: '面食', count: 1 },
    ])
    expect(listCategories([])).toEqual([])
  })
})

describe('getCandidates', () => {
  it('没有排除时就是这一餐的全部菜', () => {
    expect(names(getCandidates(MENU, { meal: 'lunch' }))).toEqual(['肠粉', '牛肉面', '牛肉面@楼下', '麻辣烫'])
  })

  it('按分类排除', () => {
    expect(names(getCandidates(MENU, { meal: 'dinner', excludedCategories: ['火锅串串'] }))).toEqual([
      '牛肉面',
      '牛肉面@楼下',
    ])
  })

  it('按单道菜排除，同品类不同店铺分开算', () => {
    const excludedIds = [makeItemId('牛肉面', '楼下')]
    expect(names(getCandidates(MENU, { meal: 'dinner', excludedIds }))).toEqual(['牛肉面', '火锅', '麻辣烫'])
  })

  it('分类和单道菜可以同时排除；排除不存在的分类或菜没有影响', () => {
    const result = getCandidates(MENU, {
      meal: 'dinner',
      excludedCategories: ['面食', '不存在的分类'],
      excludedIds: [makeItemId('火锅', ''), makeItemId('已删掉的菜', '')],
    })
    expect(names(result)).toEqual(['麻辣烫'])
  })

  it('不改动传进来的菜单', () => {
    const copy = structuredClone(MENU)
    getCandidates(MENU, { meal: 'dinner', excludedCategories: ['面食'] })
    expect(MENU).toEqual(copy)
  })
})

describe('emptyReason', () => {
  it('有候选时返回 null', () => {
    expect(emptyReason(MENU, { meal: 'lunch' })).toBeNull()
  })

  it('这一餐本来就没有菜', () => {
    expect(emptyReason(itemsForMeal(MENU, 'dinner').slice(2), { meal: 'breakfast' })).toBe('no-items-for-meal')
    expect(emptyReason([], { meal: 'lunch' })).toBe('no-items-for-meal')
  })

  it('有菜但全被排除了', () => {
    expect(emptyReason(MENU, { meal: 'breakfast', excludedCategories: ['早点', '面食'] })).toBe('all-excluded')
  })
})

describe('drawOne', () => {
  const candidates = getCandidates(MENU, { meal: 'lunch' })

  it('候选为空时返回 null', () => {
    expect(drawOne([])).toBeNull()
    expect(drawOne([], { avoidId: 'x' })).toBeNull()
  })

  it('按随机数均匀地选：每道菜都可能被抽到，且只会抽到候选里的菜', () => {
    const n = candidates.length
    const drawn = Array.from({ length: n }, (_, i) => drawOne(candidates, { random: () => i / n }))
    expect(drawn).toEqual(candidates)
    expect(drawOne(candidates, { random: () => 0.999999 })).toBe(candidates[n - 1])
  })

  it('真实随机抽 200 次：结果都在候选里，被排除的从不出现（A-03）', () => {
    const choice = { meal: 'dinner', excludedCategories: ['火锅串串'] }
    const pool = getCandidates(MENU, choice)
    for (let i = 0; i < 200; i++) {
      const item = drawOne(pool)
      expect(pool).toContain(item)
      expect(item.category).not.toBe('火锅串串')
    }
  })

  it('“再抽一次”不会连续抽到同一道', () => {
    const last = candidates[0]
    for (const r of [0, 0.3, 0.6, 0.99]) {
      expect(drawOne(candidates, { random: () => r, avoidId: last.id })).not.toBe(last)
    }
  })

  it('只剩一道菜时，“再抽一次”还是它', () => {
    const only = [candidates[0]]
    expect(drawOne(only, { random: () => 0.5, avoidId: only[0].id })).toBe(only[0])
  })

  it('随机数函数返回非法值时报错，不会返回 undefined', () => {
    for (const bad of [1, -0.1, NaN, 2]) {
      expect(() => drawOne(candidates, { random: () => bad })).toThrow(RangeError)
    }
  })

  it('不改动传进来的候选列表', () => {
    const copy = [...candidates]
    drawOne(candidates, { random: sequence(0.5), avoidId: candidates[1].id })
    expect(candidates).toEqual(copy)
  })
})
