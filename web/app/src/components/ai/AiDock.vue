<script setup lang="ts">
/**
 * @fileoverview 助手在页面右下角的那一坨：按钮与展开后的面板，外加 ⌘I 开合。
 *
 * ⚠ 三道闸串起来才决定它出不出现：没装前端适配（`installAiAssistant` 没调）、
 * 这套部署没有 ai-assistant 服务、这个账号没有 `assistant:use`——任一条成立
 * 都是干净地不出现，而不是出现一个点了报错的按钮。
 *
 * ⚠ window 监听用 AbortController 持有并在卸载时 abort：挂它的页面是会被
 * 切走的路由，留下的监听会在别的页面上继续吞掉 ⌘I。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { PERMISSION_CODES } from '@dt/contracts'

import AiAssistantPanel from '@/components/ai/AiAssistantPanel.vue'
import AiCoreIcon from '@/components/ai/AiCoreIcon.vue'
import PermGuard from '@/components/PermGuard.vue'
import type { AiPanel } from '@/composables/useAiPanel'
import { isAssistantToggle, modLabelOf } from '@/features/ai/composeKeys'

const props = defineProps<{
  ai: AiPanel
  /** 给人看的页面名，进提示词。 */
  surfaceLabel: string
  /** 摆在输入框上方的一句提醒，各页面自己给。 */
  hint: string
  /** 空态里可点的几句开场，各页面按自己的能力给。 */
  starters?: readonly string[] | undefined
}>()

// ⚠ 放大不是装饰：助手的回答里常有表格与代码块，26rem 宽的话它们只能在自己的
// 框里横向滚，读一行要来回拖两次
const isWide = ref(false)

const modKey = modLabelOf(navigator.platform)

/** ⌘I / Ctrl+I 开合。权限闸在 PermGuard，这里只看「这套部署有没有助手」。 */
function onGlobalKey(event: KeyboardEvent): void {
  if (!isAssistantToggle(event) || !props.ai.isAvailable.value) return
  event.preventDefault()
  if (props.ai.isOpen.value) props.ai.close()
  else void props.ai.open()
}

let listeners: AbortController | null = null

onMounted(() => {
  listeners = new AbortController()
  window.addEventListener('keydown', onGlobalKey, {
    signal: listeners.signal,
  })
})

onUnmounted(() => {
  listeners?.abort()
  listeners = null
})
</script>

<template>
  <PermGuard :codes="[PERMISSION_CODES.assistantUse]">
    <div v-if="ai.isAvailable.value" class="ai-dock">
      <button
        v-if="!ai.isOpen.value"
        type="button"
        class="ai-dock__call"
        aria-label="打开 AI 助手"
        :title="`AI 助手（${modKey}I）`"
        @click="() => void ai.open()"
      >
        <AiCoreIcon :size="52" />
      </button>
      <div v-else class="ai-dock__panel" :class="{ 'is-wide': isWide }">
        <span
          v-for="corner in ['tl', 'tr', 'bl', 'br']"
          :key="corner"
          class="ai-dock__corner"
          :class="`ai-dock__corner--${corner}`"
          aria-hidden="true"
        />
        <AiAssistantPanel
          :chat="ai.chat"
          :compose="ai.compose"
          :surface-label="surfaceLabel"
          :hint="hint"
          :starters="starters"
          :is-wide="isWide"
          :models="ai.models.value"
          :choice="ai.choice.value"
          @pick="(value) => void ai.pickModel(value)"
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

/* 一圈呼吸的强调色光晕，跟着主题走。⚠ 铺在机器人**背后**（负 z）而不是描边：
   描边会跟着按钮的方角走，而机器人本体是圆的，两个形状对不上。 */
.ai-dock__call::before {
  content: '';
  position: absolute;
  inset: -35%;
  z-index: -1;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(var(--accent-primary-rgb), 0.4),
    rgba(var(--accent-primary-rgb), 0.1) 55%,
    transparent 72%
  );
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

/* 浮层配方与全局一致（overlay 底 + 毛玻璃 + 弹层投影），面板才像这个产品
   自己的东西。overlay 有一丝透，毛玻璃把透上来的画布糊成一层底纹，字压不花。 */
.ai-dock__panel {
  position: relative;
  width: min(26rem, calc(100vw - 2rem));
  height: min(34rem, calc(100vh - 6rem));
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--surface-overlay);
  backdrop-filter: blur(10px);
  box-shadow:
    var(--fx-shadow-modal),
    0 0 0 1px rgba(var(--accent-primary-rgb), 0.08);
  animation: ai-dock-in 0.22s ease;
  transform-origin: bottom right;
}

/* ——不支持毛玻璃的环境退回实底，字不能压在画布上 */
@supports not (backdrop-filter: blur(1px)) {
  .ai-dock__panel {
    background: var(--surface-base);
  }
}

.ai-dock__panel.is-wide {
  width: min(46rem, calc(100vw - 2rem));
  height: min(46rem, calc(100vh - 6rem));
}

@keyframes ai-dock-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
}

/* 四角发光角标，与 DtCard 的 corners 同一副面孔（--card-corner-* 同源），
   主题关掉角标时这里跟着消失 */
.ai-dock__corner {
  position: absolute;
  z-index: 1;
  display: var(--card-corner-display);
  width: 10px;
  height: 10px;
  box-shadow: 0 0 var(--card-corner-glow) var(--card-corner-color);
  opacity: 0.9;
  pointer-events: none;
}

.ai-dock__corner--tl {
  top: 0;
  left: 0;
}

.ai-dock__corner--tr {
  top: 0;
  right: 0;
}

.ai-dock__corner--bl {
  bottom: 0;
  left: 0;
}

.ai-dock__corner--br {
  right: 0;
  bottom: 0;
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

  .ai-dock__panel {
    animation: none;
  }
}
</style>
