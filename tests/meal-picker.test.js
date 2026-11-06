// 选餐次转盘（src/components/MealPicker.vue）的测试：名字放不下时不挤、不出界
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MealPicker from '../src/components/MealPicker.vue'
import { MEALS } from '../src/core/menu-data.js'
import { textWidth } from '../src/core/meal-dial.js'

const extra = (label) => ({ id: `extra-${label}`, label })
const picker = (meals, modelValue = null) => mount(MealPicker, { props: { items: [], meals, modelValue } })

describe('MealPicker 转盘', () => {
  it('早午晚三块都放图标、名字、道数，可以用键盘选', async () => {
    const w = picker(MEALS)
    const meals = w.findAll('.meal')
    expect(meals.map((m) => m.classes())).toEqual(MEALS.map(() => expect.arrayContaining(['layout-full'])))
    expect(meals.map((m) => m.attributes('tabindex'))).toEqual(['0', '0', '0'])
    await meals[1].trigger('keydown', { key: 'Enter' })
    await meals[2].trigger('keydown', { key: ' ' })
    expect(w.emitted('update:modelValue')).toEqual([['lunch'], ['dinner']])
  })

  it('名字很长时截短，title 和读屏名字是全名（Codex 第 17 轮）', () => {
    const long = '夜里加班补充能量的夜宵'
    const w = picker([...MEALS, extra(long)])
    const g = w.find('.meal.extra')
    expect(g.find('.label').text().endsWith('…')).toBe(true)
    expect(g.find('title').text()).toBe(long)
    expect(g.attributes('aria-label')).toBe(`${long}，0 道`)
  })

  it('额外餐次很多时，窄块只放图标或短名字，字不超过块宽（Codex 第 17 轮）', () => {
    const w = picker([...MEALS, ...['早午餐', '下午茶', '晚茶', '夜宵', '夜食', '加餐'].map(extra)])
    const extras = w.findAll('.meal.extra')
    expect(extras).toHaveLength(6)
    for (const g of extras) {
      expect(g.classes().some((c) => c === 'layout-full')).toBe(false)
      const label = g.find('.label')
      // 15° 的块沿圆周方向最多约 16px，放不下两个 13px 的字
      if (label.exists()) expect(textWidth(label.text(), 13)).toBeLessThanOrEqual(50)
      // 每一块都还能点，读屏能读到全名
      expect(g.attributes('role')).toBe('button')
      expect(g.attributes('aria-label')).toMatch(/^.+，0 道$/)
    }
  })

  it('没选时不显示指针，选了才显示', async () => {
    const w = picker(MEALS)
    expect(w.find('.pointer').exists()).toBe(false)
    await w.setProps({ modelValue: 'dinner' })
    expect(w.find('.pointer').attributes('style')).toContain('rotate(240deg)')
  })

  it('选中的餐次不在列表里时不崩溃，也不显示指针', () => {
    const w = picker(MEALS, 'not-a-meal')
    expect(w.find('.pointer').exists()).toBe(false)
    expect(w.findAll('.meal.selected')).toHaveLength(0)
  })
})
