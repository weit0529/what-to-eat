// 总菜单的接口（阶段 4-2，REQUIREMENTS.md R-020、R-021、R-027）。
//
// 公开（不用登录）：
//   GET  /api/menu                 网站用的菜单：{ version, meals, items }，格式和 src/generated/menu.json 一样，只含启用的菜
// 管理员（要登录、role = admin；权限在这里检查，不能只靠网页拦）：
//   GET    /api/admin/menu         全部菜（含停用的）和额外餐次
//   POST   /api/admin/dishes       新加一道菜
//   PUT    /api/admin/dishes/:id   改一道菜
//   DELETE /api/admin/dishes/:id   删一道菜
//   PUT    /api/admin/meals        改额外餐次 { labels: [...] }
//   POST   /api/admin/import       用 Excel 导入的内容整个替换菜单 { mealLabels, dishes }
//   GET    /api/admin/admins       管理员名单
//   POST   /api/admin/admins       加一个管理员 { username, email, password }
//   DELETE /api/admin/admins/:id   去掉一个管理员（不能去掉自己，至少留一个）
// 一次性：
//   POST   /api/admin/bootstrap    还没有任何管理员时，凭 BOOTSTRAP_TOKEN 建第一个管理员（建好后这个接口就没用了）

import { MEALS, validateDish, validateExtraMeals } from '../../../src/core/menu-data.js'
import { isAllowedEmail, USERNAME_RE } from './auth-setup.js'
import { randomHex } from './auth.js'
import { json, readJson, TOO_LARGE } from './http.js'

/** 网页数据的格式版本（和 scripts/build-menu.js 的 MENU_FORMAT_VERSION 一致） */
const MENU_FORMAT_VERSION = 2
const BUILT_IN_IDS = MEALS.map((meal) => meal.id)
/** 普通管理请求和导入请求的请求体上限 */
const BODY_LIMIT = 16 * 1024
const IMPORT_LIMIT = 512 * 1024
/** 一次最多导入多少道菜 */
const IMPORT_MAX_DISHES = 2000

const SELECT_DISH =
  'SELECT id, name, shop, category, meals, tags, price, description, image, enabled, sort, created_at, updated_at FROM dishes'

/** 数据库里的一行 → 网页用的菜（格式和 menu.json 的 items 一样） */
function rowToItem(row) {
  return {
    id: row.id,
    name: row.name,
    shop: row.shop || null,
    category: row.category,
    meals: JSON.parse(row.meals),
    tags: JSON.parse(row.tags),
    price: row.price,
    description: row.description,
    image: row.image,
    source: 'admin',
    owner: null,
    status: 'approved',
  }
}

/** 管理页看到的菜：多了是否启用、更新时间 */
function rowToAdminDish(row) {
  const { source, owner, status, ...item } = rowToItem(row)
  return { ...item, enabled: row.enabled === 1, updatedAt: row.updated_at }
}

async function extraMeals(env) {
  const { results } = await env.DB.prepare('SELECT id, label FROM meal_types ORDER BY sort').all()
  return results.map((row) => ({ id: row.id, label: row.label }))
}

const allMeals = (extra) => [
  ...MEALS.map((meal) => ({ ...meal, builtIn: true })),
  ...extra.map((meal) => ({ ...meal, builtIn: false })),
]

/** 当前登录的管理员；不是管理员返回 { error, status } */
async function requireAdmin(request, auth) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return { error: '请先登录', status: 401 }
  if (session.user.role !== 'admin') return { error: '只有管理员能做这件事', status: 403 }
  return { user: session.user }
}

/** 检查一道菜，并检查“品类 + 店铺”有没有和别的菜重复 */
async function checkDish(env, input, exceptId) {
  const extra = await extraMeals(env)
  const { dish, errors } = validateDish(input, { mealIds: [...BUILT_IN_IDS, ...extra.map((m) => m.id)] })
  if (!dish) return { errors }
  const dup = await env.DB.prepare('SELECT id FROM dishes WHERE name = ? AND shop = ? AND id <> ?')
    .bind(dish.name, dish.shop ?? '', exceptId ?? '')
    .first()
  if (dup) return { errors: [{ field: 'name', message: '已经有这道菜了（品类和店铺都一样）' }] }
  return { dish }
}

