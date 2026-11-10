// 连通测试的配置。账号准备好后把下面两项填上再发布：
//   cloudbaseEnv   腾讯云开发的环境 ID（朋友开通免费体验环境后在控制台能看到）
//   cloudflareApi  Cloudflare 后台的地址（npm run cf:pages:deploy 部署的 https://what-to-eat-api.pages.dev）
// 本机调试（页面开在 localhost）时，可以在网址后面加 ?env=环境ID&cf=地址 临时覆盖；
// 发布到网上的页面不认这两个参数，免得别人发来改了后台地址的链接，把测试邀请码骗走（Codex 第 23 轮）。
// 测试邀请码不写在这里：发给朋友的链接末尾带上 #invite=邀请码。
// # 后面的内容不会随打开网页发给服务器；点“开始测试”时，邀请码只会发给上面写死的 Cloudflare 后台。
export const CONFIG = {
  cloudbaseEnv: '',
  // workers.dev 在大陆连不上（用户 2026-11-10 实测），改用 Cloudflare Pages 部署的同一后台
  cloudflareApi: 'https://what-to-eat-api.pages.dev',
}

/** 页面是不是开在本机（开发调试） */
const isLocalHost = (hostname) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname)

/** 读配置：本机调试时网址参数优先；发布到网上时只用上面写死的值 */
export function readConfig(location = window.location) {
  const query = isLocalHost(location.hostname) ? new URLSearchParams(location.search) : new URLSearchParams()
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
  return {
    cloudbaseEnv: query.get('env') || CONFIG.cloudbaseEnv,
    cloudflareApi: (query.get('cf') || CONFIG.cloudflareApi).replace(/\/+$/, ''),
    invite: hash.get('invite') || '',
  }
}
