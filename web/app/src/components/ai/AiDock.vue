<script setup lang="ts">
/**
 * @fileoverview 助手在页面右下角的那一坨：按钮与展开后的面板。
 *
 * ⚠ 三道闸串起来才决定它出不出现：没装前端适配（`installAiAssistant` 没调）、
 * 这套部署没有 ai-assistant 服务、这个账号没有 `assistant:use`——任一条成立
 * 都是干净地不出现，而不是出现一个点了报错的按钮。
 */
import { ref } from 'vue'
import { PERMISSION_CODES } from '@dt/contracts'

import AiAssistantPanel from '@/components/ai/AiAssistantPanel.vue'
import AiCoreIcon from '@/components/ai/AiCoreIcon.vue'
import PermGuard from '@/components/PermGuard.vue'
import type { AiPanel } from '@/composables/useAiPanel'

defineProps<{
  ai: AiPanel
  /** 给人看的页面名，进提示词。 */
  surfaceLabel: string
  /** 摆在输入框上方的一句提醒，各页面自己给。 */
  hint: string
}>()

// ⚠ 放大不是装饰：助手的回答里常有表格与代码块，26rem 宽的话它们只能在自己的
// 框里横向滚，读一行要来回拖两次
const isWide = ref(false)
</script>

<template>
  <PermGuard :codes="[PERMISSION_CODES.assistantUse]">
    <div v-if="ai.isAvailable.value" class="ai-dock ai-surface">
      <button
        v-if="!ai.isOpen.value"
        type="button"
        class="ai-dock__call"
        aria-label="打开 AI 助手"
        @click="() => void ai.open()"
      >
        <AiCoreIcon :size="52" />
      </button>
      <div v-else class="ai-dock__panel" :class="{ 'is-wide': isWide }">
        <AiAssistantPanel
          :chat="ai.chat"
          :surface-label="surfaceLabel"
          :hint="hint"
          :is-wide="isWide"
          @toggle-wide="isWide = !isWide"
          @close="ai.close"
        />
      </div>
    </div>
  </PermGuard>
</template>

<style scoped lang="scss">
.ai-dock {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: var(--z-assistant);
}

/* 收起时的入口：机器人本体就是按钮。它自带不透明软壳与投影，
   在任意底色的画布上都立得住，不再另垫圆底——垫了反而像贴纸。 */
.ai-dock__call {
  position: relative;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: var(--radius-lg);
  background: transparent;
  cursor: pointer;
  transition: transform 0.15s ease;
}

/* 一圈呼吸的紫色光晕。⚠ 铺在机器人**背后**（负 z）而不是描边：描边会跟着
   按钮的方角走，而机器人本体是圆的，两个形状对不上。 */
.ai-dock__call::before {
  content: '';
  position: absolute;
  inset: -35%;
  z-index: -1;
  border-radius: 50%;
  background: var(--ai-halo);
  animation: ai-dock-halo 3.2s ease-in-out infinite;
}

.ai-dock__call:hover {
  transform: translateY(-2px);
}

@keyframes ai-dock-halo {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.94);
  }

  50% {
    opacity: 1;
    transform: scale(1.06);
  }
}

.ai-dock__call:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.ai-dock__panel {
  width: min(26rem, calc(100vw - 2rem));
  height: min(34rem, calc(100vh - 6rem));
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--ai-glow);
  /* ⚠ 这一层是整块面板的**不透明底**。面板自己用的是 `--surface-panel`
     （半透明）——那是给「页面里的面板」定的，底下永远压着应用自己的深色背景。
     助手是浮在画布上的，不垫一层不透明底，画布会直接透上来把字压没。
     渐变的最后一层就是那块不透明底，两束紫光叠在它上面。 */
  background: var(--ai-grad-panel);
}

.ai-dock__panel.is-wide {
  width: min(46rem, calc(100vw - 2rem));
  height: min(46rem, calc(100vh - 6rem));
}

@media (prefers-reduced-motion: reduce) {
  .ai-dock__call {
    transition: none;
  }

  .ai-dock__call:hover {
    transform: none;
  }

  .ai-dock__call::before {
    animation: none;
  }
}
</style>
