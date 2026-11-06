// 选餐次转盘：每个餐次在圆环上占哪一段（纯计算，不碰界面）
//
// 用户 2026-11-06 的要求：
// - 早、午、晚三块大，合起来占约 75%（每块 90°），额外餐次平分剩下的 25%
// - 按一天里的时间顺序排，像钟面：早餐 → 早午类 → 午餐 → 下午茶类 → 晚餐 → 夜宵类
// - 只有早午晚时，三块各占三分之一
//
// 角度单位是度，0° 在正上方，顺时针增加。早餐那一块的中间对着正上方。

import { MEALS } from './menu-data.js'

const BUILT_IN_IDS = MEALS.map((meal) => meal.id)

/** 早午晚在一天里的位置（数字越小越早），额外餐次按名字插在它们之间 */
const BUILT_IN_SLOT = { breakfast: 10, lunch: 30, dinner: 50 }

/** 额外餐次的名字里有这些字，就放到对应的时间位置；按顺序匹配，先匹配到的算 */
const EXTRA_SLOT_RULES = [
  ['早午', 20],
  ['早茶', 20],
  ['下午', 40],
  ['茶', 40],
  ['点心', 40],
  ['宵', 60],
  ['夜', 60],
]

/** 认不出时间的额外餐次（如“加餐”）放在最后 */
const DEFAULT_EXTRA_SLOT = 60

export const isBuiltInMeal = (meal) => BUILT_IN_IDS.includes(meal.id)

/** 这一餐在一天里的大概位置，用来排顺序 */
export function mealTimeSlot(meal) {
  if (isBuiltInMeal(meal)) return BUILT_IN_SLOT[meal.id]
  const rule = EXTRA_SLOT_RULES.find(([word]) => meal.label.includes(word))
  return rule ? rule[1] : DEFAULT_EXTRA_SLOT
}

/**
 * 把餐次排到圆环上。
 * @param {{id: string, label: string}[]} meals 全部餐次（顺序就是 Excel 里的顺序）
 * @returns {{meal: object, start: number, end: number, mid: number, span: number}[]} 按时间顺序
 */
export function dialSegments(meals) {
  const extraCount = meals.filter((meal) => !isBuiltInMeal(meal)).length
  const spanOf = (meal) => {
    if (extraCount === 0) return 360 / meals.length
    return isBuiltInMeal(meal) ? 90 : 90 / extraCount
  }

  // 同一时间位置的额外餐次，保持 Excel 里的先后顺序
  const ordered = meals
    .map((meal, index) => ({ meal, index }))
    .sort((a, b) => mealTimeSlot(a.meal) - mealTimeSlot(b.meal) || a.index - b.index)
    .map(({ meal }) => meal)

  let angle = ordered.length ? -spanOf(ordered[0]) / 2 : 0
  return ordered.map((meal) => {
    const span = spanOf(meal)
    const segment = { meal, start: angle, end: angle + span, mid: angle + span / 2, span }
    angle += span
    return segment
  })
}

/**
 * 指针从 from 转到 target 时，走较短的那一边。
 * 返回新的累计角度（可以超过 360°），这样 CSS 过渡不会绕一大圈。
 */
export function nextPointerAngle(from, target) {
  const delta = ((((target - from) % 360) + 540) % 360) - 180
  return from + delta
}

// ---------- 每一块里放什么字（Codex 第 17 轮：块窄或名字长时不能挤、不能出界） ----------

/**
 * 估算一行字的宽度（量不了实际字体时用，宁可估宽）：
 * 中文等按一个字号宽；数字和空格按 0.6 个字号宽；其他英文字母、符号按 1.15 个字号宽
 * （粗体大写 W 实测约 1.07 个字号宽，Codex 第 18 轮）
 */
export function textWidth(text, fontSize) {
  let width = 0
  for (const ch of text) {
    if (/[\d ]/.test(ch)) width += fontSize * 0.6
    else if (/[\x21-\x7e]/.test(ch)) width += fontSize * 1.15
    else width += fontSize
  }
  return width
}

