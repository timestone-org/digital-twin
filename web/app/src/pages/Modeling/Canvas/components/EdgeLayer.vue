<script setup lang="ts">
/**
 * @fileoverview 画布上所有边的那一层 SVG，外加正在拉的那条橡皮筋。
 *
 * ⚠ 这一层必须 `pointer-events: none`，只给线本身开：整片 SVG 铺在节点上面，
 * 不关掉的话节点全点不中，而表象是「卡片突然没反应了」。
 * ⚠ 线要有一条**加粗的透明命中带**：2px 的曲线用鼠标几乎点不中，而点不中就
 * 选不中，选不中就删不掉。
 * ⚠ SVG 的宽高是模板上的 1×1 常量，线全靠 `overflow: visible` 画在视口外：它挂在
 * `.dt-ml-canvas__world` 里，那是个只装 absolute 子元素的变换容器，自己 0×0，
 * 百分比取到的还是 0；而外层 `<svg>` 宽或高为 0 时浏览器**整个不绘制**它，
 * 表象是「连线看不见」而单测（happy-dom 不做布局）照常全绿。
 */
import { computed } from 'vue'

import type { DrawnEdge } from '../scripts/edgeCurve'
import { arrowOf, curveOf, midOf } from '../scripts/edgeCurve'

const props = defineProps<{
  edges: readonly DrawnEdge[]
  pending: DrawnEdge | null
  selectedIds: readonly string[]
  isReadonly: boolean
}>()

const emit = defineEmits<{
  pick: [id: string, event: PointerEvent]
  menu: [id: string, at: { x: number; y: number }]
  remove: [id: string]
}>()

const selected = computed(() => new Set(props.selectedIds))

function onMenu(id: string, event: MouseEvent): void {
  event.preventDefault()
  emit('menu', id, { x: event.clientX, y: event.clientY })
}
</script>

<template>
  <svg class="dt-ml-edges" width="1" height="1" aria-hidden="true">
    <g v-for="edge in props.edges" :key="edge.id">
      <path
        class="dt-ml-edges__hit"
        :d="curveOf(edge.from, edge.to)"
        @pointerdown="emit('pick', edge.id, $event)"
        @contextmenu="onMenu(edge.id, $event)"
      />
      <path
        class="dt-ml-edges__line"
        :class="{ 'dt-ml-edges__line--on': selected.has(edge.id) }"
        :d="curveOf(edge.from, edge.to)"
      />
      <path
        class="dt-ml-edges__arrow"
        :class="{ 'dt-ml-edges__arrow--on': selected.has(edge.id) }"
        :d="arrowOf(edge.to)"
      />
      <g
        v-if="selected.has(edge.id) && !props.isReadonly"
        class="dt-ml-edges__cut"
        role="button"
        aria-label="删掉这条线"
        @pointerdown.stop="emit('remove', edge.id)"
      >
        <circle
          :cx="midOf(edge.from, edge.to).left"
          :cy="midOf(edge.from, edge.to).top"
          r="9"
        />
        <path
          :d="`M ${midOf(edge.from, edge.to).left - 4} ${midOf(edge.from, edge.to).top} h 8`"
        />
      </g>
    </g>
    <path
      v-if="props.pending"
      class="dt-ml-edges__line dt-ml-edges__line--pending"
      :d="curveOf(props.pending.from, props.pending.to)"
    />
  </svg>
</template>

<style scoped lang="scss">
.dt-ml-edges {
  position: absolute;
  top: 0;
  left: 0;
  // ⚠ 见文件头：尺寸是模板上的 1×1，这里不能再写百分比；线与命中带都在视口外，
  // 全靠 overflow 放出来
  overflow: visible;
  // ⚠ 见文件头：这一层不能吃掉落在节点上的指针事件
  pointer-events: none;

  &__line {
    fill: none;
    stroke: var(--border-strong);
    stroke-width: 2;
    pointer-events: none;

    &--on {
      stroke: var(--accent-primary);
      stroke-width: 3;
    }

    &--pending {
      stroke: var(--accent-primary);
      stroke-dasharray: 6 4;
    }
  }

  // 看不见的加粗命中带；线本身细，靠它才点得中
  &__hit {
    fill: none;
    stroke: transparent;
    stroke-width: 14;
    pointer-events: stroke;
    cursor: pointer;
  }

  &__arrow {
    fill: var(--border-strong);
    pointer-events: none;

    &--on {
      fill: var(--accent-primary);
    }
  }

  &__cut {
    pointer-events: all;
    cursor: pointer;

    circle {
      fill: var(--surface-panel);
      stroke: var(--state-danger);
      stroke-width: 1.5;
    }

    path {
      stroke: var(--state-danger);
      stroke-width: 2;
    }
  }
}
</style>
