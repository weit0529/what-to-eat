// 菜单数据检查和转换（src/core/menu-data.js）的测试
import { describe, it, expect } from 'vitest'
import { parseMenuRows, formatIssue } from '../src/core/menu-data.js'

const HEADER = ['品类', '店铺', '分类', '适合餐次', '标签', '人均价格', '描述', '图片', '启用']

/** 用列名造一行数据，没给的列留空 */
function row(fields) {
  return HEADER.map((title) => fields[title] ?? null)
}

/** 一行最基本的合法数据 */
const OK = { 品类: '麻辣烫', 分类: '火锅串串', 适合餐次: '午餐、晚餐' }

function parse(...dataRows) {
  return parseMenuRows([HEADER, ...dataRows.map(row)])
}

describe('正常转换', () => {
  it('把一行转换成菜品，空的选填项为 null 或空列表', () => {
    const { items, errors, warnings } = parse(OK)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(items).toEqual([
      {
        id: '["麻辣烫",""]',
        name: '麻辣烫',
        shop: null,
        category: '火锅串串',
        meals: ['lunch', 'dinner'],
        tags: [],
        price: null,
        description: null,
        image: null,
        source: 'admin',
        owner: null,
        status: 'approved',
      },
    ])
  })

  it('读出店铺、标签、价格、描述，去掉首尾空格', () => {
    const { items } = parse({
      ...OK,
      品类: '  麻辣烫 ',
      店铺: ' 楼下  张姐 ',
      标签: '辣、热乎,适合下雨，辣;适合一个人',
      人均价格: 25.5,
      描述: ' 汤底浓 ',
    })
    expect(items[0]).toMatchObject({
      id: '["麻辣烫","楼下 张姐"]',
      name: '麻辣烫',
      shop: '楼下 张姐',
      tags: ['辣', '热乎', '适合下雨', '适合一个人'],
      price: 25.5,
      description: '汤底浓',
    })
  })

  it('价格写成文字形式的数字也认', () => {
    expect(parse({ ...OK, 人均价格: '18' }).items[0].price).toBe(18)
    expect(parse({ ...OK, 人均价格: 0 }).items[0].price).toBe(0)
  })

  it('餐次支持多种写法和“全天”，按早午晚排序并去重', () => {
    expect(parse({ ...OK, 适合餐次: '晚饭 早' }).items[0].meals).toEqual(['breakfast', 'dinner'])
    expect(parse({ ...OK, 适合餐次: '全天、午餐' }).items[0].meals).toEqual(['breakfast', 'lunch', 'dinner'])
    expect(parse({ ...OK, 适合餐次: '午饭，晚餐' }).items[0].meals).toEqual(['lunch', 'dinner'])
  })

  it('跳过空行，行号仍按 Excel 计算', () => {
    const result = parseMenuRows([HEADER, row(OK), [], [null, '  '], row({ ...OK, 品类: '' })])
    expect(result.items).toHaveLength(1)
    expect(result.errors).toEqual([{ row: 5, column: '品类', message: '不能为空' }])
  })

  it('列的顺序可以不同，多出来的列提醒但不报错', () => {
    const result = parseMenuRows([
      ['备注', '适合餐次', '分类', '品类'],
      ['随便写', '早餐', '早点', '包子'],
    ])
    expect(result.errors).toEqual([])
    expect(result.items[0]).toMatchObject({ name: '包子', category: '早点', meals: ['breakfast'] })
    expect(result.warnings).toEqual([{ row: 1, column: '备注', message: expect.stringContaining('已忽略') }])
  })
})

describe('启用', () => {
  it('不填、填“是”或 Excel 的 TRUE 都算启用', () => {
    expect(parse(OK).items).toHaveLength(1)
    expect(parse({ ...OK, 启用: '是' }).items).toHaveLength(1)
    expect(parse({ ...OK, 启用: true }).items).toHaveLength(1)
  })

  it('填“否”的不放进结果，只计数', () => {
    const result = parse(OK, { ...OK, 品类: '冷面', 启用: '否' }, { ...OK, 品类: '凉皮', 启用: false })
    expect(result.items.map((item) => item.name)).toEqual(['麻辣烫'])
    expect(result.disabledCount).toBe(2)
  })

  it('看不懂的值报错', () => {
    expect(parse({ ...OK, 启用: '暂停' }).errors[0]).toMatchObject({ row: 2, column: '启用' })
  })

  it('全部停用时报错，否则网站上没菜可选', () => {
    const result = parse({ ...OK, 启用: '否' })
    expect(result.errors).toEqual([{ row: 1, message: expect.stringContaining('启用：否') }])
  })
})

