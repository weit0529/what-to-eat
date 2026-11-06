// 界面图标：整个网站只用 Tabler 一套图标（用户 2026-11-06 选定，见 DESIGN.md），不用 emoji。
//
// 这里放两类东西：
// 1. 分类 → 图标：按分类名里的关键字找，找不到用“餐具”图标。分类是表格里自由填的，只能“猜”
// 2. 餐次 → 图标：早午晚固定；“餐次”页加的额外餐次按名字里的关键字猜
// 想给新分类配图标：在 CATEGORY_RULES 里加一行（越靠前越优先），图标名到 https://tabler.io/icons 查，
// 再在文件顶部 import 对应的组件（名字是 Icon + 驼峰写法，例如 bowl-chopsticks → IconBowlChopsticks）。

import {
  IconBowlChopsticks,
  IconBowlSpoon,
  IconBurger,
  IconCake,
  IconCookie,
  IconCup,
  IconDumpling,
  IconFish,
  IconFishBone,
  IconFlame,
  IconGrill,
  IconMeat,
  IconMoon,
  IconMoonStars,
  IconPepper,
  IconPizza,
  IconSalad,
  IconSoup,
  IconSun,
  IconSunrise,
  IconToolsKitchen2,
} from '@tabler/icons-vue'

/** 认不出的分类、餐次都用这个 */
export const FALLBACK_ICON = IconToolsKitchen2

// 分类名里的关键字 → 图标（越靠前越优先）
const CATEGORY_RULES = [
  ['火锅', IconFlame],
  ['串', IconFlame],
  ['烧烤', IconGrill],
  ['烤', IconGrill],
  ['早点', IconDumpling],
  ['包子', IconDumpling],
  ['饺子', IconDumpling],
  ['馄饨', IconDumpling],
  ['粥', IconBowlSpoon],
  ['汤', IconSoup],
  ['面', IconSoup],
  ['粉', IconSoup],
  // “西式快餐”要先于“快餐”匹配，所以西餐放在米饭快餐前面
  ['披萨', IconPizza],
  ['西式', IconBurger],
  ['汉堡', IconBurger],
  ['米饭', IconBowlChopsticks],
  ['盖饭', IconBowlChopsticks],
  ['快餐', IconBowlChopsticks],
  ['川', IconPepper],
  ['湘', IconPepper],
  ['辣', IconPepper],
  ['海鲜', IconFishBone],
  ['日', IconFish],
  ['韩', IconFish],
  ['寿司', IconFish],
  ['鱼', IconFish],
  ['轻食', IconSalad],
  ['沙拉', IconSalad],
  ['肉', IconMeat],
  ['鸡', IconMeat],
  ['小吃', IconCookie],
  ['甜', IconCake],
  ['蛋糕', IconCake],
  ['奶茶', IconCup],
  ['饮', IconCup],
  ['咖啡', IconCup],
]

/** 给一个分类名配一个图标组件 */
export function iconForCategory(category) {
  const name = String(category ?? '')
  for (const [keyword, icon] of CATEGORY_RULES) {
    if (name.includes(keyword)) return icon
  }
  return FALLBACK_ICON
}

/** 三个固定餐次的图标 */
export const MEAL_ICONS = {
  breakfast: IconSunrise,
  lunch: IconSun,
  dinner: IconMoon,
}

// 额外餐次按名字里的关键字猜
const MEAL_RULES = [
  ['宵', IconMoonStars],
  ['夜', IconMoonStars],
  ['茶', IconCup],
  ['饮', IconCup],
  ['甜', IconCake],
  ['点心', IconCake],
  ['零食', IconCookie],
  ['加餐', IconCookie],
  ['早午', IconSunrise],
]

/** 餐次的图标：固定餐次用上面的；额外餐次按名字猜，猜不到用餐具 */
export function iconForMeal(meal) {
  if (MEAL_ICONS[meal.id]) return MEAL_ICONS[meal.id]
  for (const [keyword, icon] of MEAL_RULES) {
    if (String(meal.label ?? '').includes(keyword)) return icon
  }
  return FALLBACK_ICON
}
