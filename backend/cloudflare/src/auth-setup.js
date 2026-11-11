// 后台登录（阶段 4-2 起）：用现成库 Better Auth，不自己写登录（用户 2026-11-09 决定，2026-11-10 批准安装）。
//
// 用到的功能：
//   - 用户名 + 密码登录（username 插件）；暂时不开放注册，账号由管理员建（4-3 再做邀请码注册）
//   - 管理员角色（admin 插件）：只有 role = admin 的人能管菜单、加管理员
//   - 登录凭证放请求头（bearer 插件）：网页在 github.io、后台在 pages.dev，不是同一个网站，
//     iPhone 的 Safari 会拦跨网站的 Cookie，所以凭证存在浏览器里、每次请求带 Authorization 头（用户选 2A）
//   - 密码加密用 PBKDF2（auth.js）：Better Auth 默认的 scrypt 在 Cloudflare 免费版上可能超出 CPU 时间，
//     PBKDF2 在连通测试里实测过不超时
//   - 防猜密码：登录次数限制，记在数据库里（Cloudflare 每个请求可能在不同机器上跑，记在内存里没用）
//   - 忘记密码（阶段 4-3）：邮箱验证码重置（emailOTP 插件）；验证码 6 位、10 分钟有效、最多试 5 次、库里只存哈希
//
// D1 数据库只在请求里才拿得到，所以每个请求现建一个 auth 对象（官方推荐的做法）。

import { betterAuth } from 'better-auth'
import { admin, bearer, emailOTP, username } from 'better-auth/plugins'
import { hashPassword, verifyPassword } from './auth.js'
import { allowedOrigins } from './http.js'
import { codeMail, sendMail } from './mailer.js'

/** 用户名：2～20 个字，只能是中文、英文字母、数字、下划线（和连通测试一致） */
export const USERNAME_RE = /^[\p{Script=Han}A-Za-z0-9_]{2,20}$/u

/**
 * 邮箱格式：和 Better Auth 找回密码时的检查（zod 4 的 z.email()）用同一条规则，保证注册过的邮箱一定能通过它的检查
 * （Codex 第 35 轮：两边规则不同时，worker.js 换邮箱会改变检查结果）。tests/backend-accounts.test.js 里有和 z.email() 对照的测试
 */
export const EMAIL_RE = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/

/**
 * 能不能用这个邮箱建账号（注册、加管理员）：格式对、不太长、不是 .invalid 结尾
 * （.invalid 留给 worker.js 名额用完时换上的占位邮箱，必须保证没有这个账号；Codex 第 35 轮）
 */
export const isAllowedEmail = (email) => email.length <= 254 && EMAIL_RE.test(email) && !/\.invalid$/i.test(email)

/** 把 PBKDF2 结果编成一个字符串存进数据库：pbkdf2$迭代次数$盐$结果 */
export async function encodePassword(password, iterations) {
  const { salt, hash, iterations: n } = await hashPassword(password, iterations)
  return `pbkdf2$${n}$${salt}$${hash}`
}

/** 核对密码；格式不对一律当作密码错 */
export async function checkPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : []
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 100000) return false
  return verifyPassword(password, { salt: parts[2], hash: parts[3], iterations })
}

/**
 * Better Auth 的设置。单独导出，生成建表 SQL 的脚本（scripts/gen-auth-migration.mjs）也用它。
 * @param {object} env  DB（数据库）、BETTER_AUTH_SECRET、AUTH_BASE_URL、ALLOWED_ORIGINS
 * @param {{ iterations?: number }} [opts]  测试里可以把 PBKDF2 次数调小，跑得快
 */
export function authOptions(env, opts = {}) {
  return {
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.AUTH_BASE_URL,
    basePath: '/api/auth',
    trustedOrigins: allowedOrigins(env),
    emailAndPassword: {
      enabled: true,
      // 不开放 Better Auth 自带的注册：普通用户走 /api/account/register（要邀请码 + 邮箱验证码，见 account-api.js）
      disableSignUp: true,
      // 找回密码后，所有已经登录的地方一律退出（拿到旧登录凭证的人也用不了了，Codex 第 31 轮）
      revokeSessionsOnPasswordReset: true,
      minPasswordLength: 8,
      maxPasswordLength: 64,
      password: {
        hash: (password) => encodePassword(password, opts.iterations),
        verify: ({ hash, password }) => checkPassword(password, hash),
      },
    },
    session: {
      // 登录一次保持 30 天；每天第一次用时自动续期
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      // 登录：同一个地址 15 分钟内最多试 10 次
      customRules: {
        '/sign-in/username': { window: 15 * 60, max: 10 },
        // 找回密码：要验证码按 IP 的限次在 worker.js 里做（send-limits.js 的 resetIpLimits），这里关掉——
        // 不然注册过的邮箱被冷却拦下时不经过这里，回应和没注册的不一样，能用来判断邮箱注册过没有（Codex 第 33 轮）。
        // 试验证码重置：同一个地址 10 分钟内最多 10 次（防止猜验证码）
        '/email-otp/request-password-reset': false,
        '/email-otp/reset-password': { window: 10 * 60, max: 10 },
      },
    },
    advanced: {
      // 不用 Cookie（见文件开头），也就不需要跨站 Cookie 的设置
      disableCSRFCheck: false,
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      // 发邮件放到后台慢慢发，不让“邮箱存不存在”体现在接口快慢上（Cloudflare 用 waitUntil 保证发完）
      ...(opts.waitUntil ? { backgroundTasks: { handler: opts.waitUntil } } : {}),
    },
    plugins: [
      username({
        minUsernameLength: 2,
        maxUsernameLength: 20,
        usernameValidator: (name) => USERNAME_RE.test(name),
      }),
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
      bearer(),
      emailOTP({
        otpLength: 6,
        expiresIn: RESET_CODE_SECONDS,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        // 不让验证码顺便注册新账号（注册走 /api/account/register，要邀请码）
        disableSignUp: true,
        // 只用到“忘记密码”这一种；其他种类的验证码接口都没开放（见 worker.js 的 AUTH_ROUTES）
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== 'forget-password') return
          await sendMail(env, { to: email, ...codeMail('reset', otp, RESET_CODE_SECONDS / 60) })
        },
      }),
    ],
  }
}

/** 找回密码验证码的有效时间（秒） */
export const RESET_CODE_SECONDS = 10 * 60

/** 每个请求现建一个 auth 对象 */
export function createAuth(env, opts) {
  return betterAuth(authOptions(env, opts))
}
