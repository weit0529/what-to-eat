// Vite 配置：开发服务器、构建、测试都读这个文件
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 用相对路径打包。这样不管 GitHub 仓库叫什么名字，
  // 发布到 https://<用户名>.github.io/<仓库名>/ 都能正确加载资源
  base: './',

  plugins: [vue()],

  // Vitest 测试配置：用 jsdom 模拟浏览器，页面组件也能在 Node 里测试
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
  },
})
