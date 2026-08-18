<script setup lang="ts">
/**
 * @fileoverview DtTooltip —— 指针悬停或键盘聚焦时弹出的提示。
 * ⚠ 它只读不点：内容里放按钮或链接，键盘与触屏用户永远够不着（指针一移开就没了）。
 */
import { computed, ref, useId, watch } from 'vue'
import { useAnchoredOverlay } from '../../overlay/useAnchoredOverlay'
import type { DtOverlaySide } from '../../overlay/placement'

const props = withDefaults(
  defineProps<{
    content?: string
    side?: DtOverlaySide
    disabled?: boolean
  }>(),
  { side: 'top', disabled: false },
)

const tipId = `dt-tooltip-${useId()}`

const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)

const overlay = useAnchoredOverlay({
  trigger,
  panel,
  side: () => props.side,
  align: () => 'center',
  // 提示靠移开指针收起，点外面不额外做什么
  onOutside: () => undefined,
})
// ⚠ 不能直接叫 side：它与同名 prop 撞，模板里取到的会是哪一个说不准
const { host, style, side: placedSide, arrowOffset } = overlay

const hasContent = computed(
  () => !props.disabled && (props.content ?? '') !== '',
)

/** ⚠ 没内容时不能挂 describedby：它会指向一个不存在的节点，读屏读出空。 */
const describedby = computed(() => (hasContent.value ? tipId : undefined))

function show(): void {
  if (hasContent.value) overlay.open()
}

// 内容被清空或组件被禁用时立刻收起，否则气泡会挂着一句已经作废的话
watch(hasContent, (available) => {
  if (!available) overlay.close()
})
</script>

<template>
  <span
    ref="trigger"
    class="dt-tooltip"
    :aria-describedby="describedby"
    @mouseenter="show"
    @mouseleave="overlay.close()"
    @focusin="show"
    @focusout="overlay.close()"
    @keydown.escape="overlay.close()"
  >
    <slot />
    <Teleport v-if="overlay.isOpen.value" :to="host">
      <span
        :id="tipId"
        ref="panel"
        class="dt-tooltip__bubble"
        :class="`dt-tooltip__bubble--${placedSide}`"
        role="tooltip"
        :style="{ ...style, '--_arrow': `${arrowOffset}px` }"
      >
        {{ content }}
      </span>
    </Teleport>
  </span>
</template>

<style scoped lang="scss">
@use '../../styles/bubble' as bubble;

.dt-tooltip {
  display: inline-flex;

  &__bubble {
    display: block;
    max-width: 18rem;
    width: max-content;
    padding: 6px 10px;
    font-family: var(--font-sans);
    font-size: var(--ctl-hint-fs-lg);
    line-height: 1.4;
    overflow-wrap: break-word;
    // 气泡不接收指针事件，否则它会挡住触发器、把 mouseleave 提前触发成闪烁
    pointer-events: none;

    @include bubble.bubble-surface;
    @include bubble.bubble-arrow;
  }
}
</style>
