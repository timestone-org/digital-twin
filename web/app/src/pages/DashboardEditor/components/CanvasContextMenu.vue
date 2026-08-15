<script setup lang="ts">
/**
 * @fileoverview 画布右键菜单浮层：贴边翻转后固定在落点，方向键与 Tab 在项间循环，
 * Esc / 点菜单外 / 画布滚动都收起。条目与置灰由 `../contextMenuItems` 算好。
 * ⚠ window 监听用 AbortController 持有，收起与卸载都 abort：编辑器一开就是几天，
 * 漏一次就留下一副永远跟着鼠标走的监听。
 * ⚠ 键盘事件在捕获阶段拦下并停传：编辑器的全局快捷键也挂在 window 上，
 * 不停传的话 Esc 会在关菜单的同时把选中一并清掉。
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

import type { ContextMenuAction } from '../contextMenuItems'
import { clampContextMenu } from '../contextMenuPosition'
import type { ContextMenuState } from '../useEditorContextMenu'

const props = defineProps<{ menu: ContextMenuState | null }>()
const emit = defineEmits<{ pick: [action: ContextMenuAction]; close: [] }>()

const rootEl = ref<HTMLElement | null>(null)

const style = computed<Record<string, string>>(() => {
  const menu = props.menu
  if (menu === null) return {}
  const at = clampContextMenu(
    menu.at.x,
    menu.at.y,
    window.innerWidth,
    window.innerHeight,
  )
  return { left: `${at.x}px`, top: `${at.y}px` }
})

/** 可聚焦的菜单项；置灰项不进焦点环。 */
function itemElements(): HTMLElement[] {
  const root = rootEl.value
  if (root === null) return []
  return [
    ...root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
  ]
}

function focusBy(step: 1 | -1): void {
  const items = itemElements()
  if (items.length === 0) return
  const active = document.activeElement
  const current = items.findIndex((item) => item === active)
  const next =
    current < 0
      ? step === 1
        ? 0
        : items.length - 1
      : (current + step + items.length) % items.length
  items[next]?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }
  const forward =
    event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)
  const backward =
    event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)
  if (!forward && !backward) return
  event.preventDefault()
  event.stopPropagation()
  focusBy(forward ? 1 : -1)
}

function onPointerDown(event: Event): void {
  const root = rootEl.value
  if (
    root !== null &&
    event.target instanceof Node &&
    root.contains(event.target)
  )
    return
  emit('close')
}

/** 画布一滚，落点就不再对着原来的节点，直接收起。 */
function onViewChange(): void {
  emit('close')
}

let listeners: AbortController | null = null

function stopListening(): void {
  listeners?.abort()
  listeners = null
}

function startListening(): void {
  stopListening()
  const controller = new AbortController()
  const on = { capture: true, signal: controller.signal }
  window.addEventListener('keydown', onKeydown, on)
  window.addEventListener('pointerdown', onPointerDown, on)
  window.addEventListener('scroll', onViewChange, on)
  window.addEventListener('resize', onViewChange, on)
  listeners = controller
}

watch(
  () => props.menu !== null,
  (isOpen) => {
    if (!isOpen) {
      stopListening()
      return
    }
    startListening()
    void nextTick(() => itemElements()[0]?.focus())
  },
  { immediate: true },
)

onUnmounted(stopListening)
</script>

<template>
  <Teleport v-if="menu !== null" to="body">
    <div
      ref="rootEl"
      class="dt-ctxmenu"
      role="menu"
      aria-label="画布右键菜单"
      :style="style"
      @contextmenu.prevent
    >
      <template v-for="(group, index) in menu.groups" :key="group.key">
        <hr v-if="index > 0" class="dt-ctxmenu__sep" role="separator" />
        <button
          v-for="item in group.items"
          :key="item.action"
          type="button"
          class="dt-ctxmenu__item"
          :class="{ 'dt-ctxmenu__item--danger': item.danger }"
          role="menuitem"
          :disabled="item.disabled"
          :aria-label="item.label"
          @click="emit('pick', item.action)"
        >
          <span class="dt-ctxmenu__label">{{ item.label }}</span>
          <span v-if="item.keys !== ''" class="dt-ctxmenu__keys">
            {{ item.keys }}
          </span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.dt-ctxmenu {
  position: fixed;
  z-index: var(--z-dropdown);
  min-width: 11rem;
  padding: 4px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-panel);
  box-shadow: var(--fx-shadow-menu);
  backdrop-filter: blur(12px);

  &__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--ctl-fs-sm);
    text-align: left;
    cursor: pointer;

    &:hover:not(:disabled),
    &:focus-visible {
      background: rgba(var(--accent-primary-rgb), 0.14);
      color: var(--text-primary);
      outline: none;
    }

    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    &--danger {
      color: var(--state-danger);

      &:hover:not(:disabled),
      &:focus-visible {
        background: rgba(var(--state-danger-rgb), 0.16);
        color: var(--state-danger);
      }
    }
  }

  &__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__keys {
    flex: none;
    color: var(--text-disabled);
    font-size: var(--ctl-fs-sm);
    white-space: nowrap;
  }

  &__sep {
    height: 1px;
    margin: 4px 2px;
    border: none;
    background: var(--border-subtle);
  }
}
</style>
