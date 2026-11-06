// “最近吃过的”记录：点了“就吃这个”的菜记一条，推荐和抽取时避开最近几天吃过的。
//
// 规则（用户 2026-11-05 决定 5A、6A、7A，见 REQUIREMENTS.md 第 10 节）：
// - 点“✅ 就吃这个”才记一次（抽中不算）
// - “最近”= 最近 3 天，按日历算：今天、昨天、前天吃过的都算
// - 随机抽和分析推荐都避开；小名单不避开（由页面决定）
//
// 这里只做纯计算。记录存在哪里（本机浏览器）见 src/ui/eaten-store.js。
// 一条记录：{ id: 菜品 id, label: 显示用的名字, at: 记录时间（ISO 字符串） }

/** 多少天内算“最近”（含今天） */
export const RECENT_DAYS = 3

/** 记录最多保留多少天、多少条，超出的自动丢掉，免得越存越多 */
export const KEEP_DAYS = 30
export const MAX_RECORDS = 200

const DAY_MS = 24 * 60 * 60 * 1000

/** 当天 0 点（本地时间） */
function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 从 now 往前数 days 天（含今天）的起点 */
function windowStart(now, days) {
  const start = startOfDay(now)
  start.setDate(start.getDate() - (days - 1))
  return start
}

/** 记录格式是否正确（从浏览器读回来的数据可能被改坏） */
export function isValidRecord(record) {
  return (
    record !== null &&
    typeof record === 'object' &&
    typeof record.id === 'string' &&
    record.id !== '' &&
    typeof record.at === 'string' &&
    !Number.isNaN(Date.parse(record.at))
  )
}

/**
 * 整理记录：丢掉格式不对的、太旧的（超过 KEEP_DAYS 天），最多留最新的 MAX_RECORDS 条；按时间从旧到新排。
 */
export function pruneRecords(records, now = new Date()) {
  const oldest = windowStart(now, KEEP_DAYS).getTime()
  return (Array.isArray(records) ? records : [])
    .filter(isValidRecord)
    .filter((r) => Date.parse(r.at) >= oldest)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-MAX_RECORDS)
}

/** 记录时间比现在晚超过这么久，就当作手机时间有误，不算最近（用户 2026-11-05 决定） */
export const FUTURE_TOLERANCE_MS = DAY_MS

/**
 * 最近 days 天（含今天）的记录，从新到旧。
 * 时间比现在晚 1 天以内的（手机时间有点快）也算；晚超过 1 天的当作时间有误，不算。
 */
export function recentRecords(records, now = new Date(), days = RECENT_DAYS) {
  const start = windowStart(now, days).getTime()
  const latest = new Date(now).getTime() + FUTURE_TOLERANCE_MS
  return pruneRecords(records, now)
    .filter((r) => Date.parse(r.at) >= start && Date.parse(r.at) <= latest)
    .reverse()
}

/** 最近吃过的菜品 id（去重） */
export function recentIds(records, now = new Date(), days = RECENT_DAYS) {
  return [...new Set(recentRecords(records, now, days).map((r) => r.id))]
}

/** 这道菜今天有没有记过 */
export function eatenToday(records, id, now = new Date()) {
  return recentRecords(records, now, 1).some((r) => r.id === id)
}

/** 记一条“吃了这道菜”，返回新的记录列表（不改原数组） */
export function addRecord(records, item, now = new Date()) {
  const label = item.shop ? `${item.name} · ${item.shop}` : item.name
  return pruneRecords([...(Array.isArray(records) ? records : []), { id: item.id, label, at: new Date(now).toISOString() }], now)
}

/**
 * 撤销：去掉这道菜今天最新的一条记录，返回新的记录列表。
 * 和 eatenToday 用同样的时间范围：比现在晚超过 1 天的记录（时间有误）不动（Codex 第 14 轮）
 */
export function removeToday(records, id, now = new Date()) {
  const list = pruneRecords(records, now)
  const todayStart = startOfDay(now).getTime()
  const latest = new Date(now).getTime() + FUTURE_TOLERANCE_MS
  for (let i = list.length - 1; i >= 0; i--) {
    const t = Date.parse(list[i].at)
    if (list[i].id === id && t >= todayStart && t <= latest) {
      return [...list.slice(0, i), ...list.slice(i + 1)]
    }
  }
  return list
}

/** 显示用：今天 / 昨天 / 前天 / N 天前 */
export function describeDay(at, now = new Date()) {
  const diff = Math.round((startOfDay(now).getTime() - startOfDay(at).getTime()) / DAY_MS)
  if (diff <= 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff === 2) return '前天'
  return `${diff} 天前`
}
