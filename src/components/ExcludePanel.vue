<!--
  临时排除：勾掉这次不想吃的分类或单道菜。只影响这一次，刷新页面就恢复。
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
import { emojiForCategory } from '../ui/food-emoji.js'

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
  <section class="exclude-panel" aria-labelledby="exclude-title">
    <div class="head">
      <h2 id="exclude-title"><span aria-hidden="true">🙅 </span>不想吃的</h2>
      <span class="summary">{{ summary }}</span>
      <button v-if="hasExclusions" type="button" class="link" @click="clearAll">全部恢复</button>
    </div>

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
        <span class="chip-emoji" aria-hidden="true">{{ emojiForCategory(category.name) }}</span>
        {{ category.name }} <span class="chip-count">{{ category.count }}</span>
      </button>
    </div>

    <button type="button" class="link toggle-dishes" :aria-expanded="showDishes" @click="showDishes = !showDishes">
      {{ showDishes ? '收起 ▲' : '按菜排除 ▼' }}
    </button>

    <div v-if="showDishes" class="dishes">
      <fieldset v-for="group in dishGroups" :key="group.name" class="dish-group">
        <legend><span aria-hidden="true">{{ emojiForCategory(group.name) }} </span>{{ group.name }}</legend>
        <label
          v-for="item in group.dishes"
          :key="item.id"
          class="dish"
          :class="{ excluded: isDishExcluded(item) }"
        >
          <input
            type="checkbox"
            :checked="isDishExcluded(item)"
            :disabled="isCategoryExcluded(item.category)"
            @change="toggleDish(item)"
          />
          {{ dishLabel(item) }}
        </label>
      </fieldset>
      <p class="hint">勾上的这次不会抽到。整类排除的菜在上面点分类恢复。</p>
    </div>
  </section>
</template>

<style scoped>
.exclude-panel {
  margin-top: 22px;
  padding: 14px 16px;
  border: 3px dashed var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
}

.summary {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.link {
  margin-left: auto;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-dark);
  font-size: 0.9rem;
  font-weight: 700;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 34px;
  max-width: 100%;
  padding: 3px 12px;
  border: 2px solid var(--border);
  border-radius: 999px;
  background: var(--accent-soft);
  font-size: 0.9rem;
  overflow-wrap: anywhere;
  transition: transform 0.15s;
}

.chip:hover {
  transform: rotate(-3deg);
}

.chip-emoji {
  margin-right: 2px;
}

.chip-count {
  margin-left: 2px;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.chip.excluded {
  background: var(--surface);
  color: var(--excluded);
  text-decoration: line-through;
  border-style: dashed;
}

.chip.excluded .chip-emoji {
  filter: grayscale(1);
  opacity: 0.5;
}

.toggle-dishes {
  display: block;
  margin: 12px 0 0;
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
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-muted);
}

.dish {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 2px 14px 2px 0;
  font-size: 0.95rem;
  overflow-wrap: anywhere;
}

.dish input {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
}

.dish.excluded {
  color: var(--excluded);
  text-decoration: line-through;
}

.hint {
  margin: 10px 0 0;
  color: var(--text-muted);
  font-size: 0.8rem;
}
</style>
