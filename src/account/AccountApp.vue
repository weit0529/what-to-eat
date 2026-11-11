<!--
  账号页（阶段 4-3，网址 /account/；入口在正式网站页面底部，用户 2026-11-10 选 4A）。
  没登录：登录 / 注册（邀请码 + 邮箱验证码，R-022）/ 忘记密码（邮箱验证码重置）。
  登录后：看自己的用户名和邮箱、改密码、退出。“我的菜单”“吃过的记录跟着账号走”在 4-4、4-5 再做。
  注册链接可以带邀请码：/account/#invite=邀请码（# 后面的内容不会发给任何服务器）。
-->
<script setup>
import { onMounted, reactive, ref } from 'vue'
import { changePassword, currentUser, register, requestReset, resetPassword, sendSignupCode, signIn, signOut, tokenSaveFailed } from './api.js'

const homeUrl = new URL('../', window.location.href).href
const inviteFromLink = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('invite') || ''

const user = ref(null)
const checking = ref(true)
/** 没登录时显示哪一块：login / register / reset */
const view = ref(inviteFromLink ? 'register' : 'login')
const busy = ref(false)
const error = ref('')
const message = ref('')

const login = reactive({ username: '', password: '' })
const reg = reactive({ invite: inviteFromLink, email: '', code: '', username: '', password: '', again: '' })
const codeSent = ref(false)
/** 再要验证码前要等的秒数 */
const cooldown = ref(0)
const reset = reactive({ email: '', code: '', password: '', again: '' })
const resetSent = ref(false)
const pw = reactive({ current: '', next: '', again: '' })

function switchTo(name) {
  view.value = name
  error.value = ''
  message.value = ''
}

async function run(action) {
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await action()
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

function startCooldown() {
  cooldown.value = 60
  const timer = setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0) clearInterval(timer)
  }, 1000)
}

const doLogin = () =>
  run(async () => {
    user.value = await signIn(login.username.trim(), login.password)
    login.password = ''
  })

const doSendCode = () =>
  run(async () => {
    if (!reg.invite.trim() || !reg.email.trim()) throw new Error('邀请码和邮箱都要填')
    await sendSignupCode(reg.invite, reg.email.trim())
    codeSent.value = true
    message.value = `验证码已发到 ${reg.email.trim()}，10 分钟内有效。没收到的话看看垃圾邮件。`
    startCooldown()
  })

const doRegister = () =>
  run(async () => {
    if (reg.password !== reg.again) throw new Error('两次输入的密码不一样')
    if (reg.password.length < 8 || reg.password.length > 64) throw new Error('密码要 8～64 位')
    user.value = await register({
      invite: reg.invite,
      email: reg.email.trim(),
      code: reg.code.trim(),
      username: reg.username.trim(),
      password: reg.password,
    })
    // 注册成功后，地址栏里的邀请码已经用掉了，去掉免得误会
    if (window.location.hash) history.replaceState(null, '', window.location.pathname)
  })

const doRequestReset = () =>
  run(async () => {
    if (!reset.email.trim()) throw new Error('请填邮箱')
    await requestReset(reset.email.trim())
    resetSent.value = true
    message.value = '如果这个邮箱注册过，验证码已经发过去了（10 分钟内有效）。没收到的话看看垃圾邮件。'
  })

const doReset = () =>
  run(async () => {
    if (reset.password !== reset.again) throw new Error('两次输入的新密码不一样')
    await resetPassword(reset.email.trim(), reset.code.trim(), reset.password)
    Object.assign(reset, { code: '', password: '', again: '' })
    resetSent.value = false
    switchTo('login')
    message.value = '密码改好了，请用新密码登录。'
  })

const doChangePassword = () =>
  run(async () => {
    if (pw.next !== pw.again) throw new Error('两次输入的新密码不一样')
    if (pw.next.length < 8 || pw.next.length > 64) throw new Error('新密码要 8～64 位')
    await changePassword(pw.current, pw.next)
    Object.assign(pw, { current: '', next: '', again: '' })
    message.value = '密码改好了。其他地方登录的会被退出。'
  })

async function doSignOut() {
  await signOut()
  user.value = null
  switchTo('login')
}

onMounted(async () => {
  try {
    user.value = await currentUser()
  } catch (err) {
    error.value = err.message
  } finally {
    checking.value = false
  }
})
</script>

