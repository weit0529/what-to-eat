// “帮我分析”模式的推荐逻辑，以及临时小名单。
//
// 规则（用户 2026-11-05 确认，见 REQUIREMENTS.md 第 10 节）：
// 1. 先按餐次和“不想吃的”筛（和随机抽取一样，见 draw.js）
// 2. 再筛掉带“不要”标签的菜、超出预算的菜（没填价格的菜不筛，标“价格未填”）
// 3. 剩下的按命中“想要”标签的个数打分，每个标签 1 分
// 4. 最高分里随机选一道作推荐；再给最多 3 道“也不错”的备选
// 5. 一个想要的标签都没命中时，不硬推，提示少选几个
//
// 纯计算，不依赖页面。

import { getCandidates, emptyReason, drawOne } from './draw.js'

/** 备选最多几道 */
export const MAX_ALTERNATIVES = 3

function assertBudget(budget) {
  if (budget === null || budget === undefined) return
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0) {
    throw new RangeError(`预算必须是不小于 0 的数字，或者不填（null），收到的是 ${JSON.stringify(budget)}`)
  }
}

/**
 * 评估一道菜：命中了哪些想要的标签、缺哪些、几分、价格情况。
 * @returns {{ item: object, matched: string[], missing: string[], score: number,
 *             priceStatus: 'within' | 'unknown' | null }}
 *   priceStatus：没设预算时为 null；设了预算但这道菜没填价格为 'unknown'；否则 'within'
 */
export function assessItem(item, { wantTags = [], budget = null } = {}) {
  const wants = [...new Set(wantTags)]
  const matched = wants.filter((tag) => item.tags.includes(tag))
  const missing = wants.filter((tag) => !item.tags.includes(tag))
  let priceStatus = null
  if (budget !== null && budget !== undefined) priceStatus = item.price === null ? 'unknown' : 'within'
  return { item, matched, missing, score: matched.length, priceStatus }
}

/**
 * 按条件推荐。
 *
 * @param {object[]} items 全部菜品
 * @param {object} criteria
 * @param {string} criteria.meal 餐次
 * @param {string[]} [criteria.excludedCategories] 不想吃的分类
 * @param {string[]} [criteria.excludedIds] 不想吃的菜
 * @param {string[]} [criteria.wantTags] 想要的标签
 * @param {string[]} [criteria.avoidTags] 不要的标签：带其中任何一个的菜直接筛掉
 * @param {number|null} [criteria.budget] 人均预算（元），null 表示不限
 * @param {object} [options]
 * @param {() => number} [options.random] 随机数函数，默认 Math.random
 * @param {string|null} [options.avoidId] “换一个”时传上一次推荐的 id，尽量换成别的
 *
 * @returns {{
 *   status: 'ok' | 'none' | 'empty',
 *   emptyReason: 'no-items-for-meal' | 'all-excluded' | 'all-filtered' | null,
 *   filtered: { byAvoid: number, byBudget: number },
 *   match: 'all' | 'partial' | null,
 *   pick: object | null,
 *   alternatives: object[],
 * }}
 *   status：ok = 有推荐；none = 有菜，但一个想要的标签都没命中；empty = 筛完没有菜了
 *   emptyReason：empty 时的原因。all-filtered 表示被“不要”的标签或预算筛光了
 *   filtered：被“不要”的标签、被预算各筛掉了几道（先算标签，再算预算）
 *   match：all = 推荐的菜命中了全部想要的标签（没选想要的标签时也算 all）；partial = 只命中一部分
 *   pick、alternatives 里每一项都是 assessItem() 的结果
 */
export function recommend(items, criteria, { random = Math.random, avoidId = null } = {}) {
  const { meal, excludedCategories = [], excludedIds = [], wantTags = [], avoidTags = [], budget = null } = criteria
  assertBudget(budget)

  const result = {
    status: 'empty',
    emptyReason: null,
    filtered: { byAvoid: 0, byBudget: 0 },
    match: null,
    pick: null,
    alternatives: [],
  }

  // 1. 餐次和“不想吃的”
  const choice = { meal, excludedCategories, excludedIds }
  const base = getCandidates(items, choice)
  if (base.length === 0) {
    result.emptyReason = emptyReason(items, choice)
    return result
  }

  // 2. “不要”的标签和预算
  const avoid = new Set(avoidTags)
  const noAvoided = base.filter((item) => !item.tags.some((tag) => avoid.has(tag)))
  const inBudget = noAvoided.filter((item) => budget === null || item.price === null || item.price <= budget)
  result.filtered = { byAvoid: base.length - noAvoided.length, byBudget: noAvoided.length - inBudget.length }
  if (inBudget.length === 0) {
    result.emptyReason = 'all-filtered'
    return result
  }

  // 3. 打分，按分数从高到低排；同分保持表格顺序
  const wants = [...new Set(wantTags)]
  const ranked = inBudget
    .map((item) => assessItem(item, { wantTags: wants, budget }))
    .sort((a, b) => b.score - a.score)

  // 5. 选了想要的标签，但一个都没命中
  if (wants.length > 0 && ranked[0].score === 0) {
    result.status = 'none'
    return result
  }

  // 4. 在剩下的里面找最高分（“换一个”时先去掉上一次的），同分随机选一道
  //    剩下的都一个没命中时，宁可还是推荐上一道，也不换成不沾边的
  const others = ranked.filter((a) => a.item.id !== avoidId)
  const othersUsable = others.length > 0 && (wants.length === 0 || others[0].score > 0)
  const pool = othersUsable ? others : ranked
  const bestScore = pool[0].score
  const top = pool.filter((a) => a.score === bestScore)
  const pickedItem = drawOne(
    top.map((a) => a.item),
    { random },
  )
  const pick = top.find((a) => a.item === pickedItem)

  result.status = 'ok'
  result.pick = pick
  result.match = wants.length === 0 || pick.score === wants.length ? 'all' : 'partial'
  // 备选：按排名，去掉主推；选了想要的标签时，一个都没命中的不算“也不错”
  result.alternatives = ranked
    .filter((a) => a !== pick && (wants.length === 0 || a.score > 0))
    .slice(0, MAX_ALTERNATIVES)
  return result
}

// ---------------- 临时小名单 ----------------

/**
 * 小名单里的菜，按加入小名单的顺序。
 * 小名单不受餐次和“不想吃的”限制；菜单里已经没有的 id 会被忽略。
 */
export function shortlistItems(items, shortlistIds) {
  const byId = new Map(items.map((item) => [item.id, item]))
  return [...new Set(shortlistIds)].map((id) => byId.get(id)).filter(Boolean)
}

/** 加入或移出小名单，返回新的 id 列表（不改原数组） */
export function toggleShortlist(shortlistIds, id) {
  return shortlistIds.includes(id) ? shortlistIds.filter((x) => x !== id) : [...shortlistIds, id]
}