const dishParams = (dish) => [
  dish.name,
  dish.shop ?? '',
  dish.category,
  JSON.stringify(dish.meals),
  JSON.stringify(dish.tags),
  dish.price,
  dish.description,
  dish.image,
  dish.enabled ? 1 : 0,
]

/**
 * 处理菜单相关的接口；不是这些接口返回 null。
 * @param {() => object} getAuth  需要时才建 Better Auth（公开读菜单用不着）
 */
export async function menuRoute(method, path, request, env, getAuth, now, started, cors) {
  const reply = (body, status = 200) => json(body, status, started, cors)

  if (method === 'GET' && path === '/api/menu') {
    const extra = await extraMeals(env)
    const { results } = await env.DB.prepare(`${SELECT_DISH} WHERE enabled = 1 ORDER BY sort, created_at`).all()
    return reply({ version: MENU_FORMAT_VERSION, meals: allMeals(extra), items: results.map(rowToItem) })
  }

  if (!path.startsWith('/api/admin/')) return null

  if (method === 'POST' && path === '/api/admin/bootstrap') {
    const body = await readJson(request, BODY_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '请求太大' }, 413)
    if (!env.BOOTSTRAP_TOKEN || typeof body?.token !== 'string' || body.token !== env.BOOTSTRAP_TOKEN) {
      return reply({ error: '没有权限' }, 403)
    }
    const existing = await env.DB.prepare(`SELECT COUNT(*) AS n FROM "user" WHERE role = 'admin'`).first()
    if (existing.n > 0) return reply({ error: '已经有管理员了，这个接口不能再用' }, 409)
    return createAdmin(getAuth(), body, reply)
  }

  const auth = getAuth()
  const who = await requireAdmin(request, auth)
  if (who.error) return reply({ error: who.error }, who.status)

  if (method === 'GET' && path === '/api/admin/menu') {
    const extra = await extraMeals(env)
    const { results } = await env.DB.prepare(`${SELECT_DISH} ORDER BY sort, created_at`).all()
    return reply({ meals: allMeals(extra), dishes: results.map(rowToAdminDish) })
  }

  if (method === 'POST' && path === '/api/admin/dishes') {
    const body = await readJson(request, BODY_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '请求太大' }, 413)
    const checked = await checkDish(env, body)
    if (checked.errors) return reply({ error: '填写有误', errors: checked.errors }, 400)
    const id = `d_${randomHex(8)}`
    const sort = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM dishes').first()
    await env.DB.prepare(
      `INSERT INTO dishes (name, shop, category, meals, tags, price, description, image, enabled, id, sort, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(...dishParams(checked.dish), id, sort.next, now, now, who.user.id)
      .run()
    const row = await env.DB.prepare(`${SELECT_DISH} WHERE id = ?`).bind(id).first()
    return reply({ dish: rowToAdminDish(row) }, 201)
  }

  const dishMatch = path.match(/^\/api\/admin\/dishes\/([^/]{1,200})$/)
  if (dishMatch && (method === 'PUT' || method === 'DELETE')) {
    const id = decodeURIComponent(dishMatch[1])
    const existing = await env.DB.prepare('SELECT id FROM dishes WHERE id = ?').bind(id).first()
    if (!existing) return reply({ error: '没有这道菜（可能已经被别的管理员删了）' }, 404)
    // 至少留一道启用的菜（和导入的规则一致；Codex 第 28 轮）：网站把空菜单当作“没取到”，会退回显示旧菜。
    // 条件写在同一条 SQL 里，两个管理员同时停用最后两道菜时，后一条会被挡住
    const LAST_ONE = '至少要留一道启用的菜，不然网站上就没有菜可选了。可以先加一道新菜，或者恢复一道暂停的菜'
    if (method === 'DELETE') {
      const res = await env.DB.prepare(
        `DELETE FROM dishes WHERE id = ? AND (enabled = 0 OR (SELECT COUNT(*) FROM dishes WHERE enabled = 1) > 1)`,
      )
        .bind(id)
        .run()
      if (res.meta.changes === 0) return reply({ error: LAST_ONE }, 409)
      return reply({ ok: true })
    }
    const body = await readJson(request, BODY_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '请求太大' }, 413)
    const checked = await checkDish(env, body, id)
    if (checked.errors) return reply({ error: '填写有误', errors: checked.errors }, 400)
    const res = await env.DB.prepare(
      `UPDATE dishes SET name = ?, shop = ?, category = ?, meals = ?, tags = ?, price = ?, description = ?, image = ?, enabled = ?,
       updated_at = ?, updated_by = ?
       WHERE id = ? AND (? = 1 OR enabled = 0 OR (SELECT COUNT(*) FROM dishes WHERE enabled = 1) > 1)`,
    )
      .bind(...dishParams(checked.dish), now, who.user.id, id, checked.dish.enabled ? 1 : 0)
      .run()
    if (res.meta.changes === 0) return reply({ error: LAST_ONE }, 409)
    const row = await env.DB.prepare(`${SELECT_DISH} WHERE id = ?`).bind(id).first()
    return reply({ dish: rowToAdminDish(row) })
  }

  if (method === 'PUT' && path === '/api/admin/meals') {
    const body = await readJson(request, BODY_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '请求太大' }, 413)
    const { meals, errors } = validateExtraMeals(body?.labels)
    if (errors.length > 0) return reply({ error: errors.join('；') }, 400)
    // 去掉的餐次如果还有菜在用，先不让去掉，告诉管理员是哪几道菜
    const keep = new Set([...BUILT_IN_IDS, ...meals.map((m) => m.id)])
    const { results } = await env.DB.prepare('SELECT name, shop, meals FROM dishes').all()
    const inUse = results.filter((row) => JSON.parse(row.meals).some((id) => !keep.has(id)))
    if (inUse.length > 0) {
      const names = inUse.slice(0, 5).map((row) => (row.shop ? `${row.name}（${row.shop}）` : row.name))
      return reply({ error: `还有菜用着要去掉的餐次：${names.join('、')}${inUse.length > 5 ? ' 等' : ''}。先把这些菜的餐次改掉` }, 409)
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM meal_types'),
      env.DB.prepare(
        `INSERT INTO meal_types (id, label, sort)
         SELECT json_extract(value, '$.id'), json_extract(value, '$.label'), CAST(key AS INTEGER) FROM json_each(?)`,
      ).bind(JSON.stringify(meals)),
    ])
    return reply({ meals: allMeals(meals) })
  }

  if (method === 'POST' && path === '/api/admin/import') {
    const body = await readJson(request, IMPORT_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '表格太大了' }, 413)
    return importMenu(env, body, who.user.id, now, reply)
  }

  if (method === 'GET' && path === '/api/admin/admins') {
    const { results } = await env.DB.prepare(
      `SELECT id, displayUsername AS username, email, createdAt FROM "user" WHERE role = 'admin' ORDER BY createdAt`,
    ).all()
    return reply({ admins: results.map((row) => ({ ...row, isMe: row.id === who.user.id })) })
  }

  if (method === 'POST' && path === '/api/admin/admins') {
    const body = await readJson(request, BODY_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '请求太大' }, 413)
    return createAdmin(auth, body, reply)
  }

  const adminMatch = path.match(/^\/api\/admin\/admins\/([^/]{1,100})$/)
  if (adminMatch && method === 'DELETE') {
    const id = decodeURIComponent(adminMatch[1])
    if (id === who.user.id) return reply({ error: '不能去掉自己' }, 400)
    const target = await env.DB.prepare(`SELECT id FROM "user" WHERE id = ? AND role = 'admin'`).bind(id).first()
    if (!target) return reply({ error: '没有这个管理员' }, 404)
    // 先删登录记录和密码，再删人（不依赖数据库的级联删除）
    await env.DB.batch([
      env.DB.prepare('DELETE FROM "session" WHERE userId = ?').bind(id),
      env.DB.prepare('DELETE FROM "account" WHERE userId = ?').bind(id),
      env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(id),
    ])
    return reply({ ok: true })
  }

  return reply({ error: '没有这个接口' }, 404)
}

/** 建一个管理员（加管理员和第一次建管理员共用） */
async function createAdmin(auth, body, reply) {
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!USERNAME_RE.test(username)) return reply({ error: '用户名要 2～20 个字，只能用中文、英文字母、数字、下划线' }, 400)
  if (!isAllowedEmail(email)) return reply({ error: '邮箱格式不对' }, 400)
  if (password.length < 8 || password.length > 64) return reply({ error: '密码要 8～64 位' }, 400)
  try {
    const { user } = await auth.api.createUser({
      body: { email, password, name: username, role: 'admin', data: { username: username.toLowerCase(), displayUsername: username } },
    })
    return reply({ admin: { id: user.id, username, email } }, 201)
  } catch (err) {
    const message = String(err?.body?.message || err?.message || '')
    if (/exist|already|unique/i.test(message)) return reply({ error: '这个用户名或邮箱已经有人用了' }, 409)
    throw err
  }
}

/**
 * 用 Excel 导入的内容整个替换菜单。
 * 已有的菜按“品类 + 店铺”认出来，沿用原来的编号（大家手机上的“吃过”“小名单”记录还认得）；
 * 新菜优先用 Excel 那边算出来的编号（["品类","店铺"]，和以前的网站一致），被占用时才用随机编号。
 * 用一条 SQL 把整份菜单写进去（json_each），不受“每次请求最多几条 SQL”的限制，要么全成功要么全不变。
 */
async function importMenu(env, body, userId, now, reply) {
  if (!body || !Array.isArray(body.dishes)) return reply({ error: '格式不对' }, 400)
  if (body.dishes.length > IMPORT_MAX_DISHES) return reply({ error: `一次最多导入 ${IMPORT_MAX_DISHES} 道菜` }, 400)
  const { meals, errors: mealErrors } = validateExtraMeals(body.mealLabels ?? [])
  if (mealErrors.length > 0) return reply({ error: `餐次有误：${mealErrors.join('；')}` }, 400)
  const mealIds = [...BUILT_IN_IDS, ...meals.map((m) => m.id)]

  const problems = []
  const dishes = []
  const seen = new Set()
  body.dishes.forEach((input, index) => {
    const { dish, errors } = validateDish(input, { mealIds })
    if (!dish) {
      problems.push(`第 ${index + 1} 道菜：${errors.map((e) => e.message).join('，')}`)
      return
    }
    const key = `${dish.name}\u0000${dish.shop ?? ''}`
    if (seen.has(key)) {
      problems.push(`第 ${index + 1} 道菜：和前面的菜重复（品类和店铺都一样）`)
      return
    }
    seen.add(key)
    const legacyId = typeof input.id === 'string' && input.id.length <= 200 ? input.id : null
    dishes.push({ dish, key, legacyId })
  })
  if (problems.length > 0) return reply({ error: '表格有误', problems: problems.slice(0, 50) }, 400)
  if (!dishes.some(({ dish }) => dish.enabled)) return reply({ error: '没有启用的菜，网站上就没有菜可选了' }, 400)

  const { results: existing } = await env.DB.prepare('SELECT id, name, shop, created_at FROM dishes').all()
  const byKey = new Map(existing.map((row) => [`${row.name}\u0000${row.shop}`, row]))
  const usedIds = new Set()
  const rows = dishes.map(({ dish, key, legacyId }, index) => {
    const old = byKey.get(key)
    let id = old?.id
    if (!id) id = legacyId && !usedIds.has(legacyId) && !existing.some((row) => row.id === legacyId) ? legacyId : `d_${randomHex(8)}`
    usedIds.add(id)
    return {
      id,
      name: dish.name,
      shop: dish.shop ?? '',
      category: dish.category,
      meals: JSON.stringify(dish.meals),
      tags: JSON.stringify(dish.tags),
      price: dish.price,
      description: dish.description,
      image: dish.image,
      enabled: dish.enabled ? 1 : 0,
      sort: index,
      created_at: old?.created_at ?? now,
    }
  })

  await env.DB.batch([
    env.DB.prepare('DELETE FROM meal_types'),
    env.DB.prepare(
      `INSERT INTO meal_types (id, label, sort)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.label'), CAST(key AS INTEGER) FROM json_each(?)`,
    ).bind(JSON.stringify(meals)),
    env.DB.prepare('DELETE FROM dishes'),
    env.DB.prepare(
      `INSERT INTO dishes (id, name, shop, category, meals, tags, price, description, image, enabled, sort, created_at, updated_at, updated_by)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.shop'),
              json_extract(value, '$.category'), json_extract(value, '$.meals'), json_extract(value, '$.tags'),
              json_extract(value, '$.price'), json_extract(value, '$.description'), json_extract(value, '$.image'),
              json_extract(value, '$.enabled'), json_extract(value, '$.sort'), json_extract(value, '$.created_at'), ?, ?
       FROM json_each(?)`,
    ).bind(now, userId, JSON.stringify(rows)),
  ])
  return reply({ ok: true, count: rows.length, enabled: rows.filter((r) => r.enabled === 1).length })
}