<template>
  <header class="admin-header">
    <h1>今天吃什么？· 账号</h1>
    <a class="home-link" :href="homeUrl">回首页</a>
  </header>

  <main class="admin-main account">
    <p v-if="checking" class="hint">正在检查登录……</p>

    <section v-else-if="user" class="block">
      <h2>我的账号</h2>
      <p>用户名：<strong>{{ user.displayUsername || user.username || user.name }}</strong></p>
      <p>邮箱：{{ user.email }}</p>
      <p class="hint">“我的菜单”和“吃过的记录跟着账号走”还在做，做好后会出现在这里。</p>
      <p v-if="tokenSaveFailed" class="hint">这个浏览器不让保存登录状态（可能是无痕模式），关掉或刷新页面后要重新登录。</p>
      <div class="actions">
        <a class="button-link" :href="homeUrl">回首页</a>
        <button type="button" @click="doSignOut">退出登录</button>
      </div>

      <form @submit.prevent="doChangePassword">
        <h3>改密码</h3>
        <label class="field"><span>现在的密码</span><input v-model="pw.current" type="password" autocomplete="current-password" required /></label>
        <label class="field"><span>新密码（8～64 位）</span><input v-model="pw.next" type="password" autocomplete="new-password" required /></label>
        <label class="field"><span>再输一次新密码</span><input v-model="pw.again" type="password" autocomplete="new-password" required /></label>
        <button type="submit" class="primary" :disabled="busy">改密码</button>
      </form>
    </section>

    <template v-else>
      <nav class="tabs" aria-label="登录、注册、找回密码">
        <button type="button" class="tab" :class="{ active: view === 'login' }" :aria-pressed="view === 'login'" @click="switchTo('login')">登录</button>
        <button type="button" class="tab" :class="{ active: view === 'register' }" :aria-pressed="view === 'register'" @click="switchTo('register')">注册</button>
        <button type="button" class="tab" :class="{ active: view === 'reset' }" :aria-pressed="view === 'reset'" @click="switchTo('reset')">忘记密码</button>
      </nav>

      <form v-if="view === 'login'" class="block" @submit.prevent="doLogin">
        <h2>登录</h2>
        <label class="field"><span>用户名</span><input v-model="login.username" autocomplete="username" required /></label>
        <label class="field"><span>密码</span><input v-model="login.password" type="password" autocomplete="current-password" required /></label>
        <button type="submit" class="primary" :disabled="busy">{{ busy ? '正在登录……' : '登录' }}</button>
        <p class="hint">不登录也能随机抽、帮我分析。登录以后，以后会多出“我的菜单”等功能。</p>
      </form>

      <form v-else-if="view === 'register'" class="block" @submit.prevent="doRegister">
        <h2>注册</h2>
        <p class="hint">要有管理员给的邀请码才能注册。</p>
        <label class="field"><span>邀请码</span><input v-model="reg.invite" autocomplete="off" required /></label>
        <label class="field">
          <span>邮箱（用来找回密码）</span>
          <span class="row">
            <input v-model="reg.email" type="email" autocomplete="email" required />
            <button type="button" :disabled="busy || cooldown > 0" @click="doSendCode">{{ cooldown > 0 ? `${cooldown} 秒后可重发` : codeSent ? '重发验证码' : '发验证码' }}</button>
          </span>
        </label>
        <template v-if="codeSent">
          <label class="field"><span>邮箱里收到的 6 位验证码</span><input v-model="reg.code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required /></label>
          <label class="field"><span>用户名（2～20 个字：中文、字母、数字、下划线；登录时用）</span><input v-model="reg.username" maxlength="20" autocomplete="username" required /></label>
          <label class="field"><span>密码（8～64 位）</span><input v-model="reg.password" type="password" autocomplete="new-password" required /></label>
          <label class="field"><span>再输一次密码</span><input v-model="reg.again" type="password" autocomplete="new-password" required /></label>
          <p class="hint">注册后，管理员能看到你的用户名和邮箱；密码是加密保存的，谁都看不到原文。</p>
          <button type="submit" class="primary" :disabled="busy">{{ busy ? '正在注册……' : '注册' }}</button>
        </template>
      </form>

      <form v-else class="block" @submit.prevent="resetSent ? doReset() : doRequestReset()">
        <h2>忘记密码</h2>
        <label class="field"><span>注册时填的邮箱</span><input v-model="reset.email" type="email" autocomplete="email" required /></label>
        <template v-if="resetSent">
          <label class="field"><span>邮箱里收到的 6 位验证码</span><input v-model="reset.code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required /></label>
          <label class="field"><span>新密码（8～64 位）</span><input v-model="reset.password" type="password" autocomplete="new-password" required /></label>
          <label class="field"><span>再输一次新密码</span><input v-model="reset.again" type="password" autocomplete="new-password" required /></label>
          <button type="submit" class="primary" :disabled="busy">设新密码</button>
          <button type="button" class="link resend" :disabled="busy" @click="doRequestReset">没收到？再发一次</button>
        </template>
        <button v-else type="submit" class="primary" :disabled="busy">发验证码</button>
      </form>
    </template>

    <p v-if="message" class="ok" role="status">{{ message }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </main>
</template>

<style scoped>
.account {
  max-width: 460px;
}

.home-link,
.button-link {
  color: var(--brand-cream);
  font-size: var(--fs-sm);
}

.button-link {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 4px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-inner);
  color: var(--text);
  font-weight: 700;
  text-decoration: none;
}

.resend {
  margin-left: 12px;
}
</style>
