<!--
  “帮我分析”面板：点选标签（想要 / 不要）、填预算 → 推荐一道主推 + 最多 3 道备选，附理由。
  规则见 REQUIREMENTS.md 第 10 节（2026-11-05 09:39），计算在 src/core/recommend.js。
  餐次和“不想吃的”由上层（DrawPage）传进来，两种模式共用。
  用法：
    <AnalyzePanel
      :items="全部菜品" :meal="餐次"
      :excluded-categories="..." :excluded-ids="..."
      v-model:shortlist="小名单 id 列表"
    />
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { MEALS } from '../core/menu-data.js'
import { itemsForMeal } from '../core/draw.js'
import { recommend, toggleShortlist } from '../core/recommend.js'
import { groupTags } from '../core/tags.js'
import ResultCard from './ResultCard.vue'
import Mascot from './Mascot.vue'

const props = defineProps({
  items: { type: Array, required: true },
  meal: { type: String, required: true },
  excludedCategories: { type: Array, required: true },
  excludedIds: { type: Array, required: true },
  shortlist: { type: Array, required: true },
  /** 随机数函数。默认 Math.random；测试时换成固定值 */
  random: { type: Function, default: Math.random },
})

const emit = defineEmits(['update:shortlist'])

// ---- 条件 ----
/** 每个标签的状态：'want'（想要）/ 'avoid'（不要）；没有记录就是没选 */
const tagState = ref({})
/** 预算输入框里的文字 */
const budgetText = ref('')
/** 推荐结果（recommend() 的返回值），还没推荐时是 null */
const result = ref(null)

const mealLabel = computed(() => MEALS.find((m) => m.id === props.meal)?.label ?? '')

/** 这一餐的菜里出现过的标签，按建议分组 */
const groups = computed(() => groupTags(itemsForMeal(props.items, props.meal)))
const visibleTags = computed(() => new Set(groups.value.flatMap((g) => g.tags.map((t) => t.tag))))

// 只算当前看得见的标签：换了餐次后，别的餐次才有的标签不参与
const wantTags = computed(() => [...visibleTags.value].filter((tag) => tagState.value[tag] === 'want'))
const avoidTags = computed(() => [...visibleTags.value].filter((tag) => tagState.value[tag] === 'avoid'))

/** 预算：空着是不限；填了但不是合法数字时 budgetError 为 true，按不限处理 */
const budgetError = computed(() => {
  const text = budgetText.value.trim()
  if (text === '') return false
  // 位数太多的数字会变成 Infinity，也算填错（Codex 第 10 轮审核）
  return !/^\d+(\.\d+)?$/.test(text) || !Number.isFinite(Number(text))
})
const budget = computed(() => {
  const text = budgetText.value.trim()
  if (text === '' || budgetError.value) return null
  return Number(text)
})

const criteria = computed(() => ({
  meal: props.meal,
  excludedCategories: props.excludedCategories,
  excludedIds: props.excludedIds,
  wantTags: wantTags.value,
  avoidTags: avoidTags.value,
  budget: budget.value,
}))

// 条件一变，旧的推荐就不作数了
watch(criteria, () => {
  result.value = null
})

const hasConditions = computed(() => wantTags.value.length + avoidTags.value.length > 0 || budgetText.value !== '')

const summary = computed(() => {
  const parts = []
  if (wantTags.value.length > 0) parts.push(`想要 ${wantTags.value.length} 个`)
  if (avoidTags.value.length > 0) parts.push(`不要 ${avoidTags.value.length} 个`)
  return parts.length > 0 ? parts.join('、') : '还没选'
})

/** 点一下标签：没选 → 想要 → 不要 → 没选 */
function cycleTag(tag) {
  const next = { undefined: 'want', want: 'avoid', avoid: undefined }[tagState.value[tag]]
  const state = { ...tagState.value }
  if (next) state[tag] = next
  else delete state[tag]
  tagState.value = state
}

function clearConditions() {
  tagState.value = {}
  budgetText.value = ''
}

const stateLabel = (tag) => ({ want: '想要', avoid: '不要' })[tagState.value[tag]] ?? '没选'

// ---- 推荐 ----
function recommendNow() {
  const avoidId = result.value?.pick?.item.id ?? null
  result.value = recommend(props.items, criteria.value, { random: props.random, avoidId })
}

const inShortlist = (item) => props.shortlist.includes(item.id)
function toggleInShortlist(item) {
  emit('update:shortlist', toggleShortlist(props.shortlist, item.id))
}

const label = (item) => (item.shop ? `${item.name} · ${item.shop}` : item.name)
const priceText = (item) => (item.price === null ? '价格未填' : `人均约 ¥${Number.isInteger(item.price) ? item.price : item.price.toFixed(1)}`)

/** 筛光时的说明 */
const filteredText = computed(() => {
  const f = result.value?.filtered
  if (!f) return ''
  const parts = []
  if (f.byAvoid > 0) parts.push(`${f.byAvoid} 道带“不要”的标签`)
  if (f.byBudget > 0) parts.push(`${f.byBudget} 道超出预算`)
  return parts.join('，')
})

