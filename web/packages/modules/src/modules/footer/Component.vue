<script setup lang="ts">
/**
 * @fileoverview footer 的渲染壳：背景色、背景底图层、顶边分隔线与扫光、内容区。
 * 壳里没有标题条——与页头对称，要一行字就拖一个文字块子节点进来。
 * ⚠ 子节点走**默认插槽**由运行时注入，插槽名写错既不报错也不渲染——
 * 由 tests/modules/footer/Component.spec.ts 的插槽用例守。
 */
import type { ModuleMeta } from '@dt/contracts'
import { computed, type CSSProperties } from 'vue'

import { bannerBackground } from '../../shared/background'
import { readBoolean, readNumber, readText } from '../../shared/config'
import {
  CONTAINER_CONFIG_KEY,
  readContainerLayout,
} from '../../shared/container'

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

const accent = computed(() =>
  readText(props.config.accent, 'var(--accent-primary)'),
)
const background = computed(() => readText(props.config.background))
/** 底图那一层的 `background` 值；地址会被铺成整条贴底的横幅。 */
const bgLayer = computed(() =>
  bannerBackground(readText(props.config.backgroundImage)),
)
const showDotGrid = computed(() => readBoolean(props.config.showDotGrid))
const dividerWidth = computed(() =>
  readNumber(props.config.dividerWidth, DIVIDER_WIDTH_DEFAULT_PX),
)
/** 0 = 不要扫光：整条伪元素退场，留着 0 浓度的话它仍在顶边压着一层。 */
const sweepOpacity = computed(() =>
  readNumber(props.config.sweepOpacity, SWEEP_OPACITY_DEFAULT),
)
const layout = computed(() =>
  readContainerLayout(props.config[CONTAINER_CONFIG_KEY]),
)

const shellStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    '--dt-footer-accent': accent.value,
    // 线宽 0 就是不画线，不另设一个显隐开关：两个旋钮描述同一条边时必然会漂
    '--dt-footer-divider-w': `${dividerWidth.value}px`,
    '--dt-footer-sweep-opacity': toPercent(sweepOpacity.value),
  }
  // ⚠ 底图走自定义属性而不是直接写 background：整条简写落到 style 上会被浏览器
  // 拆开重排（`center bottom / 100% 100%` 变成 `center bottom 100% / 100%`），
  // 与页头同款写法才不会两边长得不一样
  if (bgLayer.value !== '') style['--dt-footer-bg'] = bgLayer.value
  // 背景色与背景底图各写各的：填了底图而没填底色时，底色仍该透出大屏背景
  if (background.value !== '') style.backgroundColor = background.value
  return style
})

const contentStyle = computed<CSSProperties>(() => ({
  padding: `${layout.value.pad}px`,
}))
</script>

<template>
  <div
    class="dt-footer"
    :class="{ 'dt-footer--sweepless': sweepOpacity <= 0 }"
    :style="shellStyle"
  >
    <!-- 底图单独一层真实元素：整条 background 简写落在它身上，不会把外壳的底色抹掉 -->
    <i v-if="bgLayer !== ''" class="dt-footer__bg" aria-hidden="true" />
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
  z-index: 1;
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

// 浓度归零整条伪元素退场：留着 0 透明度的话它仍在顶边压着一层
.dt-footer--sweepless::before {
  content: none;
}

.dt-footer__bg {
  position: absolute;
  z-index: 0;
  inset: 0;
  pointer-events: none;
  background: var(--dt-footer-bg, none);
}

// 子节点在这一层里绝对定位；内缩已经由 padding 让出来，运行时不要再算一次。
// z 恒为外壳内最高：底图与扫光都是氛围层，谁都不该盖住子节点
.dt-footer__content {
  position: relative;
  z-index: 2;
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
