<script setup lang="ts">
/**
 * @fileoverview container 的渲染壳：背景、可选标题条、内容区。
 * ⚠ 标题条的显隐判定必须与 `resolveContentInset` 逐字一致：一边画了条、另一边
 * 没留出 28px，表现是这个容器里所有子节点整体错位，而没有任何一处报错。
 */
import type { ModuleMeta } from '@dt/contracts'
import { computed, type CSSProperties } from 'vue'

import { coverBackground } from '../../shared/background'
import { readBoolean, readNumber, readText } from '../../shared/config'
import {
  CONTAINER_CONFIG_KEY,
  SHOW_TITLE_CONFIG_KEY,
  TITLE_BAR_HEIGHT_PX,
  readContainerLayout,
} from '../../shared/container'

/** 圆角缺省（px），与 `--radius-sm` 同值。 */
const RADIUS_DEFAULT_PX = 4

/** 描边宽度缺省（px）；颜色取卡片外观的 `--card-border`。 */
const BORDER_WIDTH_DEFAULT_PX = 1

/** 点阵的点径、步距（px）与混色比例缺省。 */
const DOT_SIZE_DEFAULT_PX = 1
const DOT_GAP_DEFAULT_PX = 16
const DOT_OPACITY_DEFAULT = 0.12

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

/**
 * 比例 → 百分号串。
 * ⚠ color-mix 的混色量只认百分比，注入裸小数整条声明会静默失效；
 * 先抹掉 `0.35 * 100` 这类浮点尾数，免得产出 `35.000000000000004%`。
 * @param ratio 0–1 的比例
 */
function toPercent(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`
}

const title = computed(() => readText(props.config.title))
const isTitleShown = computed(() =>
  readBoolean(props.config[SHOW_TITLE_CONFIG_KEY]),
)
const accent = computed(() =>
  readText(props.config.accent, 'var(--accent-primary)'),
)
const background = computed(() => readText(props.config.background))
// 素材引用 / 图片地址 / CSS 值三条路各有各的铺法，见 shared/background.ts
const backgroundLayer = computed(() =>
  coverBackground(readText(props.config.backgroundImage)),
)
const showDotGrid = computed(() => readBoolean(props.config.showDotGrid, true))
const dotSize = computed(() =>
  readNumber(props.config.dotSize, DOT_SIZE_DEFAULT_PX),
)
const dotGap = computed(() =>
  readNumber(props.config.dotGap, DOT_GAP_DEFAULT_PX),
)
const dotOpacity = computed(() =>
  readNumber(props.config.dotOpacity, DOT_OPACITY_DEFAULT),
)
const radius = computed(() =>
  readNumber(props.config.radius, RADIUS_DEFAULT_PX),
)
const showBorder = computed(() => readBoolean(props.config.showBorder))
const borderWidth = computed(() =>
  readNumber(props.config.borderWidth, BORDER_WIDTH_DEFAULT_PX),
)
const layout = computed(() =>
  readContainerLayout(props.config[CONTAINER_CONFIG_KEY]),
)

const shellStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    '--dt-container-accent': accent.value,
    '--dt-container-bar-height': `${TITLE_BAR_HEIGHT_PX}px`,
    '--dt-container-radius': `${radius.value}px`,
    // 关掉描边 = 线宽落到 0，不另设一个显隐变量：两个旋钮描述同一圈边时必然会漂
    '--dt-container-border-w': `${showBorder.value ? borderWidth.value : 0}px`,
    '--dt-container-dot-size': `${dotSize.value}px`,
    '--dt-container-dot-gap': `${dotGap.value}px`,
    '--dt-container-dot-opacity': toPercent(dotOpacity.value),
  }
  // 背景色与背景图各写各的：填了渐变而没填底色时，底色仍该透出大屏背景
  if (background.value !== '') style.backgroundColor = background.value
  const layer = backgroundLayer.value
  if (layer.image !== '') {
    style.backgroundImage = layer.image
    // ⚠ 铺法只在图片地址那条路上写：CSS 值那条路留白，否则用户拿
    //   repeating-gradient 铺的底纹会被钉成 no-repeat（shared/background.ts）
    if (layer.size !== '') style.backgroundSize = layer.size
    if (layer.position !== '') style.backgroundPosition = layer.position
    if (layer.repeat !== '') style.backgroundRepeat = layer.repeat
  }
  return style
})

const contentStyle = computed<CSSProperties>(() => ({
  padding: `${layout.value.pad}px`,
}))
</script>

<template>
  <div class="dt-container" :style="shellStyle">
    <div v-if="isTitleShown" class="dt-container__bar">
      <span class="dt-container__accent" />
      <span class="dt-container__title">{{ title }}</span>
    </div>
    <div
      class="dt-container__content"
      :class="{ 'dt-container__content--dotted': showDotGrid }"
      :style="contentStyle"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-container {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  // 描边色复用卡片外观那一份，宽度缺省 0 → 不配就仍然没有边框
  border: var(--dt-container-border-w, 0) solid var(--card-border);
  border-radius: var(--dt-container-radius, var(--radius-sm));
}

.dt-container__bar {
  display: flex;
  height: var(--dt-container-bar-height);
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
}

// 竖条与标题的形状走可注入的 --card-title-* 变量，每个兜底就是容器现值，
// 卡片外观面板上那几个旋钮因此对容器也生效
.dt-container__accent {
  width: var(--card-title-bar-w, 3px);
  height: var(--card-title-bar-h, 13px);
  flex: none;
  border-radius: var(--radius-pill);
  background: var(--dt-container-accent);
  box-shadow: 0 0 var(--card-title-bar-glow, 6px) var(--dt-container-accent);
}

.dt-container__title {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  color: var(--card-title-color, var(--text-title));
  font-size: var(--card-title-size, 13px);
  font-weight: var(--card-title-weight, 600);
  letter-spacing: var(--card-title-ls, 0.025em);
  white-space: nowrap;
  text-overflow: ellipsis;
}

// 子节点在这一层里绝对定位；内缩已经由 padding 让出来，运行时不要再算一次
.dt-container__content {
  position: relative;
  min-height: 0;
  flex: 1;
}

// 点阵只是「这里能放东西」的示意，画在背景上，不占位也不接指针事件
.dt-container__content--dotted {
  // ⚠ 圆心偏移必须跟着点径走：固定 1px 时点径一放大，左上角那一列点会被裁掉半个
  background-image: radial-gradient(
    circle at var(--dt-container-dot-size, 1px)
      var(--dt-container-dot-size, 1px),
    color-mix(
        in srgb,
        var(--dt-container-accent) var(--dt-container-dot-opacity, 12%),
        transparent
      )
      var(--dt-container-dot-size, 1px),
    transparent 0
  );
  background-size: var(--dt-container-dot-gap, 16px)
    var(--dt-container-dot-gap, 16px);
}
</style>
