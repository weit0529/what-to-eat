# 今天吃什么？

帮不知道这一餐吃什么的人快速做决定：随机抽一个，或者按口味、预算、天气等条件推荐。
推荐的是出去吃或点外卖的品类、店铺。

网址：**https://weit0529.github.io/what-to-eat/**

> 想改菜单？看 [docs/菜单填写说明.md](docs/菜单填写说明.md)，只需要改 Excel 表格，不用碰代码。
>
> 技术栈：Vue 3 + Vite，测试用 Vitest，发布到 GitHub Pages。

## 需要的环境

- Node.js 22.22.2 以上的 22.x，或 24.15 以上（本机是 24.20，GitHub 上发布用 24）。测试工具 jsdom、Vitest 不支持更老的版本
- 第一次拿到代码后，在本文件夹里运行一次 `npm install`

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run menu` | 检查菜单表格，并转成网页用的数据 |
| `npm run dev` | 启动开发服务器，浏览器打开 http://localhost:5173 ，改代码后页面自动刷新 |
| `npm test` | 跑一遍全部自动化测试 |
| `npm run test:watch` | 改代码时自动重跑测试 |
| `npm run build` | 构建正式版本，产出在 `dist/` |
| `npm run preview` | 在本机预览 `dist/` 里的正式版本 |

## 目录结构

| 位置 | 放什么 |
|---|---|
| `data/` | 菜单表格 `menu.xlsx`。**怎么改菜单见 [docs/菜单填写说明.md](docs/菜单填写说明.md)** |
| `public/images/` | 菜品图片，表格里写文件名 |
| `scripts/` | 把 Excel 转成网页数据的脚本 |
| `docs/` | 给使用者看的说明 |
| `src/ui/` | 和界面有关的小工具，比如给分类配 emoji |
| `src/core/` | 抽取、筛选、打分等核心逻辑，不依赖页面，以后小程序也能用 |
| `src/components/` | 页面组件 |
| `src/App.vue` | 根组件 |
| `tests/` | 自动化测试 |
| `.github/workflows/deploy.yml` | 推送到 GitHub 后自动测试、构建、发布到 GitHub Pages |

## 发布

推送到 GitHub 的 `main` 分支后，GitHub Actions 会自动测试、构建并发布。测试不通过就不会发布。
第一次使用前，要在仓库的 Settings → Pages 里把 Source 设成 “GitHub Actions”。