const mascotMood = computed(() => (result.value?.status === 'ok' ? 'cheer' : 'happy'))
</script>

<template>
  <div class="analyze-panel">
    <section class="conditions" aria-labelledby="tags-title">
      <div class="head">
        <h2 id="tags-title"><span aria-hidden="true">🏷️ </span>想吃点什么样的？</h2>
        <span class="summary">{{ summary }}</span>
        <button v-if="hasConditions" type="button" class="link" @click="clearConditions">清空条件</button>
      </div>
      <p class="hint">点一下 = 想要 ✅，再点一下 = 不要 🚫，第三下取消。都不选也行。</p>

      <p v-if="groups.length === 0" class="hint">这一餐的菜还没有标签，可以在菜单表格的“标签”列里加。</p>

      <div v-for="group in groups" :key="group.name" class="tag-group">
        <h3>{{ group.name }}</h3>
        <div class="chips">
          <button
            v-for="t in group.tags"
            :key="t.tag"
            type="button"
            class="tag-chip"
            :class="tagState[t.tag]"
            :data-tag="t.tag"
            @click="cycleTag(t.tag)"
          >
            <span v-if="tagState[t.tag] === 'want'" aria-hidden="true">✅ </span>
            <span v-else-if="tagState[t.tag] === 'avoid'" aria-hidden="true">🚫 </span>
            {{ t.tag }} <span class="chip-count">{{ t.count }}</span>
            <span class="sr-only">（{{ stateLabel(t.tag) }}）</span>
          </button>
        </div>
      </div>

      <div class="budget">
        <label for="budget-input"><span aria-hidden="true">💰 </span>预算：人均</label>
        <input
          id="budget-input"
          v-model="budgetText"
          class="budget-input"
          type="text"
          inputmode="decimal"
          placeholder="不限"
          :aria-invalid="budgetError"
        />
        <span>元以内</span>
      </div>
      <p v-if="budgetError" class="error">预算只填数字，比如 30。现在先按“不限”算。</p>
    </section>

    <div class="action">
      <div class="button-row">
        <Mascot :key="`l-${mascotMood}-${result?.pick?.item.id}`" :mood="mascotMood" />
        <button type="button" class="recommend-button" @click="recommendNow">
          <span class="btn-emoji" aria-hidden="true">{{ result?.status === 'ok' ? '🔄' : '🔍' }}</span>
          <span class="btn-label">{{ result?.status === 'ok' ? '换一个' : '帮我推荐' }}</span>
        </button>
        <Mascot :key="`r-${mascotMood}-${result?.pick?.item.id}`" :mood="mascotMood" flip />
      </div>
    </div>

    <div class="outcome" aria-live="polite">
      <template v-if="result">
        <p v-if="result.emptyReason === 'no-items-for-meal'" class="empty">
          <span class="empty-emoji" aria-hidden="true">🫙</span>
          菜单里还没有适合{{ mealLabel }}的菜。
        </p>
        <p v-else-if="result.emptyReason === 'all-excluded'" class="empty">
          <span class="empty-emoji" aria-hidden="true">🙈</span>
          能选的都被“不想吃的”排除了，少排除几个试试。
        </p>
        <p v-else-if="result.emptyReason === 'all-filtered'" class="empty">
          <span class="empty-emoji" aria-hidden="true">🙈</span>
          都被筛掉了：{{ filteredText }}。少选几个“不要”或者放宽预算试试。
        </p>
        <p v-else-if="result.status === 'none'" class="empty">
          <span class="empty-emoji" aria-hidden="true">🤷</span>
          没有菜带这些标签：{{ wantTags.join('、') }}。少选几个试试？
        </p>

        <template v-else-if="result.status === 'ok'">
          <p v-if="result.match === 'partial'" class="notice">
            <span aria-hidden="true">🧐 </span>没有同时满足全部条件的，这道最接近：
          </p>
          <ResultCard :key="result.pick.item.id" :item="result.pick.item" ribbon="最推荐！">
            <ul class="reasons" aria-label="推荐理由">
              <li v-for="tag in result.pick.matched" :key="`m-${tag}`" class="ok">
                <span aria-hidden="true">✔ </span>{{ tag }}
              </li>
              <li v-for="tag in result.pick.missing" :key="`x-${tag}`" class="miss">
                <span aria-hidden="true">✘ </span>缺少 {{ tag }}
              </li>
              <li v-if="result.pick.priceStatus === 'within'" class="ok">
                <span aria-hidden="true">✔ </span>在预算内
              </li>
              <li v-else-if="result.pick.priceStatus === 'unknown'" class="unknown">
                <span aria-hidden="true">❔ </span>价格未填
              </li>
            </ul>
            <button type="button" class="shortlist-button" @click="toggleInShortlist(result.pick.item)">
              {{ inShortlist(result.pick.item) ? '✓ 已在小名单（点一下移出）' : '➕ 加入小名单' }}
            </button>
          </ResultCard>

          <div v-if="result.alternatives.length > 0" class="alternatives">
            <h3><span aria-hidden="true">👇 </span>也不错</h3>
            <ul>
              <li v-for="alt in result.alternatives" :key="alt.item.id" class="alt">
                <div class="alt-main">
                  <span class="alt-name">{{ label(alt.item) }}</span>
                  <span class="alt-price">{{ priceText(alt.item) }}</span>
                  <span v-if="alt.matched.length > 0" class="alt-tags">✔ {{ alt.matched.join('、') }}</span>
                </div>
                <button
                  type="button"
                  class="alt-add"
                  :aria-pressed="inShortlist(alt.item)"
                  :title="inShortlist(alt.item) ? '从小名单移出' : '加入小名单'"
                  @click="toggleInShortlist(alt.item)"
                >
                  {{ inShortlist(alt.item) ? '✓' : '＋' }}<span class="sr-only">{{ inShortlist(alt.item) ? '从小名单移出' : '加入小名单' }}</span>
                </button>
              </li>
            </ul>
          </div>
          <p v-if="shortlist.length > 0" class="hint">
            小名单里有 {{ shortlist.length }} 道。到上面“随机抽”打开“只在小名单里抽”，就能从里面抽。
          </p>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.conditions {
  margin-top: 16px;
  padding: 14px 16px;
  border: 3px dashed var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}

