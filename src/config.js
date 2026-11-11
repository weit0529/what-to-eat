// 网站和管理页共用的设置。
//
// API_BASE：后台的地址（Cloudflare Pages，用户 2026-11-10 定为主方案）。
// 本机开发时可以在项目根目录建 .env.development.local，写 VITE_API_BASE=http://localhost:8787
// 改连本机的后台（npm run cf:dev）；不写就连线上后台。
export const API_BASE = (import.meta.env?.VITE_API_BASE || 'https://what-to-eat-api.pages.dev').replace(/\/+$/, '')
