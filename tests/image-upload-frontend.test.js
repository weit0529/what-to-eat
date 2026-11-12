// 阶段 4-4d 网页的测试：压缩、图片格子、图片地址、上传请求（REQUIREMENTS.md R-030）
import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { fitUnder, MAX_BYTES } from '../src/ui/compress-image.js'
import { imageUrlOf } from '../src/ui/image-url.js'
import { createApiClient } from '../src/api-client.js'
import { isUploadedImage } from '../src/core/menu-data.js'

const compressImage = vi.hoisted(() => vi.fn(async () => new Blob(['x'], { type: 'image/webp' })))
vi.mock('../src/ui/compress-image.js', async (importOriginal) => ({ ...(await importOriginal()), compressImage }))
const { default: ImageField } = await import('../src/admin/ImageField.vue')

const UP = `up_${'a'.repeat(32)}.webp`
afterEach(() => vi.unstubAllGlobals())

describe('压缩：找一个够小的结果', () => {
  const blobOf = (size) => ({ size })
  it('第一次就够小，直接用', async () => {
    const encode = vi.fn(async () => blobOf(100))
    expect((await fitUnder(encode)).size).toBe(100)
    expect(encode).toHaveBeenCalledTimes(1)
    expect(encode).toHaveBeenCalledWith(1, 0.85)
  })

  it('先降质量，质量降完还太大就缩小尺寸再试', async () => {
    const encode = vi.fn(async (scale, quality) => blobOf(scale < 1 && quality <= 0.75 ? MAX_BYTES : MAX_BYTES + 1))
    await fitUnder(encode)
    const calls = encode.mock.calls
    expect(calls.slice(0, 5).map(([s]) => s)).toEqual([1, 1, 1, 1, 1])
    expect(calls[5]).toEqual([0.75, 0.85])
    expect(calls.at(-1)).toEqual([0.75, 0.75])
  })

  it('怎么压都太大：报错，不会一直试下去', async () => {
    const encode = vi.fn(async () => blobOf(MAX_BYTES + 1))
    await expect(fitUnder(encode)).rejects.toThrow('压不到')
    expect(encode.mock.calls.length).toBe(25)
  })
})

describe('图片地址', () => {
  it('上传的图从后台取；随网站发布的从 images/ 取，文件名要编码', () => {
    expect(isUploadedImage(UP)).toBe(true)
    expect(isUploadedImage('up_123.webp')).toBe(false)
    expect(imageUrlOf(UP)).toMatch(new RegExp(`/api/images/${UP}$`))
    expect(imageUrlOf('麻辣 烫.jpg')).toMatch(/images\/%E9%BA%BB%E8%BE%A3%20%E7%83%AB\.jpg$/)
    expect(imageUrlOf('')).toBe(null)
  })
})

describe('上传请求', () => {
  it('Blob 原样发出去，content-type 用图片自己的类型，带登录凭证', async () => {
    localStorage.setItem('k', 'tok')
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ image: UP }), { status: 201 }))
    const client = createApiClient('k')
    const blob = new Blob(['x'], { type: 'image/webp' })
    const { data } = await client.request('/api/images', { method: 'POST', body: blob, fetchImpl })
    expect(data.image).toBe(UP)
    const [, init] = fetchImpl.mock.calls[0]
    expect(init.body).toBe(blob)
    expect(init.headers).toMatchObject({ 'content-type': 'image/webp', authorization: 'Bearer tok' })
    localStorage.clear()
  })
})

