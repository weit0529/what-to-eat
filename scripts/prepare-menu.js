// 准备网站内置的菜单（npm run menu；dev、build、test 之前都会自动运行）。
//
// 阶段 4-2 起，菜单以后台为准（管理员在管理页里改，REQUIREMENTS.md R-020）。网站打开时会先去后台读最新菜单；
// 这里准备的是“内置菜单”，后台连不上时网站用它兜底（R-026）：
//   - 设了环境变量 MENU_API_URL（发布到网上时，GitHub Actions 里设）：从后台取一份最新菜单写进去（用户 2026-11-10 选 5A）；
//     取不到或内容不对，就退回用 data/menu.xlsx，发布照常进行
//   - 没设（本机开发、跑测试）：照旧从 data/menu.xlsx 转换
// 另外把 public/images/ 里有哪些图片写成 src/generated/images.json，管理页选图片时用。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PATHS } from './build-menu.js'
import { fetchMenu } from '../src/core/remote-menu.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IMAGES_LIST = path.join(projectRoot, 'src', 'generated', 'images.json')

/** public/images/ 里的图片文件名 */
export function listImages(imagesDir = DEFAULT_PATHS.imagesDir) {
  if (!fs.existsSync(imagesDir)) return []
  return fs
    .readdirSync(imagesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(jpe?g|png|webp|gif)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
}

async function main() {
  fs.mkdirSync(path.dirname(IMAGES_LIST), { recursive: true })
  fs.writeFileSync(IMAGES_LIST, JSON.stringify(listImages(), null, 2) + '\n', 'utf8')

  const url = process.env.MENU_API_URL
  if (url) {
    const { menu, reason } = await fetchMenu(url, { timeoutMs: 20000 })
    if (menu) {
      fs.writeFileSync(DEFAULT_PATHS.output, JSON.stringify(menu, null, 2) + '\n', 'utf8')
      console.log(`内置菜单：从后台取到 ${menu.items.length} 道菜。`)
      return
    }
    console.warn(`内置菜单：${reason}，改用 data/menu.xlsx。`)
  }
  // 退回 Excel：和原来的 npm run menu 一样（检查不通过时以失败退出）
  const { spawnSync } = await import('node:child_process')
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'build-menu.js')], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
