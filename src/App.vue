<!--
  根组件：页面的整体框架。菜单数据来自 data/menu.xlsx，
  由 npm run menu 转换成 src/generated/menu.json 后在这里读入。
-->
<script setup>
import menu from './generated/menu.json'
import DrawPage from './components/DrawPage.vue'
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1>
        <span class="title-emoji left" aria-hidden="true">🍜</span>
        今天吃什么？
        <span class="title-emoji right" aria-hidden="true">🤔</span>
      </h1>
      <p class="subtitle">选择困难？交给我！<span aria-hidden="true"> 🎲</span></p>
    </header>

    <main>
      <DrawPage :items="menu.items" :meals="menu.meals" />
    </main>

    <footer class="app-footer">
      菜单共 {{ menu.items.length }} 道<span aria-hidden="true"> · 好好吃饭 💪</span>
    </footer>
  </div>
</template>

<style scoped>
.app {
  max-width: 560px;
  margin: 0 auto;
  padding: 28px 16px 36px;
}

.app-header {
  text-align: center;
  margin-bottom: 22px;
}

.app-header h1 {
  margin: 0;
  font-size: 2.1rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  color: var(--accent-dark);
  /* 有点立体感的标题 */
  text-shadow: 3px 3px 0 var(--yellow);
}

.title-emoji {
  display: inline-block;
  text-shadow: none;
}

.title-emoji.left {
  animation: wobble 2.4s ease-in-out infinite;
}

.title-emoji.right {
  animation: wobble 2.4s ease-in-out 1.2s infinite;
}

@keyframes wobble {
  0%,
  100% {
    transform: rotate(0);
  }
  25% {
    transform: rotate(-12deg);
  }
  75% {
    transform: rotate(12deg);
  }
}

.subtitle {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 1rem;
}

.app-footer {
  margin-top: 36px;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
}
</style>
