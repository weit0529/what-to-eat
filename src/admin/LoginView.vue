<!-- 管理员登录：用户名 + 密码 -->
<script setup>
import { ref } from 'vue'
import { signIn } from './api.js'

const emit = defineEmits(['signed-in'])
const username = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = '用户名和密码都要填'
    return
  }
  busy.value = true
  try {
    const user = await signIn(username.value.trim(), password.value)
    password.value = ''
    emit('signed-in', user)
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="block login" @submit.prevent="submit">
    <h2>管理员登录</h2>
    <label class="field">
      <span>用户名</span>
      <input v-model="username" autocomplete="username" required />
    </label>
    <label class="field">
      <span>密码</span>
      <input v-model="password" type="password" autocomplete="current-password" required />
    </label>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <button type="submit" class="primary" :disabled="busy">{{ busy ? '正在登录……' : '登录' }}</button>
  </form>
</template>
