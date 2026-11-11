// 管理页 Excel 导入导出的转换（src/core/menu-excel.js）的测试
import { describe, it, expect } from 'vitest'
import { menuToSheets, sheetsToImport } from '../src/core/menu-excel.js'
import { MEALS } from '../src/core/menu-data.js'

const meals = [...MEALS.map((m) => ({ ...m, builtIn: true })), { id: '夜宵', label: '夜宵', builtIn: false }]
const dishes = [
  { id: 'a', name: '麻辣烫', shop: '楼下', category: '火锅串串', meals: ['lunch', '夜宵'], tags: ['辣', '热乎'], price: 25, description: '汤浓', image: 'mlt.jpg', enabled: true },
  { id: 'b', name: '粥', shop: null, category: '粥', meals: ['breakfast'], tags: [], price: null, description: null, image: null, enabled: false },
]

describe('menuToSheets（导出）', () => {
  it('菜单页列名和原来的 menu.xlsx 一样；餐次写中文；停用写“否”', () => {
    const [menu, mealSheet] = menuToSheets({ meals, dishes })
    expect(menu.sheet).toBe('菜单')
    expect(menu.data[0]).toEqual(['品类', '店铺', '分类', '适合餐次', '标签', '人均价格', '描述', '图片', '启用'])
    expect(menu.data[1]).toEqual(['麻辣烫', '楼下', '火锅串串', '午餐、夜宵', '辣、热乎', 25, '汤浓', 'mlt.jpg', '是'])
    expect(menu.data[2]).toEqual(['粥', null, '粥', '早餐', null, null, null, null, '否'])
    expect(mealSheet).toEqual({ sheet: '餐次', data: [['餐次'], ['夜宵']] })
  })
})

describe('sheetsToImport（导入）', () => {
  it('导出的表格原样导入回来，内容不变（含停用的菜和额外餐次）', () => {
    const result = sheetsToImport(menuToSheets({ meals, dishes }))
    expect(result.ok).toBe(true)
    expect(result.mealLabels).toEqual(['夜宵'])
    expect(result.disabledCount).toBe(1)
    expect(result.dishes.map(({ id, ...rest }) => rest)).toEqual(dishes.map(({ id, ...rest }) => rest))
    // 编号按以前的规则从“品类 + 店铺”算出来，后台用它认出老的菜
    expect(result.dishes[0].id).toBe(JSON.stringify(['麻辣烫', '楼下']))
  })

  it('表格有错时不导入，列出错在哪一行', () => {
    const sheets = [{ sheet: '菜单', data: [['品类', '分类', '适合餐次'], ['', '粥', '早餐'], ['豆浆', '早点', '宵夜']] }]
    const result = sheetsToImport(sheets)
    expect(result.ok).toBe(false)
    expect(result.errors.map((e) => e.row)).toEqual([2, 3])
  })

  it('“餐次”页有错时不导入', () => {
    const sheets = [
      { sheet: '菜单', data: [['品类', '分类', '适合餐次'], ['豆浆', '早点', '早餐']] },
      { sheet: '餐次', data: [['餐次'], ['午餐']] },
    ]
    expect(sheetsToImport(sheets).ok).toBe(false)
  })

  it('第一页是“餐次”页、表格是空的时给出说明', () => {
    expect(sheetsToImport([{ sheet: '餐次', data: [] }]).errors[0].message).toContain('第一页应该是菜单')
    expect(sheetsToImport([]).ok).toBe(false)
  })

  it('图片找不到只是提醒，不挡导入', () => {
    const sheets = [{ sheet: '菜单', data: [['品类', '分类', '适合餐次', '图片'], ['豆浆', '早点', '早餐', 'none.jpg']] }]
    const result = sheetsToImport(sheets, { imageFiles: ['a.jpg'] })
    expect(result.ok).toBe(true)
    expect(result.warnings).toHaveLength(1)
    expect(result.dishes[0].image).toBe(null)
  })
})
