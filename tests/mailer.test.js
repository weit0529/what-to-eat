// @vitest-environment node
// 发信的期限和关连接（Codex 第 32 轮）：worker-mailer 换成假的，用假计时器控制连接、发信、关闭各要多久
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ connect: null, send: 0, close: 0, closeDelay: 0 }))

vi.mock('worker-mailer', () => ({
  WorkerMailer: {
    connect: (...args) => fake.connect(...args),
  },
}))

const { sendMail } = await import('../backend/cloudflare/src/mailer.js')

const env = { SMTP_USER: 'sender@example.com', SMTP_PASS: 'x' }
const mail = { to: 'a@example.com', subject: 's', text: 't' }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const mailer = ({ sendMs = 0 } = {}) => ({
  send: async () => {
    await wait(sendMs)
    fake.send++
  },
  close: () => {
    fake.close++
    return fake.closeDelay === Infinity ? new Promise(() => {}) : wait(fake.closeDelay)
  },
})

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(fake, { send: 0, close: 0, closeDelay: 0 })
})
afterEach(() => vi.useRealTimers())

/** 让 promise 跑到结束（推进假时间），返回 { ok, error, at }（at = 结束时过了多少毫秒） */
async function settle(promise, maxMs = 60000) {
  const start = Date.now()
  let out = null
  promise.then(
    () => (out = { ok: true, at: Date.now() - start }),
    (error) => (out = { ok: false, error, at: Date.now() - start }),
  )
  for (let t = 0; t < maxMs && !out; t += 100) await vi.advanceTimersByTimeAsync(100)
  return out
}

describe('发信的期限', () => {
  it('正常：发一封，然后关连接', async () => {
    fake.connect = async () => mailer()
    const r = await settle(sendMail(env, mail))
    expect(r.ok).toBe(true)
    expect([fake.send, fake.close]).toEqual([1, 1])
  })

  it('连接太慢：超时报错；后来才连上的连接不再发信，直接关掉', async () => {
    fake.connect = async () => {
      await wait(20000)
      return mailer()
    }
    const r = await settle(sendMail(env, mail))
    expect(r.ok).toBe(false)
    expect(r.error.message).toBe('发信超时')
    expect(r.at).toBeLessThanOrEqual(15100)
    await vi.advanceTimersByTimeAsync(10000)
    expect([fake.send, fake.close]).toEqual([0, 1])
  })

  it('发信太慢：超时报错，并关掉连接', async () => {
    fake.connect = async () => mailer({ sendMs: 30000 })
    const r = await settle(sendMail(env, mail))
    expect(r.ok).toBe(false)
    expect(fake.close).toBe(1)
    expect(r.at).toBeLessThanOrEqual(18100)
  })

  it('关连接一直不回应：最多再等 3 秒，整封信不超过 18 秒', async () => {
    fake.closeDelay = Infinity
    fake.connect = async () => mailer({ sendMs: 14000 })
    const r = await settle(sendMail(env, mail))
    expect(r.ok).toBe(true)
    expect(fake.send).toBe(1)
    expect(r.at).toBeLessThanOrEqual(17100)
  })

  it('连接失败：报错，不发信', async () => {
    fake.connect = async () => {
      throw new Error('认证失败')
    }
    const r = await settle(sendMail(env, mail))
    expect(r.ok).toBe(false)
    expect(r.error.message).toBe('认证失败')
    expect(fake.send).toBe(0)
  })
})
