<!--
  主页面：选餐次 → 切换“随机抽 / 帮我分析” → （可选）排除不想吃的 → 抽或推荐。
  两种模式共用餐次和“不想吃的”（用户 2026-11-05 决定 1A）。
  随机模式里还有临时小名单（5A）：打开开关后只在名单里抽，不受餐次和“不想吃的”限制。
  往小名单里加第一道菜时自动打开开关，清空时自动关掉；在“帮我分析”页面下方
  显示气泡“选好小名单了，去随机抽食物”，点一下跳到随机抽（用户 2026-11-05 11:56 要求）。
  “最近吃过”（阶段 3）：结果卡片上点“就吃这个”记一次，存在本机浏览器；
  打开“避开最近吃过的”时，随机抽和分析推荐都避开最近 3 天吃过的，小名单不避开。
  除了“最近吃过”的记录，其他选择只存在页面里，刷新就恢复原样（需求 R-006）。
  抽取逻辑在 src/core/draw.js，推荐逻辑在 src/core/recommend.js，这里只负责界面和状态。
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { MEALS } from '../core/menu-data.js'
import { itemsForMeal, getCandidates, emptyReason, drawOne } from '../core/draw.js'
import { shortlistItems } from '../core/recommend.js'
import { recentRecords, recentIds, addRecord, removeToday, eatenToday } from '../core/eaten.js'
import { getStorage, loadRecords, saveRecords } from '../ui/eaten-store.js'
import MealPicker from './MealPicker.vue'
import ExcludePanel from './ExcludePanel.vue'
import ResultCard from './ResultCard.vue'
import Mascot from './Mascot.vue'
import ShortlistPanel from './ShortlistPanel.vue'
import AnalyzePanel from './AnalyzePanel.vue'
import RecentPanel from './RecentPanel.vue'
import EatButton from './EatButton.vue'

const props = defineProps({
  /** 全部菜品（menu.json 的 items） */
  items: { type: Array, required: true },
  /** 全部餐次（menu.json 的 meals）；不传就只有早、午、晚 */
  meals: { type: Array, default: () => MEALS },
  /** 随机数函数。默认 Math.random；测试时换成固定值 */
  random: { type: Function, default: Math.random },
  /** 抽取动画的时长（毫秒）。0 表示不要动画；系统设置了“减少动画”时也不播放 */
  rollDuration: { type: Number, default: 700 },
  /** 存“最近吃过”的地方。不传就用浏览器的 localStorage；传 null 表示不存（测试用） */
  storage: { type: Object, default: undefined },
})

// “最近吃过”的记录
const storage = props.storage === undefined ? getStorage() : props.storage
/** 记录能不能存住：拿不到存储时为 false；之后每次保存失败也会变成 false（Codex 第 13 轮） */
const storageOk = ref(storage !== null)
const eatenRecords = ref(loadRecords(storage))
const avoidRecent = ref(true) // 是否避开最近吃过的（默认打开）

/**
 * “现在”的时间。“最近 3 天”按它来算。页面一直开着跨过午夜时要更新它：
 * 抽取、推荐、换餐次、换模式、页面从后台切回来时都刷新一次（Codex 第 13 轮）；
 * 另外在午夜过后自动刷新一次，免得“都吃过了、按钮不能点”的时候没有办法触发刷新（Codex 第 14 轮）
 */
