<script setup lang="ts">
/** @fileoverview 安全的整图 SVG 预览与缩放。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DtDisclosure, DtIconButton } from '@dt/ui'
import { svgBlob } from '../scripts/exportDrawing'
import type { Drawing } from '../scripts/types'
const props = defineProps<{ drawing: Drawing }>()
const image = ref('')
const frame = ref<HTMLElement | null>(null)
const frameWidth = ref(0)
const manualScale = ref<number | null>(null)
const fittedScale = computed(() =>
  frameWidth.value > 0
    ? Math.min(1, frameWidth.value / props.drawing.width)
    : 1,
)
const scale = computed(() => manualScale.value ?? fittedScale.value)
const size = computed(() => ({
  width: `${props.drawing.width * scale.value}px`,
  height: `${props.drawing.height * scale.value}px`,
  maxWidth: 'none',
}))
watch(
  () => props.drawing,
  (drawing, _, cleanup) => {
    const url = URL.createObjectURL(svgBlob(drawing))
    image.value = url
    manualScale.value = null
    cleanup(() => URL.revokeObjectURL(url))
  },
  { immediate: true },
)
let observer: ResizeObserver | undefined
onMounted(() => {
  if (!frame.value) return
  observer = new ResizeObserver(([entry]) => {
    if (entry && entry.contentRect.width > 0)
      frameWidth.value = entry.contentRect.width
  })
  observer.observe(frame.value)
})
onBeforeUnmount(() => observer?.disconnect())
function zoom(value: number) {
  manualScale.value = Math.max(
    Math.min(0.05, fittedScale.value),
    Math.min(3, value),
  )
}
</script>
<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <div
      class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2 text-xs text-text-secondary"
    >
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          >{{ drawing.nodeCount }} 个计量节点 · {{ drawing.levelCount }} 层 ·
          {{ drawing.rows.length }} 行</span
        >
        <span class="whitespace-nowrap"
          >{{ drawing.width }} × {{ drawing.height }} px</span
        >
      </div>
      <div class="ml-auto flex items-center gap-1 whitespace-nowrap">
        <DtIconButton
          size="sm"
          variant="ghost"
          intent="neutral"
          icon="maximize"
          label="适应图纸"
          @click="manualScale = null"
        />
        <DtIconButton
          size="sm"
          variant="ghost"
          intent="neutral"
          icon="zoom-out"
          label="缩小"
          @click="zoom(scale / 1.2)"
        />
        <span class="min-w-9 text-center tabular-nums">
          {{ Math.round(scale * 100) }}%
        </span>
        <DtIconButton
          size="sm"
          variant="ghost"
          intent="neutral"
          icon="zoom-in"
          label="放大"
          @click="zoom(scale * 1.2)"
        />
      </div>
    </div>
    <div ref="frame" class="min-h-0 flex-1 overflow-auto bg-surface-sunken p-4">
      <img
        class="mx-auto block"
        :src="image"
        alt="标准计量层级图"
        :style="size"
      />
    </div>
    <DtDisclosure
      v-if="drawing.warnings.length"
      :title="`图纸提示（${drawing.warnings.length}）`"
      :default-open="false"
      unmount-on-close
      class="drawing-warnings"
    >
      <ul class="space-y-1 text-xs text-text-secondary">
        <li v-for="warning in drawing.warnings" :key="warning.message">
          {{ warning.message }}
        </li>
      </ul>
    </DtDisclosure>
  </div>
</template>

<style scoped lang="scss">
.drawing-warnings {
  max-height: min(10rem, 30%);
  overflow-y: auto;
  border-top: 1px solid var(--border-subtle);

  :deep(summary) {
    position: sticky;
    top: 0;
    background: var(--surface-panel);
  }
}
</style>
