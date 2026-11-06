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
import { IconCheck, IconChevronDown, IconListCheck, IconPlus, IconX } from '@tabler/icons-vue'
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
      <h2 id="shortlist-title" class="with-icon">
        <IconListCheck class="title-icon" :size="20" :stroke-width="1.75" aria-hidden="true" />
        小名单
      </h2>
      <label class="switch">
        <input type="checkbox" class="switch-input" :checked="enabled" @change="emit('update:enabled', $event.target.checked)" />
        只在小名单里抽
      </label>
    </div>

    <ul v-if="listed.length > 0" class="chips" aria-label="小名单里的菜">
      <li v-for="item in listed" :key="item.id">
        <button type="button" class="chip" :title="`从小名单移出 ${label(item)}`" @click="toggle(item)">
          <span class="chip-name">{{ label(item) }}</span>
          <IconX :size="14" :stroke-width="2" aria-hidden="true" /><span class="sr-only">移出</span>
        </button>
      </li>
    </ul>
    <p v-else class="hint">还是空的。从菜单里挑，或者在“帮我分析”里加。</p>

    <div class="actions">
      <button type="button" class="link picker-toggle with-icon" :aria-expanded="showPicker" @click="showPicker = !showPicker">
        {{ showPicker ? '收起' : '从菜单里挑' }}
        <IconChevronDown class="caret" :class="{ open: showPicker }" :size="16" :stroke-width="2" aria-hidden="true" />
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
        <component :is="inList(item) ? IconCheck : IconPlus" :size="14" :stroke-width="2" aria-hidden="true" />
        <span>{{ label(item) }}</span>
      </button>
      <p class="hint">加了第一道菜会自动打开开关，清空后自动关掉。小名单不管餐次和“不想吃的”，刷新页面就清空。</p>
    </div>
  </section>
</template>

<style scoped>
.shortlist-panel {
  margin-top: 12px;
  padding: 12px 16px;
  border-radius: var(--radius);
  background: var(--surface);
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
}

h2 {
  flex: 1;
  min-width: 0;
  min-height: 32px;
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 700;
  gap: 8px;
}

.title-icon {
  color: var(--text-muted);
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}

.switch-input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--accent);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  max-width: 100%;
  padding: 4px 10px 4px 12px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  font-size: var(--fs-sm);
  line-height: 1.3;
}

.chip-name {
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 8px;
}

.link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-strong);
  font-size: var(--fs-sm);
  font-weight: 700;
}

.picker-toggle {
  gap: 2px;
}

.caret {
  transition: transform 0.15s;
}

.caret.open {
  transform: rotate(180deg);
}

.picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.pick {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  max-width: 100%;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  font-size: var(--fs-sm);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.pick.picked {
  border-color: var(--accent);
  background: var(--accent-soft);
  font-weight: 700;
}

.hint {
  flex-basis: 100%;
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
</style>
