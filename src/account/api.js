// 账号页和后台说话：登录、注册（邀请码 + 邮箱验证码）、找回密码。通用部分见 src/api-client.js。

import { ApiError, createApiClient } from '../api-client.js'
import { clearAccountEaten } from '../ui/eaten-account.js'

export { ApiError }

/** 登录凭证存的位置（和管理页分开）；正式网站页面底部据此显示“我的账号”还是“登录 / 注册” */
export const USER_TOKEN_KEY = 'what-to-eat:user-token:v1'
/** 登录后记下用户名，正式网站页面底部显示用（不是秘密） */
export const USER_NAME_KEY = 'what-to-eat:user-name:v1'
/** 登录后记下账号编号：首页把“吃过”记录的副本按账号分开存（阶段 4-5，不是秘密） */
export const USER_ID_KEY = 'what-to-eat:user-id:v1'
/** 4-5 第一版用过的副本位置（不分账号），退出登录时顺手删掉 */
const LEGACY_EATEN_KEY = 'what-to-eat:eaten-account:v1'

const client = createApiClient(USER_TOKEN_KEY)
export const { tokenSaveFailed, getToken, request, currentUser, changePassword } = client

function rememberUserId(id) {
  try {
    if (id) localStorage.setItem(USER_ID_KEY, id)
    else localStorage.removeItem(USER_ID_KEY)
  } catch {
    // 存不了：首页会从后台拿
  }
}

function storedUserId() {
  try {
    return localStorage.getItem(USER_ID_KEY) || ''
  } catch {
    return ''
  }
}

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
  // 记下账号编号：首页按它分开存“吃过”记录的副本，别的账号的副本读不到（阶段 4-5，Codex 第 47 轮）
  rememberUserId(user?.id)
  return user
}

export async function signOut(opts) {
  const userId = storedUserId()
  await client.signOut(opts)
  rememberName('')
  rememberUserId('')
  // 退出登录：删掉这台手机上这个账号的“吃过”记录副本（共用手机时别人看不到）；本机自己的记录不动（用户选 1A）
  clearAccountEaten(userId)
  try {
    localStorage.removeItem(LEGACY_EATEN_KEY)
  } catch {
    // 没关系
  }
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

// ---- 我的菜（阶段 4-4，R-024、R-029） ----

/** 我的菜、我提交且已通过的菜、我现在能不能加改菜 */
export const listMyDishes = (opts) => request('/api/my/dishes', opts).then((r) => r.data)
/** 内部菜单（通用 + 共享 + 我的）：加菜表单要用里面的餐次和已有的分类 */
export const myMenu = (opts) => request('/api/my/menu', opts).then((r) => r.data)
export const addMyDish = (dish, opts) => request('/api/my/dishes', { method: 'POST', body: dish, ...opts }).then((r) => r.data.dish)
export const updateMyDish = (id, dish, opts) =>
  request(`/api/my/dishes/${encodeURIComponent(id)}`, { method: 'PUT', body: dish, ...opts }).then((r) => r.data.dish)
export const deleteMyDish = (id, opts) => request(`/api/my/dishes/${encodeURIComponent(id)}`, { method: 'DELETE', ...opts })
export const submitMyDish = (id, opts) =>
  request(`/api/my/dishes/${encodeURIComponent(id)}/submit`, { method: 'POST', ...opts }).then((r) => r.data.dish)
/** 上传一张（已压缩的）图片，返回文件名（up_ 开头），填进自己的菜的 image（阶段 4-4d） */
export const uploadImage = (blob, opts) => request('/api/images', { method: 'POST', body: blob, ...opts }).then((r) => r.data.image)
