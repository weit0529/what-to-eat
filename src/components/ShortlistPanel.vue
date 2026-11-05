<!--
  临时小名单（随机模式里用）：把几道想吃的放进名单，打开开关后只在名单里抽。
  小名单不受餐次和“不想吃的”限制，刷新页面就清空（用户 2026-11-05 决定 5A）。
  用法：
    <ShortlistPanel
      :items="全部菜品" :meal-items="这一餐的菜"
      v-model:shortlist="小名单 id 列表" v-model:enabled="是否只在小名单里抽"
    />
-->
<script setup>
import { computed, ref } from 'vue'
import { shortlistItems, toggleShortlist } from '../core/recommend.js'

const props = defineProps({
  items: { type: Array, required: true },
  mealItems: { type: Array, required: true },
  shortlist: { type: Array, required: true },
  enabled: { type: Boolean, required: true },
})

const emit = defineEmits(['update:shortlist', 'update:enabled'])

/** 是否展开“从菜单里挑” */
const showPicker = ref(false)

const listed = computed(() => shortlistItems(props.items, props.shortlist))
const inList = (item) => props.shortlist.includes(item.id)
const label = (item) => (item.shop ? `${item.name} · ${item.shop}` : item.name)

function toggle(item) {
  emit('update:shortlist', toggleShortlist(props.shortlist, item.id))
}

function clearAll() {
  emit('update:shortlist', [])
}
</script>

<template>
  <section class="shortlist-panel" aria-labelledby="shortlist-title">
    <div class="head">
      <h2 id="shortlist-title"><span aria-hidden="true">📝 </span>小名单</h2>
      <label class="switch">
        <input
          type="checkbox"
          class="switch-input"
          :checked="enabled"
          @change="emit('update:enabled', $event.target.checked)"
        />
        只在小名单里抽
      </label>
    </div>

    <ul v-if="listed.length > 0" class="chips" aria-label="小名单里的菜">
      <li v-for="item in listed" :key="item.id">
        <button type="button" class="chip" :title="`从小名单移出 ${label(item)}`" @click="toggle(item)">
          {{ label(item) }} <span aria-hidden="true">✕</span><span class="sr-only">移出</span>
        </button>
      </li>
    </ul>
    <p v-else class="hint">还是空的。可以在下面挑，或者在“帮我分析”的结果上点“加入小名单”。</p>

    <div class="actions">
      <button type="button" class="link picker-toggle" :aria-expanded="showPicker" @click="showPicker = !showPicker">
        {{ showPicker ? '收起 ▲' : '从菜单里挑 ▼' }}
      </button>
      <button v-if="listed.length > 0" type="button" class="link clear" @click="clearAll">清空</button>
    </div>

    <div v-if="showPicker" class="picker">
      <button
        v-for="item in mealItems"
        :key="item.id"
        type="button"
        class="pick"
        :class="{ picked: inList(item) }"
        :aria-pressed="inList(item)"
        @click="toggle(item)"
      >
        <span aria-hidden="true">{{ inList(item) ? '✓' : '＋' }}</span> {{ label(item) }}
      </button>
    </div>

    <p class="hint small">小名单不管餐次和“不想吃的”，刷新页面就清空。</p>
  </section>
</template>

<style scoped>
.shortlist-panel {
  margin-top: 16px;
  padding: 14px 16px;
  border: 3px dashed var(--mint);
  border-radius: var(--radius);
  background: var(--surface);
}

.head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
}

.switch-input {
  width: 20px;
  height: 20px;
  accent-color: var(--mint);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.chip {
  min-height: 32px;
  max-width: 100%;
  padding: 2px 12px;
  border: 2px solid var(--mint);
  border-radius: 999px;
  background: #dcf7f1;
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  gap: 16px;
  margin-top: 10px;
}

.link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-dark);
  font-size: 0.9rem;
  font-weight: 700;
}

.picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.pick {
  min-height: 32px;
  max-width: 100%;
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.pick.picked {
  border-color: var(--mint);
  background: #dcf7f1;
  font-weight: 700;
}

.hint {
  margin: 10px 0 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.hint.small {
  font-size: 0.78rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
