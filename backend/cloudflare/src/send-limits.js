// 发验证码邮件的次数限制（阶段 4-3）：防止有人拿网站给别人的邮箱狂发信、把发信邮箱的额度用光。
//
// 每个限制是一个“名额桶”：key（如 ip:1.2.3.4、reset-email:a@b.com）在 windowMs 时间窗口里最多 max 次。
// 判断和占用写在同一条 SQL 里（Codex 第 31 轮：原来先查后写，并发请求能一起挤过上限）：
// 数据库一次只执行一条写入，条件不满足时这条 UPDATE 什么都不改，changes 为 0，就是没抢到名额。

/**
 * 占用一个名额。抢到返回 { key, windowStart }（退还时用来认出是哪个窗口的名额），满了返回 null。
 * @param {{ key: string, windowMs: number, max: number }} limit
 */
export async function takeQuota(env, { key, windowMs, max }, now) {
  const row = await env.DB.prepare(
    `INSERT INTO send_limits (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END
     WHERE ?2 - window_start >= ?3 OR count < ?4
     RETURNING window_start`,
  )
    .bind(key, now, windowMs, max)
    .first()
  return row ? { key, windowStart: row.window_start } : null
}

/**
 * 退还名额。只退同一个窗口里的（Codex 第 32 轮：窗口已经换了的话，新窗口的次数是别人的，不能减）。
 * 退还出错只记日志：最坏是少发几封，不会多发。
 */
export async function releaseQuotas(env, taken) {
  for (const { key, windowStart } of taken || []) {
    try {
      await env.DB.prepare('UPDATE send_limits SET count = count - 1 WHERE key = ? AND window_start = ? AND count > 0')
        .bind(key, windowStart)
        .run()
    } catch (err) {
      console.error('退还发信名额出错', key, err)
    }
  }
}

/**
 * 依次占用几个名额。都抢到返回占到的名额列表（以后可以用 releaseQuotas 退还）；
 * 任何一个满了或者出错，就把已经占的退回去，满了返回 null，出错照样抛出。
 * 把最严的（如 60 秒冷却）放在最前面，满了就不碰后面的。
 */
export async function takeQuotas(env, limits, now) {
  const taken = []
  try {
    for (const limit of limits) {
      const got = await takeQuota(env, limit, now)
      if (!got) {
        await releaseQuotas(env, taken)
        return null
      }
      taken.push(got)
    }
  } catch (err) {
    await releaseQuotas(env, taken)
    throw err
  }
  return taken
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 发信邮箱一天总共最多发多少封（两种验证码各自的上限，防止把 QQ 邮箱的额度用光） */
export const DAILY_TOTAL = 200

/** 注册验证码的限制：同一邮箱 60 秒一次、一天 10 封；同一 IP 一小时 10 封；全站一天 DAILY_TOTAL 封 */
export const signupLimits = (email, ip) => [
  { key: `signup-cool:${email}`, windowMs: MINUTE, max: 1 },
  { key: `email:${email}`, windowMs: DAY, max: 10 },
  { key: `ip:${ip}`, windowMs: HOUR, max: 10 },
  { key: 'signup-total', windowMs: DAY, max: DAILY_TOTAL },
]

/**
 * 找回密码要验证码按 IP 的限制：10 分钟 3 次。不管邮箱注册过没有、格式对不对都先过这一关，
 * 而且不退还，这样两种邮箱的回应完全一样（Codex 第 33 轮）
 */
export const resetIpLimits = (ip) => [{ key: `reset-ip:${ip}`, windowMs: 10 * MINUTE, max: 3 }]

/**
 * 找回密码验证码的限制：同一邮箱 60 秒一次、一天 5 封；全站一天 DAILY_TOTAL 封（IP 的限制见上面 resetIpLimits）。
 * 只给真实注册过的邮箱占，Better Auth 没接受（格式错、IP 超限）就退回（worker.js）
 */
export const resetLimits = (email) => [
  { key: `reset-cool:${email}`, windowMs: MINUTE, max: 1 },
  { key: `reset-email:${email}`, windowMs: DAY, max: 5 },
  { key: 'reset-total', windowMs: DAY, max: DAILY_TOTAL },
]