const now = ref(Date.now())
let midnightTimer = null
function refreshNow() {
  now.value = Date.now()
  scheduleMidnight()
}
/** 定一个闹钟：下一个午夜过 1 秒时刷新 */
function scheduleMidnight() {
  clearTimeout(midnightTimer)
  const next = new Date(now.value)
  next.setHours(24, 0, 1, 0)
  midnightTimer = setTimeout(refreshNow, next.getTime() - now.value)
}
scheduleMidnight()
function onVisible() {
  if (document.visibilityState === 'visible') refreshNow()
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
onBeforeUnmount(() => {
  clearTimeout(midnightTimer)
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
})

const recentList = computed(() => recentRecords(eatenRecords.value, new Date(now.value)))
/** 要避开的菜品 id：开关关着时为空 */
const avoidIds = computed(() => (avoidRecent.value ? recentIds(eatenRecords.value, new Date(now.value)) : []))
/** 给分析面板用：推荐前先刷新时间，再拿要避开的 id */
function freshAvoidIds() {
  refreshNow()
  return avoidIds.value
}

function setRecords(records) {
  eatenRecords.value = records
  storageOk.value = saveRecords(records, storage)
}
/** 点“就吃这个”：今天还没记过就记一条，记过了就撤销 */
function toggleEaten(item) {
  refreshNow()
  const at = new Date(now.value)
  setRecords(
    eatenToday(eatenRecords.value, item.id, at)
      ? removeToday(eatenRecords.value, item.id, at)
      : addRecord(eatenRecords.value, item, at),
  )
}
const isEatenToday = (item) => eatenToday(eatenRecords.value, item.id, new Date(now.value))
const eatenTodayIds = computed(() => props.items.filter((item) => isEatenToday(item)).map((item) => item.id))

// ---- 页面状态 ----
const meal = ref(null) // 选中的餐次，没选是 null
const mode = ref('random') // 'random' 随机抽 / 'analyze' 帮我分析
const shortlist = ref([]) // 小名单（菜品 id）
const shortlistOn = ref(false) // 随机模式是否只在小名单里抽
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
/** 还没去掉“最近吃过”的候选。结果被清掉只看它：点了“就吃这个”的菜不会因此从屏幕上消失 */
const baseCandidates = computed(() => {
  if (!meal.value) return []
  // 小名单开着时，只在名单里抽，不管餐次、“不想吃的”和“最近吃过”（7A）
  if (shortlistOn.value) return shortlistItems(props.items, shortlist.value)
  return getCandidates(props.items, choice.value)
})
/** 真正用来抽的候选：再去掉最近吃过的 */
const candidates = computed(() => {
  if (shortlistOn.value) return baseCandidates.value
  const avoid = new Set(avoidIds.value)
  return baseCandidates.value.filter((item) => !avoid.has(item.id))
})
const empty = computed(() => {
  if (!meal.value) return null
  if (shortlistOn.value) return candidates.value.length === 0 ? 'shortlist-empty' : null
  const reason = emptyReason(props.items, choice.value)
  if (reason) return reason
  return candidates.value.length === 0 ? 'all-recent' : null
})
const showExclude = computed(() => mealItems.value.length > 0 && !(mode.value === 'random' && shortlistOn.value))
const mealLabel = computed(() => props.meals.find((m) => m.id === meal.value)?.label ?? '')

/** 吉祥物的表情：抽取中抖得欢，抽中了蹦一下，平时轻轻跳 */
const mascotMood = computed(() => (rolling.value ? 'excited' : result.value ? 'cheer' : 'happy'))

// 换餐次、换模式时刷新“现在”的时间
watch([meal, mode], refreshNow)

// 换餐次时，停掉动画，清掉上一次的结果
watch(meal, () => {
  stopRolling()
  result.value = null
  cancelled.value = false
})

// 动画期间改了“不想吃的”、小名单或开关、或者切到别的模式：取消这次抽取，请用户重新点
// （结果是动画开始前定的，可能已经不在候选里了）
watch([excludedCategories, excludedIds, shortlist, shortlistOn, mode, avoidRecent, eatenRecords], () => {
  if (!rolling.value) return
  stopRolling()
  cancelled.value = true
})

// 小名单从空变成有菜：自动打开“只在小名单里抽”；清空了就自动关掉
watch(shortlist, (list, old) => {
  if (old.length === 0 && list.length > 0) shortlistOn.value = true
  if (list.length === 0) shortlistOn.value = false
})

/** 是否显示“去随机抽”气泡：在“帮我分析”页面、小名单里有菜时 */
const showBubble = computed(() => meal.value !== null && mode.value === 'analyze' && shortlist.value.length > 0)

/** 点气泡：切到随机抽，打开小名单开关，滚到抽取按钮 */
async function goDrawFromShortlist() {
  mode.value = 'random'
  shortlistOn.value = true
  await nextTick()
  const button = document.querySelector('.draw-button')
  button?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  button?.focus?.({ preventScroll: true })
}

// 排除了当前结果所在的分类或这道菜时，结果也清掉，免得显示一道“不想吃”的菜
watch(baseCandidates, (list) => {
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
  refreshNow()
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
  <div class="draw-page" :class="{ 'has-bubble': showBubble }">
    <MealPicker v-model="meal" :items="items" :meals="meals" />

    <p v-if="!meal" class="prompt"><span class="point" aria-hidden="true">👆</span> 先选这是哪一餐</p>

    <template v-else>
      <div class="mode-tabs" role="group" aria-label="选择模式">
        <button
          type="button"
          class="mode-tab"
          :class="{ active: mode === 'random' }"
          :aria-pressed="mode === 'random'"
          data-mode="random"
          @click="mode = 'random'"
        >
          <span aria-hidden="true">🎲 </span>随机抽
        </button>
        <button
          type="button"
          class="mode-tab"
          :class="{ active: mode === 'analyze' }"
          :aria-pressed="mode === 'analyze'"
          data-mode="analyze"
          @click="mode = 'analyze'"
        >
          <span aria-hidden="true">🔍 </span>帮我分析
        </button>
      </div>

      <ExcludePanel
        v-if="showExclude"
        v-model:excluded-categories="excludedCategories"
        v-model:excluded-ids="excludedIds"
        :items="mealItems"
      />

      <RecentPanel
        v-if="showExclude"
        v-model:avoid="avoidRecent"
        :records="recentList"
        :storage-ok="storageOk"
        @clear="setRecords([])"
      />

      <AnalyzePanel
        v-if="mode === 'analyze'"
        v-model:shortlist="shortlist"
        :items="items"
        :meal="meal"
        :meal-label="mealLabel"
        :excluded-categories="excludedCategories"
        :excluded-ids="excludedIds"
        :get-recent-ids="freshAvoidIds"
        :avoid-recent="avoidRecent"
        :eaten-today-ids="eatenTodayIds"
        :random="random"
        @toggle-eaten="toggleEaten"
      />

      <template v-else>
        <ShortlistPanel
          v-model:shortlist="shortlist"
          v-model:enabled="shortlistOn"
          :items="items"
          :meal-items="mealItems"
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
          <p v-if="candidates.length > 0" class="candidate-count">
            {{ shortlistOn ? `小名单里有 ${candidates.length} 道` : `${mealLabel}有 ${candidates.length} 道可选` }}
          </p>
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
          <p v-else-if="empty === 'all-recent' && !result" class="empty">
            <span class="empty-emoji" aria-hidden="true">🕒</span>
            能选的最近几天都吃过了。在“最近吃过”里关掉“避开”，或者少排除几个试试。
          </p>
          <p v-else-if="empty === 'shortlist-empty'" class="empty">
            <span class="empty-emoji" aria-hidden="true">📝</span>
            小名单还是空的，先往里加几道菜吧。
          </p>
          <div v-else-if="rolling" class="rolling" aria-hidden="true">
            <span class="slot">🎰</span>
            <span class="rolling-name">{{ rollingName }}</span>
          </div>
          <p v-else-if="cancelled" class="empty">
            <span class="empty-emoji" aria-hidden="true">🫣</span>
            改了条件，这次没抽完。再点一次“帮我选！”吧
          </p>
          <ResultCard v-else-if="result" :key="result.id" :item="result">
            <EatButton :eaten="isEatenToday(result)" @toggle="toggleEaten(result)" />
            <!-- 刚记下的是这一餐最后一道能选的：卡片留着（可以撤销），只在下面提示（Codex 第 13 轮） -->
            <p v-if="empty === 'all-recent'" class="last-note">这一餐能选的最近都吃过了，想再抽可以在“最近吃过”里关掉“避开”。</p>
          </ResultCard>
        </div>
      </template>
    </template>

    <!-- 小名单气泡：固定在屏幕下方 -->
    <button v-if="showBubble" type="button" class="shortlist-bubble" @click="goDrawFromShortlist">
      <span aria-hidden="true">📝 </span>选好小名单了，去随机抽食物<span class="bubble-arrow" aria-hidden="true"> 👉</span>
      <!-- 右上角的小圆点：小名单里有几道 -->
      <span class="bubble-badge">{{ shortlist.length }}<span class="sr-only"> 道</span></span>
    </button>
  </div>
</template>

<style scoped>
.has-bubble {
  /* 给底部的气泡留出位置，免得挡住最后的内容 */
  padding-bottom: 72px;
}

.shortlist-bubble {
  position: fixed;
  left: 50%;
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  z-index: 10;
  width: max-content;
  max-width: calc(100vw - 32px);
  padding: 11px 16px;
  border: 3px solid #1f9e86;
  border-radius: 999px;
  background: var(--mint);
  color: var(--text);
  font-size: 0.98rem;
  font-weight: 800;
  white-space: nowrap;
  box-shadow: 0 6px 18px rgba(31, 158, 134, 0.35);
  transform: translateX(-50%);
  animation: bubble-in 0.35s cubic-bezier(0.3, 1.6, 0.5, 1);
}

.shortlist-bubble:active {
  transform: translateX(-50%) scale(0.96);
}

.bubble-badge {
  position: absolute;
  top: -10px;
  right: -6px;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border: 2px solid var(--surface);
  border-radius: 999px;
  background: var(--pink);
  color: var(--text);
  font-size: 0.8rem;
  line-height: 20px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* 很窄的手机上字小一点，保证一行放得下 */
@media (max-width: 360px) {
  .shortlist-bubble {
    padding: 10px 12px;
    font-size: 0.88rem;
  }
}

.bubble-arrow {
  display: inline-block;
  animation: nudge 1s ease-in-out infinite;
}

@keyframes bubble-in {
  from {
    opacity: 0;
    transform: translate(-50%, 30px) scale(0.8);
  }
}

@keyframes nudge {
  50% {
    transform: translateX(4px);
  }
}

.mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 18px;
  padding: 5px;
  border-radius: 999px;
  background: var(--accent-soft);
}

.mode-tab {
  min-height: 42px;
  padding: 6px 10px;
  border: none;
  border-radius: 999px;
  background: transparent;
  font-size: 1.02rem;
  font-weight: 800;
  color: var(--text-muted);
  transition: background 0.15s;
}

.mode-tab.active {
  background: var(--surface);
  color: var(--accent-dark);
  box-shadow: 0 3px 0 var(--border);
}

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

.last-note {
  margin: 12px 0 0;
  color: var(--text-muted);
  font-size: 0.85rem;
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
