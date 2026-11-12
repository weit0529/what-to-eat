// 我的菜单、审核、加菜权限（阶段 4-4，REQUIREMENTS.md R-024、R-029）。
//
// 菜单三层（迁移 0006）：通用菜单（dishes.scope = 'general'，所有人）、共享菜（dishes.scope = 'shared'，登录用户）、
// 我的菜（user_dishes，只有自己）。审核通过时菜从 user_dishes 搬进 dishes，编号不变。
//
// 登录用户：
//   GET    /api/my/menu                   内部菜单 = 通用 + 共享 + 我的，格式和 /api/menu 一样，每道菜多一个 mine（是不是我加的）
//   GET    /api/my/dishes                 我的菜（含审核状态、退回理由）、我提交且已通过的共享菜、我现在能不能加改菜
//   POST   /api/my/dishes                 加一道菜（马上能用，只有自己看得到）
//   PUT    /api/my/dishes/:id             改（审核中的不能改）
//   DELETE /api/my/dishes/:id             删（审核中的不能删）
//   POST   /api/my/dishes/:id/submit      提交审核（提交后锁住）
// 管理员：
//   GET    /api/admin/reviews             待审核的菜（标出和已有的菜重名的）
//   POST   /api/admin/reviews/:id/approve 通过，可以带 { dish } 先改再通过；通过后变共享菜
//   POST   /api/admin/reviews/:id/reject  退回 { note }（要写理由）
//   POST   /api/admin/dishes/:id/promote  共享菜移到通用菜单
//   GET    /api/admin/dish-access         加菜总开关、每个普通用户在不在黑白名单里
//   PUT    /api/admin/dish-access         改总开关 { open }
//   PUT    /api/admin/dish-access/:userId 把用户放进黑名单 / 白名单 / 拿出来 { list: 'black' | 'white' | null }
//
// 加菜权限（R-029）：总开关打开时所有用户能加改，黑名单除外；关上时谁都不能，白名单除外；管理员不受限。
// 被禁止的人已加的菜照常能用（在内部菜单里），只是不能加、改、删、提交。

import { isUploadedImage, validateDish } from '../../../src/core/menu-data.js'
import { randomHex } from './auth.js'
import { json, readJson, TOO_LARGE } from './http.js'
import { allMeals, checkDish, dishParams, extraMeals, mealIdsOf, MEALS_EXIST, requireAdmin, rowToItem, SELECT_DISH } from './menu-api.js'
import { dishEditLimits, takeQuotas } from './send-limits.js'

const MENU_FORMAT_VERSION = 2
const BODY_LIMIT = 16 * 1024
const NOTE_MAX = 200
const CLOSED = '管理员暂时关闭了加菜'
const MEALS_CHANGED = '管理员刚改了餐次，你选的餐次有的已经没有了。刷新一下再填'
const STALE = '这道菜刚被改过或重新提交了（或者别的管理员刚处理过），刷新后再审'

const SELECT_USER_DISH =
  'SELECT id, owner_id, name, shop, category, meals, tags, price, description, image, status, revision, review_note, submitted_at, reviewed_at, created_at, updated_at FROM user_dishes'

/** 我的菜 → 网页菜单里的一道菜（和 rowToItem 同样的格式） */
function userRowToItem(row) {
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
    source: 'mine',
    owner: row.owner_id,
    status: row.status,
    mine: true,
  }
}

/** 账号页“我的菜”列表里的一道菜 */
function userRowToMyDish(row) {
  const { source, owner, mine, ...item } = userRowToItem(row)
  return { ...item, reviewNote: row.review_note, submittedAt: row.submitted_at, updatedAt: row.updated_at }
}

/** 当前登录的用户（任何角色）；没登录返回 null */
export async function currentUser(request, auth) {
  const session = await auth.api.getSession({ headers: request.headers })
  return session?.user ?? null
}

/** 加菜总开关是不是开着（没设置过就是开着） */
async function isOpen(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'user_dishes_open'").first()
  return row?.value !== '0'
}

/** 这个用户现在能不能加、改、删、提交菜（也管能不能传图片，images-api.js） */
export async function canEdit(env, user) {
  if (user.role === 'admin') return true
  const row = await env.DB.prepare('SELECT list FROM dish_access WHERE user_id = ?').bind(user.id).first()
  return (await isOpen(env)) ? row?.list !== 'black' : row?.list === 'white'
}

