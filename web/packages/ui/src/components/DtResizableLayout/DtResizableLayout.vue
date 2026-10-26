<script setup lang="ts">
/** @fileoverview 支持嵌套、响应式堆叠和尺寸记忆的多区块布局。 */
import type { LayoutDirection, ResizablePane } from './layoutSizes'
import ResizeHandle from './ResizeHandle.vue'
import { useResizableLayout } from './useResizableLayout'

const props = withDefaults(
  defineProps<{
    panes: readonly ResizablePane[]
    direction?: LayoutDirection
    stackAt?: number
    storageKey?: string
    label?: string
  }>(),
  { direction: 'horizontal', stackAt: 0, label: '调整区块' },
)
const layout = useResizableLayout(props)
const host = layout.host

function separatorLabel(index: number): string {
  const first = props.panes[index]
  const second = props.panes[index + 1]
  return `${props.label}：${first?.label ?? first?.id ?? ''} / ${second?.label ?? second?.id ?? ''}`
}
</script>

<template>
  <div
    ref="host"
    class="dt-resizable-layout"
    :class="{ 'dt-resizable-layout--resizing': layout.isResizing.value }"
    :data-direction="layout.direction.value"
    :style="layout.style.value"
  >
    <template v-for="(pane, index) in panes" :key="pane.id">
      <div class="dt-resizable-layout__pane" :data-pane="pane.id">
        <slot :name="pane.id" />
      </div>
      <ResizeHandle
        v-if="index < panes.length - 1"
        :direction="layout.direction.value"
        :label="separatorLabel(index)"
        :size="layout.sizes.value[index] ?? 0"
        :minimum="layout.limits(index).min"
        :maximum="layout.limits(index).max"
        @grab="layout.startDrag(index, $event)"
        @nudge="layout.nudge(index, $event)"
        @reset="layout.reset"
      />
    </template>
  </div>
</template>

<style scoped lang="scss">
.dt-resizable-layout {
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  &--resizing {
    user-select: none;
  }
  &__pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: auto;

    > :deep(*) {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
    }
  }
  &--resizing &__pane {
    pointer-events: none;
  }
}
</style>
