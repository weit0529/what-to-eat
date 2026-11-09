// 备用后台（Cloudflare Workers）的登录工具：密码加密、登录凭证。
// 只用 Web Crypto（浏览器、Cloudflare Workers、Node.js 都自带），不装额外的库。
//
// 密码不存原文：存“随机盐 + PBKDF2-SHA256 算出来的结果”。登录时用同样的盐再算一遍，结果一样才算对。
// 登录凭证（token）也不存原文：数据库里只存它的 SHA-256，数据库泄露了也拿不到能用的凭证。

/** PBKDF2 的迭代次数。Cloudflare Workers 最多支持 100000 次；免费套餐每次请求有 CPU 时间限制，连通测试会实测 */
export const PBKDF2_ITERATIONS = 100000

/** 用户名：2～20 个字，只能是中文、英文字母、数字、下划线 */
const USERNAME_RE = /^[\p{Script=Han}A-Za-z0-9_]{2,20}$/u

/** 检查用户名和密码的格式。合格返回 null，不合格返回一句给用户看的说明 */
export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return '用户名要 2～20 个字，只能用中文、英文字母、数字、下划线'
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 64) {
    return '密码要 8～64 位'
  }
  return null
}

const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** 随机字节，转成十六进制字符串 */
export function randomHex(byteLength) {
  return toHex(crypto.getRandomValues(new Uint8Array(byteLength)))
}

async function pbkdf2(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, 256)
  return toHex(bits)
}

/**
 * 加密一个新密码。
 * @returns {Promise<{salt: string, hash: string, iterations: number}>} 都存进数据库
 */
export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = randomHex(16)
  return { salt, hash: await pbkdf2(password, fromHex(salt), iterations), iterations }
}

/** 核对密码。比较时逐位比完，不提前退出，避免靠时间差猜密码 */
export async function verifyPassword(password, { salt, hash, iterations }) {
  const actual = await pbkdf2(password, fromHex(salt), iterations)
  if (actual.length !== hash.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ hash.charCodeAt(i)
  return diff === 0
}

/** 登录凭证的 SHA-256（数据库里只存这个） */
export async function hashToken(token) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
}
