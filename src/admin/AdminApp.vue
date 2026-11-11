<!--
  管理页（阶段 4-2，网址 /admin/，正式网站上没有入口链接，用户 2026-11-10 选 3A）。
  先登录（只有管理员能用），然后分几块：菜单、餐次、Excel 导入导出、管理员、改密码。
  菜单数据在这里读一次，各块改完后通知这里重新读。
-->
<script setup>
import { onMounted, ref } from 'vue'
import { currentUser, getMenu, signOut, tokenSaveFailed } from './api.js'
import LoginView from './LoginView.vue'
import DishesView from './DishesView.vue'
import MealsView from './MealsView.vue'
import ExcelView from './ExcelView.vue'
import AdminsView from './AdminsView.vue'

const TABS = [
  { id: 'dishes', label: '菜单' },
  { id: 'meals', label: '餐次' },
  { id: 'excel', label: 'Excel' },
  { id: 'admins', label: '管理员和密码' },
]

const user = ref(null)
const checking = ref(true)
const tab = ref('dishes')
const menu = ref(null)
const loadError = ref('')

async function loadMenu() {
  loadError.value = ''
  try {
    menu.value = await getMenu()
  } catch (err) {
    loadError.value = err.message
    if (err.status === 401) user.value = null
  }
}

async function onSignedIn(signedInUser) {
  user.value = signedInUser
  if (signedInUser?.role === 'admin') await loadMenu()
}

async function onSignOut() {
  await signOut()
  user.value = null
  menu.value = null
}

onMounted(async () => {
  try {
    const me = await currentUser()
    if (me) await onSignedIn(me)
  } catch (err) {
    loadError.value = err.message
  } finally {
    checking.value = false
  }
})
</script>

<template>
  <header class="admin-header">
    <h1>今天吃什么？· 管理</h1>
    <div v-if="user" class="who">
      <span>{{ user.displayUsername || user.username || user.name }}</span>
      <button type="button" class="link" @click="onSignOut">退出登录</button>
    </div>
  </header>

  <main class="admin-main">
    <p v-if="checking" class="hint">正在检查登录……</p>

    <LoginView v-else-if="!user" @signed-in="onSignedIn" />

    <section v-else-if="user.role !== 'admin'" class="block">
      <p>这个账号不是管理员，不能用管理页。</p>
      <button type="button" @click="onSignOut">换个账号登录</button>
    </section>

    <template v-else>
      <nav class="tabs" aria-label="管理页的几块">
        <button
          v-for="t in TABS"
          :key="t.id"
          type="button"
          class="tab"
          :class="{ active: tab === t.id }"
          :aria-pressed="tab === t.id"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </nav>

      <p v-if="tokenSaveFailed" class="hint" role="status">这个浏览器不让保存登录状态（可能是无痕模式），关掉或刷新页面后要重新登录。</p>
      <p v-if="loadError" class="error" role="alert">
        {{ loadError }} <button type="button" class="link" @click="loadMenu">重试</button>
      </p>

      <template v-if="menu">
        <DishesView v-if="tab === 'dishes'" :menu="menu" @changed="loadMenu" />
        <MealsView v-else-if="tab === 'meals'" :menu="menu" @changed="loadMenu" />
        <ExcelView v-else-if="tab === 'excel'" :menu="menu" @changed="loadMenu" />
      </template>
      <AdminsView v-if="tab === 'admins'" />
    </template>
  </main>
</template>
