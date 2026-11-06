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
import { IconCheck, IconHelpCircle, IconPlus, IconRefresh, IconSearch, IconTag, IconWallet, IconX } from '@tabler/icons-vue'
import { itemsForMeal } from '../core/draw.js'
import { recommend, toggleShortlist } from '../core/recommend.js'
import { groupTags } from '../core/tags.js'
import ResultCard from './ResultCard.vue'
import Mascot from './Mascot.vue'
import EatButton from './EatButton.vue'
import CollapsePanel from './CollapsePanel.vue'

const props = defineProps({
  items: { type: Array, required: true },
  meal: { type: String, required: true },
  /** 餐次的中文名，显示提示用 */
  mealLabel: { type: String, default: '' },
  excludedCategories: { type: Array, required: true },
  excludedIds: { type: Array, required: true },
  shortlist: { type: Array, required: true },
  /**
   * 拿要避开的“最近吃过的”菜品 id（开关关着时为空）。用函数而不是数组：
   * 推荐的那一刻要按当时的日期重新算，页面开着跨过午夜也不会用旧的（Codex 第 13 轮）
   */
  getRecentIds: { type: Function, default: () => [] },
  /** “避开最近吃过的”开关；切换时清掉旧推荐 */
  avoidRecent: { type: Boolean, default: true },
  /** 今天已经点过“就吃这个”的菜品 id，用来显示按钮状态 */
  eatenTodayIds: { type: Array, default: () => [] },
  /** 随机数函数。默认 Math.random；测试时换成固定值 */
  random: { type: Function, default: Math.random },
})

const emit = defineEmits(['update:shortlist', 'toggle-eaten'])

// ---- 条件 ----
/** 每个标签的状态：'want'（想要）/ 'avoid'（不要）；没有记录就是没选 */
const tagState = ref({})
/** 预算输入框里的文字 */
const budgetText = ref('')
/** 推荐结果（recommend() 的返回值），还没推荐时是 null */
const result = ref(null)


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

// 条件一变，旧的推荐就不作数了。
// 点“就吃这个”会让最近吃过的变化，但不应该把刚推荐的菜清掉，所以这里只看开关，不看记录
watch([criteria, () => props.avoidRecent], () => {
  result.value = null
})

const hasConditions = computed(() => wantTags.value.length + avoidTags.value.length > 0 || budgetText.value !== '')

const summary = computed(() => {
  const parts = []
  if (wantTags.value.length > 0) parts.push(`想要 ${wantTags.value.length} 个`)
  if (avoidTags.value.length > 0) parts.push(`不要 ${avoidTags.value.length} 个`)
  if (budgetError.value) parts.push('预算填错了')
  else if (budget.value !== null) parts.push(`预算 ${budget.value} 元`)
  return parts.length > 0 ? parts.join('、') : '还没选'
})

// 条件区默认收起，只显示摘要（用户 2026-11-05 决定 1A），收起展开由 CollapsePanel 管

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
  const fullCriteria = { ...criteria.value, recentIds: props.getRecentIds() }
  result.value = recommend(props.items, fullCriteria, { random: props.random, avoidId })
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
  if (f.byRecent > 0) parts.push(`${f.byRecent} 道最近吃过`)
  return parts.join('，')
})

const mascotMood = computed(() => (result.value?.status === 'ok' ? 'cheer' : 'happy'))
</script>

