<!--
  账号页的“我的菜”（阶段 4-4，REQUIREMENTS.md R-024、R-029）。
  加了马上能用（只有自己看得到，首页登录后能抽到）；可以提交给管理员审核，审核中锁住；
  通过后变成所有登录用户都能抽到的共享菜，归管理员管，这里只显示、不能改；被退回的能看到理由，改了再提交。
  管理员关了加菜（或把自己放进了黑名单）时，已加的菜照常能用，只是不能加、改、删、提交。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import DishForm from '../admin/DishForm.vue'
import { addMyDish, deleteMyDish, listMyDishes, myMenu, submitMyDish, updateMyDish, uploadImage } from './api.js'

const loading = ref(true)
const busy = ref(false)
const error = ref('')
const message = ref('')
const serverErrors = ref([])

const dishes = ref([])
const approved = ref([])
const canEdit = ref(true)
const reason = ref('')
const meals = ref([])
const categories = ref([])
/** 正在改的菜；'new' 表示新加；null 表示没在改 */
const editing = ref(null)

const mealLabel = computed(() => new Map(meals.value.map((m) => [m.id, m.label])))
const STATUS = { private: '只有自己看得到', pending: '审核中', rejected: '被退回' }

async function load() {
  const [mine, menu] = await Promise.all([listMyDishes(), myMenu()])
  dishes.value = mine.dishes
  approved.value = mine.approved
  canEdit.value = mine.canEdit
  reason.value = mine.reason || ''
  meals.value = menu.meals
  categories.value = [...new Set(menu.items.map((item) => item.category))].sort()
}

async function run(action, done) {
  busy.value = true
  error.value = ''
  message.value = ''
  serverErrors.value = []
  try {
    await action()
    if (done) message.value = done
  } catch (err) {
    error.value = err.message
    serverErrors.value = err.errors || []
    // 管理员刚关了加菜：重新读一次，按钮跟着变
    if (err.status === 403) await load().catch(() => {})
  } finally {
    busy.value = false
  }
}

function startEdit(dish) {
  editing.value = dish
  error.value = ''
  message.value = ''
  serverErrors.value = []
}

const save = (payload) =>
  run(async () => {
    if (editing.value === 'new') await addMyDish(payload)
    else await updateMyDish(editing.value.id, payload)
    const wasNew = editing.value === 'new'
    editing.value = null
    await load()
    message.value = wasNew ? '加好了。回首页就能抽到它（只有你自己看得到）。' : '改好了。'
  })

const remove = (dish) => {
  if (!window.confirm(`删掉“${dish.name}”？删了就找不回来了。`)) return
  run(async () => {
    await deleteMyDish(dish.id)
    await load()
  }, '删掉了。')
}

const submit = (dish) => {
  const ok = window.confirm(
    `把“${dish.name}”提交给管理员审核？\n审核中不能改、不能删。通过后所有登录的人都能抽到它，之后就由管理员管、你不能再改了。`,
  )
  if (!ok) return
  run(async () => {
    await submitMyDish(dish.id)
    await load()
  }, '提交了，等管理员审核。')
}

const describe = (dish) =>
  [dish.category, dish.meals.map((id) => mealLabel.value.get(id) || id).join('、'), dish.price !== null ? `人均 ¥${dish.price}` : '']
    .filter(Boolean)
    .join(' · ')

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
  <section class="block my-dishes">
    <h2>我的菜</h2>
    <p class="hint">
      加了马上能用：回首页就能抽到（只有你自己看得到）。想让大家也能抽到，就“提交审核”，管理员通过后所有登录的人都能抽到。
    </p>

    <p v-if="loading" class="hint">正在读……</p>
    <template v-else>
      <p v-if="!canEdit" class="notice" role="status">{{ reason || '管理员暂时关闭了加菜' }}。已经加的菜照常能用。</p>
      <div v-else-if="!editing" class="toolbar">
        <button type="button" class="primary" :disabled="busy" @click="startEdit('new')">加一道菜</button>
      </div>

      <!-- key：换一道菜就换一个新表单，上一道菜没传完的图片不会填到这道菜上（Codex 第 41 轮） -->
      <DishForm
        v-if="editing"
        :key="editing === 'new' ? 'new' : editing.id"
        :dish="editing === 'new' ? null : editing"
        :meals="meals"
        :categories="categories"
        :server-errors="serverErrors"
        :busy="busy"
        :show-enabled="false"
        :bundled-images="false"
        :upload-image="uploadImage"
        :title="editing === 'new' ? '加一道菜' : `改：${editing.name}`"
        @save="save"
        @cancel="editing = null"
      />

      <p v-if="message" class="ok" role="status">{{ message }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <p v-if="dishes.length === 0 && approved.length === 0" class="hint">还没加过菜。</p>

      <ul v-if="dishes.length > 0" class="dish-list">
        <li v-for="dish in dishes" :key="dish.id" class="dish-row">
          <div class="dish-main">
            <strong>{{ dish.name }}</strong>
            <span v-if="dish.shop" class="muted">（{{ dish.shop }}）</span>
            <span class="badge" :class="`status-${dish.status}`">{{ STATUS[dish.status] }}</span>
            <div class="muted small">{{ describe(dish) }}</div>
            <div v-if="dish.status === 'rejected' && dish.reviewNote" class="small reject-note">管理员说：{{ dish.reviewNote }}</div>
          </div>
          <div v-if="canEdit && dish.status !== 'pending'" class="dish-actions">
            <button type="button" :disabled="busy" @click="startEdit(dish)">改</button>
            <button type="button" :disabled="busy" @click="submit(dish)">{{ dish.status === 'rejected' ? '重新提交' : '提交审核' }}</button>
            <button type="button" class="danger" :disabled="busy" @click="remove(dish)">删</button>
          </div>
        </li>
      </ul>

      <template v-if="approved.length > 0">
        <h3>已经通过的（由管理员管，不能再改）</h3>
        <ul class="dish-list">
          <li v-for="dish in approved" :key="dish.id" class="dish-row" :class="{ paused: !dish.enabled }">
            <div class="dish-main">
              <strong>{{ dish.name }}</strong>
              <span v-if="dish.shop" class="muted">（{{ dish.shop }}）</span>
              <span class="badge">{{ dish.scope === 'general' ? '所有人都能抽到' : '登录的人都能抽到' }}</span>
              <span v-if="!dish.enabled" class="badge">管理员暂停了</span>
              <div class="muted small">{{ describe(dish) }}</div>
            </div>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>

<style scoped>
.notice {
  margin: 12px 0;
  padding: 10px 12px;
  border-radius: var(--radius-inner);
  background: var(--surface);
  color: var(--text-muted);
}

/* 被退回：和出错提示一样用深橙，提醒去看理由；审核中、只有自己看得到用默认的灰色小标签 */
.status-rejected {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.reject-note {
  margin-top: 4px;
  color: var(--accent-strong);
}
</style>
