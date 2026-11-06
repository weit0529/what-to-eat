// 菜单数据：把 Excel 读出来的表格（二维数组）转换成网页用的菜品列表，并检查填写错误。
//
// 这里只做纯数据处理，不读写文件、不依赖页面。
// 所以转换脚本（scripts/build-menu.js）在用它，以后的管理页面、小程序也能直接复用。

/**
 * 三个固定的餐次。id 是存进数据里的英文名，label 是显示给人看的中文名。
 * 另外还可以在 Excel 的“餐次”页里加额外的餐次（如下午茶、夜宵），见 parseMealRows()。
 */
export const MEALS = [
  { id: 'breakfast', label: '早餐' },
  { id: 'lunch', label: '午餐' },
  { id: 'dinner', label: '晚餐' },
]

const ALL_MEAL_IDS = MEALS.map((meal) => meal.id)

/**
 * “适合餐次”一列里认得的词，以及它们对应的餐次。
 * 用 Map 而不是普通对象：普通对象会把 constructor、toString 这类词也当成“认得”。
 */
const MEAL_WORDS = new Map([
  ['早餐', ['breakfast']],
  ['早饭', ['breakfast']],
  ['早', ['breakfast']],
  ['午餐', ['lunch']],
  ['午饭', ['lunch']],
  ['午', ['lunch']],
  ['晚餐', ['dinner']],
  ['晚饭', ['dinner']],
  ['晚', ['dinner']],
  ['全天', ALL_MEAL_IDS],
])

/**
 * 表格的列。key 是程序里用的英文名，title 是表格第一行的列名。
 * required 为 true 的列必须存在，并且每行都要填。
 */
export const COLUMNS = {
  name: { title: '品类', required: true },
  shop: { title: '店铺' },
  category: { title: '分类', required: true },
  meals: { title: '适合餐次', required: true },
  tags: { title: '标签' },
  price: { title: '人均价格' },
  description: { title: '描述' },
  image: { title: '图片' },
  enabled: { title: '启用' },
}

/** 支持的图片格式 */
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif)$/i

// 列表类的格子（标签、餐次）可以用这些符号隔开：顿号、中英文逗号、中英文分号、换行
const LIST_SEPARATOR = /[、,，;；\n]+/
// 餐次里的词不会带空格，所以空格也可以当分隔符
const MEAL_SEPARATOR = /[、,，;；\s]+/

const YES_WORDS = ['是', 'y', 'yes', 'true', '1']
const NO_WORDS = ['否', 'n', 'no', 'false', '0']

/**
 * 把一个格子的值变成去掉首尾空格的文字。空格子返回空字符串。
 * Excel 里的格子可能是文字、数字、真假值或日期，这里统一转成文字。
 */
function cellText(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).trim()
}

/** 把连续的空白压成一个空格，用来比较“品类 + 店铺”是否重复 */
function squeeze(text) {
  return text.replace(/\s+/g, ' ')
}

/** 拆分列表类的格子，去掉空项和重复项，保持原来的顺序 */
function splitList(text, separator) {
  const parts = text
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  return [...new Set(parts)]
}

/**
 * 一道菜的 id：由品类和店铺组成，例如 ["麻辣烫","楼下张姐"]；没填店铺时店铺部分是空字符串。
 * 以后账号、“吃过记录”等功能靠它认出是哪道菜。
 */
export function makeItemId(name, shop) {
  return JSON.stringify([name, shop || ''])
}

/** 这一行是不是整行都空着 */
function isEmptyRow(row) {
  return !row || row.every((value) => cellText(value) === '')
}

/**
 * 读第一行（列名），找出每一列在第几格。
 * 返回 { columnIndex, errors, warnings }。
 */
function readHeader(headerRow) {
  const titleToKey = {}
  for (const [key, column] of Object.entries(COLUMNS)) titleToKey[column.title] = key

  const columnIndex = {}
  const errors = []
  const warnings = []

  ;(headerRow || []).forEach((value, index) => {
    const title = cellText(value)
    if (title === '') return
    const key = titleToKey[title]
    if (!key) {
      warnings.push({ row: 1, column: title, message: '不认识这一列，已忽略（可以拿来写备注）' })
      return
    }
    if (key in columnIndex) {
      errors.push({ row: 1, column: title, message: '这一列出现了两次，请删掉一列' })
      return
    }
    columnIndex[key] = index
  })

  for (const [key, column] of Object.entries(COLUMNS)) {
    if (column.required && !(key in columnIndex)) {
      errors.push({ row: 1, column: column.title, message: '缺少这一列。第一行必须有这个列名' })
    }
  }

  return { columnIndex, errors, warnings }
}