<template>
  <div class="analyze-panel">
    <CollapsePanel class="conditions" title="想吃点什么样的？" :icon="IconTag" :summary="summary">
      <template #actions>
        <button v-if="hasConditions" type="button" class="link" @click="clearConditions">清空条件</button>
      </template>

      <p class="hint">点一下是想要，再点一下是不要，第三下取消。都不选也行。</p>
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
            <IconCheck v-if="tagState[t.tag] === 'want'" :size="14" :stroke-width="2.25" aria-hidden="true" />
            <IconX v-else-if="tagState[t.tag] === 'avoid'" :size="14" :stroke-width="2.25" aria-hidden="true" />
            <span class="tag-name">{{ t.tag }}</span>
            <span class="chip-count">{{ t.count }}</span>
            <span class="sr-only">（{{ stateLabel(t.tag) }}）</span>
          </button>
        </div>
      </div>

      <div class="budget">
        <label for="budget-input" class="with-icon">
          <IconWallet :size="18" :stroke-width="1.75" aria-hidden="true" />预算：人均
        </label>
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
    </CollapsePanel>

    <div class="action">
      <div class="button-row">
        <Mascot :key="`l-${mascotMood}-${result?.pick?.item.id}`" :mood="mascotMood" />
        <button type="button" class="recommend-button" @click="recommendNow">
          <component :is="result?.status === 'ok' ? IconRefresh : IconSearch" :size="22" :stroke-width="2" aria-hidden="true" />
          <span class="btn-label">{{ result?.status === 'ok' ? '换一个' : '帮我推荐' }}</span>
        </button>
        <Mascot :key="`r-${mascotMood}-${result?.pick?.item.id}`" :mood="mascotMood" flip />
      </div>
    </div>

    <div class="outcome" aria-live="polite">
      <template v-if="result">
        <p v-if="result.emptyReason === 'no-items-for-meal'" class="empty">菜单里还没有适合{{ mealLabel }}的菜。</p>
        <p v-else-if="result.emptyReason === 'all-excluded'" class="empty">能选的都被“不想吃的”排除了，少排除几个试试。</p>
        <p v-else-if="result.emptyReason === 'all-filtered'" class="empty">
          都被筛掉了：{{ filteredText }}。少选几个“不要”、放宽预算，或者在“最近吃过”里关掉“避开”试试。
        </p>
        <p v-else-if="result.status === 'none'" class="empty">没有菜带这些标签：{{ wantTags.join('、') }}。少选几个试试。</p>

        <template v-else-if="result.status === 'ok'">
          <p v-if="result.match === 'partial'" class="notice">没有同时满足全部条件的，这道最接近：</p>
          <ResultCard :key="result.pick.item.id" :item="result.pick.item">
            <ul class="reasons" aria-label="推荐理由">
              <li v-for="tag in result.pick.matched" :key="`m-${tag}`" class="ok">
                <IconCheck :size="14" :stroke-width="2.25" aria-hidden="true" />{{ tag }}
              </li>
              <li v-for="tag in result.pick.missing" :key="`x-${tag}`" class="miss">
                <IconX :size="14" :stroke-width="2.25" aria-hidden="true" />缺少 {{ tag }}
              </li>
              <li v-if="result.pick.priceStatus === 'within'" class="ok">
                <IconCheck :size="14" :stroke-width="2.25" aria-hidden="true" />在预算内
              </li>
              <li v-else-if="result.pick.priceStatus === 'unknown'" class="unknown">
                <IconHelpCircle :size="14" :stroke-width="2" aria-hidden="true" />价格未填
              </li>
            </ul>
            <div class="card-actions">
              <EatButton :eaten="eatenTodayIds.includes(result.pick.item.id)" @toggle="emit('toggle-eaten', result.pick.item)" />
              <button
                type="button"
                class="shortlist-button"
                :class="{ added: inShortlist(result.pick.item) }"
                :aria-pressed="inShortlist(result.pick.item)"
                @click="toggleInShortlist(result.pick.item)"
              >
                <component :is="inShortlist(result.pick.item) ? IconCheck : IconPlus" :size="18" :stroke-width="2" aria-hidden="true" />
                {{ inShortlist(result.pick.item) ? '已在小名单（点一下移出）' : '加入小名单' }}
              </button>
            </div>
          </ResultCard>

          <div v-if="result.alternatives.length > 0" class="alternatives">
            <h3>也不错</h3>
            <ul>
              <li v-for="alt in result.alternatives" :key="alt.item.id" class="alt">
                <div class="alt-main">
                  <span class="alt-name">{{ label(alt.item) }}</span>
                  <span class="alt-meta">
                    {{ priceText(alt.item) }}<template v-if="alt.matched.length > 0"> · {{ alt.matched.join('、') }}</template>
                  </span>
                </div>
                <button
                  type="button"
                  class="alt-add"
                  :aria-pressed="inShortlist(alt.item)"
                  :title="inShortlist(alt.item) ? '从小名单移出' : '加入小名单'"
                  @click="toggleInShortlist(alt.item)"
                >
                  <component :is="inShortlist(alt.item) ? IconCheck : IconPlus" :size="18" :stroke-width="2" aria-hidden="true" />
                  <span class="sr-only">{{ inShortlist(alt.item) ? '从小名单移出' : '加入小名单' }}</span>
                </button>
              </li>
            </ul>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.hint {
  margin: 0 0 4px;
  color: var(--text-muted);
  font-size: var(--fs-sm);
}

