<script setup lang="ts">
/**
 * @fileoverview 消息条的渲染宿主。全应用挂一次（App.vue），业务侧用 useToast 推送。
 */
import type { DtIntent } from '@dt/contracts'
import DtButton from '../DtButton/DtButton.vue'
import DtIcon from '../DtIcon/DtIcon.vue'
import { useToast } from '../../composables/useToast'

const { toasts, dismiss } = useToast()

const ICONS: Record<DtIntent, string> = {
  primary: 'activity',
  info: 'activity',
  success: 'check',
  warning: 'alert-triangle',
  danger: 'alert-circle',
  neutral: 'activity',
}

const ACCENT: Record<DtIntent, string> = {
  primary: '--accent-primary-rgb',
  info: '--state-info-rgb',
  success: '--state-success-rgb',
  warning: '--state-warning-rgb',
  danger: '--state-danger-rgb',
  neutral: '--neutral-fg-rgb',
}
</script>

<template>
  <Teleport to="body">
    <!--
      ⚠ 外层是 polite live region，aria-atomic=false 保证只播报新增的那一条，
      而不是每次都把整个堆叠重念一遍。
    -->
    <div class="dt-toasts" role="status" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="dt-toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="dt-toast"
          :style="{ '--_t-rgb': `var(${ACCENT[toast.intent]})` }"
          :role="
            toast.intent === 'danger' || toast.intent === 'warning'
              ? 'alert'
              : undefined
          "
        >
          <span class="dt-toast__badge">
            <DtIcon :name="ICONS[toast.intent]" :size="15" />
          </span>
          <div class="dt-toast__body">
            <p v-if="toast.title" class="dt-toast__title">{{ toast.title }}</p>
            <p class="dt-toast__text">{{ toast.message }}</p>
          </div>
          <DtButton
            variant="ghost"
            intent="neutral"
            size="sm"
            icon="close"
            aria-label="关闭消息"
            @click="dismiss(toast.id)"
          />
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-toasts {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 22rem;
  max-width: calc(100vw - 40px);
  // 容器常驻但不该吃指针；卡片自己再收回来
  pointer-events: none;
}

.dt-toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  pointer-events: auto;
  background: var(--surface-overlay);
  border: 1px solid rgba(var(--_t-rgb), 0.4);
  border-radius: var(--card-radius);
  box-shadow: 0 12px 36px -16px rgba(var(--_t-rgb), 0.6);
  backdrop-filter: blur(6px);

  &__badge {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    color: rgb(var(--_t-rgb));
    background: rgba(var(--_t-rgb), 0.14);
  }

  &__body {
    flex: 1;
    min-width: 0;
  }

  &__title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  &__text {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
}

.dt-toast-enter-active,
.dt-toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.dt-toast-enter-from,
.dt-toast-leave-to {
  opacity: 0;
  transform: translateX(12px);
}

// 离场时其余卡片平滑补位，不是瞬移
.dt-toast-move {
  transition: transform 0.2s ease;
}

@include ctl.reduced-motion {
  .dt-toast-enter-active,
  .dt-toast-leave-active,
  .dt-toast-move {
    transition: none;
  }
}
</style>
