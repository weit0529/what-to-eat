// 总菜单的接口（阶段 4-2，REQUIREMENTS.md R-020、R-021、R-027）。
//
// 公开（不用登录）：
//   GET  /api/menu                 网站用的菜单：{ version, meals, items }，格式和 src/generated/menu.json 一样，只含启用的通用菜
//                                  （阶段 4-4 起分通用菜单和共享菜；登录用户的菜单见 my-menu-api.js）
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

// scope（阶段 4-4，迁移 0006）：general = 通用菜单（所有人可见）；shared = 用户提交、审核通过的共享菜（登录用户可见）
export const SELECT_DISH =
  'SELECT id, name, shop, category, meals, tags, price, description, image, enabled, sort, created_at, updated_at, scope, author_id FROM dishes'

/** 数据库里的一行 → 网页用的菜（格式和 menu.json 的 items 一样） */
export function rowToItem(row) {
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
    source: row.scope === 'shared' ? 'shared' : 'admin',
    owner: null,
    status: 'approved',
  }
}

/** 管理页看到的菜：多了是否启用、更新时间、哪一层、谁提交的 */
function rowToAdminDish(row, authors = new Map()) {
  const { source, owner, status, ...item } = rowToItem(row)
  return {
    ...item,
    enabled: row.enabled === 1,
    updatedAt: row.updated_at,
    scope: row.scope === 'shared' ? 'shared' : 'general',
    author: row.author_id ? (authors.get(row.author_id) ?? '（已删除的用户）') : null,
  }
}

/** 这些用户的显示名：id → 名字 */
async function authorNames(env, ids) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const { results } = await env.DB.prepare('SELECT id, displayUsername FROM "user" WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(unique))
    .all()
  return new Map(results.map((row) => [row.id, row.displayUsername]))
}

export async function extraMeals(env) {
  const { results } = await env.DB.prepare('SELECT id, label FROM meal_types ORDER BY sort').all()
  return results.map((row) => ({ id: row.id, label: row.label }))
}

export const allMeals = (extra) => [
  ...MEALS.map((meal) => ({ ...meal, builtIn: true })),
  ...extra.map((meal) => ({ ...meal, builtIn: false })),
]

/** 所有餐次的编号（固定的早午晚 + 额外的） */
export const mealIdsOf = (extra) => [...BUILT_IN_IDS, ...extra.map((m) => m.id)]

/** 当前登录的管理员；不是管理员返回 { error, status } */
export async function requireAdmin(request, auth) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return { error: '请先登录', status: 401 }
  if (session.user.role !== 'admin') return { error: '只有管理员能做这件事', status: 403 }
  return { user: session.user }
}

/**
 * 检查一道菜，并检查“品类 + 店铺”有没有和通用菜单、共享菜里别的菜重复。
 * 审核用户的菜时也用它（my-menu-api.js）
 */
export async function checkDish(env, input, exceptId) {
  const extra = await extraMeals(env)
  const { dish, errors } = validateDish(input, { mealIds: mealIdsOf(extra) })
  if (!dish) return { errors }
  const dup = await env.DB.prepare('SELECT id FROM dishes WHERE name = ? AND shop = ? AND id <> ?')
    .bind(dish.name, dish.shop ?? '', exceptId ?? '')
    .first()
  if (dup) return { errors: [{ field: 'name', message: '已经有这道菜了（品类和店铺都一样）' }] }
  return { dish }
}

/**
 * SQL 条件：一个 JSON 数组参数（写一个 ?）里的餐次都还在（早午晚，或 meal_types 里有）。
 * 写菜的语句带上它：管理员恰好同时删了这个餐次时，这次写入不生效（Codex 第 37 轮）
 */
export const MEALS_EXIST = `NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE j.value NOT IN (${BUILT_IN_IDS.map((id) => `'${id}'`).join(', ')})
  AND j.value NOT IN (SELECT id FROM meal_types))`

