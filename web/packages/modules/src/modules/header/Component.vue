<script setup lang="ts">
/**
 * @fileoverview header 的渲染壳：背景底图层、花纹风格、CRT 扫描线、横向扫光带、
 * 底部辉光分隔线、中央两侧装饰。壳里**没有标题条**——标题是拖进来的文字块子节点。
 * ⚠ 子节点走**默认插槽**由运行时注入，插槽名写错既不报错也不渲染——
 * 由 tests/modules/header/Component.spec.ts 的插槽用例守。
 */
import type { ModuleMeta } from '@dt/contracts'
import { computed, type CSSProperties } from 'vue'

import { bannerBackground } from '../../shared/background'
import { readBoolean, readNumber, readText } from '../../shared/config'
import {
  CONTAINER_CONFIG_KEY,
  readContainerLayout,
} from '../../shared/container'
import { normalizeDeco, normalizeVariant } from './options'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

/** 「素净」风格不画花纹、扫描线与扫光：那一档要的就是干净。 */
const PLAIN_VARIANT = 'plain'

/** 底线内缩的上限。到 50% 左右边界就交叉了，线会整条消失。 */
const INSET_MAX = 49

const layout = computed(() =>
  readContainerLayout(props.config[CONTAINER_CONFIG_KEY]),
)

const variant = computed(() => normalizeVariant(readText(props.config.variant)))
const deco = computed(() => normalizeDeco(readText(props.config.deco, 'bars')))
const isDecorated = computed(() => variant.value !== PLAIN_VARIANT)

/** 空串要回落默认色：空的强调色会让花纹、装饰与辉光线一起失色。 */
const accent = computed(() =>
  readText(props.config.accent, 'var(--accent-primary)'),
)
const background = computed(() => readText(props.config.background))
const isScanlineShown = computed(
  () => readBoolean(props.config.scanlines, true) && isDecorated.value,
)

/** 底图那一层的 `background` 值；地址会被铺成整宽贴底的横幅。 */
const bgLayer = computed(() => bannerBackground(readText(props.config.bgImage)))
/** 翼台风格自带纯 CSS 轮廓，没底图时也要有这一层来承载它。 */
const isBgLayerShown = computed(
  () => bgLayer.value !== '' || variant.value === 'podium',
)
/**
 * 翼台轮廓只在「选了翼台且没自带底图」时上身：用户给了底图就说明他要那张图的形状，
 * 再拿 clip-path 裁一刀就把图裁坏了。
 */
const isPodiumOutline = computed(
  () => variant.value === 'podium' && bgLayer.value === '',
)

const isScanShown = computed(
  () => readBoolean(props.config.scan) && isDecorated.value,
)
const isScanAbove = computed(() => readBoolean(props.config.scanAbove, true))

/** 0 = 整条贯通，不注入变量；≥50 会让左右边界交叉，夹到上限。 */
const glowLineInset = computed(() => {
  const value = readNumber(props.config.glowLineInset, 0)
  return value > 0 ? Math.min(value, INSET_MAX) : 0
})

/**
 * 挂在根上的变量。一律「没配 → 不进 style → 由 CSS 里 `var(x, 兜底)` 的兜底决定」，
 * 与卡片外观同一条铁律。
 */
const shellVars = computed<CSSProperties>(() => {
  const vars: Record<string, string> = { '--dt-header-accent': accent.value }
  const gap = readNumber(props.config.decoGap, 0)
  if (gap > 0) vars['--dt-deco-gap'] = `${gap}px`
  if (bgLayer.value !== '') vars['--dt-header-bg'] = bgLayer.value
  const filter = readText(props.config.bgFilter)
  if (filter !== '') vars['--dt-header-bg-filter'] = filter
  if (isScanShown.value) {
    const width = readNumber(props.config.scanWidth, 30)
    const seconds = readNumber(props.config.scanDuration, 4)
    if (width > 0) vars['--dt-scan-w'] = `${width}%`
    if (seconds > 0) vars['--dt-scan-dur'] = `${seconds}s`
    vars['--dt-scan-color'] = readText(
      props.config.scanColor,
      'var(--card-border)',
    )
  }
  if (glowLineInset.value > 0) {
    vars['--dt-glowline-inset'] = `${glowLineInset.value}%`
  }
  // 只在显式关掉时注入 none；开着不注入，由 CSS 里那条默认外发光生效
  if (!readBoolean(props.config.glowLineGlow, true)) {
    vars['--dt-glowline-shadow'] = 'none'
  }
  return vars
})

const shellStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = { ...shellVars.value }
  if (background.value !== '') style.backgroundColor = background.value
  return style
})

const contentStyle = computed<CSSProperties>(() => ({
  padding: `${layout.value.pad}px`,
}))
</script>

<template>
  <div
    class="dt-header"
    :class="[`dt-header--${variant}`, { 'dt-scanlines': isScanlineShown }]"
    :style="shellStyle"
  >
    <!-- 底图单独一层真实元素而不是伪元素：滤镜打在这一层上，子节点的文字不跟着偏色。
         排在最前 → 与同为 z-index:0 的装饰层比 DOM 序，恒在它之下 -->
    <i
      v-if="isBgLayerShown"
      class="dt-header__bg"
      :class="{ 'dt-header__bg--podium': isPodiumOutline }"
      aria-hidden="true"
    />

    <!-- 沿中线左右对称的装饰：环境层，不吃指针，压在子节点之下 -->
    <div
      v-if="deco !== 'none' && isDecorated"
      class="dt-header__deco"
      :class="`dt-header__deco--${deco}`"
      aria-hidden="true"
    >
      <span class="dt-header__deco-bar dt-header__deco-bar--l" />
      <span class="dt-header__deco-bar dt-header__deco-bar--r" />
    </div>

    <div class="dt-header__content" :style="contentStyle"><slot /></div>

    <!-- 扫光必须是真实元素：::after 已经被 .dt-scanlines 的 CRT 纹理占住了 -->
    <span
      v-if="isScanShown"
      class="dt-header__scan"
      :class="{ 'dt-header__scan--above': isScanAbove }"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped lang="scss">
@use './deco';
@use './variants';
@use './shell';
</style>
