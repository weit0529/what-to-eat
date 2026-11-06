// 随机抽取的核心逻辑：按餐次筛选、临时排除、随机抽一道菜。
//
// 这里只做纯计算，不依赖页面、不记任何状态。页面（M3）每次把“菜单 + 当前选择”传进来，
// 拿回结果再显示。以后小程序也能直接用。
//
// 菜品的格式见 src/core/menu-data.js 的 parseMenuRows()。

/**
 * 检查餐次 id：breakfast / lunch / dinner，或者“餐次”页里加的额外餐次（id 就是名字，如“夜宵”）。
 * 没传或不是文字属于程序写错，直接报错
 */
function assertMeal(meal) {
  if (typeof meal !== 'string' || meal === '') {
    throw new Error(`餐次必须是餐次的 id（如 breakfast、夜宵），收到的是 ${JSON.stringify(meal)}`)
  }
}

/** 适合这一餐的菜 */
export function itemsForMeal(items, meal) {
  assertMeal(meal)
  return items.filter((item) => item.meals.includes(meal))
}

/**
 * 列出这些菜里有哪些分类、每类几道，按在表格里第一次出现的顺序排列。
 * 页面用它显示“不想吃的分类”勾选项。
 * @returns {Array<{ name: string, count: number }>}
 */
export function listCategories(items) {
  const counts = new Map()
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
  return [...counts].map(([name, count]) => ({ name, count }))
}

/**
 * 这一次可以抽的菜：适合这一餐，并且没有被临时排除。
 *
 * @param {object[]} items 全部菜品
 * @param {object} choice
 * @param {string} choice.meal 餐次：breakfast / lunch / dinner
 * @param {string[]} [choice.excludedCategories] 这次不想吃的分类
 * @param {string[]} [choice.excludedIds] 这次不想吃的菜（菜品的 id）
 */
export function getCandidates(items, { meal, excludedCategories = [], excludedIds = [] } = {}) {
  const categories = new Set(excludedCategories)
  const ids = new Set(excludedIds)
  return itemsForMeal(items, meal).filter((item) => !categories.has(item.category) && !ids.has(item.id))
}

/**
 * 候选为空时说明原因，方便页面给出不同的提示。
 * @returns {'no-items-for-meal' | 'all-excluded' | null} 候选不为空时返回 null
 */
export function emptyReason(items, choice) {
  if (getCandidates(items, choice).length > 0) return null
  return itemsForMeal(items, choice.meal).length === 0 ? 'no-items-for-meal' : 'all-excluded'
}

/**
 * 从候选里随机抽一道菜。候选为空时返回 null。
 *
 * @param {object[]} candidates 候选菜品（一般是 getCandidates 的结果）
 * @param {object} [options]
 * @param {() => number} [options.random] 随机数函数，返回 [0, 1) 之间的数。默认 Math.random；测试时可以换成固定值
 * @param {string|null} [options.avoidId] “再抽一次”时传上一次的结果 id，尽量不连续抽到同一道（只剩这一道时除外）
 */
export function drawOne(candidates, { random = Math.random, avoidId = null } = {}) {
  if (candidates.length === 0) return null

  let pool = candidates
  if (avoidId !== null) {
    const others = candidates.filter((item) => item.id !== avoidId)
    if (others.length > 0) pool = others
  }

  const r = random()
  if (!(r >= 0 && r < 1)) throw new RangeError(`随机数必须在 [0, 1) 之间，收到的是 ${r}`)
  return pool[Math.floor(r * pool.length)]
}
