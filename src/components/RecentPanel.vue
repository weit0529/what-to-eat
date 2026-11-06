<!--
  “最近吃过”：开关“避开最近 3 天吃过的”（默认打开）、最近的记录、清空记录。
  默认收起，只显示一行摘要（和“不想吃的”一样）。记录只存在本机浏览器。
  用法：
    <RecentPanel :records="最近的记录（从新到旧）" v-model:avoid="是否避开" :storage-ok="能不能存" @clear="清空" />
-->
<script setup>
import { computed } from 'vue'
import { IconHistory } from '@tabler/icons-vue'
import { RECENT_DAYS, describeDay } from '../core/eaten.js'
import CollapsePanel from './CollapsePanel.vue'

const props = defineProps({
  /** 最近 RECENT_DAYS 天的记录，从新到旧（recentRecords 的结果） */
  records: { type: Array, required: true },
  /** 是否避开最近吃过的 */
  avoid: { type: Boolean, required: true },
  /** 浏览器能不能存记录；不能时提示一下 */
  storageOk: { type: Boolean, default: true },
})

const emit = defineEmits(['update:avoid', 'clear'])

const dishCount = computed(() => new Set(props.records.map((r) => r.id)).size)
const summary = computed(() => {
  const text =
    dishCount.value === 0 ? '还没有记录' : props.avoid ? `${dishCount.value} 道，已避开` : `${dishCount.value} 道，没有避开`
  return props.storageOk ? text : `${text}（没存住）`
})
</script>

<template>
  <CollapsePanel class="recent-panel" title="最近吃过" :icon="IconHistory" :summary="summary">
    <label class="switch">
      <input type="checkbox" class="avoid-input" :checked="avoid" @change="emit('update:avoid', $event.target.checked)" />
      避开最近 {{ RECENT_DAYS }} 天吃过的
    </label>

    <ul v-if="records.length > 0" class="records" aria-label="最近吃过的记录">
      <li v-for="record in records" :key="`${record.id}-${record.at}`">
        <span class="record-name">{{ record.label ?? record.id }}</span>
        <span class="record-day">{{ describeDay(record.at) }}</span>
      </li>
    </ul>
    <p v-else class="hint">抽中或推荐的菜，点卡片上的“就吃这个”就会记下来。</p>

    <button v-if="records.length > 0" type="button" class="link clear" @click="emit('clear')">清空记录</button>
    <p v-if="!storageOk" class="hint warn">
      记录没存住（可能是无痕模式、禁止了网站数据，或者存储满了），刷新页面后会丢；这次打开期间照常避开。
    </p>
    <p class="hint">记录只存在这台设备的这个浏览器里。小名单里抽的时候不避开。</p>
  </CollapsePanel>
</template>

<style scoped>
.switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  font-weight: 700;
  cursor: pointer;
}

.avoid-input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--accent);
}

.records {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.records li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-radius: var(--radius-inner);
  background: var(--surface);
}

.record-name {
  overflow-wrap: anywhere;
}

.record-day {
  flex: none;
  color: var(--text-muted);
  font-size: var(--fs-sm);
}

.link {
  margin-top: 8px;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-strong);
  font-size: var(--fs-sm);
  font-weight: 700;
}

.hint {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: var(--fs-sm);
}

.hint.warn {
  color: #b42318;
}
</style>
