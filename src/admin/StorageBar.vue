<!--
  管理页“菜单”页签顶上的图片存储进度条（用户 2026-11-12 提议，REQUIREMENTS.md R-031）：
  上传的菜图片存在 Cloudflare R2，免费额度 10 GB（十进制，10⁹ 字节一个 GB，和 Cloudflare 的算法一样）；
  这里显示用了多少、多少张（后台按上传记录加总），还有全站上传次数的防刷额度
  （每轮 1000 次，传失败的也算；从这一轮第一次上传起算 24 小时，不是按日历的“今天”）。
  用量到 80% 时进度条变橙色、提醒。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import { getStorage } from './api.js'

const data = ref(null)
const error = ref('')
const loading = ref(false)

const ratio = computed(() => (data.value?.available ? Math.min(1, data.value.usedBytes / data.value.limitBytes) : 0))
const percent = computed(() => {
  const p = ratio.value * 100
  if (p === 0) return '0'
  return p < 0.1 ? '不到 0.1' : p < 10 ? p.toFixed(1) : String(Math.round(p))
})
const warn = computed(() => ratio.value >= 0.8)

/** 字节数 → 人看的大小（十进制，和 Cloudflare 的 GB 一致） */
function size(bytes) {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1000 ** 2) return `${(bytes / 1000).toFixed(1)} KB`
  if (bytes < 1000 ** 3) return `${(bytes / 1000 ** 2).toFixed(1)} MB`
  return `${(bytes / 1000 ** 3).toFixed(2)} GB`
}

/** 这一轮上传次数什么时候重新计：如“11月12日 21:30” */
const resetText = computed(() => {
  const at = data.value?.uploadResetsAt
  if (!at) return ''
  return new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await getStorage()
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="block storage" aria-label="图片存储用量">
    <div class="storage-head">
      <strong id="storage-title">图片存储</strong>
      <button type="button" class="link" :disabled="loading" @click="load">{{ loading ? '正在读……' : '刷新' }}</button>
    </div>
    <p v-if="error" class="error" role="alert">读不到用量：{{ error }}</p>
    <p v-else-if="data && !data.available" class="hint">图片存储还没开通，暂时不能传图片。</p>
    <template v-else-if="data">
      <div
        class="bar"
        :class="{ warn }"
        role="progressbar"
        aria-labelledby="storage-title"
        :aria-valuenow="Math.round(ratio * 100)"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuetext="`已用 ${size(data.usedBytes)}，共 ${size(data.limitBytes)}`"
      >
        <div class="fill" :style="{ width: `${ratio * 100}%` }"></div>
      </div>
      <p class="hint">
        已用 {{ size(data.usedBytes) }} / {{ size(data.limitBytes) }}（{{ percent }}%），共 {{ data.objects }} 张图片。
        全站上传次数每轮最多 {{ data.uploadLimit }} 次（传失败的也算）：这一轮已用 {{ data.uploadAttempts }} 次<template v-if="resetText">，{{ resetText }} 后重新计</template>。
      </p>
      <p v-if="warn" class="error">免费额度快用完了：超过 10 GB 以后会按量收费（每 GB 每月约 0.015 美元）。</p>
    </template>
  </section>
</template>

<style scoped>
.storage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bar {
  height: 10px;
  margin-top: 8px;
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
  overflow: hidden;
}

/* 用量少时也露出一点点，看得出是进度条 */
.fill {
  min-width: 4px;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--brand-dark);
}

.bar.warn .fill {
  background: var(--accent);
}
</style>
