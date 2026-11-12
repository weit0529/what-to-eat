<!--
  管理页“审核”（阶段 4-4，REQUIREMENTS.md R-024）：用户提交的菜在这里通过或退回。
  - 通过：变成共享菜，所有登录用户都能抽到（没登录的看不到，要的话在“菜单”里“移到通用菜单”）
  - 改了再通过：先在表单里改（比如补店铺、改名避开重名），再通过
  - 退回：要写一句理由，用户在账号页能看到，改了可以再提交
  和已有的菜重名（品类和店铺都一样）的不能直接通过，要先改个名字。
  通过、退回都带上列表里看到的版本号：这期间用户改过、重新提交过，后台会拒绝，列表重新读一次（Codex 第 37 轮）。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import { approveReview, listReviews, rejectReview } from './api.js'
import DishForm from './DishForm.vue'

const props = defineProps({
  /** /api/admin/menu 的结果：要用里面的餐次和已有的分类 */
  menu: { type: Object, required: true },
})
const emit = defineEmits(['changed'])

const reviews = ref([])
const loading = ref(true)
const busy = ref(false)
const message = ref('')
const error = ref('')
const serverErrors = ref([])
/** 正在“改了再通过”的那道 */
const editing = ref(null)
/** 给表单的那道菜：用户的菜没有“启用”，默认启用（computed，免得每次渲染都换新对象、表单被重置） */
const editingDish = computed(() => editing.value && { ...editing.value, enabled: true })
/** 正在写退回理由的那道的 id，和理由 */
const rejecting = ref(null)
const note = ref('')

const mealLabel = computed(() => new Map(props.menu.meals.map((m) => [m.id, m.label])))
const categories = computed(() => [...new Set(props.menu.dishes.map((d) => d.category))])
const describe = (dish) =>
  [dish.category, dish.meals.map((id) => mealLabel.value.get(id) || id).join('、'), dish.price !== null ? `人均 ¥${dish.price}` : '']
    .filter(Boolean)
    .join(' · ')
const when = (ms) => new Date(ms).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const label = (dish) => (dish.shop ? `${dish.name}（${dish.shop}）` : dish.name)

async function load() {
  reviews.value = await listReviews()
}

async function run(action, done) {
  busy.value = true
  error.value = ''
  message.value = ''
  serverErrors.value = []
  try {
    await action()
    message.value = done
    emit('changed')
    return true
  } catch (err) {
    error.value = err.message
    serverErrors.value = err.errors || []
    return false
  } finally {
    busy.value = false
    // 别的管理员可能刚处理了：不管成功失败都重新读一次列表
    await load().catch(() => {})
  }
}

function startEdit(dish) {
  editing.value = dish
  rejecting.value = null
  error.value = ''
  message.value = ''
  serverErrors.value = []
}

function startReject(dish) {
  rejecting.value = dish.id
  note.value = ''
  editing.value = null
  error.value = ''
  message.value = ''
}

const approve = (dish) => run(() => approveReview(dish.id, dish.revision), `已通过：${label(dish)}。所有登录的人都能抽到了`)

async function approveEdited(payload) {
  const dish = editing.value
  const ok = await run(() => approveReview(dish.id, dish.revision, payload), `已改好并通过：${payload.name}`)
  if (ok) editing.value = null
}

async function reject(dish) {
  if (!note.value.trim()) {
    error.value = '退回要写一句理由，用户能看到'
    return
  }
  const ok = await run(() => rejectReview(dish.id, dish.revision, note.value.trim()), `已退回：${label(dish)}`)
  if (ok) rejecting.value = null
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
  <section>
    <p class="hint">
      用户提交的菜。通过后变成共享菜，所有登录的人都能抽到（没登录的看不到；想让大家都看到，在“菜单”里点“移到通用菜单”）。
      退回要写理由，用户改了可以再提交。
    </p>
    <p v-if="message" class="ok" role="status">{{ message }}</p>
    <p v-if="error && !editing" class="error" role="alert">{{ error }}</p>

    <DishForm
      v-if="editing"
      :dish="editingDish"
      :meals="menu.meals"
      :categories="categories"
      :server-errors="serverErrors"
      :busy="busy"
      :title="`改了再通过：${editing.name}（${editing.author} 提交）`"
      @save="approveEdited"
      @cancel="editing = null"
    />
    <p v-if="error && editing" class="error" role="alert">{{ error }}</p>

    <p v-if="loading" class="hint">正在读……</p>
    <p v-else-if="reviews.length === 0" class="hint">没有要审核的菜。</p>

    <ul class="dish-list">
      <li v-for="dish in reviews" :key="dish.id" class="dish-row review-row">
        <div class="dish-main">
          <strong>{{ dish.name }}</strong>
          <span v-if="dish.shop" class="muted">（{{ dish.shop }}）</span>
          <div class="muted small">{{ describe(dish) }}</div>
          <div v-if="dish.tags.length" class="muted small">标签：{{ dish.tags.join('、') }}</div>
          <div v-if="dish.description" class="muted small">描述：{{ dish.description }}</div>
          <div class="muted small">{{ dish.author }} 在 {{ when(dish.submittedAt) }} 提交</div>
          <div v-if="dish.duplicate" class="error small">和已有的菜重名（品类和店铺都一样），要先“改了再通过”换个名字或店铺</div>

          <form v-if="rejecting === dish.id" class="reject-form" @submit.prevent="reject(dish)">
            <label class="field">
              <span>退回的理由（用户能看到）</span>
              <textarea v-model="note" rows="2" maxlength="200" placeholder="如：写一下是哪家店"></textarea>
            </label>
            <div class="actions">
              <button type="submit" class="danger" :disabled="busy">确认退回</button>
              <button type="button" :disabled="busy" @click="rejecting = null">取消</button>
            </div>
          </form>
        </div>
        <div v-if="rejecting !== dish.id" class="dish-actions">
          <button v-if="!dish.duplicate" type="button" class="primary" :disabled="busy" @click="approve(dish)">通过</button>
          <button type="button" :disabled="busy" @click="startEdit(dish)">改了再通过</button>
          <button type="button" class="danger" :disabled="busy" @click="startReject(dish)">退回</button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.reject-form {
  margin-top: 8px;
}
</style>
