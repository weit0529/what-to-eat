// 选餐次转盘的角度计算（src/core/meal-dial.js）的测试
import { describe, it, expect } from 'vitest'
import {
  angleFromMatrix,
  dialSegments,
  fitText,
  labelLayout,
  mealTimeSlot,
  nextPointerAngle,
  pointerTarget,
  segmentBox,
  textWidth,
} from '../src/core/meal-dial.js'
import { MEALS } from '../src/core/menu-data.js'

const extra = (label, id = `extra-${label}`) => ({ id, label })
const labels = (segments) => segments.map((s) => s.meal.label)

describe('dialSegments', () => {
  it('只有早午晚时三块各占三分之一，早餐的中间对着正上方', () => {
    const segs = dialSegments(MEALS)
    expect(labels(segs)).toEqual(['早餐', '午餐', '晚餐'])
    expect(segs.map((s) => s.span)).toEqual([120, 120, 120])
    expect(segs[0].mid).toBe(0)
    expect(segs.map((s) => s.mid)).toEqual([0, 120, 240])
  })

  it('有额外餐次时早午晚各 90°（共 75%），额外餐次平分剩下的 90°', () => {
    const segs = dialSegments([...MEALS, extra('下午茶'), extra('夜宵')])
    const span = Object.fromEntries(segs.map((s) => [s.meal.label, s.span]))
    expect(span).toEqual({ 早餐: 90, 午餐: 90, 晚餐: 90, 下午茶: 45, 夜宵: 45 })
    expect(segs.reduce((sum, s) => sum + s.span, 0)).toBe(360)
  })

  it('按时间顺序排，像钟面：早餐、午餐、下午茶、晚餐、夜宵', () => {
    // Excel 里先写夜宵、再写下午茶，转盘上仍按时间排
    const segs = dialSegments([...MEALS, extra('夜宵'), extra('下午茶')])
    expect(labels(segs)).toEqual(['早餐', '午餐', '下午茶', '晚餐', '夜宵'])
  })

  it('每一块首尾相接，绕满一圈', () => {
    const segs = dialSegments([...MEALS, extra('早午餐'), extra('下午茶'), extra('夜宵')])
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBeCloseTo(segs[i - 1].end)
    expect(segs.at(-1).end - segs[0].start).toBeCloseTo(360)
  })

  it('认不出时间的额外餐次放在最后，同一时间的按 Excel 顺序', () => {
    const segs = dialSegments([...MEALS, extra('加餐'), extra('夜宵'), extra('奶茶')])
    expect(labels(segs)).toEqual(['早餐', '午餐', '奶茶', '晚餐', '加餐', '夜宵'])
  })

  it('早午类放在早餐和午餐之间', () => {
    expect(labels(dialSegments([...MEALS, extra('早午餐')]))).toEqual(['早餐', '早午餐', '午餐', '晚餐'])
  })

  it('没有餐次时返回空数组', () => {
    expect(dialSegments([])).toEqual([])
  })
})

describe('mealTimeSlot', () => {
  it('早午晚的位置固定', () => {
    expect(MEALS.map(mealTimeSlot)).toEqual([10, 30, 50])
  })
})

describe('nextPointerAngle', () => {
  it('走较短的一边', () => {
    expect(nextPointerAngle(0, 90)).toBe(90)
    expect(nextPointerAngle(0, 270)).toBe(-90)
    expect(nextPointerAngle(-90, 0)).toBe(0)
  })

  it('累计角度超过一圈时也走短的一边', () => {
    expect(nextPointerAngle(350, 10)).toBe(370)
    expect(nextPointerAngle(-370, 0)).toBe(-360)
  })
})

// 和 MealPicker.vue 里的转盘尺寸一致：标签半径 93，圆环厚 58
const RING = { radius: 93, thickness: 58 }

