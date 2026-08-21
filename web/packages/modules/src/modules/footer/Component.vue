<script setup lang="ts">
/**
 * @fileoverview footer 的渲染壳：背景、可选标题条、内容区。
 * ⚠ 子节点走**默认插槽**由运行时注入，插槽名写错既不报错也不渲染——
 * 由 tests/modules/footer/Component.spec.ts 的插槽用例守。
 */
import type { ModuleMeta } from '@dt/contracts'
import { computed, type CSSProperties } from 'vue'

import {
  readBoolean,
  readEnum,
  readNumber,
  readText,
} from '../../shared/config'
import {
  CONTAINER_CONFIG_KEY,
  SHOW_TITLE_CONFIG_KEY,
  TITLE_BAR_HEIGHT_PX,
  readContainerLayout,
} from '../../shared/container'

/** 标题条的横向对齐档。 */
const TITLE_ALIGNS = ['left', 'center', 'right'] as const

/** 对齐档 → flex 主轴对齐值。 */
const TITLE_JUSTIFY: Record<(typeof TITLE_ALIGNS)[number], string> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
}

/** 顶边分隔线宽度缺省（px）。 */
const DIVIDER_WIDTH_DEFAULT_PX = 1

/** 顶边扫光与强调色的混色比例缺省。 */
const SWEEP_OPACITY_DEFAULT = 0.6

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
const titleAlign = computed(() =>
  readEnum(props.config.titleAlign, TITLE_ALIGNS, 'center'),
)
const accent = computed(() =>
  readText(props.config.accent, 'var(--accent-primary)'),
)
const background = computed(() => readText(props.config.background))
const backgroundImage = computed(() => readText(props.config.backgroundImage))
const showDotGrid = computed(() => readBoolean(props.config.showDotGrid))
const showDivider = computed(() => readBoolean(props.config.showDivider, true))
const dividerWidth = computed(() =>
  readNumber(props.config.dividerWidth, DIVIDER_WIDTH_DEFAULT_PX),
)
const showSweep = computed(() => readBoolean(props.config.showSweep, true))
const sweepOpacity = computed(() =>
  readNumber(props.config.sweepOpacity, SWEEP_OPACITY_DEFAULT),
)
const layout = computed(() =>
  readContainerLayout(props.config[CONTAINER_CONFIG_KEY]),
)

const shellStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    '--dt-footer-accent': accent.value,
    '--dt-footer-bar-height': `${TITLE_BAR_HEIGHT_PX}px`,
    '--dt-footer-title-justify': TITLE_JUSTIFY[titleAlign.value],
    // 关掉分隔线 = 线宽落到 0，不另设一个显隐变量：两个旋钮描述同一条边时必然会漂
    '--dt-footer-divider-w': `${showDivider.value ? dividerWidth.value : 0}px`,
    '--dt-footer-sweep-opacity': toPercent(sweepOpacity.value),
  }
  // 背景色与背景图各写各的：填了渐变而没填底色时，底色仍该透出大屏背景
  if (background.value !== '') style.backgroundColor = background.value
  if (backgroundImage.value !== '') {
    style.backgroundImage = backgroundImage.value
  }
  return style
})

const contentStyle = computed<CSSProperties>(() => ({
  padding: `${layout.value.pad}px`,
}))
</script>

<template>
  <div
    class="dt-footer"
    :class="{ 'dt-footer--sweepless': !showSweep }"
    :style="shellStyle"
  >
    <div v-if="isTitleShown" class="dt-footer__bar">
      <span class="dt-footer__title">{{ title }}</span>
    </div>
    <div
      class="dt-footer__content"
      :class="{ 'dt-footer__content--dotted': showDotGrid }"
      :style="contentStyle"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
// 与页头对称：分隔线画在**顶边**，扫光也压在顶边上
.dt-footer {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  border-top: var(--dt-footer-divider-w, 1px) solid var(--dt-footer-accent);
}

// 顶边扫光，纯装饰；不接指针事件，否则会吃掉贴着顶边那一排子节点的点击
.dt-footer::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(
      in srgb,
      var(--dt-footer-accent) var(--dt-footer-sweep-opacity, 60%),
      transparent
    ),
    transparent
  );
  content: '';
  pointer-events: none;
}

// 关掉扫光整条伪元素退场：留着 0 透明度的话它仍在顶边压着一层
.dt-footer--sweepless::before {
  content: none;
}

.dt-footer__bar {
  display: flex;
  height: var(--dt-footer-bar-height);
  flex: none;
  align-items: center;
  justify-content: var(--dt-footer-title-justify, center);
}

// 排版走可注入的 --card-title-* 变量，每个兜底就是页脚现值。
// ⚠ 字号兜底 14px 是**页脚自己的**，与页头那条 18px 各自独立，别统一
.dt-footer__title {
  color: var(--card-title-color, var(--text-primary));
  // ⚠ 读 --card-font（cardVars 发射的字体变量就叫它，页头同款）：读别的名字
  // 表现是「配了字体没反应」
  font-family: var(--card-font, var(--font-display));
  font-size: var(--card-title-size, 14px);
  letter-spacing: var(--card-title-ls, 0.08em);
  text-shadow: var(--card-title-shadow, var(--fx-glow-title));
}

// 子节点在这一层里绝对定位；内缩已经由 padding 让出来，运行时不要再算一次
.dt-footer__content {
  position: relative;
  min-height: 0;
  flex: 1;
}

// 点阵只是「这里能放东西」的示意，画在背景上，不占位也不接指针事件
.dt-footer__content--dotted {
  background-image: radial-gradient(
    circle at 1px 1px,
    color-mix(in srgb, var(--dt-footer-accent) 12%, transparent) 1px,
    transparent 0
  );
  background-size: 16px 16px;
}
</style>
