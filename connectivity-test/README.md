# 连通测试（阶段 4-1）

用来比较两家后台在大陆手机网络上的速度和稳定性，选出主方案（REQUIREMENTS.md R-019）。
测试页发布在正式网站的 `/connectivity-test/` 下，网站里没有链接，只发给测试的朋友。

## 一、腾讯云开发（主方案）要在控制台做的设置

新建环境时数据库选 **PostgreSQL**（PG 模式，用户 2026-11-09 决定）。然后由账号主人（大陆朋友）或协作者在云开发控制台操作：

1. **身份认证 → 登录方式**
   - 打开“匿名登录”（连通测试用，测完可以关掉）
   - 打开“用户名密码登录”
   - 打开“邮箱登录”，发件邮箱填专用 QQ / 163 邮箱：SMTP 服务器 `smtp.qq.com` 或 `smtp.163.com`，端口 465，密码填邮箱的“授权码”（授权码只填在控制台，不要发给别人）
2. **安全配置 → Web 安全域名**：加上 `weit0529.github.io` 和 `localhost:5173`
3. **PostgreSQL 数据库**：打开 SQL 编辑器，把 `connectivity-test/cloudbase-pg.sql` 整段粘贴进去运行一次。它会建 `conn_test` 表，并设好“登录了的人（包括匿名登录）才能用、每人只能读写自己的数据，只拿公开密钥没登录的请求一律不行”
4. 把“环境 ID”填进 `connectivity-test/config.js` 的 `cloudbaseEnv`

## 二、Cloudflare（备用方案）要做的设置

在项目文件夹里运行（第 1 步会打开浏览器让你登录自己的 Cloudflare 账号）：

```bash
npx wrangler login
npx wrangler d1 create what-to-eat-test
```

把第二条命令输出的 `database_id` 填进 `backend/cloudflare/wrangler.jsonc`，然后：

```bash
npx wrangler d1 migrations apply what-to-eat-test --remote --config backend/cloudflare/wrangler.jsonc
npx wrangler secret put TEST_INVITE --config backend/cloudflare/wrangler.jsonc
npm run cf:deploy
```

`secret put` 时输入一个测试邀请码（自己定，比如一串随机字母）。部署完会输出 `https://what-to-eat-test.<你的子域名>.workers.dev`，填进 `connectivity-test/config.js` 的 `cloudflareApi`。

## 三、发给朋友

推送发布后，把下面的链接发给朋友（`#` 后面换成测试邀请码。`#` 后面的内容不会随打开网页发给服务器；点“开始测试”时，邀请码只会发给 `config.js` 里写死的 Cloudflare 后台。发布到网上的测试页不认网址里的 `?cf=`、`?env=` 参数）：

```
https://weit0529.github.io/what-to-eat/connectivity-test/#invite=测试邀请码
```

朋友点“开始测试”，测完点“复制结果”，粘贴到微信发回来。最好用不同运营商（移动、联通、电信）、Wi-Fi 和流量各测一次。

## 四、本机调试

```bash
npm run cf:migrate:local
npm run cf:dev
npm run dev
```

`backend/cloudflare/.dev.vars` 里写 `TEST_INVITE=local-test`（这个文件不上传），然后打开
`http://localhost:5173/connectivity-test/?cf=http://localhost:8787#invite=local-test`。

## 五、要注意

- Cloudflare 免费套餐每次请求的 CPU 时间有限制。注册和登录要算 10 万次 PBKDF2，本机后台耗时约 40ms，线上可能超限报错，连通测试会实测出来。
- 测试结束、选定主方案后，关掉腾讯云的“匿名登录”，删掉 `conn_test` 表；备用方案的 Worker 可以留着。
- 腾讯云免费版的 PostgreSQL 长时间没人用会不会休眠，官方文档没写；连通测试时隔一两天再测一次，看第一次写数据是不是明显变慢。
