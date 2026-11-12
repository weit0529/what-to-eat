<!--
  抽中结果的卡片：图片（没有图片时显示分类图标）、名字、店铺、分类、人均价格、标签、描述。
  卡片下面的按钮（“就吃这个”等）由使用方放进默认插槽。
  用法：<ResultCard :item="抽中的菜"> …按钮… </ResultCard>
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { IconMapPin } from '@tabler/icons-vue'
import { iconForCategory } from '../ui/icons.js'
import { imageUrlOf } from '../ui/image-url.js'

const props = defineProps({
  item: { type: Object, required: true },
})

/** 图片加载失败（比如文件坏了）时就不显示图片，改显示分类图标 */
const imageFailed = ref(false)
watch(
  () => props.item.image,
  () => {
    imageFailed.value = false
  },
)

/** 图片地址：随网站发布的图片，或在线上传的图片（阶段 4-4d，见 src/ui/image-url.js） */
const imageUrl = computed(() => imageUrlOf(props.item.image))

const categoryIcon = computed(() => iconForCategory(props.item.category))

/** 人均价格：整数直接显示，有小数的保留一位 */
const priceText = computed(() => {
  const price = props.item.price
  if (price === null || price === undefined) return null
  return `人均约 ¥${Number.isInteger(price) ? price : price.toFixed(1)}`
})
</script>

<template>
  <article class="result-card">
    <img
      v-if="imageUrl && !imageFailed"
      class="photo"
      :src="imageUrl"
      :alt="item.name"
      @error="imageFailed = true"
    />
    <div v-else class="icon-art" aria-hidden="true">
      <component :is="categoryIcon" :size="40" :stroke-width="1.5" />
    </div>
    <div class="body">
      <p class="category">{{ item.category }}</p>
      <h2 class="name">{{ item.name }}</h2>
      <p v-if="item.shop || priceText" class="meta">
        <span v-if="item.shop" class="shop with-icon">
          <IconMapPin :size="16" :stroke-width="1.75" aria-hidden="true" />{{ item.shop }}
        </span>
        <span v-if="priceText" class="price">{{ priceText }}</span>
      </p>
      <ul v-if="item.tags.length > 0" class="tags" aria-label="标签">
        <li v-for="tag in item.tags" :key="tag">{{ tag }}</li>
      </ul>
      <p v-if="item.description" class="description">{{ item.description }}</p>
      <slot />
    </div>
  </article>
</template>

<style scoped>
.result-card {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.photo {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
}

.icon-art {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  margin: 20px auto 0;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.body {
  padding: 12px 16px 20px;
  text-align: center;
}

.category {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--fs-sm);
}

.name {
  margin: 2px 0 0;
  font-size: var(--fs-xl);
  font-weight: 800;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 4px 16px;
  margin: 6px 0 0;
}

.shop {
  gap: 4px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.price {
  font-weight: 700;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.tags li {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: var(--fs-sm);
  overflow-wrap: anywhere;
}

.description {
  margin: 12px 0 0;
  color: var(--text-muted);
}
</style>
