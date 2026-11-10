// 连通测试页的界面部分：读配置、点按钮跑测试、显示结果、复制结果；账号功能测试（管理员用）。
import '../src/style.css'
import './style.css'
import { readConfig } from './config.js'
import { formatReport, runCloudBase, runCloudflare } from './runner.js'

const $ = (id) => document.getElementById(id)
const config = readConfig()
// 腾讯云 SDK 比较大，点了按钮才下载（R-023：不登录的人不多下载）
const loadSdk = () => import('@cloudbase/js-sdk').then((m) => m.default || m)

$('invite').value = config.invite
let lastResults = []

function render(results) {
  const tbody = $('results')
  tbody.replaceChildren(
    ...results.map((r) => {
      const tr = document.createElement('tr')
      tr.className = r.ok ? 'ok' : 'fail'
      for (const text of [r.backend, r.name, `${r.ms} ms`, r.ok ? `成功${r.detail ? `（${r.detail}）` : ''}` : `失败：${r.detail}`]) {
        const td = document.createElement('td')
        td.textContent = text
        tr.append(td)
      }
      return tr
    }),
  )
}

$('run').addEventListener('click', async () => {
  $('run').disabled = true
  $('copy').disabled = true
  lastResults = []
  render(lastResults)
  try {
    if (config.cloudbaseEnv) {
      $('status').textContent = '正在测腾讯云……'
      lastResults.push(...(await runCloudBase({ env: config.cloudbaseEnv, loadSdk })))
    } else {
      // 先只测 Cloudflare（用户 2026-11-09 决定）：没配腾讯云时不算失败，免得朋友以为出错了
      lastResults.push({ backend: '腾讯云', name: '本次不测', ms: 0, ok: true, detail: '这次只测 Cloudflare' })
    }
    render(lastResults)
    $('status').textContent = '正在测 Cloudflare……'
    lastResults.push(...(await runCloudflare({ base: config.cloudflareApi, invite: $('invite').value.trim() })))
    render(lastResults)
    $('status').textContent = '测完了，点“复制结果”发给我。'
  } finally {
    $('run').disabled = false
    $('copy').disabled = lastResults.length === 0
  }
})

$('copy').addEventListener('click', async () => {
  const text = formatReport(lastResults, {
    time: new Date().toLocaleString('zh-CN'),
    network: navigator.connection?.effectiveType || '',
    userAgent: navigator.userAgent,
  })
  try {
    await navigator.clipboard.writeText(text)
    $('status').textContent = '已复制，粘贴到微信发给我就行。'
  } catch {
    // 有些手机浏览器不让写剪贴板：把文字放进结果下面的文本框，选中后让用户长按复制
    const box = $('report')
    box.value = text
    box.hidden = false
    box.focus()
    box.select()
    box.scrollIntoView({ block: 'center' })
    $('status').textContent = '没能自动复制，结果放在“复制结果”按钮下面的框里，长按选中复制。'
  }
})

// ---------- 账号功能测试（管理员用）：腾讯云开发的邮箱验证码注册 + 用户名密码登录 + 邮箱重置密码 ----------

let appPromise = null
const getApp = () => (appPromise ||= loadSdk().then((cloudbase) => cloudbase.init({ env: config.cloudbaseEnv })))
let verifySignUp = null
let finishReset = null

function log(label, value) {
  const line = `[${new Date().toLocaleTimeString('zh-CN')}] ${label}：${typeof value === 'string' ? value : JSON.stringify(value)}`
  $('acc-log').textContent = `${line}\n${$('acc-log').textContent}`
}

/** 把 SDK 返回的 { data, error } 或抛出的错误统一记下来 */
async function attempt(label, fn) {
  if (!config.cloudbaseEnv) return log(label, '还没填云开发环境 ID')
  try {
    const res = await fn(await getApp())
    log(label, res?.error ? `失败 ${res.error.code || ''} ${res.error.message || ''}` : '成功')
    return res
  } catch (err) {
    log(label, `出错 ${err?.code || ''} ${err?.message || err}`)
    return null
  }
}

$('acc-signup').addEventListener('click', () =>
  attempt('发注册验证码', async (app) => {
    const res = await app.auth.signUp({
      email: $('acc-email').value.trim(),
      username: $('acc-username').value.trim(),
      password: $('acc-password').value,
    })
    verifySignUp = res?.data?.verifyOtp || null
    return res
  }),
)

$('acc-verify').addEventListener('click', () =>
  attempt('完成注册', async () => {
    if (!verifySignUp) throw new Error('先点“发注册验证码”')
    return verifySignUp({ token: $('acc-code').value.trim() })
  }),
)

$('acc-login').addEventListener('click', () =>
  attempt('用户名 + 密码登录', async (app) => {
    await app.auth.signOut().catch(() => {})
    return app.auth.signInWithPassword({ username: $('acc-username').value.trim(), password: $('acc-password').value })
  }),
)

$('acc-reset').addEventListener('click', () =>
  attempt('发重置密码验证码', async (app) => {
    const res = await app.auth.resetPasswordForEmail($('acc-email').value.trim())
    finishReset = res?.data?.updateUser || null
    return res
  }),
)

$('acc-reset-done').addEventListener('click', () =>
  attempt('改密码', async () => {
    if (!finishReset) throw new Error('先点“发重置密码验证码”')
    const res = await finishReset({ nonce: $('acc-reset-code').value.trim(), password: $('acc-new-password').value })
    // 改好后，下一步“用户名 + 密码登录”用新密码
    if (!res?.error) $('acc-password').value = $('acc-new-password').value
    return res
  }),
)
