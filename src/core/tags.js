// 标签分组：把菜单里出现过的标签，按“建议标签”的分组整理，给分析页面显示用。
//
// 分组和 docs/菜单填写说明.md 第六节“建议标签”一致。表格里的标签是自由填的，
// 不在建议里的标签放进最后的“其他”组。改建议标签时，这里和说明文档要一起改。

export const TAG_GROUPS = [
  { name: '口味', tags: ['辣', '微辣', '麻', '酸辣', '酸甜', '甜', '咸香', '清淡', '重口'] },
  { name: '吃起来', tags: ['热乎', '冷食', '汤', '下饭', '管饱', '油炸'] },
  { name: '健康', tags: ['低卡', '健康', '养胃', '素', '肉'] },
  { name: '价格和速度', tags: ['实惠', '快', '想吃好点'] },
  { name: '天气', tags: ['适合下雨', '适合天冷', '适合天热'] },
  { name: '心情', tags: ['犒劳自己', '治愈', '提神'] },
  { name: '几个人', tags: ['适合一个人', '适合两个人', '适合多人'] },
  { name: '时间', tags: ['夜宵'] },
]

export const OTHER_GROUP = '其他'

/**
 * 把这些菜里出现过的标签分组列出来，每个标签带“有几道菜”。
 * 建议标签按建议里的顺序；“其他”组按出现次数从多到少，次数相同按第一次出现的顺序。
 * 没有标签的组不列出。
 *
 * @returns {Array<{ name: string, tags: Array<{ tag: string, count: number }> }>}
 */
export function groupTags(items) {
  const counts = new Map() // 保持第一次出现的顺序
  for (const item of items) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }

  const suggested = new Set()
  const groups = []
  for (const group of TAG_GROUPS) {
    group.tags.forEach((tag) => suggested.add(tag))
    const tags = group.tags.filter((tag) => counts.has(tag)).map((tag) => ({ tag, count: counts.get(tag) }))
    if (tags.length > 0) groups.push({ name: group.name, tags })
  }

  const others = [...counts]
    .filter(([tag]) => !suggested.has(tag))
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count) // sort 是稳定排序，次数相同时保持出现顺序
  if (others.length > 0) groups.push({ name: OTHER_GROUP, tags: others })

  return groups
}