describe('图片格子', () => {
  const file = () => new File(['raw'], 'photo.jpg', { type: 'image/jpeg' })

  it('选了图片：先压缩、再上传，填上返回的文件名', async () => {
    const upload = vi.fn(async () => UP)
    const w = mount(ImageField, { props: { modelValue: '', upload } })
    const input = w.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file()] })
    await input.trigger('change')
    await flushPromises()
    expect(compressImage).toHaveBeenCalled()
    expect(upload).toHaveBeenCalledWith(await compressImage.mock.results.at(-1).value)
    expect(w.emitted('update:modelValue').at(-1)).toEqual([UP])
  })

  it('压缩或上传出错：显示原因，不改图片', async () => {
    const upload = vi.fn(async () => {
      throw new Error('传得太多了，请过一会儿再试')
    })
    const w = mount(ImageField, { props: { modelValue: '', upload } })
    const input = w.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file()] })
    await input.trigger('change')
    await flushPromises()
    expect(w.find('.error').text()).toBe('传得太多了，请过一会儿再试')
    expect(w.emitted('update:modelValue')).toBeUndefined()
  })

  it('用户那边：没有“网站自带图片”下拉框；有图时能预览、能去掉', async () => {
    const w = mount(ImageField, { props: { modelValue: UP, upload: vi.fn() } })
    expect(w.find('select').exists()).toBe(false)
    expect(w.find('img').attributes('src')).toMatch(/\/api\/images\//)
    expect(w.findAll('button').map((b) => b.text())).toEqual(['换一张', '不用图片'])
    await w.findAll('button')[1].trigger('click')
    expect(w.emitted('update:modelValue').at(-1)).toEqual([''])
  })

  it('管理页：能从网站自带的图片里选；用的是上传的图时下拉框显示“用的是上传的图片”', async () => {
    const w = mount(ImageField, { props: { modelValue: UP, upload: vi.fn(), bundled: ['a.jpg', 'b.jpg'] } })
    expect(w.find('select option').text()).toBe('（用的是上传的图片）')
    await w.find('select').setValue('b.jpg')
    expect(w.emitted('update:modelValue').at(-1)).toEqual(['b.jpg'])
  })
})

describe('Codex 第 41 轮的修复', () => {
  const file = () => new File(['raw'], 'photo.jpg', { type: 'image/jpeg' })
  const MEALS = [
    { id: 'breakfast', label: '早餐' },
    { id: 'lunch', label: '午餐' },
    { id: 'dinner', label: '晚餐' },
  ]
  /** 一个能手动放行的上传 */
  function slowUpload() {
    let release
    const upload = vi.fn(() => new Promise((resolve) => (release = resolve)))
    return { upload, release: (name) => release(name) }
  }
  async function pickFile(wrapper) {
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file()], configurable: true })
    await input.trigger('change')
    await flushPromises()
  }

  it('图片还在上传时不能保存（按钮点不了，强行提交也拦住）；传完才能存，存的是新图', async () => {
    const { default: DishForm } = await import('../src/admin/DishForm.vue')
    const { upload, release } = slowUpload()
    const dish = { id: 'u_a', name: '红烧肉', shop: null, category: '家常菜', meals: ['dinner'], tags: [], price: null, description: null, image: null }
    const w = mount(DishForm, { props: { dish, meals: MEALS, uploadImage: upload, bundledImages: false, showEnabled: false } })
    await pickFile(w)
    const save = w.find('button[type="submit"]')
    expect(save.attributes('disabled')).toBeDefined()
    expect(save.text()).toBe('图片上传中……')
    await w.find('form').trigger('submit')
    expect(w.emitted('save')).toBeUndefined()
    expect(w.text()).toContain('图片还在上传，传完再保存')
    release(UP)
    await flushPromises()
    await w.find('form').trigger('submit')
    expect(w.emitted('save').at(-1)[0].image).toBe(UP)
  })

  it('上传 A 的图时切去改 B：A 的图不会填到 B 上', async () => {
    const { default: DishesView } = await import('../src/admin/DishesView.vue')
    let release
    vi.stubGlobal(
      'fetch',
      vi.fn((url) =>
        url.endsWith('/api/images')
          ? new Promise((resolve) => (release = () => resolve(new Response(JSON.stringify({ image: UP }), { status: 201 }))))
          : Promise.resolve(new Response('{}')),
      ),
    )
    const dishOf = (id, name) => ({ id, name, shop: null, category: '家常菜', meals: ['dinner'], tags: [], price: null, description: null, image: null, enabled: true, scope: 'general', author: null })
    const menu = { meals: MEALS, dishes: [dishOf('a', 'A 菜'), dishOf('b', 'B 菜')] }
    const w = mount(DishesView, { props: { menu } })
    const editButton = (i) => w.findAll('.dish-row')[i].findAll('button').find((b) => b.text() === '改')
    await editButton(0).trigger('click')
    await pickFile(w)
    await editButton(1).trigger('click')
    expect(w.find('form.dish-form h2').text()).toBe('改：B 菜')
    release()
    await flushPromises()
    expect(w.find('.image-preview').exists()).toBe(false)
    await w.find('form.dish-form').trigger('submit')
    expect(w.find('form.dish-form h2').text()).toBe('改：B 菜')
  })

  it('换了一张图（比如表单换成另一道菜）：上一张显示失败的提示清掉，新图照常显示', async () => {
    const other = `up_${'b'.repeat(32)}.webp`
    const w = mount(ImageField, { props: { modelValue: UP, upload: vi.fn() } })
    await w.find('img').trigger('error')
    expect(w.find('img').exists()).toBe(false)
    await w.setProps({ modelValue: other })
    expect(w.find('img').attributes('src')).toContain(other)
  })

  it('原图太大（超过 40 MB）直接拦住，不去解码', async () => {
    const actual = await vi.importActual('../src/ui/compress-image.js')
    const huge = { size: actual.MAX_INPUT_BYTES + 1, type: 'image/jpeg' }
    await expect(actual.compressImage(huge)).rejects.toThrow('太大')
  })
})

