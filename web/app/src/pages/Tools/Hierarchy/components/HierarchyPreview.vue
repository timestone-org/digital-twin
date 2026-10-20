<script setup lang="ts">
/** @fileoverview 安全的整图 SVG 预览与缩放。 */
import { computed, ref, watch } from 'vue'
import { DtIconButton } from '@dt/ui'
import { svgBlob } from '../scripts/exportDrawing'
import type { Drawing } from '../scripts/types'
const props = defineProps<{ drawing: Drawing }>()
const image = ref(''),
  scale = ref(0.6),
  frame = ref<HTMLElement | null>(null)
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
    cleanup(() => URL.revokeObjectURL(url))
  },
  { immediate: true },
)
function fit() {
  const width = frame.value?.clientWidth ?? 1000
  scale.value = Math.min(1, (width - 40) / props.drawing.width)
}
function zoom(value: number) {
  scale.value = Math.max(0.05, Math.min(3, value))
}
</script>
<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <div class="flex shrink-0 items-center gap-3 text-sm text-text-secondary">
      <span>
        {{ drawing.nodeCount }} 个计量节点 · {{ drawing.levelCount }} 层 ·
        {{ drawing.rows.length }} 行 · {{ drawing.width }} ×
        {{ drawing.height }} px
      </span>
      <DtIconButton
        size="sm"
        variant="ghost"
        intent="neutral"
        icon="maximize"
        label="适应图纸"
        @click="fit"
      />
      <DtIconButton
        size="sm"
        variant="ghost"
        intent="neutral"
        icon="zoom-out"
        label="缩小"
        @click="zoom(scale / 1.2)"
      />
      <span> {{ Math.round(scale * 100) }}% </span>
      <DtIconButton
        size="sm"
        variant="ghost"
        intent="neutral"
        icon="zoom-in"
        label="放大"
        @click="zoom(scale * 1.2)"
      />
    </div>
    <div
      ref="frame"
      class="min-h-0 flex-1 overflow-auto rounded border border-border-default bg-surface-sunken p-4"
    >
      <img :src="image" alt="标准计量层级图" :style="size" @load="fit" />
    </div>
    <p
      v-for="warning in drawing.warnings"
      :key="warning.message"
      class="text-xs text-text-secondary"
    >
      {{ warning.message }}
    </p>
  </div>
</template>