/**
 * 放在改餐次的 batch 最前面：要留下的菜（keepScopes 那几层的 dishes，加上所有用户自己的菜）还用着要去掉的餐次时，
 * 故意写一个空值让整个 batch 失败、什么都不改（SQLite 没有“直接报错”的语句）。
 * 先检查、后写入之间有人加了用这个餐次的菜，也能挡住（Codex 第 37 轮）
 */
function mealGuard(env, keepIds, keepScopes) {
  return env.DB.prepare(
    `INSERT INTO settings (key, value) SELECT 'meal-guard', NULL WHERE EXISTS (
       SELECT 1 FROM (
         SELECT meals FROM dishes WHERE scope IN (SELECT value FROM json_each(?))
         UNION ALL SELECT meals FROM user_dishes
       ) t, json_each(t.meals) j
       WHERE j.value NOT IN (SELECT value FROM json_each(?)))`,
  ).bind(JSON.stringify(keepScopes), JSON.stringify(keepIds))
}
const isGuardHit = (err) => /NOT NULL constraint failed: settings\.value/i.test(String(err?.message))
const MEALS_RACE = '刚好有人加了用这个餐次的菜，这次没改。刷新一下再试'
const MEALS_GONE = '选的餐次有的刚被删了，这次没保存。刷新一下再试'

/**
 * 去掉一些餐次前，看还有哪些要留下的菜在用：返回给管理员看的说明（没有就是空字符串）。
 * 通用菜、共享菜写名字（管理员本来就看得到）；用户自己的菜只说几道，不说内容
 */
async function mealsInUse(env, keepIds, scopes) {
  const keep = new Set(keepIds)
  const uses = (row) => JSON.parse(row.meals).some((id) => !keep.has(id))
  const { results: dishes } = await env.DB.prepare('SELECT name, shop, meals, scope FROM dishes').all()
  const named = dishes.filter((row) => scopes.includes(row.scope) && uses(row))
  const { results: mine } = await env.DB.prepare('SELECT meals, status FROM user_dishes').all()
  const users = mine.filter(uses)
  const parts = []
  if (named.length > 0) {
    const names = named.slice(0, 5).map((row) => (row.shop ? `${row.name}（${row.shop}）` : row.name))
    parts.push(`${names.join('、')}${named.length > 5 ? ` 等 ${named.length} 道` : ''}`)
  }
  if (users.length > 0) {
    const pending = users.filter((row) => row.status === 'pending').length
    parts.push(`${users.length} 道用户自己的菜${pending ? `（其中 ${pending} 道在等审核，可以先退回）` : ''}`)
  }
  return parts.join('，还有 ')
}

/** 至少留一道启用的通用菜（只算通用菜单：没登录的人只看得到它） */
const KEEP_ONE_GENERAL = `(SELECT COUNT(*) FROM dishes WHERE enabled = 1 AND scope = 'general') > 1`

