// 账号页和后台说话：登录、注册（邀请码 + 邮箱验证码）、找回密码。通用部分见 src/api-client.js。

import { ApiError, createApiClient } from '../api-client.js'

export { ApiError }

/** 登录凭证存的位置（和管理页分开）；正式网站页面底部据此显示“我的账号”还是“登录 / 注册” */
export const USER_TOKEN_KEY = 'what-to-eat:user-token:v1'
/** 登录后记下用户名，正式网站页面底部显示用（不是秘密） */
export const USER_NAME_KEY = 'what-to-eat:user-name:v1'

const client = createApiClient(USER_TOKEN_KEY)
export const { tokenSaveFailed, getToken, request, currentUser, changePassword } = client

function rememberName(name) {
  try {
    if (name) localStorage.setItem(USER_NAME_KEY, name)
    else localStorage.removeItem(USER_NAME_KEY)
  } catch {
    // 存不了也没关系，只影响首页底部显示的名字
  }
}

export async function signIn(username, password, opts) {
  const user = await client.signIn(username, password, opts)
  rememberName(user?.displayUsername || user?.username || user?.name)
  return user
}

export async function signOut(opts) {
  await client.signOut(opts)
  rememberName('')
}

/** 注册第一步：凭邀请码往邮箱发验证码 */
export const sendSignupCode = (invite, email, opts) =>
  request('/api/account/send-code', { method: 'POST', body: { invite, email }, ...opts })

/** 注册第二步：填验证码、用户名、密码，注册成功后直接登录 */
export async function register(form, opts) {
  await request('/api/account/register', { method: 'POST', body: form, ...opts })
  return signIn(form.username, form.password, opts)
}

/** 忘记密码第一步：往邮箱发验证码（邮箱没注册过也会说“已发送”，不暴露谁注册过） */
export const requestReset = (email, opts) =>
  request('/api/auth/email-otp/request-password-reset', { method: 'POST', body: { email }, ...opts })

/** 忘记密码第二步：凭验证码设新密码 */
export async function resetPassword(email, otp, password, opts) {
  try {
    await request('/api/auth/email-otp/reset-password', { method: 'POST', body: { email, otp, password }, ...opts })
  } catch (err) {
    if (err.status === 400 || err.status === 403) throw new ApiError('验证码不对或者过期了，或者新密码不合要求（8～64 位）', err.status)
    if (err.status === 429) throw new ApiError('试的次数太多了，请过 10 分钟再试', 429)
    throw err
  }
}
