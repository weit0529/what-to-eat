// 管理页的 Excel 导入导出（阶段 4-2，REQUIREMENTS.md R-020）：线上菜单 ⇄ 表格。
// 只做数据转换，不读写文件、不依赖页面；表格格式和原来的 data/menu.xlsx 一样（列名见 menu-data.js 的 COLUMNS），
// 所以以前的表格可以直接导入，导出的表格也能用原来的填写说明来改。

import { COLUMNS, MEALS, MEAL_SHEET_COLUMNS, parseMealRows, parseMenuRows } from './menu-data.js'

/** 菜单页、餐次页的名字（和 scripts/build-menu.js 一致：第一页是菜单，“餐次”页放额外餐次） */
export const MENU_SHEET = '菜单'
export const MEAL_SHEET = '餐次'

const COLUMN_ORDER = ['name', 'shop', 'category', 'meals', 'tags', 'price', 'description', 'image', 'enabled']

/**
 * 线上菜单 → 表格内容（每一页是二维数组，第一行是列名）。
 * @param {{ meals: Array<{id: string, label: string, builtIn?: boolean}>, dishes: object[] }} menu  /api/admin/menu 的结果
 * @returns {Array<{ sheet: string, data: Array<Array<string|number|null>> }>}
 */
export function menuToSheets({ meals, dishes }) {
  const labelOf = new Map(meals.map((meal) => [meal.id, meal.label]))
  const header = COLUMN_ORDER.map((key) => COLUMNS[key].title)
  const rows = dishes.map((dish) => [
    dish.name,
    dish.shop ?? null,
    dish.category,
    dish.meals.map((id) => labelOf.get(id) ?? id).join('、'),
    dish.tags.length ? dish.tags.join('、') : null,
    dish.price ?? null,
    dish.description ?? null,
    dish.image ?? null,
    dish.enabled === false ? '否' : '是',
  ])
  const extra = meals.filter((meal) => !MEALS.some((m) => m.id === meal.id))
  return [
    { sheet: MENU_SHEET, data: [header, ...rows] },
    { sheet: MEAL_SHEET, data: [[MEAL_SHEET_COLUMNS.label.title], ...extra.map((meal) => [meal.label])] },
  ]
}

/**
 * 读进来的表格（read-excel-file 读出的所有页）→ 要提交给后台的导入内容。
 * 规则和 npm run menu 一样：第一页是菜单，名叫“餐次”的页是额外餐次；停用的菜也带上（后台保留，只是不显示）。
 * @param {Array<{ sheet: string, data: any[][] }>} sheets
 * @param {{ imageFiles?: string[] | null }} [options] 已有的图片文件名，用来提醒找不到的图片
 * @returns {{ ok: boolean, mealLabels: string[], dishes: object[], errors: object[], warnings: object[], disabledCount: number }}
 */
export function sheetsToImport(sheets, options = {}) {
  const fail = (message) => ({ ok: false, mealLabels: [], dishes: [], errors: [{ row: 0, message }], warnings: [], disabledCount: 0 })
  if (!Array.isArray(sheets) || sheets.length === 0) return fail('表格是空的')
  if (sheets[0].sheet === MEAL_SHEET) return fail(`第一页应该是菜单，现在是“${MEAL_SHEET}”页。请把菜单页拖回最前面`)

  const mealSheet = sheets.find((s) => s.sheet === MEAL_SHEET)
  const mealResult = mealSheet ? parseMealRows(mealSheet.data) : { meals: [], errors: [], warnings: [] }
  if (mealResult.errors.length > 0) {
    return { ok: false, mealLabels: [], dishes: [], errors: mealResult.errors, warnings: mealResult.warnings, disabledCount: 0 }
  }
  const menu = parseMenuRows(sheets[0].data, {
    extraMeals: mealResult.meals,
    imageFiles: options.imageFiles ?? null,
    includeDisabled: true,
  })
  const warnings = [...mealResult.warnings, ...menu.warnings]
  if (menu.errors.length > 0) {
    return { ok: false, mealLabels: [], dishes: [], errors: menu.errors, warnings, disabledCount: menu.disabledCount }
  }
  return {
    ok: true,
    mealLabels: mealResult.meals.map((meal) => meal.label),
    dishes: menu.items.map(({ id, name, shop, category, meals, tags, price, description, image, enabled }) => ({
      id,
      name,
      shop,
      category,
      meals,
      tags,
      price,
      description,
      image,
      enabled,
    })),
    errors: [],
    warnings,
    disabledCount: menu.disabledCount,
  }
}
