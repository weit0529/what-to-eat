<!--
  根组件：页面的整体框架。菜单数据来自 data/menu.xlsx，
  由 npm run menu 转换成 src/generated/menu.json 后在这里读入。
-->
<script setup>
import menu from './generated/menu.json'
import DrawPage from './components/DrawPage.vue'

// Logo 放在 public/ 下，按相对路径取，发布到 GitHub Pages 的子路径也能找到
const logoUrl = `${import.meta.env.BASE_URL}logo.png`
</script>

<template>
  <!-- 顶栏占满整个宽度（深绿），下面的内容限宽居中 -->
  <header class="app-header">
    <h1 class="title">
      <img class="logo" :src="logoUrl" alt="" width="40" height="40" />
      <span>今天吃什么？</span>
    </h1>
  </header>

  <div class="app">
    <main>
      <DrawPage :items="menu.items" :meals="menu.meals" />
    </main>

    <footer class="app-footer">菜单共 {{ menu.items.length }} 道</footer>
  </div>
</template>

<style scoped>
.app {
  max-width: 560px;
  margin: 0 auto;
  padding: 20px 16px 32px;
}

/* 顶栏：Logo 的深绿底，和 Logo 自己的底色一样，Logo 看起来融在顶栏里 */
.app-header {
  padding: 20px 16px;
  background: var(--brand-dark);
  color: var(--brand-cream);
  text-align: center;
}

.app-header h1 {
  /* Logo 和标题文字垂直居中，整体在页面中间 */
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 800;
  line-height: 1.3;
}

.logo {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-inner);
}

.app-footer {
  margin-top: 32px;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
</style>
