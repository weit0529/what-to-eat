<!--
  管理页“菜单”页签顶上的周四特典开关（REQUIREMENTS.md R-033，用户 2026-11-18 选 5B）：
  每周四（北京时间）每台手机当天第一次随机抽一定抽到菜单里叫“KFC”（或“肯德基”）的那道菜。
  开关默认开着；菜单里没有这道启用的通用菜时，开着也不会出现，这里提示管理员去加。
  开关和找到的菜都由后台告诉（/api/admin/menu 的 thursday）。
-->
<script setup>
import { computed, ref } from 'vue'
import { setThursday } from './api.js'

const props = defineProps({
  /** /api/admin/menu 的结果（用到 thursday 和 dishes） */
  menu: { type: Object, required: true },
})
const emit = defineEmits(['changed'])

const busy = ref(false)
const error = ref('')
const on = computed(() => props.menu.thursday?.on !== false)
const dish = computed(() => {
  const id = props.menu.thursday?.dishId
  return (id && props.menu.dishes.find((d) => d.id === id)) || null
})

async function toggle() {
  const next = !on.value
  busy.value = true
  error.value = ''
  try {
    await setThursday(next)
    emit('changed')
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="block thursday" aria-label="周四特典">
    <label class="check switch-line">
      <input type="checkbox" :checked="on" :disabled="busy" @click.prevent="toggle" />
      <strong>周四特典</strong>
    </label>
    <p class="hint">
      每周四（北京时间）每台手机当天第一次随机抽，一定抽到
      <template v-if="dish">“{{ dish.name }}”<template v-if="dish.shop">（{{ dish.shop }}）</template></template>
      <template v-else>菜单里叫“KFC”的菜</template>，不管选了什么；之后再抽恢复正常。
    </p>
    <p v-if="on && !dish" class="error">菜单里还没有叫“KFC”（或“肯德基”）的启用的通用菜，现在不会出现。加一道就会生效。</p>
    <p v-else-if="!on" class="hint">现在关着。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

