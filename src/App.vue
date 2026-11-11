<!--
  根组件：页面的整体框架。
  菜单：阶段 4-2 起以后台为准（管理员在管理页里改，REQUIREMENTS.md R-020）。
  打开网页时先用内置菜单（src/generated/menu.json，发布时从后台取的一份，取不到时用 data/menu.xlsx）马上显示，
  同时去后台取最新菜单；后台连不上或太慢就一直用内置菜单，随机抽、帮我分析照常能用（R-026）。
  取到的最新菜单和内置的一样就什么都不做；不一样时：
    - 用户还没点过页面 → 直接换上
    - 用户已经在用了（选了餐次、正在抽……）→ 不偷偷换（会弄乱正在进行的抽取、结果、小名单，Codex 第 28 轮），
      页面底部提示“菜单有更新”，用户点了才换；换的时候整页重新开始（DrawPage 重建），不留旧状态
-->
<script setup>
import { onMounted, ref, shallowRef } from 'vue'
import builtInMenu from './generated/menu.json'
import DrawPage from './components/DrawPage.vue'
import { API_BASE } from './config.js'
import { fetchMenu } from './core/remote-menu.js'

const props = defineProps({
  /** 测试里可以关掉从后台取菜单 */
  remote: { type: Boolean, default: true },
  /** 测试里可以换成假的 fetch */
  fetchImpl: { type: Function, default: undefined },
})

const menu = shallowRef(builtInMenu)
/** 后台取到、但因为用户已经在用而还没换上的菜单 */
const pending = shallowRef(null)
/** 用户点过页面没有 */
const touched = ref(false)
/** 换菜单时加 1，让抽取页整个重建 */
const pageKey = ref(0)

// Logo 放在 public/ 下，按相对路径取，发布到 GitHub Pages 的子路径也能找到
const logoUrl = `${import.meta.env.BASE_URL}logo.png`

// 页面底部的账号入口（阶段 4-3，用户 2026-11-10 选 4A）：登录过就显示“我的账号（名字）”，没登录显示“登录 / 注册”。
// 只看本机有没有存登录凭证，不为这个去连后台
const accountUrl = `${import.meta.env.BASE_URL}account/`
function readSignedInName() {
  try {
    if (!localStorage.getItem('what-to-eat:user-token:v1')) return ''
    return localStorage.getItem('what-to-eat:user-name:v1') || '已登录'
  } catch {
    return ''
  }
}
const signedInName = readSignedInName()

/** 两份菜单内容是否一样（餐次和菜都一样） */
const sameMenu = (a, b) => JSON.stringify([a.meals, a.items]) === JSON.stringify([b.meals, b.items])

function applyMenu(next) {
  menu.value = next
  pending.value = null
  pageKey.value++
}

onMounted(async () => {
  if (!props.remote) return
  const { menu: latest } = await fetchMenu(`${API_BASE}/api/menu`, props.fetchImpl ? { fetchImpl: props.fetchImpl } : {})
  if (!latest || sameMenu(latest, menu.value)) return
  if (touched.value) pending.value = latest
  else applyMenu(latest)
})
</script>

<template>
  <!-- 顶栏占满整个宽度（深绿），下面的内容限宽居中 -->
  <header class="app-header">
    <h1 class="title">
      <img class="logo" :src="logoUrl" alt="" width="40" height="40" />
      <span>今天吃什么？</span>
    </h1>
  </header>

  <div class="app">
    <main @pointerdown.capture="touched = true" @keydown.capture="touched = true">
      <DrawPage :key="pageKey" :items="menu.items" :meals="menu.meals" />
    </main>

    <p v-if="pending" class="menu-update" role="status">
      菜单有更新。
      <button type="button" class="link" @click="applyMenu(pending)">换成最新菜单</button>
      （会重新开始这一次的选择）
    </p>

    <footer class="app-footer">
      <span>菜单共 {{ menu.items.length }} 道</span>
      <span aria-hidden="true"> · </span>
      <a class="account-link" :href="accountUrl">{{ signedInName ? `我的账号（${signedInName}）` : '登录 / 注册' }}</a>
    </footer>
  </div>
</template>

<style scoped>
.app {
  max-width: 560px;
  margin: 0 auto;
  padding: 20px 16px 32px;
}

/* 顶栏：Logo 的深绿底，和 Logo 自己的底色一样，Logo 看起来融在顶栏里 */
.app-header {
  padding: 20px 16px;
  background: var(--brand-dark);
  color: var(--brand-cream);
  text-align: center;
}

.app-header h1 {
  /* Logo 和标题文字垂直居中，整体在页面中间 */
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 800;
  line-height: 1.3;
}

.logo {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-inner);
}

/* 菜单有更新的提示：用户已经在用时才出现，点了才换 */
.menu-update {
  margin: 24px 0 0;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--fs-sm);
}

.menu-update .link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-strong);
  font-size: var(--fs-sm);
  font-weight: 700;
  text-decoration: underline;
}

.account-link {
  color: var(--accent-strong);
  font-weight: 700;
}

.app-footer {
  margin-top: 32px;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
</style>
