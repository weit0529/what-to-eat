// 菜单转换脚本：读 data/menu.xlsx → 检查 → 写成网页用的 src/generated/menu.json
//
// 运行：npm run menu
// 另外 npm run dev 和 npm run build 之前会自动运行（见 package.json 的 predev、prebuild）。
// 表格有错误时，脚本列出所有错误并以失败退出，构建和发布都会停下来，网站不会更新成错的菜单。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSheet } from 'read-excel-file/node'
import { parseMenuRows, formatIssue } from '../src/core/menu-data.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 默认的文件位置 */
export const DEFAULT_PATHS = {
  input: path.join(projectRoot, 'data', 'menu.xlsx'),
  output: path.join(projectRoot, 'src', 'generated', 'menu.json'),
  imagesDir: path.join(projectRoot, 'public', 'images'),
}

/** 网页数据的格式版本。以后改了数据结构就加 1 */
export const MENU_FORMAT_VERSION = 1

/**
 * 读表格、检查、写出 JSON。不打印任何东西，结果交给调用者处理。
 *
 * @returns {Promise<{ ok: boolean, items: object[], errors: object[], warnings: object[], disabledCount: number }>}
 *   ok 为 false 时没有写出文件
 */
export async function buildMenu({ input, output, imagesDir } = DEFAULT_PATHS) {
  const fail = (message) => ({ ok: false, items: [], errors: [{ row: 0, message }], warnings: [], disabledCount: 0 })

  if (!fs.existsSync(input)) return fail(`找不到菜单表格：${input}`)

  let rows
  try {
    rows = await readSheet(input)
  } catch (error) {
    return fail(`读不了菜单表格（${error.message}）。请确认它是 Excel 的 .xlsx 格式`)
  }

  // 只算真正的文件；名字像图片的文件夹不算
  const imageFiles = fs.existsSync(imagesDir)
    ? fs
        .readdirSync(imagesDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
    : []
  const result = parseMenuRows(rows, { imageFiles })
  if (result.errors.length > 0) return { ok: false, ...result }

  const data = { version: MENU_FORMAT_VERSION, items: result.items }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n', 'utf8')
  return { ok: true, ...result }
}

/** 把结果打印成人看得懂的报告 */
function printReport(result, input) {
  const show = (issue) => (issue.row > 0 ? formatIssue(issue) : issue.message)
  const relativeInput = path.relative(projectRoot, input) || input

  if (result.warnings.length > 0) {
    console.warn(`菜单提醒（不影响发布）：`)
    result.warnings.forEach((issue) => console.warn(`  ! ${show(issue)}`))
  }

  if (!result.ok) {
    console.error(`菜单检查发现 ${result.errors.length} 处错误，菜单没有更新。请改好 ${relativeInput} 后再试：`)
    result.errors.forEach((issue) => console.error(`  ✗ ${show(issue)}`))
    return
  }

  const disabled = result.disabledCount > 0 ? `，另有 ${result.disabledCount} 道暂停` : ''
  console.log(`菜单检查通过：共 ${result.items.length} 道菜可用${disabled}。`)
}

// 直接用 node 运行本文件时才执行；被测试代码 import 时不执行
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildMenu(DEFAULT_PATHS)
  printReport(result, DEFAULT_PATHS.input)
  if (!result.ok) process.exitCode = 1
}
