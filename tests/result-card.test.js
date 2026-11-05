// 结果卡片（src/components/ResultCard.vue）的测试
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ResultCard from '../src/components/ResultCard.vue'

const base = {
  id: '["麻辣烫",""]',
  name: '麻辣烫',
  shop: null,
  category: '火锅串串',
  meals: ['lunch'],
  tags: [],
  price: null,
  description: null,
  image: null,
}

const card = (extra) => mount(ResultCard, { props: { item: { ...base, ...extra } } })

describe('ResultCard', () => {
  it('只有必填项时只显示分类和名字', () => {
    const w = card({})
    expect(w.find('.category').text()).toBe('火锅串串')
    expect(w.find('.name').text()).toBe('麻辣烫')
    for (const selector of ['img', '.shop', '.price', '.tags', '.description']) {
      expect(w.find(selector).exists(), selector).toBe(false)
    }
  })

  it('显示店铺、价格、标签、描述', () => {
    const w = card({ shop: '楼下', price: 25, tags: ['辣', '热乎'], description: '汤底浓' })
    expect(w.find('.shop').text()).toContain('楼下')
    expect(w.find('.price').text()).toContain('人均约 ¥25')
    expect(w.findAll('.tags li').map((li) => li.text())).toEqual(['辣', '热乎'])
    expect(w.find('.description').text()).toBe('汤底浓')
  })

  it('价格有小数时保留一位，0 元也显示', () => {
    expect(card({ price: 12.25 }).find('.price').text()).toContain('人均约 ¥12.3')
    expect(card({ price: 0 }).find('.price').text()).toContain('人均约 ¥0')
  })

  it('图片地址对文件名编码，带 # % 空格中文的文件名也不会被误读', () => {
    const src = card({ image: '麻辣 烫#1%.jpg' }).find('img').attributes('src')
    expect(src.endsWith('images/%E9%BA%BB%E8%BE%A3%20%E7%83%AB%231%25.jpg')).toBe(true)
  })

  it('图片加载失败时不显示图片，文字照常', async () => {
    const w = card({ image: 'broken.jpg' })
    await w.find('img').trigger('error')
    expect(w.find('img').exists()).toBe(false)
    expect(w.find('.name').text()).toBe('麻辣烫')
  })

  it('换成另一道菜后，重新尝试显示图片', async () => {
    const w = card({ image: 'broken.jpg' })
    await w.find('img').trigger('error')
    await w.setProps({ item: { ...base, name: '火锅', image: 'hotpot.jpg' } })
    expect(w.find('img').attributes('src').endsWith('images/hotpot.jpg')).toBe(true)
  })
})

describe('ResultCard 的 emoji 和标题', () => {
  it('没有图片时显示分类 emoji，有图片时不显示', () => {
    expect(card({}).find('.emoji-art').text()).toBe('🍲')
    expect(card({ image: 'a.jpg' }).find('.emoji-art').exists()).toBe(false)
  })

  it('图片加载失败后改显示 emoji', async () => {
    const w = card({ image: 'broken.jpg' })
    await w.find('img').trigger('error')
    expect(w.find('.emoji-art').exists()).toBe(true)
  })

  it('卡片顶部有“就吃它！”', () => {
    expect(card({}).find('.ribbon').text()).toContain('就吃它！')
  })
})
