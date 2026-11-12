<!--
  菜的图片格子（阶段 4-4d，REQUIREMENTS.md R-030），在 DishForm 里用。
  - 能上传时（传了 upload）：选一张图片 → 浏览器里压缩（最长边 1024 像素、约 200 KB）→ 上传 → 填上文件名
  - 管理页还能从随网站发布的 public/images/ 里选（传了 bundled）
  有图片时显示小预览，可以“不用图片”。
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { compressImage } from '../ui/compress-image.js'
import { imageUrlOf } from '../ui/image-url.js'
import { isUploadedImage } from '../core/menu-data.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  /** 上传函数 (blob) => 文件名；不传就不能上传 */
  upload: { type: Function, default: null },
  /** 随网站发布的图片文件名；不传（null）就不显示这个下拉框 */
  bundled: { type: Array, default: null },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'busy'])

const busy = ref(false)
const error = ref('')
const failed = ref(false)
const fileInput = ref(null)

// 图片换了（包括表单换成另一道菜）：上一张显示失败的状态不能留着（Codex 第 41 轮）
watch(
  () => props.modelValue,
  () => {
    failed.value = false
  },
)
/** 组件已经关掉（表单关了、换了一道菜）：迟到的上传结果不再填回去 */
let alive = true
onBeforeUnmount(() => {
  alive = false
})

const previewUrl = computed(() => imageUrlOf(props.modelValue))
const isUploaded = computed(() => isUploadedImage(props.modelValue))
// 已经选了、但现在 public/images/ 里没有的图片（不是上传的），也放进下拉框，免得改别的项时把它清掉
const bundledOptions = computed(() => {
  if (!props.bundled) return []
  const v = props.modelValue
  return v && !isUploadedImage(v) && !props.bundled.includes(v) ? [v, ...props.bundled] : props.bundled
})

function set(value) {
  failed.value = false
  error.value = ''
  emit('update:modelValue', value)
}

async function pick(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  busy.value = true
  emit('busy', true)
  error.value = ''
  try {
    const blob = await compressImage(file)
    const name = await props.upload(blob)
    if (alive) set(name)
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
    emit('busy', false)
  }
}
</script>

<template>
  <div class="image-field">
    <img
      v-if="previewUrl && !failed"
      class="image-preview"
      :src="previewUrl"
      alt="这道菜的图片"
      width="96"
      height="96"
      @error="failed = true"
    />
    <p v-else-if="modelValue && failed" class="hint">图片显示不出来（{{ modelValue }}）</p>

    <div class="image-actions">
      <template v-if="upload">
        <input ref="fileInput" type="file" accept="image/*" class="sr-only" tabindex="-1" aria-hidden="true" @change="pick" />
        <button type="button" :disabled="disabled || busy" @click="fileInput?.click()">
          {{ busy ? '正在压缩上传……' : isUploaded ? '换一张' : '上传图片' }}
        </button>
      </template>
      <select v-if="bundled" :value="isUploaded ? '' : modelValue" :disabled="disabled || busy" aria-label="选网站自带的图片" @change="set($event.target.value)">
        <option value="">{{ isUploaded ? '（用的是上传的图片）' : '不用图片' }}</option>
        <option v-for="file in bundledOptions" :key="file" :value="file">{{ file }}</option>
      </select>
      <button v-if="modelValue" type="button" :disabled="disabled || busy" @click="set('')">不用图片</button>
    </div>
    <small v-if="error" class="error">{{ error }}</small>
  </div>
</template>

<style scoped>
.image-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.image-preview {
  width: 96px;
  height: 96px;
  object-fit: cover;
  border-radius: var(--radius-inner);
  border: 1px solid var(--border);
}

.image-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
