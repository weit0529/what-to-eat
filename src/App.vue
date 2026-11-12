<!--
  根组件：页面的整体框架。
  菜单：阶段 4-2 起以后台为准（管理员在管理页里改，REQUIREMENTS.md R-020）。
  打开网页时先用内置菜单（src/generated/menu.json，发布时从后台取的一份，取不到时用 data/menu.xlsx）马上显示，
  同时去后台取最新菜单；后台连不上或太慢就一直用内置菜单，随机抽、帮我分析照常能用（R-026）。
  取到的最新菜单和内置的一样就什么都不做；不一样时：
    - 用户还没点过页面 → 直接换上
    - 用户已经在用了（选了餐次、正在抽……）→ 不偷偷换（会弄乱正在进行的抽取、结果、小名单，Codex 第 28 轮），
      页面底部提示“菜单有更新”，用户点了才换；换的时候整页重新开始（DrawPage 重建），不留旧状态
  登录用户（阶段 4-4，R-024）：本机存着登录凭证时去取“内部菜单”（通用 + 共享 + 我的，/api/my/menu），
  凭证失效（401）就清掉凭证、改取通用菜单；连不上照样用内置菜单。取到内部菜单后，菜单上方可切换“全部 / 只看我加的”。
  “最近吃过”（阶段 4-5，R-025）：登录着就用账号里的记录（src/ui/eaten-account.js），打开页面时同步一次；
  凭证失效（取菜单或同步记录时发现）就改回本机记录。账号编号登录时记下；以前登录的没记，就从内部菜单的回应里拿。
-->
<script setup>
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import builtInMenu from './generated/menu.json'
import DrawPage from './components/DrawPage.vue'
import { API_BASE } from './config.js'
import { fetchMenu } from './core/remote-menu.js'
import { createAccountEatenStore } from './ui/eaten-account.js'

/** 账号页存登录凭证、用户名的位置（和 src/account/api.js 一样） */
const USER_TOKEN_KEY = 'what-to-eat:user-token:v1'
const USER_NAME_KEY = 'what-to-eat:user-name:v1'
const USER_ID_KEY = 'what-to-eat:user-id:v1'

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
function readStored(key) {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}
const token = readStored(USER_TOKEN_KEY)
const signedInName = ref(token ? readStored(USER_NAME_KEY) || '已登录' : '')
/** 这次打开时的登录还算不算数：凭证失效、或者别的标签页退出 / 换了账号后就是 false，之后迟到的回应一律不用 */
const sessionAlive = ref(Boolean(token))
/** 这台手机上现在登录的还是不是这次打开时的凭证 */
const stillSameToken = () => readStored(USER_TOKEN_KEY) === token
/**
 * 登录用户的“吃过”记录；没登录（或凭证失效）是 null，抽菜页用本机记录。
 * 登录着但还不知道账号编号（以前登录的）也建一个，只是先把改动记在内存里，知道编号后再转存、上传（Codex 第 48 轮：
 * 不能这时就拿本机自己的记录来用）
 */
const eatenStore = shallowRef(null)
if (token) {
  eatenStore.value = createAccountEatenStore({
    token,
    userId: readStored(USER_ID_KEY) || null,
    ...(props.fetchImpl ? { fetchImpl: props.fetchImpl } : {}),
  })
  // 同步记录时发现凭证失效、或者这台手机已经退出、换了账号：和取菜单时发现一样处理（Codex 第 47 轮）
  watch(eatenStore.value.expired, (gone) => {
    if (gone) forgetToken()
  })
}

/**
 * 凭证失效（或这台手机上已经不是这次的登录了）：清掉凭证（只清自己的，别的标签页新登录的不动），
 * 底部改回“登录 / 注册”，“吃过”改回本机记录，菜单撤下私有的、改回通用菜单（Codex 第 48 轮）
 */
function forgetToken() {
  if (!sessionAlive.value) return
  sessionAlive.value = false
  try {
    if (localStorage.getItem(USER_TOKEN_KEY) === token) {
      localStorage.removeItem(USER_TOKEN_KEY)
      localStorage.removeItem(USER_NAME_KEY)
      localStorage.removeItem(USER_ID_KEY)
    }
  } catch {
    // 存储不能用就算了
  }
  signedInName.value = ''
  eatenStore.value?.dispose()
  eatenStore.value = null
  // 先用内置的通用菜单顶上，再去后台取最新的通用菜单
  mineOnly.value = false
  applyMenu(builtInMenu)
  if (props.remote) loadGeneralMenu()
}

