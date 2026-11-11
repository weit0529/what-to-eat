// 账号页和后台说话的部分（src/account/api.js）的测试
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { register, resetPassword, signIn, signOut, USER_NAME_KEY, USER_TOKEN_KEY } from '../src/account/api.js'

const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers })

beforeEach(async () => {
  await signOut({ fetchImpl: async () => reply({}) })
  localStorage.clear()
})

describe('账号页', () => {
  it('注册成功后直接登录，记下凭证和用户名（首页底部显示“我的账号（名字）”用）', async () => {
    const fetchImpl = vi.fn(async (url) =>
      url.endsWith('/api/account/register')
        ? reply({ ok: true }, 201)
        : reply({ user: { displayUsername: '小明', role: 'user' } }, 200, { 'set-auth-token': 'u-token' }),
    )
    await register({ invite: 'ABCD2345', email: 'm@example.com', code: '123456', username: '小明', password: 'ming-pass-1' }, { fetchImpl })
    expect(fetchImpl.mock.calls.map((c) => new URL(c[0]).pathname)).toEqual(['/api/account/register', '/api/auth/sign-in/username'])
    expect(localStorage.getItem(USER_TOKEN_KEY)).toBe('u-token')
    expect(localStorage.getItem(USER_NAME_KEY)).toBe('小明')
  })

  it('退出登录后清掉凭证和用户名', async () => {
    await signIn('小明', 'ming-pass-1', { fetchImpl: async () => reply({ user: { displayUsername: '小明' } }, 200, { 'set-auth-token': 't' }) })
    await signOut({ fetchImpl: async () => reply({}) })
    expect(localStorage.getItem(USER_TOKEN_KEY)).toBe(null)
    expect(localStorage.getItem(USER_NAME_KEY)).toBe(null)
  })

  it('注册失败时显示后台给的中文说明', async () => {
    const fetchImpl = async () => reply({ error: '验证码不对' }, 400)
    await expect(register({ invite: 'x', email: 'm@example.com', code: '000000', username: '小明', password: 'ming-pass-1' }, { fetchImpl })).rejects.toThrow('验证码不对')
  })

  it('重置密码失败时把英文错误换成看得懂的话', async () => {
    await expect(resetPassword('m@example.com', '000000', 'new-pass-1', { fetchImpl: async () => reply({ message: 'Invalid OTP' }, 400) })).rejects.toThrow('验证码不对或者过期了')
    await expect(resetPassword('m@example.com', '000000', 'new-pass-1', { fetchImpl: async () => reply({}, 429) })).rejects.toThrow('10 分钟')
  })
})
