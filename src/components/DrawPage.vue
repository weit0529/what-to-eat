<!--
  随机抽取页面：选餐次 → （可选）排除不想吃的 → 抽 → 看结果 → 不满意再抽。
  所有选择只存在页面里，刷新就恢复原样（需求 R-006）。
  抽取逻辑都在 src/core/draw.js，这里只负责界面和状态。
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { MEALS } from '../core/menu-data.js'
import { itemsForMeal, getCandidates, emptyReason, drawOne } from '../core/draw.js'
import MealPicker from './MealPicker.vue'
import ExcludePanel from './ExcludePanel.vue'
import ResultCard from './ResultCard.vue'
import Mascot from './Mascot.vue'

const props = defineProps({
  /** 全部菜品（menu.json 的 items） */
  items: { type: Array, required: true },
  /** 随机数函数。默认 Math.random；测试时换成固定值 */
  random: { type: Function, default: Math.random },
  /** 抽取动画的时长（毫秒）。0 表示不要动画；系统设置了“减少动画”时也不播放 */
  rollDuration: { type: Number, default: 700 },
})

// ---- 页面状态 ----
const meal = ref(null) // 选中的餐次，没选是 null
const excludedCategories = ref([]) // 这次不想吃的分类
const excludedIds = ref([]) // 这次不想吃的菜
const result = ref(null) // 抽中的菜
const rolling = ref(false) // 正在播放抽取动画
const rollingName = ref('') // 动画里一闪而过的名字
const cancelled = ref(false) // 动画期间改了排除，这次抽取被取消

// ---- 由状态算出来的值 ----
const mealItems = computed(() => (meal.value ? itemsForMeal(props.items, meal.value) : []))
const choice = computed(() => ({
  meal: meal.value,
  excludedCategories: excludedCategories.value,
  excludedIds: excludedIds.value,
}))
const candidates = computed(() => (meal.value ? getCandidates(props.items, choice.value) : []))
const empty = computed(() => (meal.value ? emptyReason(props.items, choice.value) : null))
const mealLabel = computed(() => MEALS.find((m) => m.id === meal.value)?.label ?? '')

/** 吉祥物的表情：抽取中抖得欢，抽中了蹦一下，平时轻轻跳 */
const mascotMood = computed(() => (rolling.value ? 'excited' : result.value ? 'cheer' : 'happy'))

// 换餐次时，停掉动画，清掉上一次的结果
watch(meal, () => {
  stopRolling()
  result.value = null
  cancelled.value = false
})

// 动画期间改了“不想吃的”：取消这次抽取，请用户重新点（结果是动画开始前定的，可能已经被排除）
watch([excludedCategories, excludedIds], () => {
  if (!rolling.value) return
  stopRolling()
  cancelled.value = true
})

// 排除了当前结果所在的分类或这道菜时，结果也清掉，免得显示一道“不想吃”的菜
watch(candidates, (list) => {
  if (result.value && !list.some((item) => item.id === result.value.id)) result.value = null
})

// ---- 抽取 ----
let rollTimer = null
let rollEndTimer = null

function stopRolling() {
  clearInterval(rollTimer)
  clearTimeout(rollEndTimer)
  rollTimer = rollEndTimer = null
  rolling.value = false
}

onBeforeUnmount(stopRolling)

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

function draw() {
  if (rolling.value) return
  cancelled.value = false
  // 结果先定好，动画只是好看。动画期间改排除会取消这次抽取（见上面的 watch）
  const picked = drawOne(candidates.value, { random: props.random, avoidId: result.value?.id ?? null })
  if (!picked) return

  if (props.rollDuration <= 0 || prefersReducedMotion() || candidates.value.length === 1) {
    result.value = picked
    return
  }

  // 动画：依次闪过候选的名字，到时间后停在抽中的那道
  const names = candidates.value.map((item) => item.name)
  let i = 0
  result.value = null // 动画期间不保留上一次的结果，取消后也不会冒出旧结果
  rolling.value = true
  rollingName.value = names[0]
  rollTimer = setInterval(() => {
    i = (i + 1) % names.length
    rollingName.value = names[i]
  }, 70)
  rollEndTimer = setTimeout(() => {
    stopRolling()
    result.value = picked
  }, props.rollDuration)
}
</script>