/** 两份菜单内容是否一样（餐次和菜都一样） */
const sameMenu = (a, b) => JSON.stringify([a.meals, a.items]) === JSON.stringify([b.meals, b.items])

function applyMenu(next) {
  menu.value = next
  pending.value = null
  pageKey.value++
}

// “全部 / 只看我加的”（R-024 第 2 题 2B）：只有取到了登录用户的内部菜单（菜上有 mine）才出现
const isMyMenu = computed(() => menu.value.items.some((item) => 'mine' in item))
const mineCount = computed(() => menu.value.items.filter((item) => item.mine).length)
const mineOnly = ref(false)
watch(mineCount, (count) => {
  if (count === 0) mineOnly.value = false
})
const shownItems = computed(() => (isMyMenu.value && mineOnly.value ? menu.value.items.filter((item) => item.mine) : menu.value.items))

/** 取通用菜单（没登录、或登录失效后用） */
async function loadGeneralMenu() {
  const opts = props.fetchImpl ? { fetchImpl: props.fetchImpl } : {}
  const { menu: latest } = await fetchMenu(`${API_BASE}/api/menu`, opts)
  offerMenu(latest)
}

/** 后台取到的菜单：和现在的一样就不管；用户还没动过就换上，动过了就提示“菜单有更新” */
function offerMenu(latest) {
  if (!latest || sameMenu(latest, menu.value)) return
  if (touched.value) pending.value = latest
  else applyMenu(latest)
}

onMounted(async () => {
  if (!props.remote) return
  if (!token) return loadGeneralMenu()
  eatenStore.value?.sync()
  const opts = props.fetchImpl ? { fetchImpl: props.fetchImpl } : {}
  const result = await fetchMenu(`${API_BASE}/api/my/menu`, { ...opts, token })
  // 等回应的时候登录可能已经失效、或者别的标签页换了账号：这次的回应不用（Codex 第 48 轮）
  if (!sessionAlive.value) return
  if (!stillSameToken()) return forgetToken()
  if (result.status === 401) return forgetToken()
  if (!result.menu) return loadGeneralMenu()
  // 以前登录的没记下账号编号：从内部菜单的回应里拿；只在这台手机上登录的还是这个凭证时才记（上面刚查过）
  if (result.userId && eatenStore.value && !eatenStore.value.bound.value) {
    if (!readStored(USER_ID_KEY)) {
      try {
        localStorage.setItem(USER_ID_KEY, result.userId)
      } catch {
        // 存不了也照样用
      }
    }
    eatenStore.value.bind(result.userId)
  }
  offerMenu(result.menu)
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
      <div v-if="isMyMenu" class="scope-tabs" role="group" aria-label="从哪些菜里选">
        <button type="button" class="scope-tab" :class="{ active: !mineOnly }" :aria-pressed="!mineOnly" @click="mineOnly = false">
          全部
        </button>
        <button
          type="button"
          class="scope-tab"
          :class="{ active: mineOnly }"
          :aria-pressed="mineOnly"
          :disabled="mineCount === 0"
          :title="mineCount === 0 ? '还没加过菜：在“我的账号”里加' : ''"
          @click="mineOnly = true"
        >
          只看我加的（{{ mineCount }}）
        </button>
      </div>
      <DrawPage :key="pageKey" :items="shownItems" :meals="menu.meals" :eaten-store="eatenStore" />
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

/* “全部 / 只看我加的”：和“随机抽 / 帮我分析”同样的小胶囊，放在转盘上面，小一号 */
.scope-tabs {
  display: flex;
  width: max-content;
  max-width: 100%;
  gap: 2px;
  margin: 0 auto 16px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
}

.scope-tab {
  min-height: 30px;
  padding: 2px 14px;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  font-weight: 700;
  white-space: nowrap;
}

.scope-tab.active {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.scope-tab:disabled {
  opacity: 0.5;
}

.app-footer {
  margin-top: 32px;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
</style>