describe('管理页的图片存储进度条', () => {
  const GB = 1000 ** 3
  async function mountBar(storage) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(storage))))
    const { default: StorageBar } = await import('../src/admin/StorageBar.vue')
    const w = mount(StorageBar)
    await flushPromises()
    return w
  }
  const base = { available: true, limitBytes: 10 * GB, uploadLimit: 1000, uploadAttempts: 0, uploadResetsAt: null }

  it('显示已用多少（十进制 GB）、几张、本轮上传次数和重新计的时间；进度条宽度、名字对得上', async () => {
    const resetsAt = new Date(2026, 10, 12, 21, 30).getTime()
    const w = await mountBar({ ...base, usedBytes: 2.5 * GB, objects: 1234, uploadAttempts: 7, uploadResetsAt: resetsAt })
    expect(w.text()).toContain('已用 2.50 GB / 10.00 GB（25%），共 1234 张图片')
    expect(w.text()).toContain('全站上传次数每轮最多 1000 次（传失败的也算）：这一轮已用 7 次，11/12 21:30 后重新计')
    expect(w.find('.fill').attributes('style')).toContain('width: 25%')
    expect(w.find('.bar').classes()).not.toContain('warn')
    const bar = w.find('[role="progressbar"]')
    expect(bar.attributes('aria-valuenow')).toBe('25')
    expect(w.find(`#${bar.attributes('aria-labelledby')}`).text()).toBe('图片存储')
  })

  it('用量很少时显示“不到 0.1%”；到 80% 变橙色并提醒（8 GB 正好 80%）', async () => {
    let w = await mountBar({ ...base, usedBytes: 300 * 1000, objects: 2 })
    expect(w.text()).toContain('已用 300.0 KB / 10.00 GB（不到 0.1%）')
    expect(w.text()).not.toContain('重新计')
    w.unmount()
    w = await mountBar({ ...base, usedBytes: 8 * GB, objects: 9 })
    expect(w.text()).toContain('（80%）')
    expect(w.find('.bar').classes()).toContain('warn')
    expect(w.text()).toContain('免费额度快用完了')
  })

  it('还没开通：说清楚；读不到：显示原因', async () => {
    let w = await mountBar({ available: false, limitBytes: 10 * GB })
    expect(w.text()).toContain('图片存储还没开通')
    w.unmount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '只有管理员能做这件事' }), { status: 403 })))
    const { default: StorageBar } = await import('../src/admin/StorageBar.vue')
    w = mount(StorageBar)
    await flushPromises()
    expect(w.find('.error').text()).toContain('只有管理员能做这件事')
  })
})
