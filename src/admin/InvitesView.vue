<!--
  邀请码（阶段 4-3，用户 2026-11-10 选 3A）：管理员生成，7 天有效，用一次就作废。
  生成后马上显示完整的码和注册链接，只显示这一次（后台只存哈希），请复制发给朋友。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import { createInvite, listInvites, revokeInvite } from './api.js'

const invites = ref([])
const created = ref(null)
const busy = ref(false)
const message = ref('')
const error = ref('')

const STATUS = { valid: '可以用', used: '已用', expired: '过期了', revoked: '已作废' }

/** 注册链接：账号页 + #invite=码（# 后面的内容不会发给任何服务器） */
const link = computed(() => {
  if (!created.value) return ''
  const accountPage = new URL('../account/', window.location.href)
  accountPage.hash = `invite=${created.value.code}`
  return accountPage.href
})

const day = (ms) => new Date(ms).toLocaleDateString('zh-CN')

async function load() {
  try {
    invites.value = await listInvites()
  } catch (err) {
    error.value = err.message
  }
}

async function create() {
  busy.value = true
  message.value = ''
  error.value = ''
  try {
    created.value = await createInvite()
    await load()
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    message.value = '已复制'
  } catch {
    message.value = '没能自动复制，请手动选中复制'
  }
}

async function revoke(invite) {
  if (!window.confirm(`作废尾号 ${invite.hint} 的邀请码？作废后就不能用它注册了。`)) return
  busy.value = true
  message.value = ''
  error.value = ''
  try {
    await revokeInvite(invite.id)
    message.value = `已作废尾号 ${invite.hint} 的邀请码`
    await load()
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="block">
    <h2>邀请码</h2>
    <p class="hint">朋友要凭邀请码才能注册账号。每个码 7 天内有效，用一次就作废。</p>
    <button type="button" class="primary" :disabled="busy" @click="create">生成一个邀请码</button>

    <div v-if="created" class="new-invite">
      <p class="ok">新邀请码：<strong class="code">{{ created.code }}</strong>（{{ day(created.expiresAt) }} 前有效）</p>
      <p class="hint">完整的码只显示这一次，请现在复制发给朋友。发链接最方便，朋友打开就自动填好邀请码：</p>
      <p class="link-text">{{ link }}</p>
      <div class="actions">
        <button type="button" @click="copy(link)">复制注册链接</button>
        <button type="button" @click="copy(created.code)">只复制邀请码</button>
      </div>
    </div>

    <p v-if="message" class="ok" role="status">{{ message }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <h3>最近的邀请码</h3>
    <ul class="admin-list">
      <li v-for="invite in invites" :key="invite.id">
        <span>
          <strong>尾号 {{ invite.hint }}</strong>
          <span class="muted small">
            {{ day(invite.createdAt) }} 生成 · {{ STATUS[invite.status] }}
            <template v-if="invite.usedBy">（{{ invite.usedBy }}）</template>
            <template v-else-if="invite.status === 'valid'">（{{ day(invite.expiresAt) }} 前有效）</template>
          </span>
        </span>
        <button v-if="invite.status === 'valid'" type="button" class="danger" :disabled="busy" @click="revoke(invite)">作废</button>
      </li>
    </ul>
    <p v-if="invites.length === 0" class="hint">还没有生成过邀请码。</p>
  </section>
</template>
