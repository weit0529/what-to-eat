<!--
  “最近吃过”：开关“避开最近 3 天吃过的”（默认打开）、最近的记录、清空记录。
  默认收起，只显示一行摘要（和“不想吃的”一样）。记录只存在本机浏览器。
  用法：
    <RecentPanel :records="最近的记录（从新到旧）" v-model:avoid="是否避开" :storage-ok="能不能存" @clear="清空" />
-->
<script setup>
import { computed, ref, useId } from 'vue'
import { RECENT_DAYS, describeDay } from '../core/eaten.js'

const props = defineProps({
  /** 最近 RECENT_DAYS 天的记录，从新到旧（recentRecords 的结果） */
  records: { type: Array, required: true },
  /** 是否避开最近吃过的 */
  avoid: { type: Boolean, required: true },
  /** 浏览器能不能存记录；不能时提示一下 */
  storageOk: { type: Boolean, default: true },
})

const emit = defineEmits(['update:avoid', 'clear'])

const open = ref(false)
const bodyId = `recent-body-${useId()}`

const dishCount = computed(() => new Set(props.records.map((r) => r.id)).size)
const summary = computed(() => {
  const text =
    dishCount.value === 0 ? '还没有记录' : props.avoid ? `${dishCount.value} 道，已避开` : `${dishCount.value} 道，没有避开`
  return props.storageOk ? text : `${text}（没存住）`
})
</script>

<template>
  <section class="recent-panel" aria-labelledby="recent-title">
    <div class="head">
      <h2 id="recent-title">
        <button type="button" class="panel-toggle" :aria-expanded="open" :aria-controls="bodyId" @click="open = !open">
          <span class="title"><span aria-hidden="true">🕒 </span>最近吃过</span>
          <span class="summary">{{ summary }}</span>
          <span class="caret" aria-hidden="true">{{ open ? '▲' : '▼' }}</span>
        </button>
      </h2>
    </div>

    <div v-show="open" :id="bodyId" class="body">
      <label class="switch">
        <input
          type="checkbox"
          class="avoid-input"
          :checked="avoid"
          @change="emit('update:avoid', $event.target.checked)"
        />
        避开最近 {{ RECENT_DAYS }} 天吃过的
      </label>

      <ul v-if="records.length > 0" class="records" aria-label="最近吃过的记录">
        <li v-for="record in records" :key="`${record.id}-${record.at}`">
          <span class="record-name">{{ record.label ?? record.id }}</span>
          <span class="record-day">{{ describeDay(record.at) }}</span>
        </li>
      </ul>
      <p v-else class="hint">抽中或推荐的菜，点卡片上的“✅ 就吃这个”就会记下来。</p>

      <button v-if="records.length > 0" type="button" class="link clear" @click="emit('clear')">清空记录</button>
      <p v-if="!storageOk" class="hint warn">
        记录没存住（可能是无痕模式、禁止了网站数据，或者存储满了），刷新页面后会丢；这次打开期间照常避开。
      </p>
      <p class="hint small">记录只存在这台设备的这个浏览器里。小名单里抽的时候不避开。</p>
    </div>
  </section>
</template>

<style scoped>
.recent-panel {
  margin-top: 12px;
  padding: 12px 16px;
  border: 3px dashed var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

h2 {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
}

.panel-toggle {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
  width: 100%;
  min-height: 32px;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  text-align: left;
}

.summary {
  color: var(--text-muted);
  font-size: 0.85rem;
  font-weight: 400;
}

.caret {
  margin-left: auto;
  color: var(--accent-dark);
  font-size: 0.85rem;
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 0.92rem;
  font-weight: 700;
  cursor: pointer;
}

.avoid-input {
  width: 20px;
  height: 20px;
  accent-color: var(--accent);
}

.records {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.records li {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 10px;
  border-radius: 10px;
  background: var(--accent-soft);
  font-size: 0.9rem;
}

.record-name {
  overflow-wrap: anywhere;
}

.record-day {
  flex: none;
  color: var(--text-muted);
}

.link {
  margin-top: 10px;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-dark);
  font-size: 0.9rem;
  font-weight: 700;
}

.hint {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.hint.small {
  font-size: 0.78rem;
}

.hint.warn {
  color: #c92a2a;
}
</style>
