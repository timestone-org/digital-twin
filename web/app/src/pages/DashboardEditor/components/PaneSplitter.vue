<script setup lang="ts">
/**
 * @fileoverview 侧栏与画布之间的拖拽分隔条。
 * ⚠ 它是 `role="separator"` 而不是按钮：读屏要能报出「现在多宽、能拖到多宽」，
 * 所以 `aria-valuenow` / `min` / `max` 三个都得给，且键盘也要能挪。
 */
import { NUDGE_COARSE_PX, NUDGE_PX, type PaneLimits } from '../scripts/paneWidths'

const props = defineProps<{
  label: string
  width: number
  limits: PaneLimits
}>()

const emit = defineEmits<{
  grab: [event: PointerEvent]
  /** 正数是把这一侧拉宽。 */
  nudge: [delta: number]
  reset: []
}>()

/** 够大的一步：交给上层 clamp 就正好落在端点上，不必另开两个事件。 */
const TO_EDGE_PX = 100000

function onKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? NUDGE_COARSE_PX : NUDGE_PX
  const moves: Record<string, number> = {
    ArrowLeft: -step,
    ArrowRight: step,
    Home: -TO_EDGE_PX,
    End: TO_EDGE_PX,
  }
  const delta = moves[event.key]
  if (delta === undefined) return
  event.preventDefault()
  emit('nudge', delta)
}
</script>

<template>
  <div
    class="dt-splitter"
    role="separator"
    aria-orientation="vertical"
    tabindex="0"
    :aria-label="label"
    :aria-valuenow="Math.round(props.width)"
    :aria-valuemin="props.limits.min"
    :aria-valuemax="props.limits.max"
    :title="`${label}（拖动改宽，双击复位）`"
    @pointerdown="emit('grab', $event)"
    @keydown="onKeydown"
    @dblclick="emit('reset')"
  >
    <span class="dt-splitter__line" />
  </div>
</template>

<style scoped lang="scss">
.dt-splitter {
  display: flex;
  align-items: stretch;
  justify-content: center;
  // 整条都是抓取区：只给那 2px 的线做热区的话，得瞄准了才拖得动
  cursor: col-resize;
  // 拖拽时指针常常跑到条外，别让它顺手选中两侧的文字
  user-select: none;
  touch-action: none;

  &:focus-visible {
    outline: 2px solid rgba(var(--accent-primary-rgb), 0.6);
    outline-offset: -2px;
    border-radius: var(--radius-sm);
  }

  &__line {
    width: 2px;
    border-radius: var(--radius-pill);
    background: var(--border-subtle);
    transition:
      background 0.15s ease,
      box-shadow 0.15s ease;
  }

  &:hover &__line,
  &:focus-visible &__line {
    background: var(--accent-primary);
    box-shadow: 0 0 6px rgba(var(--accent-primary-rgb), 0.55);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dt-splitter__line {
    transition: none;
  }
}
</style>
