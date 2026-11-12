<!--
  管理页“加菜权限”（阶段 4-4，REQUIREMENTS.md R-029，用户 2026-11-11 提议）：
  一个总开关“允许用户加 / 改菜”——打开时所有用户都能加，黑名单里的除外；关上时谁都不能加，白名单里的除外。
  被禁止的人已经加的菜照常能用，只是不能再加、改、删、提交。管理员不受限制，不在这个列表里。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import { getDishAccess, setDishesOpen, setUserList } from './api.js'

const open = ref(true)
const users = ref([])
const loading = ref(true)
const busy = ref(false)
const message = ref('')
const error = ref('')
const query = ref('')

const LIST_LABEL = { black: '黑名单', white: '白名单' }
const canAdd = (user) => (open.value ? user.list !== 'black' : user.list === 'white')
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return users.value
  return users.value.filter((u) => [u.username, u.email].some((t) => t && t.toLowerCase().includes(q)))
})
const blockedCount = computed(() => users.value.filter((u) => !canAdd(u)).length)

async function load() {
  const data = await getDishAccess()
  open.value = data.open
  users.value = data.users
}

async function run(action, done) {
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await action()
    message.value = done
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
    await load().catch(() => {})
  }
}

function toggleOpen() {
  const next = !open.value
  const text = next
    ? '打开后，所有用户都能加、改菜（黑名单里的除外）。确定打开？'
    : '关上后，用户都不能再加、改、删、提交菜（白名单里的除外），已经加的菜照常能用。确定关上？'
  if (!window.confirm(text)) return
  run(() => setDishesOpen(next), next ? '已打开：用户可以加菜了' : '已关上：用户暂时不能加菜')
}

function changeList(user, value) {
  const list = value === '' ? null : value
  run(
    () => setUserList(user.id, list),
    list ? `已把 ${user.username} 放进${LIST_LABEL[list]}` : `已把 ${user.username} 从名单里拿出来`,
  )
}

onMounted(() =>
  load()
    .catch((err) => {
      error.value = err.message
    })
    .finally(() => {
      loading.value = false
    }),
)
</script>

<template>
  <section class="block">
    <h2>总开关</h2>
    <label class="check switch-line">
      <input type="checkbox" :checked="open" :disabled="busy || loading" @click.prevent="toggleOpen" />
      允许用户加 / 改菜
    </label>
    <p class="hint">
      <template v-if="open">现在：所有用户都能加菜，<strong>黑名单</strong>里的人除外。</template>
      <template v-else>现在：用户都不能加菜，<strong>白名单</strong>里的人除外。已经加的菜照常能用。</template>
      管理员不受限制。
    </p>
  </section>

  <section class="block">
    <h2>用户</h2>
    <p class="hint">
      共 {{ users.length }} 个普通用户，现在 {{ blockedCount }} 个不能加菜。
      {{ open ? '总开关开着，只有“黑名单”有用' : '总开关关着，只有“白名单”有用' }}（两张名单都留着，切换总开关后另一张才生效）。
    </p>
    <div class="toolbar">
      <input v-model="query" type="search" placeholder="搜用户名、邮箱" aria-label="搜索用户" />
    </div>
    <p v-if="message" class="ok" role="status">{{ message }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading" class="hint">正在读……</p>
    <p v-else-if="users.length === 0" class="hint">还没有普通用户。</p>

    <ul class="admin-list">
      <li v-for="user in shown" :key="user.id" class="dish-row">
        <div class="dish-main">
          <strong>{{ user.username }}</strong>
          <span class="badge" :class="{ shared: canAdd(user) }">{{ canAdd(user) ? '能加菜' : '不能加菜' }}</span>
          <div class="muted small">{{ user.email }} · 加了 {{ user.dishCount }} 道</div>
        </div>
        <div class="dish-actions">
          <select :value="user.list ?? ''" :disabled="busy" :aria-label="`${user.username} 在哪张名单`" @change="changeList(user, $event.target.value)">
            <option value="">不在名单里</option>
            <option value="black">黑名单</option>
            <option value="white">白名单</option>
          </select>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.switch-line {
  font-weight: 700;
}
</style>
