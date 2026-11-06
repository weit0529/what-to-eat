// 把“最近吃过的”记录存在本机浏览器（localStorage）里。
//
// 记录只在这台设备的这个浏览器里：换手机、换浏览器、清理浏览器数据后就没了（用户 2026-11-05 知悉）。
// 有些情况下浏览器不让存（无痕模式、禁用了网站数据），这时读写都不报错，只是存不住，
// 页面会提示“这个浏览器存不了记录”。

import { pruneRecords } from '../core/eaten.js'

/** 存储用的名字。以后改了记录格式就换个版本号 */
export const STORAGE_KEY = 'what-to-eat:eaten:v1'

/** 拿到浏览器的 localStorage；拿不到（被禁用、不在浏览器里）返回 null */
export function getStorage() {
  try {
    const storage = globalThis.localStorage
    // 有的浏览器能拿到对象但一写就报错，试写一次
    const probe = `${STORAGE_KEY}:probe`
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

/** 读记录。没有、读不了、格式坏了都返回空列表 */
export function loadRecords(storage = getStorage()) {
  if (!storage) return []
  try {
    const text = storage.getItem(STORAGE_KEY)
    return text ? pruneRecords(JSON.parse(text)) : []
  } catch {
    return []
  }
}

/** 存记录。存成功返回 true，存不了返回 false（不报错） */
export function saveRecords(records, storage = getStorage()) {
  if (!storage) return false
  try {
    if (records.length === 0) storage.removeItem(STORAGE_KEY)
    else storage.setItem(STORAGE_KEY, JSON.stringify(records))
    return true
  } catch {
    return false
  }
}
