<script setup lang="ts">
/**
 * @fileoverview 画布底：一层按当前倍率对齐的网格线，加一圈把设计框之外压暗的遮罩
 * ——让 `canvas.width/height` 的边界在任何倍率下都一眼可见。
 *
 * ⚠ 纯装饰，整层一点指针都不吃：吃了的话它盖在画布上，点选、框选与拖放全被它接走，
 * 而界面上看不出任何异常。
 * ⚠ 线色只走 `--fx-grid-line`：写死颜色的那一层在换肤时第一个露馅。
 * ⚠ 格距不足几个像素时整层不画：再密线就糊成一片实色，那是比没有网格更糟的底。
 */
import { finiteOr } from '@dt/twin2d'
import type { Twin2dCanvas } from '@dt/twin2d'
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

import { toLocalPoint } from '../scripts/viewportOps'
import type { Twin2dViewport } from '../scripts/viewportOps'

/** 格距小于这么多屏幕像素就不画网格线。 */
const MIN_GRID_STEP_PX = 4

/** 设计坐标系的原点。 */
const DESIGN_ORIGIN = { x: 0, y: 0 }

/**
 * ⚠ 「不吃指针」写成内联而不是样式块里的一条：它是行为不是装饰，得能被用例断住，
 * 而 vitest 不编译 scoped 样式。
 */
const DECORATION_STYLE: CSSProperties = { pointerEvents: 'none' }

const props = defineProps<{
  /** 画布自己的坐标系、栅格步长与网格开关。 */
  canvas: Twin2dCanvas
  /** 当前视口。 */
  view: Twin2dViewport
}>()

/** 设计框左上角在屏幕上的位置。 */
const origin = computed(() => toLocalPoint(props.view, DESIGN_ORIGIN))

/** 这一档倍率下的格距（屏幕像素）。 */
const step = computed(
  () => finiteOr(props.canvas.grid, 0) * finiteOr(props.view.scale, 1),
)

/** 关了网格、或格距密到糊成一片时，线层整个不画。 */
const showLines = computed(
  () => props.canvas.showGrid && step.value >= MIN_GRID_STEP_PX,
)

/**
 * 设计框在屏幕上的那块矩形。
 * ⚠ 每一项都过一手 `finiteOr`：视口是外面递进来的，NaN 进了 `left/width` 之后整块
 * 遮罩静默消失，而 devtools 里看什么都正常。
 */
const frameStyle = computed<CSSProperties>(() => {
  const scale = finiteOr(props.view.scale, 1)
  const width = Math.max(0, finiteOr(props.canvas.width, 0) * scale)
  const height = Math.max(0, finiteOr(props.canvas.height, 0) * scale)
  return {
    left: `${finiteOr(origin.value.x, 0)}px`,
    top: `${finiteOr(origin.value.y, 0)}px`,
    width: `${width}px`,
    height: `${height}px`,
  }
})

/**
 * 网格线的三个数：格距与两轴起点。
 * ⚠ 出的是自定义属性而不是 `background-*` 本身：值里带 `var()` 的标准属性会被
 * happy-dom 的 CSSOM 整条丢掉，浏览器上没事、用例里却断言不到（同 `Twin2dStage`
 * 的底图层）。
 */
const linesStyle = computed<Record<string, string>>(() => ({
  '--t2-grid-step': `${step.value}px`,
  '--t2-grid-x': `${finiteOr(origin.value.x, 0)}px`,
  '--t2-grid-y': `${finiteOr(origin.value.y, 0)}px`,
}))
</script>

<template>
  <div
    class="dt-twin2d-grid"
    :style="DECORATION_STYLE"
    aria-hidden="true"
    data-test="grid"
  >
    <div
      v-if="showLines"
      class="dt-twin2d-grid__lines"
      :style="linesStyle"
      data-test="grid-lines"
    />
    <div
      class="dt-twin2d-grid__frame"
      :style="frameStyle"
      data-test="grid-frame"
    />
  </div>
</template>

<style scoped lang="scss">
// 铺满视口宿主；遮罩那一圈铺开的投影靠它裁掉
.dt-twin2d-grid {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

// 格距与起点由内联的自定义属性喂进来，线色恒走 token
.dt-twin2d-grid__lines {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(to right, var(--fx-grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--fx-grid-line) 1px, transparent 1px);
  background-position: var(--t2-grid-x) var(--t2-grid-y);
  background-size: var(--t2-grid-step) var(--t2-grid-step);
}

// 设计框：框线在内圈，往外一圈铺开的投影把画布之外压暗，框内一点不遮
.dt-twin2d-grid__frame {
  position: absolute;
  box-shadow:
    0 0 0 1px var(--border-default),
    0 0 0 9999px var(--fx-scrim);
}
</style>
