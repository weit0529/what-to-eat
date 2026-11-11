<!--
  管理员名单（R-021：用户本人和几位指定的朋友）和改自己的密码。
  加管理员时由现在的管理员定一个初始密码，告诉对方，对方登录后自己改。
-->
<script setup>
import { onMounted, reactive, ref } from 'vue'
import { addAdmin, changePassword, listAdmins, removeAdmin } from './api.js'

const admins = ref([])
const busy = ref(false)
const message = ref('')
const error = ref('')
const form = reactive({ username: '', email: '', password: '' })
const pw = reactive({ current: '', next: '', again: '' })
const pwMessage = ref('')
const pwError = ref('')

/** 随机一个初始密码（12 位，去掉容易看错的字母和数字） */
function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return [...bytes].map((b) => chars[b % chars.length]).join('')
}

async function load() {
  try {
    admins.value = await listAdmins()
  } catch (err) {
    error.value = err.message
  }
}

async function add() {
  message.value = ''
  error.value = ''
  busy.value = true
  try {
    const created = await addAdmin({ ...form })
    message.value = `已加上管理员“${created.username}”。初始密码：${form.password}（请告诉对方，让他登录后自己改）`
    Object.assign(form, { username: '', email: '', password: '' })
    await load()
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

async function remove(admin) {
  if (!window.confirm(`确定去掉管理员“${admin.username}”？他的账号会被删掉，已经登录的地方也会退出。`)) return
  message.value = ''
  error.value = ''
  busy.value = true
  try {
    await removeAdmin(admin.id)
    message.value = `已去掉：${admin.username}`
    await load()
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

async function savePassword() {
  pwMessage.value = ''
  pwError.value = ''
  if (pw.next.length < 8 || pw.next.length > 64) {
    pwError.value = '新密码要 8～64 位'
    return
  }
  if (pw.next !== pw.again) {
    pwError.value = '两次输入的新密码不一样'
    return
  }
  busy.value = true
  try {
    await changePassword(pw.current, pw.next)
    pwMessage.value = '密码改好了。其他地方登录的会被退出。'
    Object.assign(pw, { current: '', next: '', again: '' })
  } catch (err) {
    pwError.value = err.message
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="block">
    <h2>管理员</h2>
    <ul class="admin-list">
      <li v-for="admin in admins" :key="admin.id">
        <span><strong>{{ admin.username }}</strong> <span class="muted small">{{ admin.email }}</span></span>
        <span v-if="admin.isMe" class="badge">我</span>
        <button v-else type="button" class="danger" :disabled="busy" @click="remove(admin)">去掉</button>
      </li>
    </ul>

    <form class="add-admin" @submit.prevent="add">
      <h3>加一个管理员</h3>
      <label class="field">
        <span>用户名（2～20 个字：中文、字母、数字、下划线）</span>
        <input v-model="form.username" maxlength="20" required />
      </label>
      <label class="field">
        <span>邮箱</span>
        <input v-model="form.email" type="email" required />
      </label>
      <label class="field">
        <span>初始密码（8～64 位）</span>
        <span class="row">
          <input v-model="form.password" minlength="8" maxlength="64" required autocomplete="new-password" />
          <button type="button" @click="form.password = randomPassword()">随机生成</button>
        </span>
      </label>
      <button type="submit" class="primary" :disabled="busy">加上</button>
    </form>
    <p v-if="message" class="ok" role="status">{{ message }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>

  <form class="block" @submit.prevent="savePassword">
    <h2>改我的密码</h2>
    <label class="field">
      <span>现在的密码</span>
      <input v-model="pw.current" type="password" autocomplete="current-password" required />
    </label>
    <label class="field">
      <span>新密码（8～64 位）</span>
      <input v-model="pw.next" type="password" autocomplete="new-password" required />
    </label>
    <label class="field">
      <span>再输一次新密码</span>
      <input v-model="pw.again" type="password" autocomplete="new-password" required />
    </label>
    <p v-if="pwMessage" class="ok" role="status">{{ pwMessage }}</p>
    <p v-if="pwError" class="error" role="alert">{{ pwError }}</p>
    <button type="submit" class="primary" :disabled="busy">改密码</button>
  </form>
</template>