.tag-group h3 {
  margin: 12px 0 6px;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  font-weight: 700;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-chip {
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

.tag-name {
  overflow-wrap: anywhere;
}

.chip-count {
  color: var(--text-muted);
}

.tag-chip.want {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-weight: 700;
}

.tag-chip.avoid {
  border-style: dashed;
  background: transparent;
  color: var(--excluded);
}

.tag-chip.avoid .tag-name {
  text-decoration: line-through;
}

.budget {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
  font-weight: 700;
}

.budget label {
  gap: 4px;
}

.budget-input {
  width: 80px;
  min-height: 36px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-inner);
  background: var(--surface);
  text-align: center;
}

.budget-input[aria-invalid='true'] {
  border-color: #b42318;
}

.error {
  margin: 6px 0 0;
  color: #b42318;
  font-size: var(--fs-sm);
}

.link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-strong);
  font-size: var(--fs-sm);
  font-weight: 700;
}

.action {
  margin-top: 24px;
}

.button-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.recommend-button {
  display: inline-flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  gap: 8px;
  max-width: 280px;
  min-width: 0;
  min-height: 52px;
  padding: 10px 16px;
  border: none;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--accent-text);
  font-size: var(--fs-lg);
  font-weight: 800;
  transition: transform 0.08s;
}

.recommend-button:active {
  transform: translateY(1px);
}

.outcome {
  margin-top: 20px;
}

.empty {
  margin: 0;
  padding: 16px;
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-muted);
  text-align: center;
}

.notice {
  margin: 0 0 8px;
  color: var(--text-muted);
  font-size: var(--fs-sm);
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
}

.reasons li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-sm);
  font-weight: 700;
}

.reasons .ok {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.reasons .miss,
.reasons .unknown {
  background: var(--surface-muted);
  color: var(--text-muted);
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

/* EatButton 自带的上边距在这里不要，由 .card-actions 统一管。
   两个按钮一样宽：放得下就并排，放不下就各占一整行（用户 2026-11-06：注意对齐） */
.card-actions :deep(.eat-button),
.card-actions .shortlist-button {
  flex: 1 1 180px;
  margin-top: 0;
}

.shortlist-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 40px;
  padding: 6px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-inner);
  background: var(--surface);
  font-weight: 700;
}

.shortlist-button.added {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.alternatives {
  margin-top: 20px;
}

.alternatives h3 {
  margin: 0 0 8px;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  font-weight: 700;
}

.alternatives ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.alt {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--border);
}

.alt:last-child {
  border-bottom: 1px solid var(--border);
}

.alt-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.alt-name {
  font-weight: 700;
  overflow-wrap: anywhere;
}

.alt-meta {
  color: var(--text-muted);
  font-size: var(--fs-sm);
}

.alt-add {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius-inner);
  background: var(--surface);
}

.alt-add[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
}

@media (max-width: 360px) {
  .button-row :deep(.mascot) {
    width: 44px;
    height: 40px;
  }
}
</style>