describe('必须改的错误', () => {
  it('必填项为空', () => {
    // 只填了标签的行：不算空行，三个必填项都要报
    const { errors, items } = parse({ 标签: '辣' })
    expect(items).toEqual([])
    expect(errors.map((e) => e.column)).toEqual(['品类', '分类', '适合餐次'])
  })

  it('分类只能填一个', () => {
    expect(parse({ ...OK, 分类: '火锅、川菜' }).errors[0]).toMatchObject({ column: '分类', message: '只能填一个分类' })
  })

  it('不认识的餐次', () => {
    const { errors } = parse({ ...OK, 适合餐次: '午餐、宵夜、下午茶' })
    expect(errors).toEqual([{ row: 2, column: '适合餐次', message: expect.stringContaining('宵夜、下午茶') }])
  })

  it('价格不是数字或是负数', () => {
    expect(parse({ ...OK, 人均价格: '25元' }).errors[0]).toMatchObject({ column: '人均价格' })
    expect(parse({ ...OK, 人均价格: -1 }).errors[0]).toMatchObject({ column: '人均价格', message: '不能是负数' })
  })

  it('品类 + 店铺重复时，指出和哪一行重复；店铺不同则不算重复', () => {
    const { errors, items } = parse(OK, { ...OK, 店铺: '楼下' }, { ...OK, 适合餐次: '早餐' })
    expect(items).toHaveLength(2)
    expect(errors).toEqual([{ row: 4, column: '品类', message: '和第 2 行重复（品类和店铺都一样）' }])
  })

  it('停用的菜也参与重复检查', () => {
    expect(parse({ ...OK, 启用: '否' }, OK).errors[0].row).toBe(3)
  })

  it('一行有多处错误时全部列出，这一行不进结果，其他行照常', () => {
    const { errors, items } = parse({ 品类: '包子', 分类: '', 适合餐次: '宵夜', 人均价格: 'abc' }, OK)
    expect(errors.map((e) => e.column)).toEqual(['分类', '适合餐次', '人均价格'])
    expect(items.map((item) => item.name)).toEqual(['麻辣烫'])
  })

  it('缺少必填的列时只报列的问题，不逐行检查', () => {
    const result = parseMenuRows([['品类', '分类'], ['包子', '早点']])
    expect(result.errors).toEqual([{ row: 1, column: '适合餐次', message: expect.stringContaining('缺少这一列') }])
    expect(result.items).toEqual([])
  })

  it('列名重复', () => {
    const result = parseMenuRows([['品类', '分类', '适合餐次', '分类'], ['包子', '早点', '早餐', '面食']])
    expect(result.errors).toEqual([{ row: 1, column: '分类', message: expect.stringContaining('两次') }])
  })

  // 以下 4 个是 Codex 第 2 轮审核发现的问题（reviews/review-codex-2.md）
  it('餐次只填了标点，和没填一样报错', () => {
    for (const text of ['、，;', ' 、 ', '\n']) {
      const { errors, items } = parse({ ...OK, 适合餐次: text })
      expect(items, JSON.stringify(text)).toEqual([])
      expect(errors, JSON.stringify(text)).toEqual([
        { row: 2, column: '适合餐次', message: expect.stringContaining('不能为空') },
      ])
    }
  })

  it('名字里带竖线等符号时，不同的“品类 + 店铺”不会被当成重复', () => {
    const { errors, items } = parse({ ...OK, 品类: 'A|B', 店铺: 'C' }, { ...OK, 品类: 'A', 店铺: 'B|C' })
    expect(errors).toEqual([])
    expect(items.map((item) => item.id)).toEqual(['["A|B","C"]', '["A","B|C"]'])
  })

  it('餐次填了 constructor 这类词时，报“不认识”而不是让脚本崩溃', () => {
    for (const word of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const { errors } = parse({ ...OK, 适合餐次: `午餐、${word}` })
      expect(errors, word).toEqual([{ row: 2, column: '适合餐次', message: expect.stringContaining(word) }])
    }
  })

  it('位数太多的数字价格报错，不会悄悄变成没填', () => {
    const { errors, items } = parse({ ...OK, 人均价格: '9'.repeat(400) })
    expect(items).toEqual([])
    expect(errors[0]).toMatchObject({ column: '人均价格', message: expect.stringContaining('不是数字') })
  })

  it('表格是空的或只有列名', () => {
    expect(parseMenuRows([]).errors[0].message).toContain('第一行')
    expect(parseMenuRows([HEADER]).errors[0].message).toBe('表格里还没有菜')
  })
})

