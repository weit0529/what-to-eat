<!--
  菜单：列出全部菜（含暂停的），可以搜索、新加、修改、暂停 / 恢复、删除。
  改完马上存到后台，网站上的人刷新就能看到，不用重新发布（REQUIREMENTS.md D-02）。
-->
<script setup>
import { computed, ref } from 'vue'
import { createDish, deleteDish, promoteDish, updateDish, uploadImage } from './api.js'
import DishForm from './DishForm.vue'

const props = defineProps({
  /** /api/admin/menu 的结果 { meals, dishes } */
  menu: { type: Object, required: true },
})
const emit = defineEmits(['changed'])

const query = ref('')
/** 看哪一层：all 全部 / general 通用菜单 / shared 共享菜（阶段 4-4） */
const scope = ref('all')
/** 正在编辑的菜：null = 没在编辑；'new' = 新加；否则是那道菜 */
const editing = ref(null)
const busy = ref(false)
const message = ref('')
const error = ref('')
const serverErrors = ref([])

const mealLabel = computed(() => new Map(props.menu.meals.map((m) => [m.id, m.label])))
const categories = computed(() => [...new Set(props.menu.dishes.map((d) => d.category))])
const enabledCount = computed(() => props.menu.dishes.filter((d) => d.enabled).length)
const sharedCount = computed(() => props.menu.dishes.filter((d) => d.scope === 'shared').length)

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const inScope = props.menu.dishes.filter((d) => scope.value === 'all' || (d.scope ?? 'general') === scope.value)
  if (!q) return inScope
  return inScope.filter((d) =>
    [d.name, d.shop, d.category, ...d.tags].some((text) => text && text.toLowerCase().includes(q)),
  )
})

function startEdit(dish) {
  editing.value = dish
  serverErrors.value = []
  message.value = ''
  error.value = ''
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
    serverErrors.value = err.errors
    return false
  } finally {
    busy.value = false
  }
}

async function save(payload) {
  const isNew = editing.value === 'new'
  const ok = await run(
    () => (isNew ? createDish(payload) : updateDish(editing.value.id, payload)),
    isNew ? `已加上：${payload.name}` : `已保存：${payload.name}`,
  )
  if (ok) editing.value = null
}

function toggle(dish) {
  return run(() => updateDish(dish.id, { ...dish, enabled: !dish.enabled }), dish.enabled ? `已暂停：${dish.name}` : `已恢复：${dish.name}`)
}

function promote(dish) {
  const label = dish.shop ? `${dish.name}（${dish.shop}）` : dish.name
  if (!window.confirm(`把“${label}”移到通用菜单？
移过去以后没登录的人也能抽到它（在 Excel 导出里也会有它）。`)) return
  return run(() => promoteDish(dish.id), `已移到通用菜单：${label}`)
}

function remove(dish) {
  const label = dish.shop ? `${dish.name}（${dish.shop}）` : dish.name
  if (!window.confirm(`确定删掉“${label}”？删了就没了；只是暂时不想让它出现的话，用“暂停”。`)) return
  return run(() => deleteDish(dish.id), `已删除：${label}`)
}
</script>

<template>
  <section>
    <div class="toolbar">
      <input v-model="query" type="search" placeholder="搜品类、店铺、分类、标签" aria-label="搜索菜" />
      <select v-model="scope" aria-label="看哪些菜">
        <option value="all">全部</option>
        <option value="general">通用菜单</option>
        <option value="shared">共享菜</option>
      </select>
      <button type="button" class="primary" :disabled="busy" @click="startEdit('new')">新加一道菜</button>
    </div>
    <p class="hint">
      共 {{ menu.dishes.length }} 道，启用 {{ enabledCount }} 道<template v-if="sharedCount">，其中共享菜 {{ sharedCount }} 道</template>。改完马上生效，网站上的人刷新就能看到。
      共享菜是用户提交、审核通过的，只有登录的人能抽到。
    </p>
    <p v-if="message" class="ok" role="status">{{ message }}</p>
    <p v-if="error && !editing" class="error" role="alert">{{ error }}</p>

    <!-- key：换一道菜就换一个新表单，上一道菜没传完的图片不会填到这道菜上（Codex 第 41 轮） -->
    <DishForm
      v-if="editing"
      :key="editing === 'new' ? 'new' : editing.id"
      :dish="editing === 'new' ? null : editing"
      :meals="menu.meals"
      :categories="categories"
      :server-errors="serverErrors"
      :busy="busy"
      :upload-image="uploadImage"
      @save="save"
      @cancel="editing = null"
    />
    <p v-if="error && editing" class="error" role="alert">{{ error }}</p>

    <ul class="dish-list">
      <li v-for="dish in shown" :key="dish.id" class="dish-row" :class="{ paused: !dish.enabled }">
        <div class="dish-main">
          <strong>{{ dish.name }}</strong>
          <span v-if="dish.shop" class="muted">（{{ dish.shop }}）</span>
          <span v-if="!dish.enabled" class="badge">暂停</span>
          <span v-if="dish.scope === 'shared'" class="badge shared">共享 · {{ dish.author }} 提交</span>
          <div class="muted small">
            {{ dish.category }} · {{ dish.meals.map((id) => mealLabel.get(id) || id).join('、') }}
            <template v-if="dish.price !== null"> · 人均 ¥{{ dish.price }}</template>
            <template v-if="dish.tags.length"> · {{ dish.tags.join('、') }}</template>
          </div>
        </div>
        <div class="dish-actions">
          <button type="button" :disabled="busy" @click="startEdit(dish)">改</button>
          <button type="button" :disabled="busy" @click="toggle(dish)">{{ dish.enabled ? '暂停' : '恢复' }}</button>
          <button v-if="dish.scope === 'shared'" type="button" :disabled="busy" @click="promote(dish)">移到通用菜单</button>
          <button type="button" class="danger" :disabled="busy" @click="remove(dish)">删</button>
        </div>
      </li>
    </ul>
    <p v-if="shown.length === 0" class="hint">{{ query ? '没有搜到。' : '还没有菜。可以在“Excel”里把原来的菜单表格导入进来。' }}</p>
  </section>
</template>
