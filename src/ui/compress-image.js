// 上传前在浏览器里压缩图片（阶段 4-4d，REQUIREMENTS.md R-030）：最长边缩到 1024 像素，压到约 200 KB 以内。
// 重新画一遍再导出，手机照片里的拍摄地点等信息（EXIF）也一起去掉了。
// 优先导出 webp；浏览器不支持导出 webp（导出来的不是 webp）时改用 jpg。

export const MAX_SIDE = 1024
export const MAX_BYTES = 200 * 1024
/**
 * 太大的原图先拦住（Codex 第 41 轮：整张解码很吃内存，手机上可能卡死或被系统关掉）：
 * 文件超过 40 MB 不打开；打开后超过 5000 万像素（如 8000×6250）也不处理
 */
export const MAX_INPUT_BYTES = 40 * 1024 * 1024
export const MAX_INPUT_PIXELS = 50_000_000
const TOO_BIG = '这张图片太大了，先在手机上缩小一点（或截个图）再传'
const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45]
/** 最低质量还是太大时，图片再缩小到原来的几分之几，最多缩几次 */
const SHRINK = 0.75
const MAX_SHRINKS = 4

/**
 * 找一个够小的导出结果：从高质量往低试，还太大就把尺寸缩小再试。
 * @param {(scale: number, quality: number) => Promise<Blob>} encode  按尺寸比例和质量导出一张图
 * @returns {Promise<Blob>} 不超过 maxBytes 的图片；实在压不下去就抛错
 */
export async function fitUnder(encode, maxBytes = MAX_BYTES) {
  let scale = 1
  for (let round = 0; round <= MAX_SHRINKS; round++) {
    for (const quality of QUALITIES) {
      const blob = await encode(scale, quality)
      if (blob.size <= maxBytes) return blob
    }
    scale *= SHRINK
  }
  throw new Error('这张图片压不到 200 KB 以内，换一张试试')
}

/** 把图片文件读成可以画的东西；读不了（不是图片、格式不支持）就抛错 */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // 有的浏览器不认这个参数，下面换老办法
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

const toBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('导出图片失败'))), type, quality))

/**
 * 压缩一张用户选的图片。
 * @param {File} file
 * @returns {Promise<Blob>} webp 或 jpg，最长边不超过 1024 像素、不超过 200 KB
 */
export async function compressImage(file) {
  if (file.size > MAX_INPUT_BYTES) throw new Error(TOO_BIG)
  let source
  try {
    source = await decode(file)
  } catch {
    throw new Error('打不开这个文件：要选 jpg、png、webp 之类的图片')
  }
  const width = source.width || source.naturalWidth
  const height = source.height || source.naturalHeight
  if (!width || !height) throw new Error('打不开这个文件：要选 jpg、png、webp 之类的图片')
  if (width * height > MAX_INPUT_PIXELS) {
    source.close?.()
    throw new Error(TOO_BIG)
  }
  const base = Math.min(1, MAX_SIDE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  let type = 'image/webp'

  const encode = async (scale, quality) => {
    canvas.width = Math.max(1, Math.round(width * base * scale))
    canvas.height = Math.max(1, Math.round(height * base * scale))
    const ctx = canvas.getContext('2d')
    // 透明的 png 转 jpg 时透明处会变黑，先铺一层白底
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    let blob = await toBlob(canvas, type, quality)
    if (blob.type !== type) {
      // 这个浏览器导不出 webp（会给 png），改用 jpg
      type = 'image/jpeg'
      blob = await toBlob(canvas, type, quality)
    }
    return blob
  }

  try {
    return await fitUnder(encode)
  } finally {
    source.close?.()
  }
}
