<script setup lang="ts">
/**
 * @fileoverview DtModal —— 对话框。Teleport 到 body，自带焦点陷阱与 Esc 关闭。
 *
 * ⚠ 三条无障碍硬要求：打开时焦点进入弹窗、Tab 不许跑出去、关闭后焦点归还
 * 触发元素。少任何一条，键盘用户都会在弹窗打开后「焦点消失」。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import DtButton from '../DtButton/DtButton.vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title: string
    description?: string | undefined
    width?: string
    closeOnBackdrop?: boolean
  }>(),
  { width: '30rem', closeOnBackdrop: true },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const panel = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),' +
  'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

function close(): void {
  emit('update:modelValue', false)
}

function focusables(): HTMLElement[] {
  return Array.from(panel.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
}

/** 焦点陷阱：Tab 到末尾回到首项，Shift+Tab 到首项回到末项。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const items = focusables()
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return
  const active = document.activeElement
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null
      await nextTick()
      ;(focusables()[0] ?? panel.value)?.focus()
      return
    }
    previouslyFocused?.focus()
    previouslyFocused = null
  },
)

// 组件在弹窗开着时被卸载（路由切走）也要把焦点还回去
onBeforeUnmount(() => {
  previouslyFocused?.focus()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="dt-modal" @keydown="onKeydown">
      <div class="dt-modal__backdrop" @click="closeOnBackdrop && close()" />
      <div
        ref="panel"
        class="dt-modal__panel"
        :style="{ width }"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
      >
        <header class="dt-modal__head">
          <div>
            <h2 class="dt-modal__title">{{ title }}</h2>
            <p v-if="description" class="dt-modal__desc">{{ description }}</p>
          </div>
          <DtButton
            variant="ghost"
            intent="neutral"
            size="sm"
            icon="close"
            aria-label="关闭"
            @click="close"
          />
        </header>

        <div class="dt-modal__body"><slot /></div>

        <footer v-if="$slots.footer" class="dt-modal__foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.dt-modal {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;

  &__backdrop {
    position: absolute;
    inset: 0;
    background: var(--fx-scrim);
    backdrop-filter: blur(2px);
  }

  &__panel {
    position: relative;
    display: flex;
    flex-direction: column;
    max-width: 100%;
    max-height: 100%;
    overflow: hidden;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    background: var(--surface-overlay);
    box-shadow: var(--fx-shadow-modal);
  }

  &__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 20px 12px;
    border-bottom: 1px solid var(--border-subtle);
  }

  &__title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 600;
    color: var(--text-title);
  }

  &__desc {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--text-disabled);
  }

  &__body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 20px;
  }

  &__foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px 18px;
    border-top: 1px solid var(--border-subtle);
  }
}
</style>