/**
 * 检查用户填的菜：规则和管理员一样（validateDish）；图片只能用自己在线上传的（4-4d，R-030），
 * 不能用随网站发布的图片，也不能用别人传的。
 * 自己的菜里不能有两道“品类 + 店铺”一样的。和通用菜单、共享菜重名可以（审核时提示）
 */
async function checkMyDish(env, userId, input, exceptId) {
  const extra = await extraMeals(env)
  const { dish, errors } = validateDish({ ...(input && typeof input === 'object' ? input : {}), enabled: true }, {
    mealIds: mealIdsOf(extra),
  })
  if (!dish) return { errors }
  if (dish.image) {
    const own = isUploadedImage(dish.image)
      ? await env.DB.prepare('SELECT 1 FROM images WHERE name = ? AND owner_id = ?').bind(dish.image, userId).first()
      : null
    if (!own) return { errors: [{ field: 'image', message: '只能用自己上传的图片' }] }
  }
  const dup = await env.DB.prepare('SELECT id FROM user_dishes WHERE owner_id = ? AND name = ? AND shop = ? AND id <> ?')
    .bind(userId, dish.name, dish.shop ?? '', exceptId ?? '')
    .first()
  if (dup) return { errors: [{ field: 'name', message: '你已经加过这道菜了（品类和店铺都一样）' }] }
  return { dish }
}

/**
 * 处理我的菜单、审核、加菜权限的接口；不是这些接口返回 null。
 */
export async function myMenuRoute(method, path, request, env, getAuth, now, started, cors) {
  const reply = (body, status = 200) => json(body, status, started, cors)

  if (path.startsWith('/api/my/')) return myRoute(method, path, request, env, getAuth(), now, reply)

  const isAdminPath =
    path === '/api/admin/reviews' ||
    path.startsWith('/api/admin/reviews/') ||
    path === '/api/admin/dish-access' ||
    path.startsWith('/api/admin/dish-access/') ||
    /^\/api\/admin\/dishes\/[^/]{1,200}\/promote$/.test(path)
  if (!isAdminPath) return null

  const who = await requireAdmin(request, getAuth())
  if (who.error) return reply({ error: who.error }, who.status)
  return adminRoute(method, path, request, env, who.user, now, reply)
}

