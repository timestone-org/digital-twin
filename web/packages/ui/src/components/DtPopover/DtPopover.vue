<script setup lang="ts">
/**
 * @fileoverview DtPopover —— 点击展开的锚定浮层原语，DropdownMenu / HelpTip 都建在它上面。
 * 默认插槽是触发器（拿到 toggle 与 isOpen），content 插槽是面板内容（拿到 close）。
 */
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useAnchoredOverlay } from '../../overlay/useAnchoredOverlay'
import type { DtOverlayAlign, DtOverlaySide } from '../../overlay/placement'

// 面板里优先接管焦点的元素。没有可聚焦子元素时退回面板本身
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const props = withDefaults(
  defineProps<{
    /** 受控开合。不传就由组件自己管。 */
    open?: boolean | undefined
    // 上游会原样转发自己的这几个 prop，必须接得住 undefined（同 DtField）
    side?: DtOverlaySide | undefined
    align?: DtOverlayAlign | undefined
    disabled?: boolean | undefined
  }>(),
  // ⚠ open 必须显式给 undefined：Boolean 型 prop 缺省会被 Vue 强制成 false，
  // 那样「没传 open」和「传了 false」就分不开，受控判定永远为真
  { open: undefined, side: 'bottom', align: 'center', disabled: false },
)

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const panelId = `dt-popover-${useId()}`

const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)

const overlay = useAnchoredOverlay({
  trigger,
  panel,
  side: () => props.side,
  align: () => props.align,
  // 外点走同一条关闭路径，受控时才不会绕过父组件的回写
  onOutside: () => {
    requestClose()
  },
})
// ⚠ 不能直接叫 side：它与同名 prop 撞，模板里取到的会是哪一个说不准
const { host, style, side: placedSide, arrowOffset } = overlay

const isControlled = computed(() => typeof props.open === 'boolean')
const isOpen = computed(() =>
  isControlled.value ? props.open === true : overlay.isOpen.value,
)

let restoreFocusTo: HTMLElement | null = null

function focusIntoPanel(): void {
  void nextTick(() => {
    const node = panel.value
    ;(node?.querySelector<HTMLElement>(FOCUSABLE) ?? node)?.focus()
  })
}

/** 关闭时把焦点还给触发器，否则焦点会掉回 body、Tab 从头开始。 */
function restoreFocus(): void {
  restoreFocusTo?.focus()
  restoreFocusTo = null
}

function requestOpen(): void {
  if (props.disabled || isOpen.value) return
  emit('update:open', true)
  if (isControlled.value) return
  restoreFocusTo = document.activeElement as HTMLElement | null
  overlay.open()
  focusIntoPanel()
}

function requestClose(): void {
  if (!isOpen.value) return
  emit('update:open', false)
  if (isControlled.value) return
  overlay.close()
  restoreFocus()
}

function toggle(): void {
  if (isOpen.value) requestClose()
  else requestOpen()
}

// 受控模式下真正的开合由父组件回写驱动，副作用只在这里做一次。
// ⚠ immediate 不能省：挂载时就带着 open=true 的话，不跑一次就永远不会起跟踪，
// 表现是「一上来就开着的浮层点外面关不掉」。
watch(
  () => isOpen.value,
  (next) => {
    if (!isControlled.value) return
    if (next) {
      restoreFocusTo = document.activeElement as HTMLElement | null
      overlay.open()
      focusIntoPanel()
    } else {
      overlay.close()
      restoreFocus()
    }
  },
  { immediate: true },
)

defineExpose({ open: requestOpen, close: requestClose, toggle })
</script>

<template>
  <span ref="trigger" class="dt-popover" @keydown.escape.stop="requestClose">
    <slot
      :toggle="toggle"
      :open="requestOpen"
      :close="requestClose"
      :is-open="isOpen"
      :panel-id="panelId"
    />
    <Teleport v-if="isOpen" :to="host">
      <div
        :id="panelId"
        ref="panel"
        class="dt-popover__panel"
        :class="`dt-popover__panel--${placedSide}`"
        role="dialog"
        tabindex="-1"
        :style="{ ...style, '--_arrow': `${arrowOffset}px` }"
        @keydown.escape.stop="requestClose"
      >
        <slot name="content" :close="requestClose" />
      </div>
    </Teleport>
  </span>
</template>

<style scoped lang="scss">
@use '../../styles/bubble' as bubble;
@use '../../styles/control' as ctl;

.dt-popover {
  display: inline-flex;

  &__panel {
    max-width: 22rem;
    padding: 10px 12px;
    font-size: var(--ctl-fs-sm);
    line-height: 1.5;

    @include bubble.bubble-surface(var(--radius-md));
    @include bubble.bubble-arrow;
    @include ctl.focus-ring;
  }
}
</style>
