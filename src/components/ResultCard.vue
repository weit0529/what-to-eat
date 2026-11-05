<!--
  抽中结果的卡片：图片（没有图片时显示分类 emoji）、名字、店铺、分类、人均价格、标签、描述。
  用法：<ResultCard :item="抽中的菜" />
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { emojiForCategory } from '../ui/food-emoji.js'

const props = defineProps({
  item: { type: Object, required: true },
  /** 卡片顶部横幅上的字 */
  ribbon: { type: String, default: '就吃它！' },
})

/** 图片加载失败（比如文件坏了）时就不显示图片，改显示 emoji */
const imageFailed = ref(false)
watch(
  () => props.item.image,
  () => {
    imageFailed.value = false
  },
)

/**
 * 图片地址。文件名要编码，否则带 #、% 、空格等字符的文件名会被浏览器误读。
 * BASE_URL 是网站的根路径（见 vite.config.js 的 base），发布到 GitHub Pages 子目录时也能找到。
 */
const imageUrl = computed(() =>
  props.item.image ? `${import.meta.env.BASE_URL}images/${encodeURIComponent(props.item.image)}` : null,
)

const emoji = computed(() => emojiForCategory(props.item.category))

/** 人均价格：整数直接显示，有小数的保留一位 */
const priceText = computed(() => {
  const price = props.item.price
  if (price === null || price === undefined) return null
  return `人均约 ¥${Number.isInteger(price) ? price : price.toFixed(1)}`
})
</script>

<template>
  <article class="result-card">
    <p class="ribbon"><span aria-hidden="true">🎉 </span>{{ ribbon }}<span aria-hidden="true"> 🎉</span></p>
    <img
      v-if="imageUrl && !imageFailed"
      class="photo"
      :src="imageUrl"
      :alt="item.name"
      @error="imageFailed = true"
    />
    <div v-else class="emoji-art" aria-hidden="true">{{ emoji }}</div>
    <div class="body">
      <p class="category">{{ item.category }}</p>
      <h2 class="name">{{ item.name }}</h2>
      <p v-if="item.shop" class="shop"><span aria-hidden="true">📍 </span>{{ item.shop }}</p>
      <p v-if="priceText" class="price"><span aria-hidden="true">💰 </span>{{ priceText }}</p>
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
  position: relative;
  overflow: hidden;
  border: 3px solid var(--accent);
  border-radius: 22px;
  background: var(--surface);
  box-shadow: 0 6px 0 var(--accent-dark);
}

.ribbon {
  margin: 0;
  padding: 6px 12px;
  background: linear-gradient(90deg, var(--accent), var(--pink));
  color: var(--accent-text);
  font-weight: 800;
  text-align: center;
  letter-spacing: 0.1em;
}

.photo {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
}

.emoji-art {
  padding: 18px 0 4px;
  font-size: 4.5rem;
  line-height: 1.1;
  text-align: center;
  animation: spin-in 0.5s ease-out;
}

@keyframes spin-in {
  from {
    transform: rotate(-30deg) scale(0.4);
    opacity: 0;
  }
}

.body {
  padding: 8px 18px 20px;
  text-align: center;
}

.category {
  display: inline-block;
  margin: 0;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--yellow-soft);
  color: var(--text-muted);
  font-size: 0.85rem;
}

.name {
  margin: 4px 0 0;
  font-size: 2rem;
  font-weight: 900;
  line-height: 1.3;
  color: var(--accent-dark);
  overflow-wrap: anywhere;
}

.shop {
  margin: 2px 0 0;
  font-size: 1rem;
  overflow-wrap: anywhere;
}

.price {
  margin: 6px 0 0;
  color: var(--accent);
  font-weight: 700;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.tags li {
  padding: 1px 10px;
  border-radius: 999px;
  background: var(--accent-soft);
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.tags li:nth-child(3n + 2) {
  background: #ffe3ee;
}

.tags li:nth-child(3n) {
  background: #dcf7f1;
}

.description {
  margin: 10px 0 0;
  color: var(--text-muted);
}
</style>