async function myRoute(method, path, request, env, auth, now, reply) {
  const user = await currentUser(request, auth)
  if (!user) return reply({ error: '请先登录' }, 401)

  if (method === 'GET' && path === '/api/my/menu') {
    const extra = await extraMeals(env)
    const { results: dishes } = await env.DB.prepare(
      `${SELECT_DISH} WHERE enabled = 1 ORDER BY CASE scope WHEN 'general' THEN 0 ELSE 1 END, sort, created_at`,
    ).all()
    const { results: mine } = await env.DB.prepare(`${SELECT_USER_DISH} WHERE owner_id = ? ORDER BY created_at`).bind(user.id).all()
    const items = [
      // 我提交、审核通过的菜：不管还在共享菜里，还是已经被移到通用菜单，都算“我加的”（Codex 第 37 轮）
      ...dishes.map((row) => ({ ...rowToItem(row), mine: row.author_id === user.id })),
      ...mine.map(userRowToItem),
    ]
    return reply({ version: MENU_FORMAT_VERSION, meals: allMeals(extra), items })
  }

  if (method === 'GET' && path === '/api/my/dishes') {
    const { results: mine } = await env.DB.prepare(`${SELECT_USER_DISH} WHERE owner_id = ? ORDER BY created_at DESC`).bind(user.id).all()
    const { results: shared } = await env.DB.prepare(
      `${SELECT_DISH} WHERE author_id = ? ORDER BY created_at DESC`,
    )
      .bind(user.id)
      .all()
    const allowed = await canEdit(env, user)
    return reply({
      canEdit: allowed,
      reason: allowed ? null : CLOSED,
      dishes: mine.map(userRowToMyDish),
      // 我提交、审核通过的菜（共享菜，或已被移到通用菜单）：归管理员管了，这里只显示，不能改
      approved: shared.map((row) => ({ ...rowToItem(row), enabled: row.enabled === 1, scope: row.scope })),
    })
  }

  const isWrite =
    (method === 'POST' && path === '/api/my/dishes') ||
    /^\/api\/my\/dishes\/[^/]{1,200}(\/submit)?$/.test(path)
  if (!isWrite) return reply({ error: '没有这个接口' }, 404)

  // 先看权限，再数次数（被禁止的人不占次数）
  if (!(await canEdit(env, user))) return reply({ error: CLOSED }, 403)
  if (!(await takeQuotas(env, dishEditLimits(user.id), now))) return reply({ error: '改得太快了，请过一分钟再试' }, 429)

  if (method === 'POST' && path === '/api/my/dishes') {
    const body = await readJson(request, BODY_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '请求太大' }, 413)
    const checked = await checkMyDish(env, user.id, body)
    if (checked.errors) return reply({ error: '填写有误', errors: checked.errors }, 400)
    const id = `u_${randomHex(8)}`
    const [name, shop, category, meals, tags, price, description, image] = dishParams(checked.dish)
    try {
      // 写入时再确认一次餐次都还在（检查和写入之间管理员可能刚删了餐次）
      const res = await env.DB.prepare(
        `INSERT INTO user_dishes (id, owner_id, name, shop, category, meals, tags, price, description, image, status, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, ? WHERE ${MEALS_EXIST}`,
      )
        .bind(id, user.id, name, shop, category, meals, tags, price, description, image, now, now, meals)
        .run()
      if (res.meta.changes === 0) return reply({ error: MEALS_CHANGED }, 409)
    } catch (err) {
      // 两个请求同时加同一道菜：唯一约束挡住后一个
      if (/unique/i.test(String(err?.message))) return reply({ error: '你已经加过这道菜了（品类和店铺都一样）' }, 409)
      throw err
    }
    const row = await env.DB.prepare(`${SELECT_USER_DISH} WHERE id = ?`).bind(id).first()
    return reply({ dish: userRowToMyDish(row) }, 201)
  }

  const match = path.match(/^\/api\/my\/dishes\/([^/]{1,200})(\/submit)?$/)
  const id = decodeURIComponent(match[1])
  const submit = Boolean(match[2])
  // 改、删、提交都只对自己的、不在审核中的菜有效；条件写在同一条 SQL 里，和管理员审核同时发生也不会乱
  const explain = async () => {
    const row = await env.DB.prepare('SELECT status FROM user_dishes WHERE id = ? AND owner_id = ?').bind(id, user.id).first()
    if (!row) return reply({ error: '没有这道菜（可能已经删了，或者已经审核通过）' }, 404)
    if (row.status === 'pending') return reply({ error: '这道菜在审核中，等管理员处理完才能改' }, 409)
    return reply({ error: MEALS_CHANGED }, 409)
  }

  if (submit && method === 'POST') {
    const res = await env.DB.prepare(
      `UPDATE user_dishes SET status = 'pending', revision = revision + 1, submitted_at = ?, review_note = NULL, reviewed_at = NULL, updated_at = ?
       WHERE id = ? AND owner_id = ? AND status IN ('private', 'rejected')`,
    )
      .bind(now, now, id, user.id)
      .run()
    if (res.meta.changes === 0) return explain()
    const row = await env.DB.prepare(`${SELECT_USER_DISH} WHERE id = ?`).bind(id).first()
    return reply({ dish: userRowToMyDish(row) })
  }

  if (!submit && method === 'DELETE') {
    const res = await env.DB.prepare("DELETE FROM user_dishes WHERE id = ? AND owner_id = ? AND status <> 'pending'")
      .bind(id, user.id)
      .run()
    if (res.meta.changes === 0) return explain()
    return reply({ ok: true })
  }

  if (!submit && method === 'PUT') {
    const body = await readJson(request, BODY_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '请求太大' }, 413)
    const checked = await checkMyDish(env, user.id, body, id)
    if (checked.errors) return reply({ error: '填写有误', errors: checked.errors }, 400)
    const [name, shop, category, meals, tags, price, description, image] = dishParams(checked.dish)
    let res
    try {
      res = await env.DB.prepare(
        `UPDATE user_dishes SET name = ?, shop = ?, category = ?, meals = ?, tags = ?, price = ?, description = ?, image = ?,
                                revision = revision + 1, updated_at = ?
         WHERE id = ? AND owner_id = ? AND status <> 'pending' AND ${MEALS_EXIST}`,
      )
        .bind(name, shop, category, meals, tags, price, description, image, now, id, user.id, meals)
        .run()
    } catch (err) {
      if (/unique/i.test(String(err?.message))) return reply({ error: '你已经加过这道菜了（品类和店铺都一样）' }, 409)
      throw err
    }
    if (res.meta.changes === 0) return explain()
    const row = await env.DB.prepare(`${SELECT_USER_DISH} WHERE id = ?`).bind(id).first()
    return reply({ dish: userRowToMyDish(row) })
  }

  return reply({ error: '没有这个接口' }, 404)
}

