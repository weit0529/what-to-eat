<!--
  选餐次：早餐 / 午餐 / 晚餐三个按钮，一次只能选一个。
  “餐次”页里加的额外餐次（如下午茶、夜宵）放在下面一行，早午晚的位置和大小不变（用户 2026-11-05 要求）。
  用法：<MealPicker v-model="meal" :items="全部菜品" :meals="全部餐次" />
  按钮上的数字是这一餐有几道菜。
-->
<script setup>
import { computed } from 'vue'
import { MEALS } from '../core/menu-data.js'
import { itemsForMeal } from '../core/draw.js'
import { iconForMeal } from '../ui/icons.js'

const props = defineProps({
  /** 当前选中的餐次 id，还没选时是 null */
  modelValue: { type: String, default: null },
  /** 全部菜品，用来算每一餐有几道 */
  items: { type: Array, required: true },
  /** 全部餐次（menu.json 的 meals）；不传就只有早、午、晚 */
  meals: { type: Array, default: () => MEALS },
})

const emit = defineEmits(['update:modelValue'])

const toOption = (meal) => ({ ...meal, icon: iconForMeal(meal), count: itemsForMeal(props.items, meal.id).length })
const builtInIds = MEALS.map((meal) => meal.id)
/** 早、午、晚 */
const options = computed(() => props.meals.filter((meal) => builtInIds.includes(meal.id)).map(toOption))
/** 额外餐次 */
const extraOptions = computed(() => props.meals.filter((meal) => !builtInIds.includes(meal.id)).map(toOption))
</script>

<template>
  <div class="meal-picker" role="group" aria-label="选择这一餐">
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      class="meal"
      :class="[option.id, { selected: option.id === modelValue }]"
      :aria-pressed="option.id === modelValue"
      @click="emit('update:modelValue', option.id)"
    >
      <component :is="option.icon" class="meal-icon" :size="24" :stroke-width="1.75" aria-hidden="true" />
      <span class="label">{{ option.label }}</span>
      <span class="count">{{ option.count }} 道</span>
    </button>

    <button
      v-for="option in extraOptions"
      :key="option.id"
      type="button"
      class="meal extra"
      :class="{ selected: option.id === modelValue }"
      :aria-pressed="option.id === modelValue"
      @click="emit('update:modelValue', option.id)"
    >
      <span class="with-icon">
        <component :is="option.icon" class="meal-icon" :size="18" :stroke-width="1.75" aria-hidden="true" />
        <span class="label">{{ option.label }}</span>
      </span>
      <span class="count">{{ option.count }} 道</span>
    </button>
  </div>
</template>

<style scoped>
.meal-picker {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.meal {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 88px;
  padding: 10px 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  transition:
    border-color 0.12s,
    background 0.12s;
}

.meal:active {
  background: var(--surface-muted);
}

.meal.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.meal-icon {
  color: var(--text-muted);
}

.meal.selected .meal-icon {
  color: var(--accent-strong);
}

.label {
  font-size: var(--fs-md);
  font-weight: 700;
  line-height: 1.3;
}

.count {
  font-size: var(--fs-sm);
  color: var(--text-muted);
  line-height: 1.3;
}

/* 额外餐次：比早午晚矮，图标和名字一行，数量在下面 */
.meal.extra {
  min-height: 56px;
  padding: 6px 4px;
  white-space: nowrap;
}
</style>
