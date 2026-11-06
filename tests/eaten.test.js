// 阶段 3：“最近吃过的”记录（src/core/eaten.js、src/ui/eaten-store.js）
import { describe, it, expect } from 'vitest'
import {
  RECENT_DAYS,
  KEEP_DAYS,
  MAX_RECORDS,
  pruneRecords,
  recentRecords,
  recentIds,
  eatenToday,
  addRecord,
  removeToday,
  describeDay,
} from '../src/core/eaten.js'
import { loadRecords, saveRecords, STORAGE_KEY } from '../src/ui/eaten-store.js'

// 2026-11-05 晚上 8 点（本地时间）
const NOW = new Date(2026, 10, 5, 20, 0)
const at = (dayOffset, hour = 12) => new Date(2026, 10, 5 + dayOffset, hour, 0).toISOString()
const rec = (id, dayOffset, hour) => ({ id, label: id, at: at(dayOffset, hour) })

/** 内存里的假 localStorage */
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  }
}

describe('最近 3 天（按日历：今天、昨天、前天）', () => {
  it(`RECENT_DAYS 是 ${RECENT_DAYS}`, () => {
    expect(RECENT_DAYS).toBe(3)
  })

  it('今天、昨天、前天的算最近；大前天的不算，哪怕只差几个小时', () => {
    const records = [rec('今天', 0, 8), rec('昨天', -1, 23), rec('前天', -2, 0), rec('大前天', -3, 23)]
    expect(recentIds(records, NOW)).toEqual(['今天', '昨天', '前天'])
  })

  it('最近的记录从新到旧；同一道菜吃了几次，id 只出现一次', () => {
    const records = [rec('a', -2), rec('b', -1), rec('a', 0)]
    expect(recentRecords(records, NOW).map((r) => r.id)).toEqual(['a', 'b', 'a'])
    expect(recentIds(records, NOW)).toEqual(['a', 'b'])
  })

  it('时间比现在晚 1 天以内的算最近；晚超过 1 天的当作手机时间有误，不算', () => {
    expect(recentIds([rec('明天中午', 1)], NOW)).toEqual(['明天中午']) // 晚 16 小时
    expect(recentIds([rec('后天', 2)], NOW)).toEqual([]) // 晚 40 小时
    expect(recentIds([rec('明天深夜', 1, 21)], NOW)).toEqual([]) // 晚 25 小时
  })

  it('eatenToday 只看今天', () => {
    const records = [rec('a', 0, 9), rec('b', -1)]
    expect(eatenToday(records, 'a', NOW)).toBe(true)
    expect(eatenToday(records, 'b', NOW)).toBe(false)
  })
})

describe('记一条、撤销', () => {
  const item = { id: '["麻辣烫","楼下"]', name: '麻辣烫', shop: '楼下' }

  it('addRecord：加一条带名字和时间的记录，不改原数组', () => {
    const before = [rec('x', -1)]
    const after = addRecord(before, item, NOW)
    expect(before).toHaveLength(1)
    expect(after[after.length - 1]).toEqual({ id: item.id, label: '麻辣烫 · 楼下', at: NOW.toISOString() })
  })

  it('removeToday：只去掉这道菜今天最新的一条；昨天的不动', () => {
    const records = [rec(item.id, -1), rec(item.id, 0, 9), rec(item.id, 0, 12), rec('x', 0, 10)]
    const after = removeToday(records, item.id, NOW)
    expect(after.map((r) => [r.id, r.at])).toEqual([
      [item.id, at(-1)],
      [item.id, at(0, 9)],
      ['x', at(0, 10)],
    ])
    expect(removeToday([rec(item.id, -1)], item.id, NOW)).toHaveLength(1)
    // 比现在晚超过 1 天的记录（时间有误）不动，删的是今天的
    const future = rec(item.id, 5)
    expect(removeToday([rec(item.id, 0, 9), future], item.id, NOW)).toEqual([future])
  })
})

describe('整理记录', () => {
  it('丢掉格式不对的和太旧的，按时间排序', () => {
    const records = [
      rec('b', 0),
      null,
      { id: '', at: at(0) },
      { id: 'x', at: '不是时间' },
      { id: 3, at: at(0) },
      rec('a', -1),
      rec('old', -KEEP_DAYS),
      'junk',
    ]
    expect(pruneRecords(records, NOW).map((r) => r.id)).toEqual(['a', 'b'])
    expect(pruneRecords('不是数组', NOW)).toEqual([])
  })

  it(`最多留最新的 ${MAX_RECORDS} 条`, () => {
    const many = Array.from({ length: MAX_RECORDS + 10 }, (_, i) => ({
      id: `d${i}`,
      at: new Date(NOW.getTime() - (MAX_RECORDS + 10 - i) * 60000).toISOString(),
    }))
    const kept = pruneRecords(many, NOW)
    expect(kept).toHaveLength(MAX_RECORDS)
    expect(kept[0].id).toBe('d10')
  })

  it('describeDay：今天 / 昨天 / 前天 / N 天前', () => {
    expect([0, -1, -2, -5].map((d) => describeDay(at(d), NOW))).toEqual(['今天', '昨天', '前天', '5 天前'])
  })
})

describe('存在本机浏览器', () => {
  it('存了再读回来一样；清空时删掉', () => {
    const storage = fakeStorage()
    const records = [rec('a', 0)]
    expect(saveRecords(records, storage)).toBe(true)
    expect(JSON.parse(storage.data.get(STORAGE_KEY))).toEqual(records)
    expect(loadRecords(storage)).toEqual(records)
    saveRecords([], storage)
    expect(storage.data.has(STORAGE_KEY)).toBe(false)
  })

  it('没存过、存的是坏数据：读出空列表，不报错', () => {
    expect(loadRecords(fakeStorage())).toEqual([])
    expect(loadRecords(fakeStorage({ [STORAGE_KEY]: '{坏了' }))).toEqual([])
    expect(loadRecords(fakeStorage({ [STORAGE_KEY]: '"字符串"' }))).toEqual([])
  })

  it('浏览器不让存（没有存储，或者一读写就报错）：不报错，存返回 false', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadRecords(null)).toEqual([])
    expect(saveRecords([rec('a', 0)], null)).toBe(false)
    expect(loadRecords(broken)).toEqual([])
    expect(saveRecords([rec('a', 0)], broken)).toBe(false)
  })
})
