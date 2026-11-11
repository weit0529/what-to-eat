// 发验证码邮件（阶段 4-3，REQUIREMENTS.md R-022）：后台连 QQ 邮箱的 SMTP 发信（用户 2026-11-10 选 6B）。
// 用现成库 worker-mailer（Cloudflare 的 TCP 连接；不能用 25 端口，这里用 465 加密端口）。
//
// 环境变量：
//   SMTP_HOST  发信服务器，默认 smtp.qq.com
//   SMTP_PORT  端口，默认 465（一连上就加密）
//   SMTP_USER  发信邮箱地址（secret：代码公开在 GitHub 上，邮箱地址也不写进去）
//   SMTP_PASS  邮箱的“授权码”（secret，用户自己用 wrangler 存，不写进代码、不经过 Agent）
//
// worker-mailer 要用 Cloudflare 才有的 cloudflare:sockets，Node 里的测试加载不了，所以用到时才导入；
// 测试里可以在 env.SEND_MAIL 放一个假的发信函数。

/** 邮件里显示的发件人名字 */
const FROM_NAME = '今天吃什么'
/** 连接 + 发信最多等多久；之后关连接最多再等 CLOSE_TIMEOUT_MS。加起来比网页的 20 秒短，网页能收到明确的结果 */
const SEND_TIMEOUT_MS = 15000
const CLOSE_TIMEOUT_MS = 3000
const SOCKET_TIMEOUT_MS = 10000

/** 等 promise，最多 ms 毫秒；超时就 reject(new Error(message))，并把计时器清掉 */
function within(promise, ms, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * 发一封纯文本邮件。发不出去时抛错（调用方决定怎么告诉用户）。
 * @param {object} env
 * @param {{ to: string, subject: string, text: string }} mail
 */
export async function sendMail(env, mail) {
  if (typeof env.SEND_MAIL === 'function') return env.SEND_MAIL(mail)
  // 本机开发：.dev.vars 里写 MAIL_MODE=log，邮件只打印在 wrangler dev 的输出里，不真发（线上不设这一项）
  if (env.MAIL_MODE === 'log') {
    console.log(`[本机开发，没有真发邮件] 收件人 ${mail.to}｜${mail.subject}`)
    return
  }
  if (!env.SMTP_USER || !env.SMTP_PASS) throw new Error('还没设置发信邮箱（SMTP_USER / SMTP_PASS）')
  const { WorkerMailer } = await import('worker-mailer')
  // 库自己的超时只管单次连接 / 单次回应，整封信的期限在这里管（Codex 第 31、32 轮）：
  // - 超时以后才连上的连接：不再发信，直接关掉（调用方已经当作没发出去了）
  // - 关连接也有期限，不让它拖住请求
  let finished = false
  let mailer = null
  let closing = null
  const close = () => {
    if (mailer && !closing) closing = within(Promise.resolve().then(() => mailer.close()), CLOSE_TIMEOUT_MS, '关闭发信连接超时').catch(() => {})
    return closing || Promise.resolve()
  }
  const work = (async () => {
    mailer = await WorkerMailer.connect({
      host: env.SMTP_HOST || 'smtp.qq.com',
      port: Number(env.SMTP_PORT || 465),
      secure: true,
      credentials: { username: env.SMTP_USER, password: env.SMTP_PASS },
      authType: ['login', 'plain'],
      socketTimeoutMs: SOCKET_TIMEOUT_MS,
      responseTimeoutMs: SOCKET_TIMEOUT_MS,
    })
    if (finished) {
      close()
      throw new Error('发信超时')
    }
    await mailer.send({
      from: { name: FROM_NAME, email: env.SMTP_USER },
      to: { email: mail.to },
      subject: mail.subject,
      text: mail.text,
    })
  })()
  work.catch(() => {})
  try {
    await within(work, SEND_TIMEOUT_MS, '发信超时')
  } finally {
    finished = true
    // 连接这一步就失败时库没有关连接（worker-mailer 1.3.1 的已知情况），那时拿不到 mailer，
    // 只能等 Cloudflare 在请求结束时回收
    await close()
  }
}

/** 验证码邮件的标题和正文 */
export function codeMail(purpose, code, minutes) {
  const what = purpose === 'register' ? '注册账号' : '重置密码'
  return {
    subject: `【今天吃什么】${what}的验证码：${code}`,
    text: `你好！\n\n你正在“今天吃什么”${what}，验证码是：${code}\n\n${minutes} 分钟内有效。如果不是你本人操作，不用理会这封邮件。\n`,
  }
}