export const dishParams = (dish) => [
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
    // 公开菜单只有通用菜单（共享菜只给登录用户，见 my-menu-api.js 的 /api/my/menu）
    const { results } = await env.DB.prepare(`${SELECT_DISH} WHERE enabled = 1 AND scope = 'general' ORDER BY sort, created_at`).all()
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
    const authors = await authorNames(env, results.map((row) => row.author_id))
    return reply({ meals: allMeals(extra), dishes: results.map((row) => rowToAdminDish(row, authors)) })
  }

  if (method === 'POST' && path === '/api/admin/dishes') {
    const body = await readJson(request, BODY_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '请求太大' }, 413)
    const checked = await checkDish(env, body)
    if (checked.errors) return reply({ error: '填写有误', errors: checked.errors }, 400)
    const id = `d_${randomHex(8)}`
    const sort = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM dishes').first()
    // 写入时再确认一次餐次都还在（检查和写入之间别的管理员可能刚删了餐次，Codex 第 38 轮）
    const added = await env.DB.prepare(
      `INSERT INTO dishes (name, shop, category, meals, tags, price, description, image, enabled, id, sort, created_at, updated_at, updated_by)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${MEALS_EXIST}`,
    )
      .bind(...dishParams(checked.dish), id, sort.next, now, now, who.user.id, JSON.stringify(checked.dish.meals))
      .run()
    if (added.meta.changes === 0) return reply({ error: MEALS_GONE }, 409)
    const row = await env.DB.prepare(`${SELECT_DISH} WHERE id = ?`).bind(id).first()
    return reply({ dish: rowToAdminDish(row) }, 201)
  }

  const dishMatch = path.match(/^\/api\/admin\/dishes\/([^/]{1,200})$/)
  if (dishMatch && (method === 'PUT' || method === 'DELETE')) {
    const id = decodeURIComponent(dishMatch[1])
    const existing = await env.DB.prepare('SELECT id FROM dishes WHERE id = ?').bind(id).first()
    if (!existing) return reply({ error: '没有这道菜（可能已经被别的管理员删了）' }, 404)
    // 至少留一道启用的通用菜（和导入的规则一致；Codex 第 28 轮）：网站把空菜单当作“没取到”，会退回显示旧菜。
    // 条件写在同一条 SQL 里，两个管理员同时停用最后两道菜时，后一条会被挡住。共享菜不算（没登录的人看不到）
    const LAST_ONE = '至少要留一道启用的通用菜，不然网站上就没有菜可选了。可以先加一道新菜，或者恢复一道暂停的菜'
    if (method === 'DELETE') {
      const res = await env.DB.prepare(
        `DELETE FROM dishes WHERE id = ? AND (enabled = 0 OR scope <> 'general' OR ${KEEP_ONE_GENERAL})`,
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
    const meals = JSON.stringify(checked.dish.meals)
    // 改和“没改成的原因”放在同一个 batch（同一个事务）里查：查到的就是改的那一刻的情况，
    // 不会因为别人在两次查询之间又改了餐次而提示错原因（Codex 第 39 轮）
    const [res, why] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE dishes SET name = ?, shop = ?, category = ?, meals = ?, tags = ?, price = ?, description = ?, image = ?, enabled = ?,
         updated_at = ?, updated_by = ?
         WHERE id = ? AND (? = 1 OR enabled = 0 OR scope <> 'general' OR ${KEEP_ONE_GENERAL}) AND ${MEALS_EXIST}`,
      ).bind(...dishParams(checked.dish), now, who.user.id, id, checked.dish.enabled ? 1 : 0, meals),
      env.DB.prepare(`SELECT EXISTS (SELECT 1 FROM dishes WHERE id = ?) AS found, ${MEALS_EXIST} AS meals_ok`).bind(id, meals),
    ])
    if (res.meta.changes === 0) {
      const { found, meals_ok: mealsOk } = why.results[0]
      if (!found) return reply({ error: '没有这道菜（可能已经被别的管理员删了）' }, 404)
      return reply({ error: mealsOk ? LAST_ONE : MEALS_GONE }, 409)
    }
    const row = await env.DB.prepare(`${SELECT_DISH} WHERE id = ?`).bind(id).first()
    return reply({ dish: rowToAdminDish(row, await authorNames(env, [row.author_id])) })
  }

  if (method === 'PUT' && path === '/api/admin/meals') {
    const body = await readJson(request, BODY_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '请求太大' }, 413)
    const { meals, errors } = validateExtraMeals(body?.labels)
    if (errors.length > 0) return reply({ error: errors.join('；') }, 400)
    // 去掉的餐次如果还有菜在用（通用、共享、用户自己的都算，Codex 第 37 轮），先不让去掉，告诉管理员是哪些菜
    const keepIds = mealIdsOf(meals)
    const inUse = await mealsInUse(env, keepIds, ['general', 'shared'])
    if (inUse) return reply({ error: `还有菜用着要去掉的餐次：${inUse}。先把这些菜的餐次改掉` }, 409)
    try {
      await env.DB.batch([
        mealGuard(env, keepIds, ['general', 'shared']),
        env.DB.prepare('DELETE FROM meal_types'),
        env.DB.prepare(
          `INSERT INTO meal_types (id, label, sort)
           SELECT json_extract(value, '$.id'), json_extract(value, '$.label'), CAST(key AS INTEGER) FROM json_each(?)`,
        ).bind(JSON.stringify(meals)),
      ])
    } catch (err) {
      if (isGuardHit(err)) return reply({ error: MEALS_RACE }, 409)
      throw err
    }
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

  // 只替换通用菜单（阶段 4-4）：共享菜是用户提交、审核过的，导入不能把它们冲掉。
  // 表格里的菜和共享菜重名时先不导入，请管理员处理（“品类 + 店铺”在两层之间也不能重复）
  const { results: existing } = await env.DB.prepare('SELECT id, name, shop, created_at, scope, author_id FROM dishes').all()
  const keyOf = (row) => `${row.name}\u0000${row.shop}`
  const sharedByKey = new Map(existing.filter((row) => row.scope === 'shared').map((row) => [keyOf(row), row]))
  dishes.forEach(({ dish, key }, index) => {
    if (sharedByKey.has(key)) {
      const label = dish.shop ? `${dish.name}（${dish.shop}）` : dish.name
      problems.push(`第 ${index + 1} 道菜“${label}”和用户提交的共享菜重复。先在管理页把那道共享菜改名、删掉或移到通用菜单`)
    }
  })
  // 表格的“餐次”页去掉了共享菜、用户自己的菜还在用的餐次：不导入（Codex 第 37 轮：那些菜导入后还留着，会抽不到）
  const inUse = await mealsInUse(env, mealIdsOf(meals), ['shared'])
  if (inUse) problems.push(`表格的“餐次”页少了还有菜在用的餐次：${inUse}。把那个餐次加回“餐次”页，或者先改掉那些菜`)
  if (problems.length > 0) return reply({ error: '表格有误', problems: problems.slice(0, 50) }, 400)
  const { results: userDishIds } = await env.DB.prepare('SELECT id FROM user_dishes').all()
  const takenIds = new Set([...existing.map((row) => row.id), ...userDishIds.map((row) => row.id)])
  const byKey = new Map(existing.filter((row) => row.scope !== 'shared').map((row) => [keyOf(row), row]))
  const usedIds = new Set()
  const rows = dishes.map(({ dish, key, legacyId }, index) => {
    const old = byKey.get(key)
    let id = old?.id
    // 用户的菜（u_ 开头）的编号留给它们审核通过时用，表格里的编号不能占
    const legacyOk = legacyId && !legacyId.startsWith('u_') && !usedIds.has(legacyId) && !takenIds.has(legacyId)
    if (!id) id = legacyOk ? legacyId : `d_${randomHex(8)}`
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
      // 沿用已有的菜时也沿用“谁提交的”（用户的菜审核通过、移到通用菜单后，导出再导入不能丢，Codex 第 38 轮）；
      // 只认数据库里的，不认表格
      author_id: old?.author_id ?? null,
    }
  })

  const batch = [
    mealGuard(env, mealIdsOf(meals), ['shared']),
    env.DB.prepare('DELETE FROM meal_types'),
    env.DB.prepare(
      `INSERT INTO meal_types (id, label, sort)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.label'), CAST(key AS INTEGER) FROM json_each(?)`,
    ).bind(JSON.stringify(meals)),
    env.DB.prepare("DELETE FROM dishes WHERE scope = 'general'"),
    env.DB.prepare(
      `INSERT INTO dishes (id, name, shop, category, meals, tags, price, description, image, enabled, sort, created_at, author_id, updated_at, updated_by)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.shop'),
              json_extract(value, '$.category'), json_extract(value, '$.meals'), json_extract(value, '$.tags'),
              json_extract(value, '$.price'), json_extract(value, '$.description'), json_extract(value, '$.image'),
              json_extract(value, '$.enabled'), json_extract(value, '$.sort'), json_extract(value, '$.created_at'),
              json_extract(value, '$.author_id'), ?, ?
       FROM json_each(?)`,
    ).bind(now, userId, JSON.stringify(rows)),
  ]
  try {
    await env.DB.batch(batch)
  } catch (err) {
    if (isGuardHit(err)) return reply({ error: MEALS_RACE }, 409)
    throw err
  }
  return reply({ ok: true, count: rows.length, enabled: rows.filter((r) => r.enabled === 1).length })
}
