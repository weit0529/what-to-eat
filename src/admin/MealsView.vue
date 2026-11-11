<!--
  餐次：早、午、晚固定不变；可以加额外餐次（如下午茶、夜宵），规则和 Excel“餐次”页一样。
  还有菜在用的餐次不能去掉（后台会说是哪几道菜）。
-->
<script setup>
import { ref, watch } from 'vue'
import { MAX_EXTRA_MEALS, validateExtraMeals } from '../core/menu-data.js'
import { saveMeals } from './api.js'

const props = defineProps({
  menu: { type: Object, required: true },
})
const emit = defineEmits(['changed'])

const labels = ref([])
const newLabel = ref('')
const busy = ref(false)
const message = ref('')
const error = ref('')

watch(
  () => props.menu,
  (menu) => {
    labels.value = menu.meals.filter((m) => !m.builtIn).map((m) => m.label)
  },
  { immediate: true },
)

function add() {
  const label = newLabel.value.trim()
  if (!label) return
  labels.value = [...labels.value, label]
  newLabel.value = ''
}

function move(index, step) {
  const next = [...labels.value]
  const [item] = next.splice(index, 1)
  next.splice(index + step, 0, item)
  labels.value = next
}

async function save() {
  message.value = ''
  const { errors } = validateExtraMeals(labels.value)
  error.value = errors.join('；')
  if (errors.length > 0) return
  busy.value = true
  try {
    await saveMeals(labels.value)
    message.value = '餐次已保存'
    emit('changed')
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="block">
    <h2>餐次</h2>
    <p class="hint">早餐、午餐、晚餐固定不变。下面是额外的餐次，最多 {{ MAX_EXTRA_MEALS }} 个，按这里的顺序排到转盘上对应的时间位置。</p>
    <ul class="meal-list">
      <li v-for="(label, index) in labels" :key="label + index">
        <span>{{ label }}</span>
        <button type="button" :disabled="index === 0" aria-label="往前挪" @click="move(index, -1)">↑</button>
        <button type="button" :disabled="index === labels.length - 1" aria-label="往后挪" @click="move(index, 1)">↓</button>
        <button type="button" class="danger" @click="labels = labels.filter((_, i) => i !== index)">去掉</button>
      </li>
    </ul>
    <form class="toolbar" @submit.prevent="add">
      <input v-model="newLabel" maxlength="10" placeholder="新的餐次名，如：下午茶" aria-label="新的餐次名" />
      <button type="submit">加上</button>
    </form>
    <p v-if="message" class="ok" role="status">{{ message }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <button type="button" class="primary" :disabled="busy" @click="save">{{ busy ? '正在保存……' : '保存餐次' }}</button>
  </section>
</template>
