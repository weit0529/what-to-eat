// 阶段 3：Excel “餐次”页里加的额外餐次（用户 2026-11-05 21:44 决定 2B、3A）
import { describe, it, expect } from 'vitest'
import { parseMenuRows, parseMealRows, formatIssue, MAX_EXTRA_MEALS } from '../src/core/menu-data.js'
import { emojiForMeal, FALLBACK_EMOJI } from '../src/ui/food-emoji.js'

const HEADER = ['品类', '店铺', '分类', '适合餐次', '标签', '人均价格', '描述', '图片', '启用']
const MEAL_HEADER = ['餐次', '图标']
const menuRow = (meals) => ['麻辣烫', null, '火锅串串', meals, null, null, null, null, null]

describe('parseMealRows', () => {
  it('按顺序读出餐次，id 就是名字；图标是 emoji 时保留；空行跳过', () => {
    const r = parseMealRows([MEAL_HEADER, ['下午茶', '🧋'], [], ['夜宵', null]])
    expect(r.errors).toEqual([])
    expect(r.meals).toEqual([
      { id: '下午茶', label: '下午茶', emoji: '🧋' },
      { id: '夜宵', label: '夜宵', emoji: null },
    ])
  })

  it('整页空着或只有列名：没有额外餐次，不报错', () => {
    expect(parseMealRows([])).toEqual({ meals: [], errors: [], warnings: [] })
    expect(parseMealRows([MEAL_HEADER])).toEqual({ meals: [], errors: [], warnings: [] })
  })

  it('图标不是 emoji（比如读坏的字）或太长：提醒，改用自动配的', () => {
    const r = parseMealRows([MEAL_HEADER, ['下午茶', '溜'], ['夜宵', '🌙🌙🌙🌙🌙']])
    expect(r.errors).toEqual([])
    expect(r.meals.map((m) => m.emoji)).toEqual([null, null])
    expect(r.warnings.map((w) => [w.sheet, w.row, w.column])).toEqual([
      ['餐次', 2, '图标'],
      ['餐次', 3, '图标'],
    ])
  })

  it('名字为空、带分隔符、和固定的词重名、重复：报错，并且一个额外餐次都不生效', () => {
    const r = parseMealRows([
      MEAL_HEADER,
      [null, '🧋'],
      ['下午 茶', null],
      ['早餐', null],
      ['全天', null],
      ['breakfast', null],
      ['夜宵', null],
      ['夜宵', null],
    ])
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6, 8])
    expect(r.errors.every((e) => e.sheet === '餐次')).toBe(true)
    expect(r.meals).toEqual([])
  })

  it(`最多 ${MAX_EXTRA_MEALS} 个`, () => {
    const rows = [MEAL_HEADER, ...Array.from({ length: MAX_EXTRA_MEALS + 1 }, (_, i) => [`加餐${i}`, null])]
    const r = parseMealRows(rows)
    expect(r.errors[0].message).toContain(`最多加 ${MAX_EXTRA_MEALS} 个`)
    expect(r.meals).toEqual([])
  })

  it('缺“餐次”这一列时报错；多出来的列只提醒', () => {
    expect(parseMealRows([['名字'], ['夜宵']]).errors[0]).toMatchObject({ sheet: '餐次', row: 1, column: '餐次' })
    const r = parseMealRows([['餐次', '备注'], ['夜宵', '晚上饿了']])
    expect(r.errors).toEqual([])
    expect(r.warnings[0]).toMatchObject({ sheet: '餐次', column: '备注' })
  })
})

describe('菜单里填额外餐次', () => {
  const extra = (...names) => parseMealRows([MEAL_HEADER, ...names.map((n) => [n])]).meals

  it('可以填额外餐次；顺序是早午晚在前、额外餐次按“餐次”页的顺序', () => {
    const r = parseMenuRows([HEADER, menuRow('夜宵、晚餐、下午茶')], { extraMeals: extra('下午茶', '夜宵') })
    expect(r.errors).toEqual([])
    expect(r.items[0].meals).toEqual(['dinner', '下午茶', '夜宵'])
  })

  it('“全天”只含早、午、晚，不含额外餐次（3A）', () => {
    const r = parseMenuRows([HEADER, menuRow('全天')], { extraMeals: extra('夜宵') })
    expect(r.items[0].meals).toEqual(['breakfast', 'lunch', 'dinner'])
  })

  it('没在“餐次”页里加的词仍然报错，提示里列出能填的词', () => {
    const r = parseMenuRows([HEADER, menuRow('下午茶')], { extraMeals: extra('夜宵') })
    expect(r.errors[0].message).toBe('不认识“下午茶”。只能填早餐、午餐、晚餐、夜宵、全天')
    const empty = parseMenuRows([HEADER, menuRow('、')], { extraMeals: extra('夜宵') })
    expect(empty.errors[0].message).toBe('不能为空。填早餐、午餐、晚餐、夜宵中的一个或几个，或者填“全天”')
  })

  it('不传额外餐次时和原来一样', () => {
    expect(parseMenuRows([HEADER, menuRow('夜宵')]).errors[0].message).toBe('不认识“夜宵”。只能填早餐、午餐、晚餐、全天')
  })
})

describe('formatIssue 和 emojiForMeal', () => {
  it('“餐次”页的问题前面加上页名', () => {
    expect(formatIssue({ sheet: '餐次', row: 3, column: '餐次', message: '不能为空' })).toBe(
      '「餐次」页第 3 行「餐次」：不能为空',
    )
  })

  it('固定餐次用固定图标；额外餐次优先用“餐次”页填的，没填就按名字猜', () => {
    expect(emojiForMeal({ id: 'lunch', label: '午餐', emoji: '🍕' })).toBe('🌞')
    expect(emojiForMeal({ id: '夜宵', label: '夜宵', emoji: '🍢' })).toBe('🍢')
    expect(emojiForMeal({ id: '夜宵', label: '夜宵', emoji: null })).toBe('🌃')
    expect(emojiForMeal({ id: '下午茶', label: '下午茶' })).toBe('🧋')
    expect(emojiForMeal({ id: '神秘时间', label: '神秘时间' })).toBe(FALLBACK_EMOJI)
  })
})
