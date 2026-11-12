# 后台（Cloudflare Pages + D1）

主后台（用户 2026-11-10 定为主方案）。代码在 `src/`，部署到 Cloudflare Pages 项目 `what-to-eat-api`，网址 `https://what-to-eat-api.pages.dev`。
`workers.dev` 的网址在大陆连不上，所以用 Pages（`pages/public/_worker.js` 只是转发到 `src/worker.js`）。

| 文件 | 做什么 |
|---|---|
| `src/worker.js` | 入口：按网址分给下面几部分 |
| `src/auth-setup.js` | 登录（现成库 Better Auth：用户名 + 密码、管理员角色、凭证放请求头、登录次数限制） |
| `src/menu-api.js` | 菜单：网站读菜单（公开）；管理员增删改、导入、餐次、管理员名单 |
| `src/account-api.js` | 普通用户注册（邀请码 + 邮箱验证码）、管理员的邀请码 |
| `src/my-menu-api.js` | 我的菜单（登录用户加菜、提交审核）、管理员审核、共享菜移到通用菜单、加菜总开关和黑白名单 |
| `src/images-api.js` | 菜的图片：上传（存 R2）、转发（经 pages.dev，大陆能打开） |
| `src/eaten-api.js` | 吃过记录跟账号走：网页攒下的改动一起同步，返回账号里的记录 |
| `src/send-limits.js` | 发信和改菜的次数限制（判断和占用在一条 SQL 里） |
| `src/mailer.js` | 发验证码邮件（worker-mailer 连 QQ 邮箱 SMTP） |
| `src/connectivity.js` | 阶段 4-1 连通测试用的接口（测试页 `/connectivity-test/` 在用） |
| `src/auth.js` | 密码加密（PBKDF2）等小工具 |
| `src/http.js` | JSON 响应、跨域头、限长读请求体 |
| `migrations/` | 建表 SQL，按编号顺序执行 |

## 环境变量

| 名字 | 放哪 | 做什么 |
|---|---|---|
| `DB` | `wrangler.jsonc` | D1 数据库 `what-to-eat-test`（亚太区域） |
| `IMAGES` | `wrangler.jsonc` | R2 存储桶 `what-to-eat-images`，放在线上传的菜图片（阶段 4-4d） |
| `ALLOWED_ORIGINS` | `wrangler.jsonc` | 允许调用后台的网页（GitHub Pages、本机开发） |
| `AUTH_BASE_URL` | `wrangler.jsonc` | 后台自己的网址 |
| `BETTER_AUTH_SECRET` | secret | 登录用的密钥，随机 64 位十六进制；**换了它所有人都要重新登录** |
| `BOOTSTRAP_TOKEN` | secret | 建第一个管理员用的一次性口令；建好后可以删掉 |
| `TEST_INVITE` | secret | 连通测试的邀请码 |
| `SMTP_HOST` / `SMTP_PORT` | `wrangler.jsonc` | 发信服务器，smtp.qq.com、465 |
| `SMTP_USER` | secret | 发信邮箱地址（不写进公开的代码） |
| `SMTP_PASS` | secret | 邮箱的“授权码”（在 QQ 邮箱设置里开 SMTP 后拿到；用户自己存，不经过别人） |
| `MAIL_MODE` | 只在本机 `.dev.vars` | 写 `log` 时邮件只打印在 wrangler dev 的输出里，不真发 |

## 部署（在项目根目录运行）

```bash
npx wrangler d1 migrations apply what-to-eat-test --remote --config backend/cloudflare/wrangler.jsonc
npm run cf:pages:deploy
```

第一次部署前还要设两个 secret（在 `backend/cloudflare/pages` 文件夹里运行，按提示输入值）：

```bash
npx wrangler pages secret put BETTER_AUTH_SECRET --project-name what-to-eat-api
npx wrangler pages secret put BOOTSTRAP_TOKEN --project-name what-to-eat-api
```

发验证码邮件还要两个 secret（同样在 `backend/cloudflare/pages` 文件夹里运行，按提示输入；授权码只由邮箱主人自己输入）：

```bash
npx wrangler pages secret put SMTP_USER --project-name what-to-eat-api
npx wrangler pages secret put SMTP_PASS --project-name what-to-eat-api
```

放菜图片的 R2 存储桶（阶段 4-4d）：先在 Cloudflare 控制台开通 R2（可能要绑卡），再建桶，然后才能部署（配置里绑了它，没建好会部署失败）：

```bash
npx wrangler r2 bucket create what-to-eat-images
```

设完 secret 要再部署一次才生效。然后建第一个管理员（见 `scripts/create-first-admin.mjs`），其他管理员在管理页里加。

## 本机运行

`backend/cloudflare/.dev.vars`（不上传）里写 `TEST_INVITE`、`BETTER_AUTH_SECRET`、`BOOTSTRAP_TOKEN`、`AUTH_BASE_URL=http://localhost:8787`，然后：

```bash
npm run cf:migrate:local
npm run cf:dev
```

网页连本机后台：项目根目录建 `.env.development.local`（不上传），写 `VITE_API_BASE=http://localhost:8787`，再 `npm run dev`。

## 改了登录插件之后

`node scripts/gen-auth-migration.mjs` 重新生成 `migrations/0003_auth.sql` 的内容；已经部署过的数据库要另写一个新编号的迁移文件来改表，不能直接改 0003。