<template>
  <div class="draw-page">
    <MealPicker v-model="meal" :items="items" />

    <p v-if="!meal" class="prompt"><span class="point" aria-hidden="true">👆</span> 先选这是哪一餐</p>

    <template v-else>
      <ExcludePanel
        v-if="mealItems.length > 0"
        v-model:excluded-categories="excludedCategories"
        v-model:excluded-ids="excludedIds"
        :items="mealItems"
      />

      <div class="action">
        <div class="button-row">
          <!-- key 跟着状态变，换表情时重新播放动画 -->
          <Mascot :key="`l-${mascotMood}-${result?.id}`" :mood="mascotMood" />
          <button
            type="button"
            class="draw-button"
            :disabled="candidates.length === 0 || rolling"
            @click="draw"
          >
            <span class="btn-emoji" aria-hidden="true">{{ result ? '🔄' : '🎲' }}</span>
            <span class="btn-label">{{ result ? '再抽一次' : '帮我选！' }}</span>
          </button>
          <Mascot :key="`r-${mascotMood}-${result?.id}`" :mood="mascotMood" flip />
        </div>
        <p v-if="candidates.length > 0" class="candidate-count">{{ mealLabel }}有 {{ candidates.length }} 道可选</p>
      </div>

      <div class="outcome" aria-live="polite">
        <p v-if="empty === 'no-items-for-meal'" class="empty">
          <span class="empty-emoji" aria-hidden="true">🫙</span>
          菜单里还没有适合{{ mealLabel }}的菜。可以在菜单表格的“适合餐次”里加上“{{ mealLabel }}”。
        </p>
        <p v-else-if="empty === 'all-excluded'" class="empty">
          <span class="empty-emoji" aria-hidden="true">🙈</span>
          能选的都被排除了，在上面点“全部恢复”或者少排除几个试试。
        </p>
        <div v-else-if="rolling" class="rolling" aria-hidden="true">
          <span class="slot">🎰</span>
          <span class="rolling-name">{{ rollingName }}</span>
        </div>
        <p v-else-if="cancelled" class="empty">
          <span class="empty-emoji" aria-hidden="true">🫣</span>
          改了不想吃的，这次没抽完。再点一次“帮我选！”吧
        </p>
        <ResultCard v-else-if="result" :key="result.id" :item="result" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.prompt {
  margin: 30px 0 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 1.05rem;
}

.point {
  display: inline-block;
  animation: poke 1s ease-in-out infinite;
}

@keyframes poke {
  50% {
    transform: translateY(-6px);
  }
}

.action {
  margin-top: 26px;
  text-align: center;
}

.button-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.draw-button {
  flex: 1 1 auto;
  max-width: 300px;
  min-width: 0;
  padding: 14px 12px;
  border: 3px solid var(--accent-dark);
  border-radius: 999px;
  background: linear-gradient(135deg, var(--accent), var(--pink));
  color: var(--accent-text);
  font-size: 1.3rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  box-shadow: 0 6px 0 var(--accent-dark);
  transition:
    transform 0.1s,
    box-shadow 0.1s,
    opacity 0.15s;
}

.draw-button:not(:disabled) {
  animation: breathe 2.2s ease-in-out infinite;
}

.draw-button:hover:not(:disabled) {
  transform: translateY(-2px) rotate(-1deg);
}

.draw-button:active:not(:disabled) {
  transform: translateY(4px);
  box-shadow: 0 2px 0 var(--accent-dark);
  animation: none;
}

.draw-button:disabled {
  opacity: 0.5;
  animation: none;
}

.btn-emoji {
  display: inline-block;
  margin-right: 6px;
}

.draw-button:hover:not(:disabled) .btn-emoji {
  animation: spin 0.6s ease-in-out;
}

@keyframes breathe {
  50% {
    transform: scale(1.04);
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.candidate-count {
  margin: 10px 0 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.outcome {
  margin-top: 22px;
}

.empty {
  padding: 16px;
  border: 3px dashed var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  text-align: center;
}

.empty-emoji {
  display: block;
  font-size: 2.4rem;
  line-height: 1.3;
}

.rolling {
  padding: 30px 16px;
  border: 3px dashed var(--accent);
  border-radius: 22px;
  background: var(--yellow-soft);
  text-align: center;
}

.slot {
  display: block;
  font-size: 2.6rem;
  line-height: 1.2;
  animation: shake 0.2s linear infinite;
}

.rolling-name {
  display: block;
  margin-top: 4px;
  font-size: 1.8rem;
  font-weight: 900;
  color: var(--accent-dark);
  overflow-wrap: anywhere;
}

@keyframes shake {
  0%,
  100% {
    transform: rotate(-8deg);
  }
  50% {
    transform: rotate(8deg);
  }
}

.result-card {
  animation: pop-in 0.35s cubic-bezier(0.3, 1.6, 0.5, 1);
}

@keyframes pop-in {
  from {
    opacity: 0;
    transform: scale(0.8) rotate(-3deg);
  }
}

/* 很窄的手机上，吉祥物小一点，给按钮留地方 */
@media (max-width: 360px) {
  .button-row :deep(.mascot) {
    width: 44px;
    height: 40px;
  }
}
</style>
