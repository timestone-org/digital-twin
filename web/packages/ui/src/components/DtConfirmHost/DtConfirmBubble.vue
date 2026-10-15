<script setup lang="ts">
/** @fileoverview 锚定触发按钮的紧凑确认气泡，复用浮层定位、箭头与外点取消。 */
import { nextTick, onBeforeUnmount, onMounted, ref, toRef, useId } from 'vue'
import DtButton from '../DtButton/DtButton.vue'
import DtIcon from '../DtIcon/DtIcon.vue'
import type { DtConfirmRequest } from '../../composables/useConfirm'
import { useAnchoredOverlay } from '../../overlay/useAnchoredOverlay'

const props = defineProps<{
  anchor: HTMLElement
  request: Readonly<DtConfirmRequest>
}>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const panel = ref<HTMLElement | null>(null)
const id = useId()
const overlay = useAnchoredOverlay({
  trigger: toRef(props, 'anchor'),
  panel,
  side: () => 'bottom',
  align: () => 'end',
  onOutside: () => emit('cancel'),
})
const { host, style, side, arrowOffset } = overlay
let disposed = false

function onEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  emit('cancel')
}

onMounted(() => {
  if (!props.anchor.isConnected) {
    emit('cancel')
    return
  }
  overlay.open()
  document.addEventListener('keydown', onEscape, true)
  void nextTick(() => {
    if (!disposed) panel.value?.querySelector<HTMLElement>('button')?.focus()
  })
})
onBeforeUnmount(() => {
  disposed = true
  overlay.close()
  document.removeEventListener('keydown', onEscape, true)
  if (props.anchor.isConnected) props.anchor.focus()
})
</script>

<template>
  <Teleport :to="host">
    <section
      ref="panel"
      class="dt-confirm-bubble"
      :class="'dt-confirm-bubble--' + side"
      :style="{ ...style, '--_arrow': `${arrowOffset}px` }"
      role="dialog"
      :aria-labelledby="id + '-title'"
      :aria-describedby="id + '-message'"
      @keydown.stop
    >
      <div class="dt-confirm-bubble__heading">
        <span class="dt-confirm-bubble__icon"
          ><DtIcon name="alert-circle" :size="15"
        /></span>
        <h2 :id="id + '-title'">{{ request.title ?? '请确认' }}</h2>
      </div>
      <p :id="id + '-message'">{{ request.message }}</p>
      <footer>
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          @click="emit('cancel')"
          >{{ request.cancelText ?? '取消' }}</DtButton
        >
        <DtButton
          size="xs"
          :intent="request.danger ? 'danger' : 'primary'"
          @click="emit('confirm')"
          >{{ request.confirmText ?? '确定' }}</DtButton
        >
      </footer>
    </section>
  </Teleport>
</template>

<style scoped lang="scss">
@use '../../styles/bubble' as bubble;

.dt-confirm-bubble {
  @include bubble.bubble-surface(var(--radius-lg));
  @include bubble.bubble-arrow(7px);
  box-sizing: border-box;
  width: min(264px, calc(100vw - 16px));
  padding: 12px;
  border-color: color-mix(in srgb, var(--text-primary) 12%, transparent);
  backdrop-filter: blur(18px);

  &::after {
    border-color: color-mix(in srgb, var(--text-primary) 12%, transparent);
  }

  &__heading {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  &__icon {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border-radius: var(--radius-pill);
    color: var(--state-warning);
    background: color-mix(in srgb, var(--state-warning) 10%, transparent);
  }
  h2 {
    margin: 0;
    font-size: 13px;
    line-height: 1.4;
    font-weight: 600;
  }
  p {
    margin: 6px 0 12px 32px;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
}
</style>