/**
 * 放不下就截短，末尾加“…”；一个字都放不下时返回空字符串。
 * measure(text, fontSize) 量宽度，默认用上面的估算；浏览器里传入按实际字体量的函数。
 */
export function fitText(text, fontSize, maxWidth, measure = textWidth) {
  if (measure(text, fontSize) <= maxWidth) return text
  let out = ''
  for (const ch of text) {
    if (measure(`${out}${ch}…`, fontSize) > maxWidth) break
    out += ch
  }
  return out ? `${out}…` : ''
}

/**
 * 一块圆环里，以标签中心为中点、横平竖直的矩形最大能有多宽、多高。
 * 横向的一段字，沿圆周方向的分量受这一块的弦长限制，沿半径方向的分量受圆环厚度限制。
 * @param {{span: number, mid: number}} seg 这一块的角度
 * @param {{radius: number, thickness: number, padding?: number}} ring 标签所在半径、圆环厚度、四周留白
 */
export function segmentBox(seg, { radius, thickness, padding = 4 }) {
  const half = Math.min(seg.span / 2, 90) * (Math.PI / 180)
  const along = 2 * radius * Math.sin(half) - padding * 2 // 沿圆周方向可用
  const across = thickness - padding * 2 // 沿半径方向可用
  const t = (seg.mid * Math.PI) / 180
  const c = Math.abs(Math.cos(t))
  const s = Math.abs(Math.sin(t))
  const limit = (room, share) => (share < 1e-6 ? Infinity : room / share)
  return {
    width: Math.max(0, Math.min(limit(along, c), limit(across, s))),
    height: Math.max(0, Math.min(limit(along, s), limit(across, c))),
  }
}

/**
 * 决定一块里显示什么：
 * - full：图标 + 名字 + 道数（地方够时；countText 是道数那一行，如“29 道”）
 * - name：只有名字（必要时截短，至少留两个字）
 * - icon：只有图标（名字放不下两个字时）
 * - none：什么都不放（极窄时），仍可点，读屏读完整名字
 * measure / countMeasure：量名字（粗体）和道数（常规）宽度的函数，默认用估算。
 * 名字被截短或没显示时 truncated 为 true，界面上用 title 提示全名；选中后下方的“X 有 N 道可选”也会显示全名。
 */
export function labelLayout(
  label,
  box,
  { fontSize, iconSize = 16, stackHeight = 46, countText = '', countFontSize = 13, measure = textWidth, countMeasure = measure },
) {
  const minChars = Math.min(2, [...label].length)
  const fitted = fitText(label, fontSize, box.width, measure)
  const shown = fitted.replace(/…$/, '')
  const enoughText = [...shown].length >= minChars
  const fullWidth = Math.max(iconSize, countMeasure(countText, countFontSize))
  if (box.height >= stackHeight && box.width >= fullWidth && enoughText) {
    return { mode: 'full', text: fitted, truncated: fitted !== label }
  }
  if (box.height >= fontSize + 2 && enoughText) {
    return { mode: 'name', text: fitted, truncated: fitted !== label }
  }
  if (box.width >= iconSize && box.height >= iconSize) return { mode: 'icon', text: '', truncated: true }
  return { mode: 'none', text: '', truncated: true }
}

// ---------- 指针在转动途中又换了餐次（Codex 第 17 轮） ----------

/** 从 getComputedStyle(...).transform 的 "matrix(a, b, c, d, e, f)" 里读出旋转角度；读不出返回 null */
export function angleFromMatrix(transform) {
  const match = /^matrix\(\s*([-\d.e]+)\s*,\s*([-\d.e]+)/.exec(transform || '')
  if (!match) return null
  return (Math.atan2(Number(match[2]), Number(match[1])) * 180) / Math.PI
}

/**
 * 换餐次时指针的新角度。
 * stored：上次设定的累计角度；shown：画面上指针现在实际的角度（还在转的途中时和 stored 不同，读不出时为 null）。
 * 从画面上的位置出发走短的一边，连续快点时也不会绕大圈。
 */
export function pointerTarget(stored, shown, target) {
  const from = shown === null || shown === undefined ? stored : nextPointerAngle(stored, shown)
  return nextPointerAngle(from, target)
}
