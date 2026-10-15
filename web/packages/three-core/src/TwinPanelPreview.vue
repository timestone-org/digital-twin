<script setup lang="ts">
/** @fileoverview 配置用平面卡片预览，复用运行态卡片渲染器。 */
import type { TwinPanel, TwinPanelValues } from '@dt/twin-config'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  buildPanelCard,
  paintPanelField,
  type PanelFieldView,
} from './panelCard'
const props = defineProps<{ panel: TwinPanel; values: TwinPanelValues }>()
const host = ref<HTMLDivElement | null>(null)
let views: PanelFieldView[] = []
function paint(): void {
  for (const view of views) paintPanelField(view, props.values)
}
function build(): void {
  const element = host.value
  if (element === null) return
  element.replaceChildren()
  const card = buildPanelCard({
    ...props.panel,
    style: { ...props.panel.style, orient: 'center' },
  })
  views = card.fields
  element.append(card.mount)
  paint()
}
onMounted(build)
watch(() => props.panel, build, { flush: 'post' })
watch(() => props.values, paint)
onBeforeUnmount(() => {
  host.value?.replaceChildren()
  views = []
})
</script>
<template>
  <div
    ref="host"
    class="panel-preview"
    role="region"
    aria-label="卡片配置预览"
    tabindex="0"
  />
</template>
<style scoped lang="scss">
.panel-preview {
  box-sizing: border-box;
  flex: 1 1 auto;
  padding: 16px;
  min-width: 0;
  min-height: 0;
  max-height: min(320px, 40dvh);
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: -2px;
  }
  :deep(.twin-panel-mount) {
    width: 100%;
    height: auto;
    white-space: normal;
  }
  :deep(.twin-panel-mount > .twin-panel) {
    position: relative;
    transform: none;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }
}
</style>
