// 网页和后台说话的共用部分（管理页、账号页都用）：带登录凭证发请求、登录、退出、改密码。
//
// 登录凭证（Better Auth 的 bearer token）存在浏览器的 localStorage 里，每次请求放在 Authorization 头（用户选 2A：
// 网页和后台不是同一个网站，iPhone 的 Safari 会拦跨网站的 Cookie）。退出登录时删掉。
// 浏览器不让存时（如无痕模式、空间满），凭证只记在这一页里：这次能用，关掉或刷新页面后要重新登录（Codex 第 28 轮）。
// 管理页和账号页各用一个存凭证的位置（tokenKey），互不影响。

import { ref } from 'vue'
import { API_BASE } from './config.js'

/** 一次请求最多等多久 */
const TIMEOUT_MS = 20000

/** 后台返回的错误：message 给人看；status 是 HTTP 状态码；problems / errors 是详细列表 */
export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message)
    this.status = status
    this.problems = data.problems || []
    this.errors = data.errors || []
  }
}

/**
 * 建一个和后台说话的客户端。
 * @param {string} tokenKey  登录凭证存在 localStorage 的哪个位置
 */
export function createApiClient(tokenKey) {
  /** 这一页里记着的凭证：只在存不进 localStorage 时用它 */
  let memoryToken = ''
  /**
   * 最近一次存凭证是否失败。做成响应式的，管理页随时据此提醒“关掉或刷新页面后要重新登录”
   * （不只是登录时；改密码换发新凭证时才存不进去也要提醒，Codex 第 29 轮）
   */
  const tokenSaveFailed = ref(false)
  const tokenNotSaved = () => tokenSaveFailed.value

  /**
   * 当前的凭证。localStorage 能用时以它为准：另一个标签页改密码换发的新凭证，这一页也能马上用上（Codex 第 29 轮）；
   * 存不进去时才用这一页内存里的
   */
  function getToken() {
    if (tokenSaveFailed.value) return memoryToken
    try {
      return localStorage.getItem(tokenKey) || ''
    } catch {
      return memoryToken
    }
  }

  function setToken(token) {
    memoryToken = token || ''
    try {
      if (token) localStorage.setItem(tokenKey, token)
      else localStorage.removeItem(tokenKey)
      tokenSaveFailed.value = false
    } catch {
      tokenSaveFailed.value = Boolean(token)
    }
  }

  /**
   * 调后台。成功返回 JSON；失败抛 ApiError。
   * body 是 Blob（如压缩好的图片，阶段 4-4d）时原样发送，content-type 用它自己的类型；其他按 JSON 发
   * @param {string} path  例如 /api/admin/menu
   */
  async function request(path, { method = 'GET', body, fetchImpl = fetch } = {}) {
    const headers = {}
    const token = getToken()
    if (token) headers.authorization = `Bearer ${token}`
    const isBlob = typeof Blob !== 'undefined' && body instanceof Blob
    if (body !== undefined) headers['content-type'] = isBlob ? body.type || 'application/octet-stream' : 'application/json'
    let res
    try {
      res = await fetchImpl(`${API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : isBlob ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new ApiError('连不上后台，检查一下网络再试', 0)
    }
    let data = {}
    try {
      data = await res.json()
    } catch {
      // 没有 JSON 正文
    }
    // 凭证失效：只在失效的就是现在这个凭证时才清掉；如果别的标签页已经换上了新凭证，不要把新的也删了（Codex 第 29 轮）
    if (res.status === 401 && path !== '/api/auth/sign-in/username' && getToken() === token) setToken('')
    // 后台换发了新凭证（如改密码后，旧的登录全部作废、给当前这一处发新的）：马上换上，不然下一次请求就是 401（Codex 第 28 轮）
    const renewed = res.ok ? res.headers.get('set-auth-token') : null
    if (renewed) setToken(renewed)
    if (!res.ok) throw new ApiError(data.error || data.message || `后台出错了（HTTP ${res.status}）`, res.status, data)
    return { data, headers: res.headers }
  }

  /** 用户名 + 密码登录；成功后记住凭证，返回用户信息 */
  async function signIn(username, password, opts) {
    try {
      const { data, headers } = await request('/api/auth/sign-in/username', {
        method: 'POST',
        body: { username, password },
        ...opts,
      })
      const token = headers.get('set-auth-token')
      if (!token) throw new ApiError('登录没成功（没拿到登录凭证）', 500)
      setToken(token)
      return data.user
    } catch (err) {
      if (err.status === 401) throw new ApiError('用户名或密码不对', 401)
      if (err.status === 429) throw new ApiError('试的次数太多了，请 15 分钟后再试', 429)
      throw err
    }
  }

  /** 现在登录的是谁；没登录返回 null */
  async function currentUser(opts) {
    if (!getToken()) return null
    try {
      const { data } = await request('/api/auth/get-session', opts)
      return data?.user ?? null
    } catch (err) {
      if (err.status === 401) return null
      throw err
    }
  }

  async function signOut(opts) {
    try {
      await request('/api/auth/sign-out', { method: 'POST', body: {}, ...opts })
    } catch {
      // 退出时后台连不上也没关系：本机的凭证照样删掉
    } finally {
      setToken('')
    }
  }

  async function changePassword(currentPassword, newPassword, opts) {
    try {
      await request('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword, revokeOtherSessions: true },
        ...opts,
      })
    } catch (err) {
      if (err.status === 400 || err.status === 401) throw new ApiError('原密码不对，或者新密码不合要求（8～64 位）', err.status)
      throw err
    }
  }

  return { tokenSaveFailed, tokenNotSaved, getToken, setToken, request, signIn, currentUser, signOut, changePassword }
}
