// 界面图标（src/ui/icons.js）：整个网站只用 Tabler 一套图标，不用 emoji（用户 2026-11-06）
import { describe, it, expect } from 'vitest'
import {
  IconBowlChopsticks,
  IconBowlSpoon,
  IconCake,
  IconCookie,
  IconCup,
  IconDumpling,
  IconFish,
  IconFishBone,
  IconFlame,
  IconGrill,
  IconMoon,
  IconMoonStars,
  IconPepper,
  IconSalad,
  IconSoup,
  IconSun,
  IconSunrise,
  IconBurger,
} from '@tabler/icons-vue'
import { iconForCategory, iconForMeal, FALLBACK_ICON } from '../src/ui/icons.js'

describe('iconForCategory', () => {
  it('示例菜单里的每个分类都配上专门的图标', () => {
    const expected = {
      早点: IconDumpling,
      面食: IconSoup,
      饺子馄饨: IconDumpling,
      米饭快餐: IconBowlChopsticks,
      川湘菜: IconPepper,
      米粉: IconSoup,
      火锅串串: IconFlame,
      烧烤: IconGrill,
      西式快餐: IconBurger,
      日韩料理: IconFish,
      轻食: IconSalad,
      粥: IconBowlSpoon,
      饮品甜点: IconCake,
      小吃: IconCookie,
      海鲜: IconFishBone,
    }
    // 组件比较用 toBe（同一个对象），toEqual 对组件对象比不出差别
    for (const [category, icon] of Object.entries(expected)) {
      expect(iconForCategory(category) === icon, category).toBe(true)
    }
  })

  it('认不出或空的分类用餐具图标', () => {
    for (const c of ['神秘料理', '', null, undefined]) expect(iconForCategory(c), String(c)).toBe(FALLBACK_ICON)
  })
})

describe('iconForMeal', () => {
  it('早午晚固定；额外餐次按名字猜，猜不到用餐具', () => {
    expect(iconForMeal({ id: 'breakfast', label: '早餐' })).toBe(IconSunrise)
    expect(iconForMeal({ id: 'lunch', label: '午餐' })).toBe(IconSun)
    expect(iconForMeal({ id: 'dinner', label: '晚餐' })).toBe(IconMoon)
    expect(iconForMeal({ id: '夜宵', label: '夜宵' })).toBe(IconMoonStars)
    expect(iconForMeal({ id: '下午茶', label: '下午茶' })).toBe(IconCup)
    expect(iconForMeal({ id: '神秘时间', label: '神秘时间' })).toBe(FALLBACK_ICON)
  })
})

describe('界面里不再有 emoji', () => {
  it('src 里的页面和代码不含 emoji（注释除外）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const files = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'generated') walk(full)
        } else if (/\.(vue|js)$/.test(entry.name)) files.push(full)
      }
    }
    walk(path.resolve(process.cwd(), 'src'))
    const emoji = /\p{Extended_Pictographic}/u
    const found = []
    for (const file of files) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '').replace(/<!--.*?-->/g, '')
          const t = code.trim()
          if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')) return
          if (emoji.test(code)) found.push(`${path.relative(process.cwd(), file)}:${i + 1}`)
        })
    }
    expect(found).toEqual([])
  })
})
