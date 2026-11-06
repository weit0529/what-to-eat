<!--
  选餐次：圆环转盘，点哪一块就选哪一餐，中间的小指针转过去指着它（用户 2026-11-06 的想法）。
  - 早、午、晚三块大（合起来约 75%），“餐次”页里加的额外餐次（如下午茶、夜宵）平分剩下的
  - 按时间顺序排，像钟面；只有早午晚时三块各占三分之一
  - 每一块上有图标、名字、这一餐有几道菜
  用法：<MealPicker v-model="meal" :items="全部菜品" :meals="全部餐次" />
  角度的计算在 src/core/meal-dial.js。
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { MEALS } from '../core/menu-data.js'
import { itemsForMeal } from '../core/draw.js'
import {
  angleFromMatrix,
  dialSegments,
  isBuiltInMeal,
  labelLayout,
  pointerTarget,
  segmentBox,
  textWidth,
} from '../core/meal-dial.js'
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

// 转盘尺寸（SVG 坐标，显示时按容器宽度缩放，最大 248px）
const SIZE = 248
const C = SIZE / 2
const OUTER = C - 2
const INNER = 64
const LABEL_R = (OUTER + INNER) / 2
/** 两块之间留的缝（度） */
const GAP = 1.6
/** 名字的字号：早午晚 15px，额外餐次 13px（和 CSS 里的 .label 一致） */
const LABEL_FONT = { builtIn: 15, extra: 13 }

/** 角度 → 坐标（0° 在正上方，顺时针） */
function point(radius, angle) {
  const t = (angle * Math.PI) / 180
  return [C + radius * Math.sin(t), C - radius * Math.cos(t)]
}

/** 圆环上的一段 */
function ringPath(start, end) {
  const a0 = start + GAP / 2
  const a1 = end - GAP / 2
  const large = a1 - a0 > 180 ? 1 : 0
  const [x0, y0] = point(OUTER, a0)
  const [x1, y1] = point(OUTER, a1)
  const [x2, y2] = point(INNER, a1)
  const [x3, y3] = point(INNER, a0)
  return `M${x0} ${y0}A${OUTER} ${OUTER} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${INNER} ${INNER} 0 ${large} 0 ${x3} ${y3}Z`
}

/**
 * 按页面实际字体量文字宽度（Codex 第 18 轮：估算对宽英文字母偏小）。
 * 不支持 OffscreenCanvas 的浏览器（较旧的 Safari）和测试环境用偏宽的估算。量出来的再多留 5%。
 */
function makeMeasure(weight) {
  try {
    if (typeof OffscreenCanvas === 'undefined' || typeof document === 'undefined') return textWidth
    const ctx = new OffscreenCanvas(1, 1).getContext('2d')
    if (!ctx) return textWidth
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
    return (text, fontSize) => {
      ctx.font = `${weight} ${fontSize}px ${family}`
      return ctx.measureText(text).width * 1.05
    }
  } catch {
    return textWidth
  }
}
const measureLabel = makeMeasure(700)
const measureCount = makeMeasure(400)

const segments = computed(() =>
  dialSegments(props.meals).map((seg) => {
    const [x, y] = point(LABEL_R, seg.mid)
    const builtIn = isBuiltInMeal(seg.meal)
    const label = seg.meal.label
    const count = itemsForMeal(props.items, seg.meal.id).length
    // 按这一块实际有多大决定放什么：图标 + 名字 + 道数 / 只放名字 / 只放图标 / 什么都不放
    const box = segmentBox(seg, { radius: LABEL_R, thickness: OUTER - INNER })
    const layout = labelLayout(label, box, {
      fontSize: builtIn ? LABEL_FONT.builtIn : LABEL_FONT.extra,
      countText: `${count} 道`,
      measure: measureLabel,
      countMeasure: measureCount,
    })
    return {
      ...seg,
      id: seg.meal.id,
      label,
      builtIn,
      layout,
      icon: iconForMeal(seg.meal),
      count,
      path: ringPath(seg.start, seg.end),
      x,
      y,
    }
  }),
)

const selectedSegment = computed(() => segments.value.find((seg) => seg.id === props.modelValue) ?? null)

// 指针角度累计记着，换餐次时走较短的一边转过去
const pointerAngle = ref(selectedSegment.value?.mid ?? 0)
const pointerEl = ref(null)

/** 画面上指针现在实际转到的角度（转动途中和 pointerAngle 不同）；读不出时返回 null */
function shownPointerAngle() {
  if (!pointerEl.value || typeof getComputedStyle !== 'function') return null
  return angleFromMatrix(getComputedStyle(pointerEl.value).transform)
}

watch(
  () => selectedSegment.value?.mid,
  (target, previous) => {
    if (target === undefined) return
    // 第一次选（之前没有指针）直接指过去，不从正上方转过来
    pointerAngle.value = previous === undefined ? target : pointerTarget(pointerAngle.value, shownPointerAngle(), target)
  },
)

