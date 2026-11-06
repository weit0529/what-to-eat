<!--
  临时排除：勾掉这次不想吃的分类或单道菜。只影响这一次，刷新页面就恢复。
  默认收起，只显示一行摘要，点标题展开（用户 2026-11-05 决定 1A）。
  用法：
    <ExcludePanel
      :items="这一餐的菜"
      v-model:excluded-categories="..."
      v-model:excluded-ids="..."
    />
-->
<script setup>
import { computed, ref } from 'vue'
import { listCategories } from '../core/draw.js'
import { IconBan, IconChevronDown } from '@tabler/icons-vue'
import { iconForCategory } from '../ui/icons.js'
import CollapsePanel from './CollapsePanel.vue'

const props = defineProps({
  /** 这一餐的菜（已经按餐次筛过） */
  items: { type: Array, required: true },
  /** 排除的分类名 */
  excludedCategories: { type: Array, required: true },
  /** 排除的菜品 id */
  excludedIds: { type: Array, required: true },
})

const emit = defineEmits(['update:excludedCategories', 'update:excludedIds'])

/** 是否展开“按菜排除”的列表 */
const showDishes = ref(false)

const categories = computed(() => listCategories(props.items))

/** 按分类分组的菜，用于“按菜排除”列表 */
const dishGroups = computed(() =>
  categories.value.map((category) => ({
    name: category.name,
    dishes: props.items.filter((item) => item.category === category.name),
  })),
)

const isCategoryExcluded = (name) => props.excludedCategories.includes(name)
const isDishExcluded = (item) => props.excludedIds.includes(item.id) || isCategoryExcluded(item.category)

// 只统计和这一餐有关的排除（换了餐次后，别的餐次才有的分类不算）
const excludedCategoryCount = computed(() => categories.value.filter((c) => isCategoryExcluded(c.name)).length)
const excludedDishCount = computed(
  () => props.items.filter((item) => props.excludedIds.includes(item.id) && !isCategoryExcluded(item.category)).length,
)
const hasExclusions = computed(() => props.excludedCategories.length > 0 || props.excludedIds.length > 0)

const summary = computed(() => {
  const parts = []
  if (excludedCategoryCount.value > 0) parts.push(`${excludedCategoryCount.value} 类`)
  if (excludedDishCount.value > 0) parts.push(`${excludedDishCount.value} 道`)
  return parts.length > 0 ? `已排除 ${parts.join('、')}` : '都可以'
})

/** 在列表里加上或去掉一项，返回新数组（不直接改 props） */
function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function toggleCategory(name) {
  emit('update:excludedCategories', toggle(props.excludedCategories, name))
}

function toggleDish(item) {
  emit('update:excludedIds', toggle(props.excludedIds, item.id))
}

function clearAll() {
  emit('update:excludedCategories', [])
  emit('update:excludedIds', [])
}

const dishLabel = (item) => (item.shop ? `${item.name} · ${item.shop}` : item.name)
</script>

<template>
  <CollapsePanel class="exclude-panel" title="不想吃的" :icon="IconBan" :summary="summary">
    <template #actions>
      <button v-if="hasExclusions" type="button" class="link" @click="clearAll">全部恢复</button>
    </template>

    <div class="chips">
      <button
        v-for="category in categories"
        :key="category.name"
        type="button"
        class="chip"
        :class="{ excluded: isCategoryExcluded(category.name) }"
        :aria-pressed="isCategoryExcluded(category.name)"
        :title="isCategoryExcluded(category.name) ? '点一下恢复' : '点一下排除这一类'"
        @click="toggleCategory(category.name)"
      >
        <component :is="iconForCategory(category.name)" class="chip-icon" :size="16" :stroke-width="1.75" aria-hidden="true" />
        <span class="chip-name">{{ category.name }}</span>
        <span class="chip-count">{{ category.count }}</span>
      </button>
    </div>

    <button type="button" class="link toggle-dishes with-icon" :aria-expanded="showDishes" @click="showDishes = !showDishes">
      {{ showDishes ? '收起单道菜' : '按菜排除' }}
      <IconChevronDown class="caret" :class="{ open: showDishes }" :size="16" :stroke-width="2" aria-hidden="true" />
    </button>

    <div v-if="showDishes" class="dishes">
      <fieldset v-for="group in dishGroups" :key="group.name" class="dish-group">
        <legend>{{ group.name }}</legend>
        <label v-for="item in group.dishes" :key="item.id" class="dish" :class="{ excluded: isDishExcluded(item) }">
          <input
            type="checkbox"
            :checked="isDishExcluded(item)"
            :disabled="isCategoryExcluded(item.category)"
            @change="toggleDish(item)"
          />
          {{ dishLabel(item) }}
        </label>
      </fieldset>
      <p class="hint">勾上的这次不会抽到。整类排除的，在上面点分类恢复。</p>
    </div>
  </CollapsePanel>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
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
}

.chip-icon {
  color: var(--text-muted);
}

.chip-name {
  overflow-wrap: anywhere;
}

.chip-count {
  color: var(--text-muted);
}

.chip.excluded {
  border-style: dashed;
  background: transparent;
  color: var(--excluded);
}

.chip.excluded .chip-name {
  text-decoration: line-through;
}

.chip.excluded .chip-icon {
  color: var(--excluded);
}

.link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-strong);
  font-size: var(--fs-sm);
  font-weight: 700;
}

.toggle-dishes {
  margin-top: 12px;
  gap: 2px;
}

.caret {
  transition: transform 0.15s;
}

.caret.open {
  transform: rotate(180deg);
}

.dishes {
  margin-top: 8px;
}

.dish-group {
  margin: 8px 0 0;
  padding: 0;
  border: none;
}

legend {
  padding: 0;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  font-weight: 700;
}

.dish {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  margin-right: 16px;
  font-size: var(--fs-md);
  overflow-wrap: anywhere;
}

.dish input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--accent);
}

.dish.excluded {
  color: var(--excluded);
  text-decoration: line-through;
}

.hint {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
</style>
