// Vite 配置：开发服务器、构建、测试都读这个文件
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 用相对路径打包。这样不管 GitHub 仓库叫什么名字，
  // 发布到 https://<用户名>.github.io/<仓库名>/ 都能正确加载资源
  base: './',

  plugins: [vue()],

  // 四个页面：正式网站；连通测试页（/connectivity-test/，4-1）；管理页（/admin/，4-2）；账号页（/account/，4-3）。
  // 只有账号页在正式网站底部有入口
  build: {
    // 腾讯云 SDK 单独一个文件约 855KB（压缩传输约 211KB），只在用到时才下载，不影响首页；提高提醒阈值免得每次构建都报
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        connectivity: fileURLToPath(new URL('./connectivity-test/index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin/index.html', import.meta.url)),
        account: fileURLToPath(new URL('./account/index.html', import.meta.url)),
      },
    },
  },

  // Vitest 测试配置：用 jsdom 模拟浏览器，页面组件也能在 Node 里测试
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
  },
})
