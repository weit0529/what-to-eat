<!--
  加 / 改一道菜的表单。提交前先用和后台同一套规则（validateDish）检查一遍，有错直接在对应的格子下面说明；
  后台还会再检查一次（不能只靠网页拦），后台说有错也显示在这里。
  账号页“我的菜”（阶段 4-4）也用它：不显示“启用”，图片只能自己上传（4-4d）。
  reveal()：滚到表单、光标放进第一个格子（用户 2026-11-12 验收时提，R-032：表单在列表上方，点了“改”看不到）。
  调用方每点一次“改” / “新加”都调一次（Codex 第 45 轮：只在出现时滚的话，表单开着再点同一道菜不会滚回来）；
  保存失败时不调，表单留在原地。
-->
<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { validateDish } from '../core/menu-data.js'
import imageFiles from '../generated/images.json'
import ImageField from './ImageField.vue'

const props = defineProps({
  /** 要改的菜；新加时为 null */
  dish: { type: Object, default: null },
  /** 全部餐次（早午晚 + 额外餐次） */
  meals: { type: Array, required: true },
  /** 已有的分类，给“分类”格子做提示 */
  categories: { type: Array, default: () => [] },
  /** 后台返回的错误 [{ field, message }] */
  serverErrors: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  /** 显示“图片”一项 */
  showImage: { type: Boolean, default: true },
  /** 上传图片的函数 (blob) => 文件名（阶段 4-4d）；不传就不能上传 */
  uploadImage: { type: Function, default: null },
  /** 能不能从随网站发布的 public/images/ 里选（管理页能，用户不能） */
  bundledImages: { type: Boolean, default: true },
  /** 显示“启用”一项（用户的菜没有启用 / 暂停） */
  showEnabled: { type: Boolean, default: true },
  /** 标题；不传就按新加 / 修改自动写 */
  title: { type: String, default: '' },
})
const emit = defineEmits(['save', 'cancel'])

/** 标签格子里可以用这些符号隔开（和 Excel 一样） */
const TAG_SEPARATOR = /[、,，;；\n]+/

const blank = () => ({ name: '', shop: '', category: '', meals: [], tags: '', price: '', description: '', image: '', enabled: true })
const form = reactive(blank())
const localErrors = ref([])
/** 图片正在压缩、上传：这时不能保存，不然存进去的是旧图（Codex 第 41 轮） */
const uploading = ref(false)

const root = ref(null)
/** 滚到表单、聚焦第一个格子（调用方在每次点“改” / “新加”后调） */
function reveal() {
  const el = root.value
  if (!el) return
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  el.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  // 光标放进第一个格子；不让浏览器再跳一次（上面已经滚好了）
  el.querySelector('input')?.focus?.({ preventScroll: true })
}
defineExpose({ reveal })

watch(
  () => props.dish,
  (dish) => {
    Object.assign(form, blank())
    if (dish) {
      Object.assign(form, {
        ...dish,
        shop: dish.shop ?? '',
        tags: dish.tags.join('、'),
        price: dish.price ?? '',
        description: dish.description ?? '',
        image: dish.image ?? '',
      })
    }
    localErrors.value = []
  },
  { immediate: true },
)

const errors = computed(() => [...localErrors.value, ...props.serverErrors])
const errorOf = (field) => errors.value.filter((e) => e.field === field).map((e) => e.message).join('；')

function toPayload() {
  const price = form.price === '' || form.price === null ? null : Number(form.price)
  return {
    name: form.name,
    shop: form.shop,
    category: form.category,
    meals: form.meals,
    tags: String(form.tags)
      .split(TAG_SEPARATOR)
      .map((t) => t.trim())
      .filter(Boolean),
    price: Number.isNaN(price) ? -1 : price,
    description: form.description,
    image: form.image,
    enabled: form.enabled,
  }
}

function submit() {
  if (uploading.value) {
    localErrors.value = [{ field: 'image', message: '图片还在上传，传完再保存' }]
    return
  }
  const payload = toPayload()
  const { errors: found } = validateDish(payload, { mealIds: props.meals.map((m) => m.id) })
  localErrors.value = found
  if (found.length === 0) emit('save', payload)
}
</script>

<template>
  <form ref="root" class="block dish-form" @submit.prevent="submit">
    <h2>{{ title || (dish ? `改：${dish.name}` : '新加一道菜') }}</h2>

    <div class="grid">
      <label class="field">
        <span>品类 *</span>
        <input v-model="form.name" maxlength="40" placeholder="如：麻辣烫" />
        <small v-if="errorOf('name')" class="error">{{ errorOf('name') }}</small>
      </label>
      <label class="field">
        <span>店铺</span>
        <input v-model="form.shop" maxlength="40" placeholder="可以不填" />
        <small v-if="errorOf('shop')" class="error">{{ errorOf('shop') }}</small>
      </label>
      <label class="field">
        <span>分类 *</span>
        <input v-model="form.category" maxlength="20" list="category-options" placeholder="如：火锅串串" />
        <datalist id="category-options">
          <option v-for="c in categories" :key="c" :value="c" />
        </datalist>
        <small v-if="errorOf('category')" class="error">{{ errorOf('category') }}</small>
      </label>
      <label class="field">
        <span>人均价格（元）</span>
        <input v-model="form.price" type="number" min="0" step="0.1" inputmode="decimal" placeholder="可以不填" />
        <small v-if="errorOf('price')" class="error">{{ errorOf('price') }}</small>
      </label>
    </div>

    <fieldset class="field meals">
      <legend>适合餐次 *</legend>
      <label v-for="meal in meals" :key="meal.id" class="check">
        <input v-model="form.meals" type="checkbox" :value="meal.id" />{{ meal.label }}
      </label>
      <small v-if="errorOf('meals')" class="error">{{ errorOf('meals') }}</small>
    </fieldset>

    <label class="field">
      <span>标签（用顿号或逗号隔开）</span>
      <input v-model="form.tags" placeholder="如：辣、热乎、适合下雨" />
      <small v-if="errorOf('tags')" class="error">{{ errorOf('tags') }}</small>
    </label>

    <label class="field">
      <span>描述</span>
      <textarea v-model="form.description" rows="2" maxlength="200" placeholder="可以不填"></textarea>
      <small v-if="errorOf('description')" class="error">{{ errorOf('description') }}</small>
    </label>

    <div v-if="showImage" class="field">
      <span>图片</span>
      <ImageField
        v-model="form.image"
        :upload="uploadImage"
        :bundled="bundledImages ? imageFiles : null"
        :disabled="busy"
        @busy="uploading = $event"
      />
      <small class="hint">
        {{ uploadImage ? '上传前会自动压缩（最长边 1024 像素，约 200 KB），照片里的拍摄地点等信息也会去掉。' : '' }}
        {{ bundledImages ? '也可以选项目 public/images/ 里随网站发布的图片。' : '' }}
      </small>
      <small v-if="errorOf('image')" class="error">{{ errorOf('image') }}</small>
    </div>

    <label v-if="showEnabled" class="check">
      <input v-model="form.enabled" type="checkbox" />启用（不勾就暂停：网站上不显示，但留着）
    </label>

    <div class="actions">
      <button type="submit" class="primary" :disabled="busy || uploading">
        {{ busy ? '正在保存……' : uploading ? '图片上传中……' : '保存' }}
      </button>
      <button type="button" :disabled="busy" @click="emit('cancel')">取消</button>
    </div>
  </form>
</template>
