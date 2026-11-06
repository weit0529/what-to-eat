<!--
  结果卡片上的“就吃这个”按钮：点了记一次“吃过”；今天已经记过时显示“已记下”，再点一下撤销。
  用法：<EatButton :eaten="今天是否已记过" @toggle="..." />
-->
<script setup>
import { IconCheck, IconToolsKitchen2 } from '@tabler/icons-vue'

defineProps({
  eaten: { type: Boolean, required: true },
})
const emit = defineEmits(['toggle'])
</script>

<template>
  <button type="button" class="eat-button" :class="{ done: eaten }" :aria-pressed="eaten" @click="emit('toggle')">
    <template v-if="eaten">
      <IconCheck :size="18" :stroke-width="2" aria-hidden="true" />已记下（点一下撤销）
    </template>
    <template v-else>
      <IconToolsKitchen2 :size="18" :stroke-width="1.75" aria-hidden="true" />就吃这个
    </template>
  </button>
</template>

<style scoped>
.eat-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 40px;
  margin-top: 16px;
  padding: 6px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-inner);
  background: var(--surface);
  font-weight: 700;
}

.eat-button:active {
  background: var(--surface-muted);
}

.eat-button.done {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
}
</style>