/**
 * 解析“适合餐次”，返回 { meals, unknown }，unknown 是不认识的词。
 * words：认得的词 → 餐次 id；order：输出的顺序（早→午→晚→额外餐次）
 */
function parseMeals(text, words, order) {
  const meals = new Set()
  const unknown = []
  for (const word of splitList(text, MEAL_SEPARATOR)) {
    const ids = words.get(word)
    if (ids) ids.forEach((id) => meals.add(id))
    else unknown.push(word)
  }
  return { meals: order.filter((id) => meals.has(id)), unknown }
}

// ---------------- 额外餐次（Excel 的“餐次”页） ----------------

/** “餐次”页的列 */
export const MEAL_SHEET_COLUMNS = {
  label: { title: '餐次', required: true },
  emoji: { title: '图标' },
}

/** “餐次”页最多加几个餐次（页面上一行放 3 个，最多两行） */
export const MAX_EXTRA_MEALS = 6

/** 餐次名不能用的字：这些符号在“适合餐次”里用来隔开几个餐次 */
const MEAL_NAME_FORBIDDEN = /[、,，;；\s]/

/**
 * 读“餐次”页：额外的餐次（早、午、晚之外的），按表格顺序。
 * 额外餐次的 id 就是它的名字（例如“夜宵”），和固定餐次的英文 id 不会重名。
 *
 * @param {Array<Array<any>>} rows “餐次”页的内容，第一行是列名
 * @returns {{ meals: Array<{ id: string, label: string, emoji: string | null }>,
 *             errors: object[], warnings: object[] }}
 *   错误和提醒都带 sheet: '餐次'，row 是 Excel 里的行号
 */
export function parseMealRows(rows) {
  const sheet = '餐次'
  const meals = []
  const errors = []
  const warnings = []
  const issue = (list, row, column, message) => list.push({ sheet, row, column, message })

  if (!rows || rows.length === 0 || isEmptyRow(rows[0])) {
    // 整页空着：当作没有额外餐次
    return { meals, errors, warnings }
  }

  // 列名
  const titleToKey = Object.fromEntries(Object.entries(MEAL_SHEET_COLUMNS).map(([k, c]) => [c.title, k]))
  const columnIndex = {}
  rows[0].forEach((value, index) => {
    const title = cellText(value)
    if (title === '') return
    const key = titleToKey[title]
    if (!key) issue(warnings, 1, title, '不认识这一列，已忽略')
    else if (key in columnIndex) issue(errors, 1, title, '这一列出现了两次，请删掉一列')
    else columnIndex[key] = index
  })
  if (!('label' in columnIndex)) issue(errors, 1, '餐次', '缺少这一列。第一行必须有这个列名')
  if (errors.length > 0) return { meals, errors, warnings }

  const cell = (row, key) => (key in columnIndex ? row[columnIndex[key]] : null)
  const firstRowOf = new Map()

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const excelRow = i + 1
    if (isEmptyRow(row)) continue

    const label = cellText(cell(row, 'label'))
    let emoji = cellText(cell(row, 'emoji')) || null

    if (label === '') {
      issue(errors, excelRow, '餐次', '不能为空')
      continue
    }
    if (MEAL_NAME_FORBIDDEN.test(label)) {
      issue(errors, excelRow, '餐次', '名字里不能有顿号、逗号、分号或空格（“适合餐次”里用它们隔开几个餐次）')
      continue
    }
    if (MEAL_WORDS.has(label) || ALL_MEAL_IDS.includes(label)) {
      issue(errors, excelRow, '餐次', `“${label}”和早餐、午餐、晚餐、全天这些固定的词重了，换个名字`)
      continue
    }
    if (firstRowOf.has(label)) {
      issue(errors, excelRow, '餐次', `和第 ${firstRowOf.get(label)} 行重复`)
      continue
    }
    firstRowOf.set(label, excelRow)

    // 图标只要一个 emoji。不是 emoji、或者太长的，提醒并改用自动配的图标。
    // 注意：有些工具（比如 Python 的 openpyxl）把 emoji 存成“&#数字;”，读表格的库会把它读坏成别的字，
    // 这里也会因为“不是 emoji”而提醒，不会把读坏的字显示到网页上。用 Excel / WPS 直接填没有这个问题
    if (emoji && (!/\p{Extended_Pictographic}/u.test(emoji) || [...emoji].length > 4)) {
      issue(warnings, excelRow, '图标', `“${emoji}”不是一个 emoji，或者太长了。先用自动配的图标`)
      emoji = null
    }
    meals.push({ id: label, label, emoji })
  }

  if (meals.length > MAX_EXTRA_MEALS) {
    issue(errors, 1, '餐次', `最多加 ${MAX_EXTRA_MEALS} 个餐次，现在有 ${meals.length} 个`)
  }
  return { meals: errors.length > 0 ? [] : meals, errors, warnings }
}

