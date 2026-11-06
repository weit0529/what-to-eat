<!--
  结果卡片上的“✅ 就吃这个”按钮：点了记一次“吃过”；今天已经记过时显示“已记下”，再点一下撤销。
  用法：<EatButton :eaten="今天是否已记过" @toggle="..." />
-->
<script setup>
defineProps({
  eaten: { type: Boolean, required: true },
})
const emit = defineEmits(['toggle'])
</script>

<template>
  <button type="button" class="eat-button" :class="{ done: eaten }" :aria-pressed="eaten" @click="emit('toggle')">
    <template v-if="eaten"><span aria-hidden="true">✓ </span>已记下，今天吃它（点一下撤销）</template>
    <template v-else><span aria-hidden="true">✅ </span>就吃这个</template>
  </button>
</template>

<style scoped>
.eat-button {
  display: block;
  margin: 14px auto 0;
  min-height: 40px;
  padding: 6px 18px;
  border: 3px solid var(--accent-dark);
  border-radius: 999px;
  background: var(--yellow);
  color: var(--text);
  font-weight: 800;
  box-shadow: 0 4px 0 var(--accent-dark);
}

.eat-button:active {
  transform: translateY(3px);
  box-shadow: 0 1px 0 var(--accent-dark);
}

.eat-button.done {
  border-color: var(--mint);
  background: #dcf7f1;
  box-shadow: 0 4px 0 #1f9e86;
  font-weight: 700;
}
</style>
