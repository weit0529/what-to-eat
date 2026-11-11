<!--
  Excel 导入导出（REQUIREMENTS.md R-020：以后菜单以后台为准，Excel 只做批量导入导出）。
  导出：把线上菜单存成和原来 data/menu.xlsx 一样格式的表格。
  导入：选一个表格 → 先检查、给管理员看结果 → 确认后整个替换线上菜单（替换前建议先导出一份备份）。
-->
<script setup>
import { computed, ref } from 'vue'
import readXlsxFile from 'read-excel-file/browser'
import writeXlsxFile from 'write-excel-file/browser'
import { formatIssue } from '../core/menu-data.js'
import { menuToSheets, sheetsToImport } from '../core/menu-excel.js'
import imageFiles from '../generated/images.json'
import { importMenu } from './api.js'

const props = defineProps({
  menu: { type: Object, required: true },
})
const emit = defineEmits(['changed'])

const preview = ref(null)
const busy = ref(false)
const message = ref('')
const error = ref('')
const problems = ref([])
const fileInput = ref(null)

const show = (issue) => (issue.row > 0 ? formatIssue(issue) : issue.message)
const enabledInPreview = computed(() => preview.value?.dishes.filter((d) => d.enabled).length ?? 0)

async function exportExcel() {
  error.value = ''
  try {
    const sheets = menuToSheets(props.menu)
    const date = new Date().toISOString().slice(0, 10)
    await writeXlsxFile(sheets.map((s) => ({ data: s.data, sheet: s.sheet, stickyRowsCount: 1 }))).toFile(`今天吃什么-菜单-${date}.xlsx`)
  } catch (err) {
    error.value = `导出失败：${err.message}`
  }
}

async function pickFile(event) {
  const file = event.target.files?.[0]
  message.value = ''
  error.value = ''
  problems.value = []
  preview.value = null
  if (!file) return
  try {
    const sheets = await readXlsxFile(file)
    preview.value = sheetsToImport(sheets, { imageFiles })
  } catch (err) {
    error.value = `读不了这个文件（${err.message}）。请确认它是 Excel 的 .xlsx 格式`
  }
}

async function confirmImport() {
  const p = preview.value
  if (!p?.ok) return
  if (!window.confirm(`用这个表格整个替换线上菜单？\n共 ${p.dishes.length} 道菜（启用 ${enabledInPreview.value} 道）。\n表格里没有的菜会被删掉。建议先点“导出”留一份备份。`)) return
  busy.value = true
  error.value = ''
  problems.value = []
  try {
    const result = await importMenu({ mealLabels: p.mealLabels, dishes: p.dishes })
    message.value = `导入好了：共 ${result.count} 道菜，启用 ${result.enabled} 道。网站上的人刷新就能看到。`
    preview.value = null
    if (fileInput.value) fileInput.value.value = ''
    emit('changed')
  } catch (err) {
    error.value = err.message
    problems.value = err.problems
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="block">
    <h2>导出</h2>
    <p class="hint">把线上菜单存成 Excel 表格（格式和原来的 menu.xlsx 一样，按“菜单填写说明”就能改）。导入前最好先导出一份备份。</p>
    <button type="button" @click="exportExcel">导出 Excel</button>
  </section>

  <section class="block">
    <h2>导入</h2>
    <p class="hint">选一个表格，先检查；检查通过后再确认。<strong>导入会整个替换线上菜单</strong>，表格里没有的菜会被删掉。</p>
    <input ref="fileInput" type="file" accept=".xlsx" aria-label="选择 Excel 表格" @change="pickFile" />

    <div v-if="preview" class="preview">
      <template v-if="preview.ok">
        <p class="ok">
          检查通过：共 {{ preview.dishes.length }} 道菜（启用 {{ enabledInPreview }} 道，暂停 {{ preview.disabledCount }} 道）；
          额外餐次：{{ preview.mealLabels.length ? preview.mealLabels.join('、') : '没有' }}。
        </p>
        <button type="button" class="primary" :disabled="busy" @click="confirmImport">{{ busy ? '正在导入……' : '确认导入' }}</button>
      </template>
      <template v-else>
        <p class="error">表格有 {{ preview.errors.length }} 处要改，改好后重新选：</p>
        <ul class="issues">
          <li v-for="(issue, i) in preview.errors" :key="i">{{ show(issue) }}</li>
        </ul>
      </template>
      <template v-if="preview.warnings.length">
        <p class="hint">提醒（不影响导入）：</p>
        <ul class="issues">
          <li v-for="(issue, i) in preview.warnings" :key="i">{{ show(issue) }}</li>
        </ul>
      </template>
    </div>

    <p v-if="message" class="ok" role="status">{{ message }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <ul v-if="problems.length" class="issues">
      <li v-for="(p, i) in problems" :key="i">{{ p }}</li>
    </ul>
  </section>
</template>