h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
}

h3 {
  margin: 10px 0 4px;
  font-size: 0.85rem;
  color: var(--text-muted);
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

.hint {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-chip {
  min-height: 32px;
  max-width: 100%;
  padding: 2px 11px;
  border: 2px solid var(--border);
  border-radius: 999px;
  background: var(--accent-soft);
  font-size: 0.88rem;
  overflow-wrap: anywhere;
  transition: transform 0.15s;
}

.tag-chip:active {
  transform: scale(0.94);
}

.tag-chip.want {
  border-color: var(--mint);
  background: #dcf7f1;
  font-weight: 700;
}

.tag-chip.avoid {
  border-color: #e5484d;
  background: #ffe5e5;
  text-decoration: line-through;
}

.chip-count {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.budget {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
  font-weight: 700;
}

.budget-input {
  width: 80px;
  min-height: 36px;
  padding: 4px 8px;
  border: 2px solid var(--border);
  border-radius: 10px;
  font: inherit;
  text-align: center;
}

.budget-input[aria-invalid='true'] {
  border-color: #e5484d;
}

.error {
  margin: 6px 0 0;
  color: #c92a2a;
  font-size: 0.85rem;
}

.action {
  margin-top: 24px;
}

.button-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.recommend-button {
  flex: 1 1 auto;
  max-width: 300px;
  min-width: 0;
  padding: 14px 12px;
  border: 3px solid #1f9e86;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--mint), var(--yellow));
  color: var(--text);
  font-size: 1.3rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  box-shadow: 0 6px 0 #1f9e86;
  transition:
    transform 0.1s,
    box-shadow 0.1s;
}

.recommend-button:hover {
  transform: translateY(-2px) rotate(1deg);
}

.recommend-button:active {
  transform: translateY(4px);
  box-shadow: 0 2px 0 #1f9e86;
}

.btn-emoji {
  display: inline-block;
  margin-right: 6px;
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

.notice {
  margin: 0 0 10px;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--yellow-soft);
  font-weight: 700;
  text-align: center;
}

.reasons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.85rem;
  font-weight: 700;
}

.reasons li {
  padding: 1px 10px;
  border-radius: 999px;
}

.reasons .ok {
  background: #dcf7f1;
  color: #146c5c;
}

.reasons .miss {
  background: #ffe5e5;
  color: #b42318;
}

.reasons .unknown {
  background: var(--yellow-soft);
  color: var(--text-muted);
}

.shortlist-button {
  margin-top: 14px;
  min-height: 36px;
  padding: 4px 14px;
  border: 2px solid var(--mint);
  border-radius: 999px;
  background: var(--surface);
  font-weight: 700;
}

.alternatives {
  margin-top: 18px;
}

.alternatives ul {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.alt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 2px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
}

.alt-main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  flex: 1;
  min-width: 0;
}

.alt-name {
  font-weight: 800;
  overflow-wrap: anywhere;
}

.alt-price,
.alt-tags {
  color: var(--text-muted);
  font-size: 0.82rem;
}

.alt-add {
  flex: none;
  width: 36px;
  height: 36px;
  border: 2px solid var(--mint);
  border-radius: 50%;
  background: var(--surface);
  font-weight: 900;
}

.alt-add[aria-pressed='true'] {
  background: #dcf7f1;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 360px) {
  .button-row :deep(.mascot) {
    width: 44px;
    height: 40px;
  }
}
</style>
