<script setup lang="ts">
/**
 * @fileoverview image-block 的渲染：URL 走 `<img>`、CSS 值走背景层，两条路共用同一套
 * 画面调节。取不回图时画一句占位，而不是留一个浏览器的碎图图标。
 */
import type { ModuleMeta } from '@dt/contracts'
import { computed, ref, watch, type CSSProperties } from 'vue'

import ModulePanel from '../../shared/ModulePanel.vue'
import {
  readBoolean,
  readEnum,
  readNumber,
  readText,
  readTrimmedText,
} from '../../shared/config'
import { isAssetRef, resolveImageValue } from '../../shared/assetImage'
import { imageSourceKind } from '../../shared/background'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const FITS = ['contain', 'cover', 'fill'] as const
const POSITIONS = ['center', 'top', 'bottom', 'left', 'right'] as const
const REPEATS = ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'] as const
// CSS 值那条路用 background-size 表达同一套语义，'fill' 没有对应关键字，得写成两轴拉满
const BACKGROUND_SIZES = {
  contain: 'contain',
  cover: 'cover',
  fill: '100% 100%',
} as const

const title = computed(() => readText(props.config.title))
// 先 trim：一串空白算没填，否则会渲染出一个必然加载失败的 img
const rawSrc = computed(() => readTrimmedText(props.config.src))
// 素材引用摊成地址后再判来源：不摊的话 `asset:…` 会被当成 URL 塞进 img，得到一个碎图图标
const source = computed(() => resolveImageValue(rawSrc.value))
const kind = computed(() => imageSourceKind(source.value))
// 挑了素材却摊不出地址（宿主没装解析、素材已被删）：这是取不回，不是没配
const isBrokenRef = computed(
  () => isAssetRef(rawSrc.value) && source.value === '',
)
const alt = computed(() => readText(props.config.alt))
const fit = computed(() => readEnum(props.config.fit, FITS, 'contain'))
const position = computed(() =>
  readEnum(props.config.position, POSITIONS, 'center'),
)

/** 以 100% 为恒等的滤镜：等于 100 就不写，免得给浏览器一条恒等的滤镜去算。 */
function percentFilter(name: string, raw: unknown): string | null {
  const value = Math.max(0, readNumber(raw, 100))
  return value === 100 ? null : `${name}(${value}%)`
}

/** 以 0% 为恒等的滤镜（灰度、反相、褪色这一类），同样等于恒等就不写。 */
function amountFilter(name: string, raw: unknown): string | null {
  const value = Math.max(0, readNumber(raw, 0))
  return value === 0 ? null : `${name}(${value}%)`
}

const filter = computed(() => {
  const blur = Math.max(0, readNumber(props.config.blur, 0))
  // 色相是角度不是数量，负值合法，所以不跟着百分比档一起夹到 0
  const hueRotate = readNumber(props.config.hueRotate, 0)
  // ⚠ 负值必须先夹掉：`brightness(-10%)` 会让**整条** filter 声明作废，
  //   表现是其他几档滤镜一起失效，而不是这一档不生效
  const parts = [
    blur > 0 ? `blur(${blur}px)` : null,
    amountFilter('grayscale', props.config.grayscale),
    percentFilter('brightness', props.config.brightness),
    percentFilter('contrast', props.config.contrast),
    percentFilter('saturate', props.config.saturate),
    hueRotate === 0 ? null : `hue-rotate(${hueRotate}deg)`,
    amountFilter('invert', props.config.invert),
    amountFilter('sepia', props.config.sepia),
  ].filter((part) => part !== null)
  return parts.join(' ')
})

const transform = computed(() => {
  const rotate = readNumber(props.config.rotate, 0)
  const parts = [
    readBoolean(props.config.flipX) ? 'scaleX(-1)' : null,
    readBoolean(props.config.flipY) ? 'scaleY(-1)' : null,
    rotate === 0 ? null : `rotate(${rotate}deg)`,
  ].filter((part) => part !== null)
  return parts.join(' ')
})

/** 两条路共用的画面调节；没配的项一律不注入。 */
const commonStyle = computed<CSSProperties>(() => {
  const opacity = Math.min(
    100,
    Math.max(0, readNumber(props.config.opacity, 100)),
  )
  const rounded = Math.max(0, readNumber(props.config.rounded, 0))
  const style: CSSProperties = { opacity: opacity / 100 }
  if (rounded > 0) style.borderRadius = `${rounded}px`
  if (transform.value !== '') style.transform = transform.value
  if (filter.value !== '') style.filter = filter.value
  return style
})

const imageStyle = computed<CSSProperties>(() => ({
  ...commonStyle.value,
  objectFit: fit.value,
  objectPosition: position.value,
}))

// ⚠ 写 background-image 而不是 background 简写：简写会把颜色、重复、定位一起重置，
//   于是下面三项的顺序稍一颠倒就被自己清掉，而清掉是看不出来的
const cssStyle = computed<CSSProperties>(() => ({
  ...commonStyle.value,
  backgroundImage: source.value,
  backgroundSize: BACKGROUND_SIZES[fit.value],
  backgroundPosition: position.value,
  backgroundRepeat: readEnum(props.config.repeat, REPEATS, 'no-repeat'),
}))

// 取不回图时换成占位；换了地址要复位，否则新地址永远显示上一张的失败
const hasFailed = ref(false)
watch(source, () => {
  hasFailed.value = false
})

// 两句兜底与清单里的 default 逐字同值；配成空串即「占位时一个字都不显示」
const placeholder = computed(() =>
  hasFailed.value || isBrokenRef.value
    ? readText(props.config.errorText, '图片加载失败')
    : readText(props.config.emptyText, '未设置图片'),
)
</script>

<template>
  <ModulePanel :title="title">
    <div class="dt-image-block">
      <img
        v-if="kind === 'url' && !hasFailed"
        class="dt-image-block__image"
        :src="source"
        :alt="alt"
        :style="imageStyle"
        loading="lazy"
        @error="hasFailed = true"
      />
      <span
        v-else-if="kind === 'css'"
        class="dt-image-block__css"
        :style="cssStyle"
      />
      <span v-else class="dt-image-block__empty">{{ placeholder }}</span>
    </div>
  </ModulePanel>
</template>

<style scoped lang="scss">
.dt-image-block {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.dt-image-block__image,
.dt-image-block__css {
  display: block;
  width: 100%;
  height: 100%;
}

.dt-image-block__empty {
  color: var(--text-disabled);
  font-size: 12px;
}
</style>
