<!--
  加 / 改一道菜的表单。提交前先用和后台同一套规则（validateDish）检查一遍，有错直接在对应的格子下面说明；
  后台还会再检查一次（不能只靠网页拦），后台说有错也显示在这里。
-->
<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { validateDish } from '../core/menu-data.js'
import imageFiles from '../generated/images.json'

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
})
const emit = defineEmits(['save', 'cancel'])

/** 标签格子里可以用这些符号隔开（和 Excel 一样） */
const TAG_SEPARATOR = /[、,，;；\n]+/

const blank = () => ({ name: '', shop: '', category: '', meals: [], tags: '', price: '', description: '', image: '', enabled: true })
const form = reactive(blank())
const localErrors = ref([])

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
// 已经选了、但现在 public/images/ 里没有的图片，也放进下拉框，免得改别的项时把它清掉
const imageOptions = computed(() => (form.image && !imageFiles.includes(form.image) ? [form.image, ...imageFiles] : imageFiles))

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
  const payload = toPayload()
  const { errors: found } = validateDish(payload, { mealIds: props.meals.map((m) => m.id) })
  localErrors.value = found
  if (found.length === 0) emit('save', payload)
}
</script>

<template>
  <form class="block dish-form" @submit.prevent="submit">
    <h2>{{ dish ? `改：${dish.name}` : '新加一道菜' }}</h2>

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

    <label class="field">
      <span>图片</span>
      <select v-model="form.image">
        <option value="">不用图片</option>
        <option v-for="file in imageOptions" :key="file" :value="file">{{ file }}</option>
      </select>
      <small class="hint">
        只能选项目 public/images/ 里已有的图片；新图片要放进那个文件夹、发布网站后才能选（在线上传以后再做）。
      </small>
      <small v-if="errorOf('image')" class="error">{{ errorOf('image') }}</small>
    </label>

    <label class="check">
      <input v-model="form.enabled" type="checkbox" />启用（不勾就暂停：网站上不显示，但留着）
    </label>

    <div class="actions">
      <button type="submit" class="primary" :disabled="busy">{{ busy ? '正在保存……' : '保存' }}</button>
      <button type="button" :disabled="busy" @click="emit('cancel')">取消</button>
    </div>
  </form>
</template>
