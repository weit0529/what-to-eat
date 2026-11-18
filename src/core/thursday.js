// 周四特典（REQUIREMENTS.md R-033，用户 2026-11-18 选 1B、2A、3A、4B）：
// 每周四（按北京时间算，4B），每台手机当天第一次随机抽，一定抽到菜单里的“KFC”（2A）；之后再抽恢复正常。
// 哪道菜由后台告诉网页（菜单里的 thursdayPick，管理员可以关）；这里只管“今天是不是周四、今天用过没有”。
// 用过的日子存在这台手机的浏览器里；存不了（无痕模式等）就只记在这一页里，刷新后可能再来一次。

/** 北京时间比 UTC 早 8 小时（中国不用夏令时） */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const THURSDAY = 4

/** 存“哪天用过特典”的位置（每台手机一份，不跟账号走） */
export const THURSDAY_KEY = 'what-to-eat:thursday-kfc:v1'

/** 某个时刻在北京是哪一天：{ day: 'YYYY-MM-DD', weekday: 0（周日）～6 } */
export function beijingDay(ms) {
  const d = new Date(ms + BEIJING_OFFSET_MS)
  return { day: d.toISOString().slice(0, 10), weekday: d.getUTCDay() }
}

/** 某个时刻之后的下一个北京时间午夜（毫秒）。页面一直开着时，到点刷新“是不是周四”（Codex 第 52 轮） */
export function nextBeijingMidnight(ms) {
  const DAY = 24 * 60 * 60 * 1000
  return (Math.floor((ms + BEIJING_OFFSET_MS) / DAY) + 1) * DAY - BEIJING_OFFSET_MS
}

/**
 * 这次抽是不是该出特典：返回那道菜，不该出时返回 null。
 * @param {object|null} dish   特典那道菜（菜单里找到的；没有就是 null）
 * @param {number} now         现在的时间（毫秒）
 * @param {string} usedDay     这台手机上次用特典是北京时间哪天（没用过是空字符串）
 */
export function thursdaySpecial(dish, now, usedDay) {
  if (!dish) return null
  const { day, weekday } = beijingDay(now)
  return weekday === THURSDAY && usedDay !== day ? dish : null
}

/** 浏览器存不了时记在这里（整页共用，换菜单重建抽取页后也还在） */
let memoryDay = ''

/** 这台手机上次用特典是哪天 */
export function readUsedDay(storage) {
  try {
    const value = storage?.getItem(THURSDAY_KEY)
    if (typeof value === 'string') return value > memoryDay ? value : memoryDay
  } catch {
    // 读不了就看这一页里记的
  }
  return memoryDay
}

/** 记下今天（北京时间）用过特典了；浏览器存不了时记在这一页里 */
export function markUsed(storage, now) {
  const { day } = beijingDay(now)
  try {
    if (!storage) throw new Error('no storage')
    storage.setItem(THURSDAY_KEY, day)
  } catch {
    memoryDay = day
  }
}

/** 浏览器的 localStorage；拿不到时是 null */
export function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 测试用：清掉这一页里记的 */
export function resetMemory() {
  memoryDay = ''
}