/** 指针（朝正上方画，靠 CSS 旋转） */
const needlePath = `M${C - 6} ${C}L${C} ${C - (INNER - 14)}L${C + 6} ${C}Z`

const choose = (id) => emit('update:modelValue', id)
</script>

<template>
  <div class="meal-picker">
    <svg class="dial" :viewBox="`0 0 ${SIZE} ${SIZE}`" role="group" aria-label="选择这一餐">
      <g
        v-for="seg in segments"
        :key="seg.id"
        class="meal"
        :class="[seg.id, `layout-${seg.layout.mode}`, { selected: seg.id === modelValue, extra: !seg.builtIn }]"
        role="button"
        tabindex="0"
        :aria-pressed="seg.id === modelValue"
        :aria-label="`${seg.label}，${seg.count} 道`"
        @click="choose(seg.id)"
        @keydown.enter.prevent="choose(seg.id)"
        @keydown.space.prevent="choose(seg.id)"
      >
        <!-- 名字被截短或没显示时，鼠标停上去显示全名（读屏读 aria-label 里的全名） -->
        <title v-if="seg.layout.truncated">{{ seg.label }}</title>
        <path class="seg" :d="seg.path" />
        <text v-if="seg.layout.mode === 'name'" class="label" :x="seg.x" :y="seg.y + 5" text-anchor="middle">
          {{ seg.layout.text }}
        </text>
        <component
          :is="seg.icon"
          v-else-if="seg.layout.mode === 'icon'"
          class="meal-icon"
          :x="seg.x - 8"
          :y="seg.y - 8"
          :size="16"
          :stroke-width="1.75"
          aria-hidden="true"
        />
        <template v-else-if="seg.layout.mode === 'full'">
          <component
            :is="seg.icon"
            class="meal-icon"
            :x="seg.x - 8"
            :y="seg.y - 28"
            :size="16"
            :stroke-width="1.75"
            aria-hidden="true"
          />
          <text class="label" :x="seg.x" :y="seg.y + 3" text-anchor="middle">{{ seg.layout.text }}</text>
          <text class="count" :x="seg.x" :y="seg.y + 20" text-anchor="middle">{{ seg.count }} 道</text>
        </template>
      </g>

      <circle class="face" :cx="C" :cy="C" :r="INNER - 3" />
      <g v-if="selectedSegment" ref="pointerEl" class="pointer" :style="{ transform: `rotate(${pointerAngle}deg)` }" aria-hidden="true">
        <path class="needle" :d="needlePath" />
      </g>
      <circle class="hub" :cx="C" :cy="C" r="9" />
      <circle class="hub-dot" :cx="C" :cy="C" r="3.5" />
    </svg>
  </div>
</template>

<style scoped>
.meal-picker {
  display: flex;
  justify-content: center;
}

.dial {
  display: block;
  width: min(248px, 100%);
  height: auto;
  overflow: visible;
}

.meal {
  cursor: pointer;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

.seg {
  fill: var(--surface);
  stroke: var(--border);
  stroke-width: 1;
  transition:
    fill 0.12s,
    stroke 0.12s;
}

@media (hover: hover) {
  .meal:not(.selected):hover .seg {
    fill: var(--surface-muted);
  }
}

.meal:not(.selected):active .seg {
  fill: var(--surface-muted);
}

.meal.selected .seg {
  fill: var(--accent-soft);
  stroke: var(--accent);
  stroke-width: 1.5;
}

/* 键盘选到时，这一块描粗边（代替方框形的焦点框） */
.meal:focus-visible .seg {
  stroke: var(--accent-strong);
  stroke-width: 2.5;
}

.meal-icon {
  color: var(--text-muted);
  pointer-events: none;
}

.meal.selected .meal-icon {
  color: var(--accent-strong);
}

.label {
  fill: var(--text);
  font-size: var(--fs-md);
  font-weight: 700;
  pointer-events: none;
}

.meal.extra .label {
  font-size: var(--fs-sm);
}

.meal.selected .label {
  fill: var(--accent-strong);
}

.count {
  fill: var(--text-muted);
  font-size: var(--fs-sm);
  pointer-events: none;
}

.face {
  fill: var(--surface);
  stroke: var(--border);
}

/* 指针绕转盘中心转；系统设置“减少动画”时直接跳过去（style.css 全局规则） */
.pointer {
  transform-box: view-box;
  transform-origin: 50% 50%;
  transition: transform 0.35s cubic-bezier(0.3, 1.3, 0.5, 1);
  pointer-events: none;
}

.needle {
  fill: var(--text);
}

.hub {
  fill: var(--text);
}

.hub-dot {
  fill: var(--surface);
}
</style>