async function adminRoute(method, path, request, env, admin, now, reply) {
  if (method === 'GET' && path === '/api/admin/reviews') {
    const { results } = await env.DB.prepare(
      `SELECT ud.id, ud.owner_id, ud.name, ud.shop, ud.category, ud.meals, ud.tags, ud.price, ud.description, ud.image, ud.status, ud.revision,
              ud.review_note, ud.submitted_at, ud.reviewed_at, ud.created_at, ud.updated_at,
              u.displayUsername AS author,
              (SELECT d.id FROM dishes d WHERE d.name = ud.name AND d.shop = ud.shop) AS duplicate_id
       FROM user_dishes ud LEFT JOIN "user" u ON u.id = ud.owner_id
       WHERE ud.status = 'pending' ORDER BY ud.submitted_at`,
    ).all()
    return reply({
      reviews: results.map((row) => {
        const { owner, mine, ...item } = userRowToItem(row)
        return {
          ...item,
          revision: row.revision,
          author: row.author ?? '（已删除的用户）',
          submittedAt: row.submitted_at,
          duplicate: Boolean(row.duplicate_id),
        }
      }),
    })
  }

  const review = path.match(/^\/api\/admin\/reviews\/([^/]{1,200})\/(approve|reject)$/)
  if (review && method === 'POST') {
    const id = decodeURIComponent(review[1])
    const body = await readJson(request, BODY_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '请求太大' }, 413)
    // 管理员看到的是哪一版：通过、退回都只对这一版有效（Codex 第 37 轮）
    const revision = body?.revision
    if (!Number.isInteger(revision)) return reply({ error: '页面太旧了，刷新后再审' }, 400)
    const current = await env.DB.prepare(`${SELECT_USER_DISH} WHERE id = ? AND status = 'pending'`).bind(id).first()
    if (!current) return reply({ error: '没有这道待审核的菜（可能别的管理员已经处理了）' }, 404)
    if (current.revision !== revision) return reply({ error: STALE }, 409)
    const row = current

    if (review[2] === 'reject') {
      const note = typeof body?.note === 'string' ? body.note.trim() : ''
      if (!note) return reply({ error: '退回要写一句理由' }, 400)
      if ([...note].length > NOTE_MAX) return reply({ error: `理由最多 ${NOTE_MAX} 个字` }, 400)
      const res = await env.DB.prepare(
        "UPDATE user_dishes SET status = 'rejected', review_note = ?, reviewed_at = ? WHERE id = ? AND status = 'pending' AND revision = ?",
      )
        .bind(note, now, id, revision)
        .run()
      if (res.meta.changes === 0) return reply({ error: STALE }, 409)
      return reply({ ok: true })
    }

    // 通过：管理员可以先改（body.dish），不改就用用户填的
    const input = body?.dish && typeof body.dish === 'object' ? body.dish : userRowToItem(row)
    const checked = await checkDish(env, input, id)
    if (checked.errors) {
      return reply({ error: '填写有误，或者和已有的菜重名（品类和店铺都一样），先改个名字再通过', errors: checked.errors }, 400)
    }
    let results
    try {
      // 一个事务里：搬进 dishes（编号不变）、从 user_dishes 删掉；两个管理员同时通过，只有一个成功
      results = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO dishes (name, shop, category, meals, tags, price, description, image, enabled,
                              id, sort, created_at, updated_at, updated_by, scope, author_id)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ud.id, (SELECT COALESCE(MAX(sort), 0) + 1 FROM dishes), ?, ?, ?, 'shared', ud.owner_id
           FROM user_dishes ud WHERE ud.id = ? AND ud.status = 'pending' AND ud.revision = ? AND ${MEALS_EXIST}`,
        ).bind(...dishParams(checked.dish), now, now, admin.id, id, revision, JSON.stringify(checked.dish.meals)),
        env.DB.prepare(
          "DELETE FROM user_dishes WHERE id = ? AND status = 'pending' AND revision = ? AND EXISTS (SELECT 1 FROM dishes WHERE id = ?)",
        ).bind(id, revision, id),
      ])
    } catch (err) {
      if (/unique|constraint/i.test(String(err?.message))) {
        return reply({ error: '和已有的菜重名（品类和店铺都一样），或者别的管理员刚处理了这道菜' }, 409)
      }
      throw err
    }
    // 一条都没搬：这期间被处理了、被改了版本，或者餐次刚被删了
    if (results[0].meta.changes === 0) return reply({ error: STALE }, 409)
    const dish = await env.DB.prepare(`${SELECT_DISH} WHERE id = ?`).bind(id).first()
    return reply({ dish: { ...rowToItem(dish), enabled: dish.enabled === 1 } })
  }

  const promote = path.match(/^\/api\/admin\/dishes\/([^/]{1,200})\/promote$/)
  if (promote && method === 'POST') {
    const id = decodeURIComponent(promote[1])
    const res = await env.DB.prepare(
      "UPDATE dishes SET scope = 'general', updated_at = ?, updated_by = ? WHERE id = ? AND scope = 'shared'",
    )
      .bind(now, admin.id, id)
      .run()
    if (res.meta.changes === 0) return reply({ error: '没有这道共享菜（可能已经移过了，或者被删了）' }, 404)
    return reply({ ok: true })
  }

  if (method === 'GET' && path === '/api/admin/dish-access') {
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.displayUsername AS username, u.email, a.list,
              -- 加过的菜：还在自己手里的 + 审核通过、变成共享菜（或已移到通用菜单）的
              (SELECT COUNT(*) FROM user_dishes WHERE owner_id = u.id) + (SELECT COUNT(*) FROM dishes WHERE author_id = u.id) AS dish_count
       FROM "user" u LEFT JOIN dish_access a ON a.user_id = u.id
       WHERE u.role IS NULL OR u.role <> 'admin'
       ORDER BY u.createdAt`,
    ).all()
    return reply({
      open: await isOpen(env),
      users: results.map((row) => ({ id: row.id, username: row.username, email: row.email, list: row.list ?? null, dishCount: row.dish_count })),
    })
  }

  if (method === 'PUT' && path === '/api/admin/dish-access') {
    const body = await readJson(request, BODY_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '请求太大' }, 413)
    if (typeof body?.open !== 'boolean') return reply({ error: '格式不对' }, 400)
    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('user_dishes_open', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
      .bind(body.open ? '1' : '0', now, admin.id)
      .run()
    return reply({ open: body.open })
  }

  const access = path.match(/^\/api\/admin\/dish-access\/([^/]{1,100})$/)
  if (access && method === 'PUT') {
    const userId = decodeURIComponent(access[1])
    const body = await readJson(request, BODY_LIMIT)
    if (body === TOO_LARGE) return reply({ error: '请求太大' }, 413)
    const list = body?.list ?? null
    if (list !== null && list !== 'black' && list !== 'white') return reply({ error: '格式不对' }, 400)
    const target = await env.DB.prepare('SELECT id, role FROM "user" WHERE id = ?').bind(userId).first()
    if (!target) return reply({ error: '没有这个用户' }, 404)
    if (target.role === 'admin') return reply({ error: '管理员不受加菜开关限制，不用放进名单' }, 400)
    if (list === null) {
      await env.DB.prepare('DELETE FROM dish_access WHERE user_id = ?').bind(userId).run()
    } else {
      await env.DB.prepare(
        `INSERT INTO dish_access (user_id, list, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET list = excluded.list, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
        .bind(userId, list, now, admin.id)
        .run()
    }
    return reply({ ok: true, list })
  }

  return reply({ error: '没有这个接口' }, 404)
}
