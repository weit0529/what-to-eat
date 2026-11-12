// 菜的图片上传和转发（阶段 4-4d，REQUIREMENTS.md R-030）。图片存 Cloudflare R2（绑定名 IMAGES）。
//
//   POST /api/images        要登录、有加菜权限（管理员不受限）。请求体就是图片本身（网页已压缩成 webp / jpg，≤ 300 KB）。
//                           返回 { image: 'up_….webp' }，填进菜的 image 字段
//   GET  /api/images/:name  公开，转发 R2 里的图片（R2 自带的 r2.dev 网址在大陆很可能连不上，所以经 pages.dev 转发）
//   GET  /api/admin/storage 管理员看图片存储用了多少（免费额度 10 GB，按上传记录加总），管理页“菜单”顶上的进度条用（用户 2026-11-12 提议）
//
// 图片地址不带登录凭证（<img> 发不了 Authorization 头），“审核通过前只有自己看得到”靠随机文件名：
// 32 位十六进制猜不出来，只有上传的人、审核的管理员知道。
// 只认图片文件头（jpg / png / webp），不收 svg 等可能带脚本的格式；回图片时加 nosniff，浏览器不会当成网页。

import { randomHex } from './auth.js'
import { json, readBody, TOO_LARGE } from './http.js'
import { UPLOADED_IMAGE_RE } from '../../../src/core/menu-data.js'
import { requireAdmin } from './menu-api.js'
import { canEdit, currentUser } from './my-menu-api.js'
import { IMAGE_DAILY_TOTAL, IMAGE_TOTAL_WINDOW_MS, imageLimits, takeQuotas } from './send-limits.js'

/** 一张图最大多少字节（网页压缩到 200 KB 左右，留点余量） */
export const IMAGE_MAX_BYTES = 300 * 1024

/**
 * R2 免费额度：每月 10 GB 存储。Cloudflare 说的 GB 是十进制（10⁹ 字节，Codex 第 43 轮：原来按 1024³ 算，百分比偏低约 7%）。
 * 这里只是当前存了多少，不是月度账单（账单按每天峰值的月平均算，还有操作次数）
 */
export const R2_FREE_BYTES = 10 * 1000 ** 3

/**
 * 用了多少：按 images 表里的上传记录加总（Codex 第 43 轮：原来一页页列 R2 文件，图片多时只数得了前 2 万张，
 * 永远算不到 80%；而且每次打开管理页都要花 R2 的操作次数）。
 * 上传时先写记录再存文件，存失败会删记录；极少数删记录也失败的，会多算一点（宁可多算，提醒早一点）
 */
async function storageUsage(env) {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS used, COUNT(*) AS objects FROM images').first()
  return { usedBytes: row.used, objects: row.objects }
}

/** 看文件头认图片格式；不是这三种返回 null */
function sniff(bytes) {
  const b = bytes
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' }
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { ext: 'png', type: 'image/png' }
  }
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to))
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' }
  return null
}

/**
 * 处理图片接口；不是这些接口返回 null。
 */
export async function imagesRoute(method, path, request, env, getAuth, now, started, cors) {
  const reply = (body, status = 200) => json(body, status, started, cors)

  const get = path.match(/^\/api\/images\/([^/]{1,100})$/)
  if (get && method === 'GET') {
    const name = get[1]
    if (!UPLOADED_IMAGE_RE.test(name)) return reply({ error: '没有这张图片' }, 404)
    if (!env.IMAGES) return reply({ error: '图片存储还没开通' }, 503)
    const object = await env.IMAGES.get(name)
    if (!object) return reply({ error: '没有这张图片' }, 404)
    return new Response(object.body, {
      status: 200,
      headers: {
        'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
        // 文件名是随机的、内容不会变，可以一直缓存
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'",
        // 图片是公开的：任何网页都能读，不按来源区分（按来源给的话，浏览器缓存里的那份可能不带这个头）
        'access-control-allow-origin': '*',
      },
    })
  }

  if (path === '/api/admin/storage') {
    if (method !== 'GET') return reply({ error: '没有这个接口' }, 404)
    const who = await requireAdmin(request, getAuth())
    if (who.error) return reply({ error: who.error }, who.status)
    if (!env.IMAGES) return reply({ available: false, limitBytes: R2_FREE_BYTES })
    const usage = await storageUsage(env)
    // 全站“一天 1000 次”的防刷计数（send-limits.js 的 img-total）：从这一轮第一次上传起算 24 小时，
    // 传失败的也算（Codex 第 43 轮：网页上照实说“上传次数”，不说成“已传几张”）；这一轮过了就是 0
    const row = await env.DB.prepare("SELECT count, window_start FROM send_limits WHERE key = 'img-total'").first()
    const active = row && now - row.window_start < IMAGE_TOTAL_WINDOW_MS
    return reply({
      available: true,
      limitBytes: R2_FREE_BYTES,
      ...usage,
      uploadAttempts: active ? row.count : 0,
      uploadLimit: IMAGE_DAILY_TOTAL,
      uploadResetsAt: active ? row.window_start + IMAGE_TOTAL_WINDOW_MS : null,
    })
  }

  if (path !== '/api/images') return null
  if (method !== 'POST') return reply({ error: '没有这个接口' }, 404)

  const user = await currentUser(request, getAuth())
  if (!user) return reply({ error: '请先登录' }, 401)
  if (!(await canEdit(env, user))) return reply({ error: '管理员暂时关闭了加菜' }, 403)
  if (!env.IMAGES) return reply({ error: '图片存储还没开通，暂时不能传图片' }, 503)

  // 先读、先认格式，再占次数：传错文件不白占名额
  const bytes = await readBody(request, IMAGE_MAX_BYTES)
  if (bytes === TOO_LARGE) return reply({ error: `图片太大了（最大 ${IMAGE_MAX_BYTES / 1024} KB）` }, 413)
  if (bytes === null || bytes.length === 0) return reply({ error: '没收到图片' }, 400)
  const kind = sniff(bytes)
  if (!kind) return reply({ error: '只能传 jpg、png、webp 图片' }, 400)
  if (!(await takeQuotas(env, imageLimits(user.id), now))) return reply({ error: '传得太多了，请过一会儿再试' }, 429)

  const name = `up_${randomHex(16)}.${kind.ext}`
  // 先记“谁传的”，再存图片（Codex 第 41 轮：反过来的话，存图成功、记录失败会在 R2 里留下查不到是谁的文件）。
  // 存图失败就把记录删掉；万一删也失败，留下的是“有记录、没文件”，读图回 404，记录能查到、能清理
  await env.DB.prepare('INSERT INTO images (name, owner_id, content_type, size, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(name, user.id, kind.type, bytes.length, now)
    .run()
  try {
    await env.IMAGES.put(name, bytes, { httpMetadata: { contentType: kind.type } })
  } catch (err) {
    console.error('图片存进 R2 失败', name, err)
    await env.DB.prepare('DELETE FROM images WHERE name = ?')
      .bind(name)
      .run()
      .catch((delErr) => console.error('删掉没存成的图片记录也失败了', name, delErr))
    return reply({ error: '图片没存上，请稍后再试' }, 502)
  }
  return reply({ image: name }, 201)
}
