// 管理页和后台说话的部分（src/admin/api.js）的测试：登录凭证的保存、带上、清掉
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { currentUser, getMenu, getToken, signIn, signOut } from '../src/admin/api.js'

const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers })

// 每个测试前清掉本机和这一页里记着的凭证
beforeEach(async () => {
  await signOut({
    fetchImpl: async () => {
      throw new TypeError('offline')
    },
  })
  localStorage.clear()
})

describe('管理页登录', () => {
  it('登录成功：记住响应头里的凭证，之后的请求带上 Authorization', async () => {
    const fetchImpl = vi.fn(async () => reply({ user: { id: 'u1', role: 'admin' } }, 200, { 'set-auth-token': 'tok-1' }))
    const user = await signIn('阿涛', 'pass-1234', { fetchImpl })
    expect(user.role).toBe('admin')
    expect(getToken()).toBe('tok-1')
    const menuFetch = vi.fn(async () => reply({ meals: [], dishes: [] }))
    await getMenu({ fetchImpl: menuFetch })
    expect(menuFetch.mock.calls[0][1].headers.authorization).toBe('Bearer tok-1')
  })

  it('密码错、试太多次时给出看得懂的说明', async () => {
    await expect(signIn('a', 'b', { fetchImpl: vi.fn(async () => reply({ message: 'Invalid' }, 401)) })).rejects.toThrow('用户名或密码不对')
    await expect(signIn('a', 'b', { fetchImpl: vi.fn(async () => reply({}, 429)) })).rejects.toThrow('15 分钟')
  })

  it('凭证过期（后台返回 401）时清掉本机凭证，当作没登录', async () => {
    localStorage.setItem('what-to-eat:admin-token:v1', 'old')
    const user = await currentUser({ fetchImpl: vi.fn(async () => reply({}, 401)) })
    expect(user).toBe(null)
    expect(getToken()).toBe('')
  })

  it('连不上后台时说清楚，不是“出错了”', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(getMenu({ fetchImpl: down })).rejects.toThrow('连不上后台')
  })

  it('退出登录：后台连不上也照样删掉本机凭证', async () => {
    localStorage.setItem('what-to-eat:admin-token:v1', 'tok')
    await signOut({
      fetchImpl: vi.fn(async () => {
        throw new TypeError('offline')
      }),
    })
    expect(getToken()).toBe('')
  })
})

describe('Codex 第 28 轮的修复', () => {
  it('后台换发了新凭证（如改密码后）就换上，之后的请求用新的', async () => {
    localStorage.setItem('what-to-eat:admin-token:v1', 'old')
    const { changePassword } = await import('../src/admin/api.js')
    await changePassword('old-pass-1', 'new-pass-1', {
      fetchImpl: vi.fn(async () => reply({ token: null }, 200, { 'set-auth-token': 'new-token' })),
    })
    expect(getToken()).toBe('new-token')
    const menuFetch = vi.fn(async () => reply({ meals: [], dishes: [] }))
    await getMenu({ fetchImpl: menuFetch })
    expect(menuFetch.mock.calls[0][1].headers.authorization).toBe('Bearer new-token')
  })

  it('浏览器不让存登录状态时，这一页里照样能用，并标记“没存住”', async () => {
    const { tokenNotSaved } = await import('../src/admin/api.js')
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    try {
      await signIn('阿涛', 'pass-1234', {
        fetchImpl: vi.fn(async () => reply({ user: { id: 'u1', role: 'admin' } }, 200, { 'set-auth-token': 'mem-token' })),
      })
      expect(tokenNotSaved()).toBe(true)
      const menuFetch = vi.fn(async () => reply({ meals: [], dishes: [] }))
      await getMenu({ fetchImpl: menuFetch })
      expect(menuFetch.mock.calls[0][1].headers.authorization).toBe('Bearer mem-token')
    } finally {
      spy.mockRestore()
      await signOut({ fetchImpl: vi.fn(async () => reply({})) })
    }
  })
})

describe('Codex 第 29 轮的修复', () => {
  it('另一个标签页换了新凭证：这一页用新的；旧凭证返回 401 时不会把新凭证删掉', async () => {
    await signIn('阿涛', 'pass-1234', {
      fetchImpl: vi.fn(async () => reply({ user: { id: 'u1', role: 'admin' } }, 200, { 'set-auth-token': 'old-token' })),
    })
    // 另一个标签页改了密码，把新凭证写进了共用的 localStorage
    localStorage.setItem('what-to-eat:admin-token:v1', 'new-token')
    const menuFetch = vi.fn(async () => reply({ meals: [], dishes: [] }))
    await getMenu({ fetchImpl: menuFetch })
    expect(menuFetch.mock.calls[0][1].headers.authorization).toBe('Bearer new-token')

    // 一个用旧凭证发出去的请求回来是 401，而这时存的已经是新凭证：不删新凭证
    const slowFetch = vi.fn(async () => {
      localStorage.setItem('what-to-eat:admin-token:v1', 'newer-token')
      return reply({}, 401)
    })
    await expect(getMenu({ fetchImpl: slowFetch })).rejects.toThrow()
    expect(getToken()).toBe('newer-token')
  })

  it('改密码时才存不进去：标记“没存住”（页面会提醒），这一页继续用新凭证', async () => {
    const { changePassword, tokenSaveFailed } = await import('../src/admin/api.js')
    await signIn('阿涛', 'pass-1234', {
      fetchImpl: vi.fn(async () => reply({ user: { id: 'u1', role: 'admin' } }, 200, { 'set-auth-token': 'first' })),
    })
    expect(tokenSaveFailed.value).toBe(false)
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    try {
      await changePassword('a-pass-123', 'b-pass-123', {
        fetchImpl: vi.fn(async () => reply({}, 200, { 'set-auth-token': 'second' })),
      })
      expect(tokenSaveFailed.value).toBe(true)
      expect(getToken()).toBe('second')
    } finally {
      spy.mockRestore()
    }
  })
})