describe('图片（只提醒，不挡发布）', () => {
  const withImage = (image, imageFiles) => parseMenuRows([HEADER, row({ ...OK, 图片: image })], { imageFiles })

  it('文件存在时保留文件名', () => {
    const result = withImage('malatang.jpg', ['malatang.jpg'])
    expect(result.items[0].image).toBe('malatang.jpg')
    expect(result.warnings).toEqual([])
  })

  it('在线上传的图片（up_ 开头）不在 public/images/ 里，也照样保留、不提醒（阶段 4-4d）', () => {
    const name = `up_${'a'.repeat(32)}.webp`
    const result = withImage(name, [])
    expect(result.items[0].image).toBe(name)
    expect(result.warnings).toEqual([])
    // 长得像但不合规的，照旧当普通文件名检查
    expect(withImage('up_123.webp', []).items[0].image).toBeNull()
  })

  it('文件不存在时提醒，并且不显示图片', () => {
    const result = withImage('a.jpg', [])
    expect(result.errors).toEqual([])
    expect(result.items[0].image).toBeNull()
    expect(result.warnings).toEqual([{ row: 2, column: '图片', message: expect.stringContaining('找不到') }])
  })

  it('大小写不一致时提醒（发布到网上会找不到）', () => {
    const result = withImage('Malatang.JPG', ['malatang.jpg'])
    expect(result.items[0].image).toBeNull()
    expect(result.warnings[0].message).toContain('大小写')
  })

  it('带文件夹路径或不是图片格式时提醒', () => {
    for (const name of ['../secret.png', 'images/a.png', 'C:\\a.png', '.hidden.png', 'menu.xlsx']) {
      const result = withImage(name, [name])
      expect(result.items[0].image, name).toBeNull()
      expect(result.warnings, name).toHaveLength(1)
    }
  })

  it('不传文件列表时不检查是否存在', () => {
    expect(parseMenuRows([HEADER, row({ ...OK, 图片: 'a.png' })]).items[0].image).toBe('a.png')
  })

  it('停用的菜不检查图片', () => {
    expect(withImage('a.jpg', []).warnings).toHaveLength(1)
    const result = parseMenuRows([HEADER, row(OK), row({ ...OK, 品类: '冷面', 图片: 'a.jpg', 启用: '否' })], {
      imageFiles: [],
    })
    expect(result.warnings).toEqual([])
  })
})

describe('formatIssue', () => {
  it('有列名和没列名两种写法', () => {
    expect(formatIssue({ row: 3, column: '分类', message: '不能为空' })).toBe('第 3 行「分类」：不能为空')
    expect(formatIssue({ row: 1, message: '表格里还没有菜' })).toBe('第 1 行：表格里还没有菜')
  })
})

// docs/菜单填写说明.md 里写给用户的规则，逐条和实际检查对上（M4）
describe('填写说明里的规则', () => {
  it('适合餐次认得的词：早餐、早饭、早；午餐、午饭、午；晚餐、晚饭、晚；全天', () => {
    for (const [text, meals] of [
      ['早餐', ['breakfast']],
      ['早饭', ['breakfast']],
      ['早', ['breakfast']],
      ['午餐', ['lunch']],
      ['午饭', ['lunch']],
      ['午', ['lunch']],
      ['晚餐', ['dinner']],
      ['晚饭', ['dinner']],
      ['晚', ['dinner']],
      ['全天', ['breakfast', 'lunch', 'dinner']],
    ]) {
      expect(parse({ ...OK, 适合餐次: text }).items[0].meals, text).toEqual(meals)
    }
    for (const text of ['宵夜', '下午茶']) expect(parse({ ...OK, 适合餐次: text }).errors, text).toHaveLength(1)
  })

  it('隔开用顿号、中英文逗号、中英文分号或换行', () => {
    const { items } = parse({ ...OK, 标签: '辣、热乎，汤,快；夜宵;适合下雨\n适合多人' })
    expect(items[0].tags).toEqual(['辣', '热乎', '汤', '快', '夜宵', '适合下雨', '适合多人'])
    expect(parse({ ...OK, 适合餐次: '早餐；午餐\n晚餐' }).items[0].meals).toEqual(['breakfast', 'lunch', 'dinner'])
  })

  it('启用认得的词：是/否、yes/no、1/0、TRUE/FALSE', () => {
    for (const yes of ['是', 'yes', 'YES', '1', true]) expect(parse({ ...OK, 启用: yes }).items, String(yes)).toHaveLength(1)
    for (const no of ['否', 'no', '0', false]) expect(parse({ ...OK, 启用: no }, { ...OK, 品类: '别的' }).disabledCount, String(no)).toBe(1)
  })

  it('人均价格：25、12.5 可以；25元、约25、负数报错', () => {
    expect(parse({ ...OK, 人均价格: 25 }).items[0].price).toBe(25)
    expect(parse({ ...OK, 人均价格: '12.5' }).items[0].price).toBe(12.5)
    for (const bad of ['25元', '约25', -3, '-3']) expect(parse({ ...OK, 人均价格: bad }).errors, String(bad)).toHaveLength(1)
  })

  it('图片格式：jpg、jpeg、png、webp、gif', () => {
    for (const name of ['a.jpg', 'a.jpeg', 'a.png', 'a.webp', 'a.gif', 'A.JPG']) {
      expect(parseMenuRows([HEADER, row({ ...OK, 图片: name })], { imageFiles: [name] }).items[0].image, name).toBe(name)
    }
    expect(parseMenuRows([HEADER, row({ ...OK, 图片: 'a.bmp' })], { imageFiles: ['a.bmp'] }).items[0].image).toBeNull()
  })
})
