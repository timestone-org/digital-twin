<script setup lang="ts">
/**
 * @fileoverview 助手的脸：会浮动、眨眼、环视的机器人图标。
 * 入口球、面板徽标、空态共用这一张；本体标记在 AiCoreFigure，
 * 动画在这里的 scoped 样式里（SVG 自带的内嵌样式标签是文档级全局的，
 * 类名会殃及整页，所以不原样内联原稿）。
 */
import { useId } from 'vue'

import AiCoreFigure from '@/components/ai/AiCoreFigure.vue'

withDefaults(
  defineProps<{
    /** 边长（px），图是方的。 */
    size?: number
  }>(),
  { size: 48 },
)

// ⚠ SVG 的渐变/滤镜 id 是文档级全局的：同屏两份实例若同名，
// 后一份会引用到前一份的 defs 上，所以每份实例带自己的前缀
const uid = useId()
</script>

<template>
  <svg
    class="ai-core"
    :width="size"
    :height="size"
    viewBox="0 0 256 256"
    fill="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient
        :id="`${uid}-shell`"
        x1="66"
        y1="55"
        x2="196"
        y2="208"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#D8FCFF" />
        <stop offset=".2" stop-color="#7DE3EC" />
        <stop offset=".55" stop-color="#23A7C1" />
        <stop offset="1" stop-color="#0D5E7B" />
      </linearGradient>
      <linearGradient
        :id="`${uid}-shellEdge`"
        x1="48"
        y1="52"
        x2="208"
        y2="211"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#B9FDFF" />
        <stop offset=".45" stop-color="#31DCEB" />
        <stop offset="1" stop-color="#187FD1" />
      </linearGradient>
      <linearGradient
        :id="`${uid}-face`"
        x1="75"
        y1="87"
        x2="183"
        y2="176"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#173F52" />
        <stop offset=".5" stop-color="#071C29" />
        <stop offset="1" stop-color="#0A3041" />
      </linearGradient>
      <linearGradient
        :id="`${uid}-eye`"
        x1="0"
        y1="106"
        x2="0"
        y2="149"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#FAFFFF" />
        <stop offset="1" stop-color="#79F0F7" />
      </linearGradient>
      <linearGradient
        :id="`${uid}-scanLight`"
        x1="0"
        y1="0"
        x2="34"
        y2="0"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#E8FFFF" stop-opacity="0" />
        <stop offset=".5" stop-color="#E8FFFF" stop-opacity=".72" />
        <stop offset="1" stop-color="#E8FFFF" stop-opacity="0" />
      </linearGradient>
      <filter
        :id="`${uid}-shadow`"
        x="15"
        y="12"
        width="226"
        height="232"
        filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB"
      >
        <feDropShadow
          dx="0"
          dy="10"
          stdDeviation="10"
          flood-color="#00101A"
          flood-opacity=".48"
        />
      </filter>
      <filter
        :id="`${uid}-eyeGlow`"
        x="66"
        y="94"
        width="124"
        height="70"
        filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB"
      >
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <clipPath :id="`${uid}-faceClip`">
        <rect x="63" y="82" width="130" height="98" rx="49" />
      </clipPath>
    </defs>

    <AiCoreFigure :uid="uid" />
  </svg>
</template>

<style scoped lang="scss">
/* 整体偏色。⚠ 图里那几十个渐变端点是硬编码的青蓝，一个个换成变量既繁琐又
   容易漏掉一两个（漏掉的那个只有人眼看得出来）。整张图统一转色调是本仓已有的
   做法——装饰位图那一路就是靠 `--fx-decor-filter` 做的，理由见 tokens.scss。
   缺省 `none`：不在助手那块紫玻璃里时，它仍是原色。 */
.ai-core {
  filter: var(--ai-figure-filter, none);
}

/* 动画的目标都在子件 AiCoreFigure 里，一律 :deep 打进去 */
.ai-core :deep(.bot),
.ai-core :deep(.eyes),
.ai-core :deep(.pupils),
.ai-core :deep(.shine),
.ai-core :deep(.signal-dot),
.ai-core :deep(.signal-ring) {
  transform-box: fill-box;
}

.ai-core :deep(.bot) {
  transform-origin: center;
  animation: ai-float 4s ease-in-out infinite;
}

.ai-core :deep(.eyes) {
  transform-origin: center;
  animation: ai-blink 5.2s ease-in-out infinite;
}

.ai-core :deep(.pupils) {
  animation: ai-look 5.2s ease-in-out infinite;
}

.ai-core :deep(.shine) {
  animation: ai-scan 4.2s ease-in-out infinite;
}

.ai-core :deep(.signal-dot) {
  transform-origin: center;
  animation: ai-pulse 1.8s ease-in-out infinite;
}

.ai-core :deep(.signal-ring) {
  transform-origin: center;
  animation: ai-ripple 1.8s ease-out infinite;
}

/* 悬停时更来劲：浮得更快、眼睛转得更勤 */
.ai-core:hover :deep(.bot) {
  animation-duration: 2.2s;
}

.ai-core:hover :deep(.pupils) {
  animation-duration: 2.6s;
}

@keyframes ai-float {
  0%,
  100% {
    transform: translateY(3px);
  }

  50% {
    transform: translateY(-5px);
  }
}

@keyframes ai-blink {
  0%,
  40%,
  44%,
  74%,
  78%,
  100% {
    transform: scaleY(1);
  }

  42%,
  76% {
    transform: scaleY(0.09);
  }
}

@keyframes ai-look {
  0%,
  18%,
  100% {
    transform: translate(0, 0);
  }

  28%,
  40% {
    transform: translate(5px, -1px);
  }

  50%,
  64% {
    transform: translate(-5px, 1px);
  }

  75%,
  90% {
    transform: translate(1px, 0);
  }
}

@keyframes ai-scan {
  0% {
    transform: translateX(-132px);
    opacity: 0;
  }

  18%,
  72% {
    opacity: 0.4;
  }

  100% {
    transform: translateX(144px);
    opacity: 0;
  }
}

@keyframes ai-pulse {
  0%,
  100% {
    transform: scale(0.85);
    opacity: 0.75;
  }

  50% {
    transform: scale(1.15);
    opacity: 1;
  }
}

@keyframes ai-ripple {
  0% {
    transform: scale(0.7);
    opacity: 0.7;
  }

  100% {
    transform: scale(1.7);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-core :deep(.bot),
  .ai-core :deep(.eyes),
  .ai-core :deep(.pupils),
  .ai-core :deep(.shine),
  .ai-core :deep(.signal-dot),
  .ai-core :deep(.signal-ring) {
    animation: none !important;
  }
}
</style>
