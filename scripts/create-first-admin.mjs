// 建第一个管理员（只在后台还没有任何管理员时有用；用户 2026-11-10 选 6A：由 Agent 用命令行建，给初始密码，登录后自己改）。
//
// 用法（BOOTSTRAP_TOKEN 是部署时设的一次性口令，用环境变量传，不写在命令里）：
//   BOOTSTRAP_TOKEN=口令 node scripts/create-first-admin.mjs --api https://what-to-eat-api.pages.dev --username 用户名 --email 邮箱
// 会随机生成一个 12 位初始密码并打印出来。建好以后这个接口就不能再用了；其他管理员在管理页里加。

import { parseArgs } from 'node:util'
import { randomInt } from 'node:crypto'

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'https://what-to-eat-api.pages.dev' },
    username: { type: 'string' },
    email: { type: 'string' },
  },
})

const token = process.env.BOOTSTRAP_TOKEN
if (!token || !values.username || !values.email) {
  console.error('用法：BOOTSTRAP_TOKEN=口令 node scripts/create-first-admin.mjs --api 后台地址 --username 用户名 --email 邮箱')
  process.exit(1)
}

// 去掉容易看错的字母和数字
const CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const password = Array.from({ length: 12 }, () => CHARS[randomInt(CHARS.length)]).join('')

const res = await fetch(`${values.api.replace(/\/+$/, '')}/api/admin/bootstrap`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token, username: values.username, email: values.email, password }),
})
const data = await res.json().catch(() => ({}))
if (!res.ok) {
  console.error(`没建成：${data.error || `HTTP ${res.status}`}`)
  process.exit(1)
}
console.log(`已建好管理员“${values.username}”（${values.email}）。`)
console.log(`初始密码：${password}`)
console.log('请登录管理页后在“管理员和密码”里改掉它。')
