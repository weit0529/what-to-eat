<!--
  可以收起的面板：标题一行（图标、标题、摘要、展开箭头），点标题展开或收起。
  “不想吃的”“最近吃过”“想吃点什么样的？”都用它，默认收起（用户 2026-11-05 决定 1A）。
  标题行不折行：摘要太长时省略，右边的操作按钮（“全部恢复”等）始终在同一行（修手机上折行的问题）。
  用法：
    <CollapsePanel class="exclude-panel" title="不想吃的" :icon="IconBan" :summary="摘要">
      <template #actions><button class="link">全部恢复</button></template>
      面板内容
    </CollapsePanel>
-->
<script setup>
import { ref, useId } from 'vue'
import { IconChevronDown } from '@tabler/icons-vue'

const props = defineProps({
  title: { type: String, required: true },
  /** 标题前的图标组件 */
  icon: { type: [Object, Function], default: null },
  /** 收起时也显示的一行摘要 */
  summary: { type: String, default: '' },
  /** 默认是否展开 */
  defaultOpen: { type: Boolean, default: false },
})

const open = ref(props.defaultOpen)
const id = useId()
const titleId = `panel-title-${id}`
const bodyId = `panel-body-${id}`
</script>

<template>
  <section class="collapse-panel" :aria-labelledby="titleId">
    <div class="head">
      <h2 :id="titleId" class="heading">
        <button type="button" class="panel-toggle" :aria-expanded="open" :aria-controls="bodyId" @click="open = !open">
          <component :is="icon" v-if="icon" class="title-icon" :size="20" :stroke-width="1.75" aria-hidden="true" />
          <span class="title">{{ title }}</span>
          <span class="summary">{{ summary }}</span>
          <IconChevronDown class="caret" :class="{ open }" :size="18" :stroke-width="2" aria-hidden="true" />
        </button>
      </h2>
      <slot name="actions" />
    </div>
    <div v-show="open" :id="bodyId" class="body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.collapse-panel {
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

.heading {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-md);
}

.panel-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
}

.title-icon {
  color: var(--text-muted);
}

.title {
  flex: none;
  font-size: var(--fs-md);
  font-weight: 700;
}

.summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.caret {
  color: var(--text-muted);
  transition: transform 0.15s;
}

/* 很窄的屏幕（如 320px 宽的手机）：标题行放不下摘要，摘要挪到第二行，免得被挤没（Codex 第 15 轮） */
.collapse-panel {
  container-type: inline-size;
}

@container (max-width: 300px) {
  .head {
    align-items: flex-start;
  }

  .panel-toggle {
    flex-wrap: wrap;
  }

  .caret {
    margin-left: auto;
  }

  .summary {
    order: 10;
    flex-basis: 100%;
    padding-left: 28px;
  }

  /* 右边的操作按钮和第一行（标题行）对齐 */
  .head :slotted(.link) {
    line-height: 32px;
  }
}

.caret.open {
  transform: rotate(180deg);
}

.body {
  margin-top: 12px;
}

/* 标题行右边的操作按钮（由使用方传进来） */
.head :slotted(.link) {
  flex: none;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-strong);
  font-size: var(--fs-sm);
  font-weight: 700;
  white-space: nowrap;
}
</style>