/** 解析“人均价格”。返回 { price } 或 { error } */
function parsePrice(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return { error: '不能是负数' }
    return { price: value }
  }
  const text = cellText(value)
  if (text === '') return { price: null }
  const notNumber = { error: `“${text}”不是数字。只填数字，单位是元，例如 25` }
  if (!/^\d+(\.\d+)?$/.test(text)) return notNumber
  const price = Number(text)
  // 位数太多的数字会变成 Infinity，也当作不是数字
  if (!Number.isFinite(price)) return notNumber
  return { price }
}

/** 解析“启用”。返回 { enabled } 或 { error } */
function parseEnabled(value) {
  if (typeof value === 'boolean') return { enabled: value }
  const text = cellText(value).toLowerCase()
  if (text === '' || YES_WORDS.includes(text)) return { enabled: true }
  if (NO_WORDS.includes(text)) return { enabled: false }
  return { error: `“${cellText(value)}”看不懂。只能填“是”或“否”，不填等于“是”` }
}

/**
 * 检查图片文件名。返回 { image } 或 { image: null, warning }。
 * imageFiles 是图片文件夹里实际有的文件名；传 null 表示不检查文件是否存在。
 */
function checkImage(fileName, imageFiles) {
  if (fileName === '') return { image: null }

  // 只能是文件名本身，不能带文件夹路径，也不能以点开头
  if (/[\\/:*?"<>|]/.test(fileName) || fileName.startsWith('.')) {
    return { image: null, warning: `“${fileName}”不是有效的文件名。只填文件名，不要带文件夹，例如 malatang.jpg` }
  }
  if (!IMAGE_EXTENSIONS.test(fileName)) {
    return { image: null, warning: `“${fileName}”不是支持的图片格式（jpg、jpeg、png、webp、gif）` }
  }

  if (imageFiles) {
    if (imageFiles.includes(fileName)) return { image: fileName }
    // 本机 Windows 不区分大小写，但发布到网上后区分，所以大小写不一致也要提醒
    const sameIgnoringCase = imageFiles.find((name) => name.toLowerCase() === fileName.toLowerCase())
    if (sameIgnoringCase) {
      return {
        image: null,
        warning: `文件夹里的文件叫“${sameIgnoringCase}”，大小写和表格里的“${fileName}”不一致，发布到网上后会找不到`,
      }
    }
    return { image: null, warning: `在 public/images/ 里找不到“${fileName}”` }
  }

  return { image: fileName }
}

/**
 * 把整张表格转换成菜品列表。
 *
 * @param {Array<Array<any>>} rows 表格内容，第一行是列名
 * @param {{ imageFiles?: string[] | null, extraMeals?: Array<{ id: string, label: string }> }} [options]
 *   imageFiles：图片文件夹里实际有的文件名，用来检查图片是否存在；不传就不检查
 *   extraMeals：“餐次”页里加的额外餐次（parseMealRows 的结果），“适合餐次”里可以填它们的名字
 * @returns {{
 *   items: Array<object>,   启用的菜品（停用的不放进来）
 *   errors: Array<{row: number, column?: string, message: string}>,   必须改的错误
 *   warnings: Array<{row: number, column?: string, message: string}>, 只是提醒
 *   disabledCount: number   填了“启用：否”的菜有几道
 * }}
 * 错误和提醒里的 row 是 Excel 里看到的行号（第一行是列名）。
 */
export function parseMenuRows(rows, options = {}) {
  const imageFiles = options.imageFiles ?? null
  const extraMeals = options.extraMeals ?? []
  // 认得的餐次词：固定的词 + 额外餐次的名字。“全天”只含早、午、晚（用户 2026-11-05 决定 3A）
  const mealWords = new Map(MEAL_WORDS)
  extraMeals.forEach((meal) => mealWords.set(meal.label, [meal.id]))
  const mealOrder = [...ALL_MEAL_IDS, ...extraMeals.map((meal) => meal.id)]
  const mealNames = ['早餐', '午餐', '晚餐', ...extraMeals.map((meal) => meal.label), '全天'].join('、')
  const errors = []
  const warnings = []
  const items = []
  let disabledCount = 0

  if (!rows || rows.length === 0 || isEmptyRow(rows[0])) {
    errors.push({ row: 1, message: '第一行应该是列名，但现在是空的' })
    return { items, errors, warnings, disabledCount }
  }

  const header = readHeader(rows[0])
  errors.push(...header.errors)
  warnings.push(...header.warnings)
  // 列名有问题时，后面每一行都没法正确读，直接返回
  if (header.errors.length > 0) return { items, errors, warnings, disabledCount }

  const { columnIndex } = header
  const cell = (row, key) => (key in columnIndex ? row[columnIndex[key]] : null)

  // 记录每个“品类 + 店铺”第一次出现在哪一行，用来发现重复
  const firstRowOfKey = new Map()

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const excelRow = i + 1
    if (isEmptyRow(row)) continue

    const rowErrors = []
    const addError = (key, message) => rowErrors.push({ row: excelRow, column: COLUMNS[key].title, message })
    const addWarning = (key, message) => warnings.push({ row: excelRow, column: COLUMNS[key].title, message })

    const name = squeeze(cellText(cell(row, 'name')))
    const shop = squeeze(cellText(cell(row, 'shop')))
    const category = cellText(cell(row, 'category'))
    const mealsText = cellText(cell(row, 'meals'))

    if (name === '') addError('name', '不能为空')

    if (category === '') addError('category', '不能为空')
    else if (LIST_SEPARATOR.test(category)) addError('category', '只能填一个分类')

    // 只填了标点（比如“、，”）时拆出来什么都没有，和没填一样处理
    const { meals, unknown } = parseMeals(mealsText, mealWords, mealOrder)
    if (unknown.length > 0) {
      addError('meals', `不认识“${unknown.join('、')}”。只能填${mealNames}`)
    } else if (meals.length === 0) {
      addError('meals', `不能为空。填${mealNames.replace('、全天', '')}中的一个或几个，或者填“全天”`)
    }

    const price = parsePrice(cell(row, 'price'))
    if (price.error) addError('price', price.error)

    const enabled = parseEnabled(cell(row, 'enabled'))
    if (enabled.error) addError('enabled', enabled.error)

    // 用“品类 + 店铺”识别一道菜，所以这个组合不能重复（停用的菜也算）。
    // 用 JSON 数组编码，不会因为名字里带某个符号而把两道不同的菜拼成同一个 id
    const id = makeItemId(name, shop)
    if (name !== '') {
      if (firstRowOfKey.has(id)) {
        addError('name', `和第 ${firstRowOfKey.get(id)} 行重复（品类和店铺都一样）`)
      } else {
        firstRowOfKey.set(id, excelRow)
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      continue
    }

    if (!enabled.enabled) {
      disabledCount++
      continue
    }

    const image = checkImage(cellText(cell(row, 'image')), imageFiles)
    if (image.warning) addWarning('image', `${image.warning}。这道菜先不显示图片`)

    const description = cellText(cell(row, 'description'))

    items.push({
      id,
      name,
      shop: shop || null,
      category,
      meals,
      tags: splitList(cellText(cell(row, 'tags')), LIST_SEPARATOR),
      price: price.price,
      description: description || null,
      image: image.image,
      // 以下三项给以后的账号功能预留（REQUIREMENTS.md F-002）：
      // 来源（admin = 管理员表格）、上传者、审核状态
      source: 'admin',
      owner: null,
      status: 'approved',
    })
  }

  if (errors.length === 0 && items.length === 0) {
    errors.push({
      row: 1,
      message: disabledCount > 0 ? '所有菜都填了“启用：否”，网站上就没有菜可选了' : '表格里还没有菜',
    })
  }

  return { items, errors, warnings, disabledCount }
}

/**
 * 把一条错误或提醒变成一句话，例如“第 3 行「分类」：不能为空”。
 * 不在菜单页的（比如“餐次”页）前面加上页名：“「餐次」页第 2 行「餐次」：不能为空”
 */
export function formatIssue(issue) {
  const sheet = issue.sheet ? `「${issue.sheet}」页` : ''
  const where = issue.column ? `${sheet}第 ${issue.row} 行「${issue.column}」` : `${sheet}第 ${issue.row} 行`
  return `${where}：${issue.message}`
}
