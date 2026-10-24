<script setup lang="ts">
/** @fileoverview 支持指针和键盘的可访问布局分隔条。 */
import type { LayoutDirection } from './layoutSizes'

const props = defineProps<{
  direction: LayoutDirection
  label: string
  size: number
  minimum: number
  maximum: number
}>()
const emit = defineEmits<{
  grab: [event: PointerEvent]
  nudge: [delta: number]
  reset: []
}>()

function handleKey(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    emit('reset')
    return
  }
  const step = event.shiftKey ? 64 : 16
  const backwards = props.direction === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
  const forwards = props.direction === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
  const delta =
    event.key === backwards
      ? -step
      : event.key === forwards
        ? step
        : event.key === 'Home'
          ? -Number.MAX_SAFE_INTEGER
          : event.key === 'End'
            ? Number.MAX_SAFE_INTEGER
            : null
  if (delta === null) return
  event.preventDefault()
  event.stopPropagation()
  emit('nudge', delta)
}
</script>

<template>
  <div
    class="dt-resize-handle"
    :class="`dt-resize-handle--${direction}`"
    role="separator"
    tabindex="0"
    :aria-label="label"
    :aria-orientation="direction === 'horizontal' ? 'vertical' : 'horizontal'"
    :aria-valuenow="Math.round(size)"
    :aria-valuemin="Math.round(minimum)"
    :aria-valuemax="Math.round(maximum)"
    :title="`${label}（拖动调整，双击或 Enter 复位）`"
    @pointerdown="emit('grab', $event)"
    @keydown="handleKey"
    @dblclick="emit('reset')"
  >
    <span class="dt-resize-handle__line" />
  </div>
</template>

<style scoped lang="scss">
.dt-resize-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  touch-action: none;
  user-select: none;
  outline-offset: -2px;

  &--horizontal {
    cursor: col-resize;
  }
  &--vertical {
    cursor: row-resize;
  }

  &__line {
    border-radius: var(--radius-pill);
    background: var(--border-subtle);
    transition: background 0.15s ease;
  }
  &--horizontal &__line {
    width: 2px;
    height: 100%;
  }
  &--vertical &__line {
    height: 2px;
    width: 100%;
  }
  &:hover &__line,
  &:focus-visible &__line {
    background: var(--accent-primary);
  }
  &:focus-visible {
    outline: 2px solid var(--accent-primary);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dt-resize-handle__line {
    transition: none;
  }
}
</style>
