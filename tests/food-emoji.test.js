// 分类 emoji（src/ui/food-emoji.js）的测试
import { describe, it, expect } from 'vitest'
import { emojiForCategory, FALLBACK_EMOJI } from '../src/ui/food-emoji.js'

describe('emojiForCategory', () => {
  it('示例菜单里的分类都能配上专门的 emoji', () => {
    const categories = ['早点', '面食', '饺子馄饨', '米饭快餐', '川湘菜', '米粉', '火锅串串', '烧烤', '西式快餐', '日韩料理', '轻食', '粥']
    for (const name of categories) expect(emojiForCategory(name), name).not.toBe(FALLBACK_EMOJI)
  })

  it('按关键字匹配，靠前的规则优先', () => {
    expect(emojiForCategory('火锅串串')).toBe('🍲')
    expect(emojiForCategory('兰州面馆')).toBe('🍜')
    expect(emojiForCategory('奶茶')).toBe('🧋')
  })

  it('认不出或空的分类用默认 emoji', () => {
    expect(emojiForCategory('神秘料理')).toBe(FALLBACK_EMOJI)
    expect(emojiForCategory('')).toBe(FALLBACK_EMOJI)
    expect(emojiForCategory(null)).toBe(FALLBACK_EMOJI)
  })
})
