<!--
  选餐次：早餐 / 午餐 / 晚餐三个按钮，一次只能选一个。
  用法：<MealPicker v-model="meal" :items="全部菜品" />
  按钮上的数字是这一餐有几道菜。
-->
<script setup>
import { computed } from 'vue'
import { MEALS } from '../core/menu-data.js'
import { itemsForMeal } from '../core/draw.js'
import { MEAL_EMOJI } from '../ui/food-emoji.js'

const props = defineProps({
  /** 当前选中的餐次 id，还没选时是 null */
  modelValue: { type: String, default: null },
  /** 全部菜品，用来算每一餐有几道 */
  items: { type: Array, required: true },
})

const emit = defineEmits(['update:modelValue'])

const options = computed(() =>
  MEALS.map((meal) => ({ ...meal, emoji: MEAL_EMOJI[meal.id], count: itemsForMeal(props.items, meal.id).length })),
)
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
      <span class="emoji" aria-hidden="true">{{ option.emoji }}</span>
      <span class="label">{{ option.label }}</span>
      <span class="count">{{ option.count }} 道</span>
    </button>
  </div>
</template>

<style scoped>
.meal-picker {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.meal {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 4px 10px;
  border: 3px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 4px 0 var(--border);
  transition:
    transform 0.15s,
    border-color 0.15s,
    background 0.15s;
}

.meal:hover:not(.selected) {
  transform: translateY(-2px);
}

.meal:active {
  transform: translateY(2px);
  box-shadow: 0 2px 0 var(--border);
}

.meal.selected {
  border-color: var(--accent);
  background: var(--yellow-soft);
  box-shadow: 0 4px 0 var(--accent-dark);
  transform: rotate(-2deg) scale(1.04);
}

.meal.selected .emoji {
  animation: bounce 0.5s ease-out;
}

.emoji {
  font-size: 1.9rem;
  line-height: 1.2;
}

.label {
  font-size: 1.1rem;
  font-weight: 800;
}

.count {
  font-size: 0.8rem;
  color: var(--text-muted);
}

@keyframes bounce {
  40% {
    transform: translateY(-8px) scale(1.15);
  }
}
</style>
