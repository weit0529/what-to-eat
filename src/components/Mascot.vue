<!--
  小吉祥物“饭团”：一个眯眼笑、脸红红的白饭团，坐在黄色的小饭碗里。
  按用户给的参考图用 SVG 线条画出来（不是贴图片），放大缩小都清楚。
  用法：<Mascot mood="happy" />
    mood：happy（平时，不动）/ excited（抽取中，抖得欢）/ cheer（抽中了，蹦一下）
    平时不做一直在动的装饰动画，只在抽取、抽中时给反馈（用户 2026-11-06 同意 de-slop 第 7 条）
    flip：是否左右翻转（放在按钮右边时用）
-->
<script setup>
import { useId } from 'vue'

const props = defineProps({
  mood: { type: String, default: 'happy' },
  flip: { type: Boolean, default: false },
})

// 颜色。想换配色改这里
const COLOR = {
  line: '#4a4544', // 描边
  rice: '#ffffff', // 饭团
  blush: '#f7a8b4', // 腮红
  bowlInside: '#f7f2e3', // 碗内壁
  bowl: '#fbe9a6', // 碗身
  band: '#f2cf4c', // 碗上的黄色宽条
  foot: '#f4f1ea', // 碗底座
}

// 页面上有两个吉祥物，裁剪区域的 id 不能重复
const clipId = `mascot-bowl-${useId()}`
</script>

<template>
  <span class="mascot" :class="[mood, { flip: props.flip }]" aria-hidden="true">
    <svg viewBox="0 0 120 108" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <!-- 碗身的形状，用来把黄色宽条裁在碗里面 -->
        <clipPath :id="clipId">
          <path d="M6 58 A54 13 0 0 0 114 58 C112 86 90 98 60 98 C30 98 8 86 6 58 Z" />
        </clipPath>
      </defs>

      <!-- 1. 碗口后半圈（碗的内壁），画在饭团后面 -->
      <ellipse cx="60" cy="58" rx="54" ry="13" :fill="COLOR.bowlInside" :stroke="COLOR.line" stroke-width="4" />

      <!-- 2. 饭团：圆圆的白色脸 -->
      <g class="rice">
        <ellipse cx="60" cy="49" rx="30" ry="29" :fill="COLOR.rice" :stroke="COLOR.line" stroke-width="4" />
        <!-- 眯着的眼睛：两条往外下斜的短线 -->
        <path d="M42 42 Q47 41 52 45" fill="none" :stroke="COLOR.line" stroke-width="3.6" stroke-linecap="round" />
        <path d="M68 45 Q73 41 78 42" fill="none" :stroke="COLOR.line" stroke-width="3.6" stroke-linecap="round" />
        <!-- 腮红 -->
        <ellipse cx="41" cy="54" rx="6" ry="3.5" :fill="COLOR.blush" />
        <ellipse cx="79" cy="54" rx="6" ry="3.5" :fill="COLOR.blush" />
        <!-- ω 形的小嘴 -->
        <path
          d="M52 51 Q54 57 60 53 Q66 57 68 51"
          fill="none"
          :stroke="COLOR.line"
          stroke-width="3.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </g>

      <!-- 3. 碗底座 -->
      <path d="M44 95 L46 104 Q60 107 74 104 L76 95 Z" :fill="COLOR.foot" :stroke="COLOR.line" stroke-width="4" stroke-linejoin="round" />

      <!-- 4. 碗身（挡住饭团下半部分），中间一条更深的黄色宽条 -->
      <path d="M6 58 A54 13 0 0 0 114 58 C112 86 90 98 60 98 C30 98 8 86 6 58 Z" :fill="COLOR.bowl" />
      <path
        d="M0 70 Q60 88 120 70 L120 83 Q60 101 0 83 Z"
        :fill="COLOR.band"
        :clip-path="`url(#${clipId})`"
      />
      <path
        d="M6 58 A54 13 0 0 0 114 58 C112 86 90 98 60 98 C30 98 8 86 6 58 Z"
        fill="none"
        :stroke="COLOR.line"
        stroke-width="4"
        stroke-linejoin="round"
      />
    </svg>
  </span>
</template>

<style scoped>
.mascot {
  display: inline-block;
  width: 60px;
  height: 54px;
  flex: none;
}

.mascot svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.flip svg {
  transform: scaleX(-1);
}

.excited {
  animation: shake 0.18s linear infinite;
}

.cheer {
  animation: hop 0.4s ease-out 1;
}

/* 抽取中，饭团在碗里左右晃 */
.excited .rice {
  transform-origin: 60px 60px;
  animation: wiggle 0.3s ease-in-out infinite;
}

@keyframes shake {
  0%,
  100% {
    transform: rotate(-5deg);
  }
  50% {
    transform: rotate(5deg);
  }
}

@keyframes hop {
  0%,
  100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-12px) rotate(-4deg);
  }
}

@keyframes wiggle {
  0%,
  100% {
    transform: rotate(-8deg);
  }
  50% {
    transform: rotate(8deg);
  }
}
</style>
