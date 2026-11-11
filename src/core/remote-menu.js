// 从后台读菜单（阶段 4-2，REQUIREMENTS.md R-020、R-026）。网站打开时用，发布时的脚本（scripts/prepare-menu.js）也用。
// 后台返回的内容要检查格式；格式不对、一道菜都没有、连不上、太慢，都当作“没取到”，网站继续用内置菜单。

/** 网页数据的格式版本（和 scripts/build-menu.js 的 MENU_FORMAT_VERSION 一致） */
export const MENU_FORMAT_VERSION = 2

const isText = (v) => typeof v === 'string'

/** 后台返回的菜单格式对不对（不对就不用它） */
export function isValidMenu(data) {
  return Boolean(
    data &&
      data.version === MENU_FORMAT_VERSION &&
      Array.isArray(data.meals) &&
      data.meals.length >= 3 &&
      data.meals.every((m) => m && isText(m.id) && isText(m.label)) &&
      Array.isArray(data.items) &&
      data.items.length > 0 &&
      data.items.every(
        (item) =>
          item &&
          isText(item.id) &&
          isText(item.name) &&
          isText(item.category) &&
          Array.isArray(item.meals) &&
          Array.isArray(item.tags),
      ),
  )
}

/**
 * 从后台取菜单。成功返回 { menu }，失败返回 { menu: null, reason }，不会抛错。
 * @param {string} url  后台的 /api/menu 地址
 */
export async function fetchMenu(url, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { menu: null, reason: `后台返回 HTTP ${res.status}` }
    const data = await res.json()
    if (!isValidMenu(data)) return { menu: null, reason: '后台返回的菜单格式不对，或者一道菜都没有' }
    return { menu: { version: data.version, meals: data.meals, items: data.items }, reason: '' }
  } catch (err) {
    return { menu: null, reason: `连不上后台（${err?.message || err}）` }
  }
}