describe('fitText / textWidth', () => {
  it('中文按一个字号宽，数字空格按 0.6 个字号宽，英文字母按 1.15 个字号宽（宁可估宽）', () => {
    expect(textWidth('夜宵', 13)).toBe(26)
    expect(textWidth('29 道', 13)).toBeCloseTo(13 * 0.6 * 3 + 13)
    expect(textWidth('WW', 13)).toBeCloseTo(13 * 1.15 * 2)
  })

  it('宽英文字母截短后不超过可用宽度（Codex 第 18 轮：WWWW… 实际约 68.8px，超出 50px）', () => {
    // 估算下只留两个 W；按实测粗体 W 约 14px、省略号约 13px，两个 W 加省略号约 41px，放得下
    expect(fitText('WWWWWWWWWWWWWWWWWWWW', 13, 50)).toBe('WW…')
  })

  it('可以传入按实际字体量宽度的函数', () => {
    const measure = (text) => [...text].length * 20
    expect(fitText('下午茶', 13, 45, measure)).toBe('下…')
  })

  it('放得下就原样，放不下就截短加省略号，一个字都放不下返回空', () => {
    expect(fitText('下午茶', 13, 39)).toBe('下午茶')
    expect(fitText('夜里加班补充能量的夜宵', 13, 60)).toBe('夜里加…')
    expect(textWidth(fitText('夜里加班补充能量的夜宵', 13, 60), 13)).toBeLessThanOrEqual(60)
    expect(fitText('下午茶', 13, 20)).toBe('')
  })
})

describe('segmentBox', () => {
  it('正上方 90° 的块：宽度受弦长限制，高度受圆环厚度限制', () => {
    const box = segmentBox({ span: 90, mid: 0 }, RING)
    expect(box.width).toBeCloseTo(2 * 93 * Math.sin(Math.PI / 4) - 8)
    expect(box.height).toBeCloseTo(50)
  })

  it('正右方的块：横向的字沿半径方向，宽度受圆环厚度限制', () => {
    expect(segmentBox({ span: 90, mid: 90 }, RING).width).toBeCloseTo(50)
  })

  it('15° 的窄块又小又窄', () => {
    const box = segmentBox({ span: 15, mid: 180 }, RING)
    expect(box.width).toBeLessThan(20)
  })
})

describe('labelLayout：块里放什么', () => {
  const font = { fontSize: 13, countText: '9 道' }

  it('地方够时放图标、名字、道数', () => {
    expect(labelLayout('夜宵', segmentBox({ span: 45, mid: 292.5 }, RING), font)).toEqual({
      mode: 'full',
      text: '夜宵',
      truncated: false,
    })
  })

  it('名字太长时截短，标记 truncated（界面上用 title 显示全名）', () => {
    const box = segmentBox({ span: 90, mid: 270 }, RING)
    const layout = labelLayout('夜里加班补充能量的夜宵', box, font)
    expect(layout.text.endsWith('…')).toBe(true)
    expect(layout.truncated).toBe(true)
    expect(textWidth(layout.text, 13)).toBeLessThanOrEqual(box.width)
  })

  it('放不下两个字时只放图标，再小就什么都不放', () => {
    expect(labelLayout('下午茶', { width: 20, height: 40 }, font).mode).toBe('icon')
    expect(labelLayout('下午茶', { width: 10, height: 10 }, font).mode).toBe('none')
  })

  it('高度不够放三行时只放名字', () => {
    expect(labelLayout('夜宵', { width: 50, height: 20 }, font)).toEqual({ mode: 'name', text: '夜宵', truncated: false })
  })
})

describe('指针转动途中又换餐次', () => {
  it('从 transform 矩阵读出角度', () => {
    const r = (deg) => (deg * Math.PI) / 180
    expect(angleFromMatrix(`matrix(${Math.cos(r(113))}, ${Math.sin(r(113))}, 0, 0, 0, 0)`)).toBeCloseTo(113)
    expect(angleFromMatrix('none')).toBe(null)
    expect(angleFromMatrix('rotate(90deg)')).toBe(null)
  })

  it('从画面上的位置出发走短的一边（Codex 第 17 轮：设定 360°、画面才转到 113° 时不能再顺时针绕 247°）', () => {
    // 上次设定的是 225°（晚餐），画面上指针才转到 113°，这时点早餐（0°）
    const next = pointerTarget(225, 113, 0)
    expect(next).toBe(0)
    expect(Math.abs(next - 113)).toBeLessThanOrEqual(180)
  })

  it('读不出画面角度时按上次设定的角度算', () => {
    expect(pointerTarget(225, null, 0)).toBe(360)
  })
})
