<script setup lang="ts">
/**
 * @fileoverview 画布的辅助层：拖动命中的智能参考线与框选矩形，都是设计坐标系里的图形。
 * 整层不吃指针事件，免得盖住底下的节点。
 */
import type { NodeBox, DesignSize } from '@dt/runtime'
import { computed, type CSSProperties } from 'vue'

import type { GuideLine } from '@/features/dashboard/canvasSnap'

const props = defineProps<{
  guides: readonly GuideLine[]
  /** 正在拖的框选矩形；没在框选时为 null。 */
  marquee: NodeBox | null
  design: DesignSize
}>()

/** 一条参考线的稳定标识：位置与跨度一变就是另一条线。 */
function keyOf(guide: GuideLine): string {
  return `${guide.orientation}:${guide.pos}:${guide.from}:${guide.to}`
}

const marqueeStyle = computed<CSSProperties>(() => ({
  left: `${props.marquee?.x ?? 0}px`,
  top: `${props.marquee?.y ?? 0}px`,
  width: `${props.marquee?.w ?? 0}px`,
  height: `${props.marquee?.h ?? 0}px`,
}))
</script>

<template>
  <svg
    v-if="guides.length > 0"
    class="dt-guides"
    :viewBox="`0 0 ${design.width} ${design.height}`"
    preserveAspectRatio="none"
  >
    <line
      v-for="guide in guides"
      :key="keyOf(guide)"
      :x1="guide.orientation === 'v' ? guide.pos : guide.from"
      :y1="guide.orientation === 'v' ? guide.from : guide.pos"
      :x2="guide.orientation === 'v' ? guide.pos : guide.to"
      :y2="guide.orientation === 'v' ? guide.to : guide.pos"
    />
  </svg>
  <div v-if="marquee !== null" class="dt-marquee" :style="marqueeStyle"></div>
</template>

<style scoped lang="scss">
.dt-guides {
  position: absolute;
  inset: 0;
  z-index: 99999;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.dt-guides line {
  stroke: var(--state-danger);
  stroke-width: 1;
  stroke-dasharray: 5 3;
  // 参考线在缩放后仍是一像素宽，不然缩小时会细到看不见
  vector-effect: non-scaling-stroke;
}

.dt-marquee {
  position: absolute;
  z-index: 99998;
  pointer-events: none;
  border: 1px solid var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
}
</style>
