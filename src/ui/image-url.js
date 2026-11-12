// 菜的图片地址（阶段 4-4d）：在线上传的（up_ 开头）从后台取，其他的是随网站发布的 public/images/ 里的文件。
// 文件名要编码，否则带 #、%、空格等字符的文件名会被浏览器误读。
// BASE_URL 是网站的根路径（见 vite.config.js 的 base），发布到 GitHub Pages 子目录时也能找到。
import { API_BASE } from '../config.js'
import { isUploadedImage } from '../core/menu-data.js'

export function imageUrlOf(name) {
  if (!name) return null
  if (isUploadedImage(name)) return `${API_BASE}/api/images/${name}`
  return `${import.meta.env.BASE_URL}images/${encodeURIComponent(name)}`
}
