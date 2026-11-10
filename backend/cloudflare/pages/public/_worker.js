// Cloudflare Pages 的“高级模式”入口：整个后台就是 backend/cloudflare/src/worker.js，这里只是转一下。
// 为什么另用 Pages 部署：workers.dev 的网址在大陆连不上（用户 2026-11-10 实测），
// 有报告说 pages.dev 的网址能访问，所以同一份后台再部署一份到 Pages 试试（用户 2026-11-10 决定）。
// 部署时 wrangler 会把 worker.js 和它引用的 auth.js 一起打包进来。
export { default } from '../../src/worker.js'
