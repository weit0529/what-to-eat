// 给分类配 emoji：按分类名里的关键字找，找不到就用 🍽️。
// 分类是表格里自由填的，所以这里只能“猜”，猜不到也没关系。
// 想给新分类配 emoji，在下面的列表里加一行即可（越靠前越优先）。

const RULES = [
  ['火锅', '🍲'],
  ['串', '🍢'],
  ['烧烤', '🍢'],
  ['烤', '🍢'],
  ['早点', '🥟'],
  ['包子', '🥟'],
  ['饺子', '🥟'],
  ['馄饨', '🥟'],
  ['粥', '🥣'],
  ['汤', '🥣'],
  ['面', '🍜'],
  ['粉', '🍜'],
  ['米饭', '🍚'],
  ['盖饭', '🍚'],
  ['快餐', '🍱'],
  ['川', '🌶️'],
  ['湘', '🌶️'],
  ['辣', '🌶️'],
  ['西式', '🍔'],
  ['汉堡', '🍔'],
  ['披萨', '🍕'],
  ['日', '🍣'],
  ['韩', '🍣'],
  ['寿司', '🍣'],
  ['轻食', '🥗'],
  ['沙拉', '🥗'],
  ['海鲜', '🦐'],
  ['鱼', '🐟'],
  ['鸡', '🍗'],
  ['小吃', '🍡'],
  ['甜', '🍰'],
  ['蛋糕', '🍰'],
  ['奶茶', '🧋'],
  ['饮', '🧋'],
  ['咖啡', '☕'],
]

export const FALLBACK_EMOJI = '🍽️'

/** 给一个分类名配一个 emoji */
export function emojiForCategory(category) {
  const name = String(category ?? '')
  for (const [keyword, emoji] of RULES) {
    if (name.includes(keyword)) return emoji
  }
  return FALLBACK_EMOJI
}

/** 三个固定餐次的 emoji */
export const MEAL_EMOJI = {
  breakfast: '🌅',
  lunch: '🌞',
  dinner: '🌙',
}

// 额外餐次没填图标时，按名字里的关键字猜一个
const MEAL_RULES = [
  ['宵', '🌃'],
  ['夜', '🌃'],
  ['茶', '🧋'],
  ['甜', '🍰'],
  ['点心', '🧁'],
  ['零食', '🍿'],
  ['加餐', '🍪'],
  ['早午', '🥞'],
]

/**
 * 餐次的 emoji：固定餐次用上面的；额外餐次用“餐次”页填的图标，没填就按名字猜，猜不到用 🍽️
 * @param {{ id: string, label: string, emoji?: string | null }} meal
 */
export function emojiForMeal(meal) {
  if (MEAL_EMOJI[meal.id]) return MEAL_EMOJI[meal.id]
  if (meal.emoji) return meal.emoji
  for (const [keyword, emoji] of MEAL_RULES) {
    if (meal.label.includes(keyword)) return emoji
  }
  return FALLBACK_EMOJI
}
