// @vitest-environment node
// 菜单转换脚本（scripts/build-menu.js）的测试：用 tests/fixtures 里的真实 Excel 文件
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMenu, MENU_FORMAT_VERSION } from '../scripts/build-menu.js'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const imagesDir = path.join(fixtures, 'images')

let tempDir
let output

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'what-to-eat-'))
  output = path.join(tempDir, 'generated', 'menu.json')
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('buildMenu', () => {
  it('正确的表格：写出 JSON，只读第一个工作表', async () => {
    const result = await buildMenu({ input: path.join(fixtures, 'menu-ok.xlsx'), output, imagesDir })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.disabledCount).toBe(1)

    const data = JSON.parse(fs.readFileSync(output, 'utf8'))
    expect(data.version).toBe(MENU_FORMAT_VERSION)
    expect(data.items.map((item) => item.id)).toEqual(['["麻辣烫",""]', '["包子","楼下"]'])
    expect(data.items[0]).toMatchObject({ image: 'ok.png', price: 25, meals: ['lunch', 'dinner'] })
    // 文字形式的价格也能转成数字；找不到的图片不显示，只提醒
    expect(data.items[1]).toMatchObject({ image: null, price: 8 })
    expect(result.warnings).toEqual([{ row: 3, column: '图片', message: expect.stringContaining('missing.jpg') }])
  })

  it('有错误的表格：列出全部错误和行号，不写文件', async () => {
    const result = await buildMenu({ input: path.join(fixtures, 'menu-bad.xlsx'), output, imagesDir })
    expect(result.ok).toBe(false)
    expect(result.errors.map((e) => [e.row, e.column])).toEqual([
      [2, '分类'],
      [3, '适合餐次'],
      [3, '人均价格'],
      [4, '品类'],
    ])
    expect(fs.existsSync(output)).toBe(false)
  })

  it('表格不存在时给出明确提示', async () => {
    const result = await buildMenu({ input: path.join(tempDir, 'nope.xlsx'), output, imagesDir })
    expect(result.ok).toBe(false)
    expect(result.errors[0].message).toContain('找不到菜单表格')
  })

  it('文件不是 xlsx 时给出明确提示', async () => {
    const fake = path.join(tempDir, 'fake.xlsx')
    fs.writeFileSync(fake, '这不是 Excel')
    const result = await buildMenu({ input: fake, output, imagesDir })
    expect(result.ok).toBe(false)
    expect(result.errors[0].message).toContain('读不了菜单表格')
  })

  it('名字像图片的文件夹不算图片（Codex 第 2 轮审核）', async () => {
    const dir = path.join(tempDir, 'images')
    fs.mkdirSync(path.join(dir, 'ok.png'), { recursive: true })
    const result = await buildMenu({ input: path.join(fixtures, 'menu-ok.xlsx'), output, imagesDir: dir })
    expect(result.ok).toBe(true)
    expect(result.items[0].image).toBeNull()
    expect(result.warnings.map((w) => w.row)).toEqual([2, 3])
  })

  it('读“餐次”页的额外餐次，写进 meals；“填写说明”页不影响', async () => {
    const result = await buildMenu({ input: path.join(fixtures, 'menu-meals.xlsx'), output, imagesDir })
    expect(result.ok).toBe(true)
    const data = JSON.parse(fs.readFileSync(output, 'utf8'))
    expect(data.meals.map((m) => [m.id, m.builtIn])).toEqual([
      ['breakfast', true],
      ['lunch', true],
      ['dinner', true],
      ['下午茶', false],
      ['夜宵', false],
    ])
    expect(data.items.map((i) => [i.name, i.meals])).toEqual([
      ['烧烤', ['dinner', '夜宵']],
      ['奶茶', ['下午茶']],
      ['馄饨', ['breakfast', 'lunch', 'dinner']],
    ])
    // 这个测试表格还留着旧的“图标”列（2026-11-06 去掉了）：只提醒“不认识这一列”，不影响读取
    expect(data.meals[3]).toEqual({ id: '下午茶', label: '下午茶', builtIn: false })
    expect(result.warnings).toEqual([expect.objectContaining({ sheet: '餐次', row: 1, column: '图标' })])
  })

  it('没有“餐次”页时只有早、午、晚', async () => {
    const result = await buildMenu({ input: path.join(fixtures, 'menu-ok.xlsx'), output, imagesDir })
    expect(result.meals.map((m) => m.id)).toEqual(['breakfast', 'lunch', 'dinner'])
  })

  it('“餐次”页被拖到最前面时报错，提示把“菜单”页拖回去', async () => {
    const result = await buildMenu({ input: path.join(fixtures, 'menu-meals-first.xlsx'), output, imagesDir })
    expect(result.ok).toBe(false)
    expect(result.errors[0].message).toContain('第一页应该是菜单')
  })

  it('图片文件夹不存在时，有图片的菜只提醒', async () => {
    const result = await buildMenu({
      input: path.join(fixtures, 'menu-ok.xlsx'),
      output,
      imagesDir: path.join(tempDir, 'no-images'),
    })
    expect(result.ok).toBe(true)
    expect(result.warnings).toHaveLength(2)
  })
})
