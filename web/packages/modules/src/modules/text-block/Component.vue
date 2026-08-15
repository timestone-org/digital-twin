<script setup lang="ts">
/**
 * @fileoverview text-block 的渲染：逐行输出文字，排版旋钮全部收敛后写成内联样式。
 * ⚠ 数值一律夹取到清单声明的范围：`min` / `max` 只约束属性面板，脏配置里的
 * `-5` 会让整条声明被浏览器丢掉，而 `0` 会让文字彻底看不见。
 */
import type { ModuleMeta } from '@dt/contracts'
import { computed, type CSSProperties } from 'vue'

import ModulePanel from '../../shared/ModulePanel.vue'
import {
  readBoolean,
  readEnum,
  readNumber,
  readText,
  readTrimmedText,
} from '../../shared/config'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

/** 空行的占位字符：空 `<span>` 会塌成 0 高，段落间距当场消失。 */
const BLANK_LINE = '\u00a0'

const V_ALIGNS = {
  top: 'flex-start',
  center: 'center',
  bottom: 'flex-end',
} as const

const FONT_FAMILY_KINDS = ['sans', 'display', 'mono', 'custom'] as const
type FontFamilyKind = (typeof FONT_FAMILY_KINDS)[number]

// 'sans' 与 'custom' 都不在表里：前者的语义是「不注入 font-family、继承外层正文
// 字体」，后者的字体名由 fontFamilyCustom 直接给
const FONT_FAMILIES = {
  display: 'var(--font-display)',
  mono: 'var(--font-mono)',
} as const

/** 辉光的颜色与形状写在样式表里，只有半径这一个数值由配置给。 */
type TextBlockStyle = CSSProperties & { '--dt-text-glow-radius'?: string }

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * 要注入的 font-family；空串 = 不注入，继承外层正文字体。
 * @param kind 字体档
 * @param custom 自定义档填的字体名，留空即回到「继承」
 */
function fontFamilyOf(kind: FontFamilyKind, custom: string): string {
  if (kind === 'sans') return ''
  if (kind === 'custom') return custom
  return FONT_FAMILIES[kind]
}

const title = computed(() => readText(props.config.title))

// 缺省与清单里的 default 同值：脱开运行时单独挂载时也该看到示例文本而不是空白
const lines = computed(() =>
  readText(props.config.text, '示例文本')
    .split(/\r?\n/)
    .map((text, index) => ({
      // ⚠ 键带上行文本：纯序号做键时删掉中间一行会让其余行整体错位
      key: `${index}:${text}`,
      text: text === '' ? BLANK_LINE : text,
    })),
)

const overflow = computed(() =>
  readEnum(
    props.config.overflow,
    ['hidden', 'scroll', 'ellipsis'] as const,
    'hidden',
  ),
)

const isGlowing = computed(() => readBoolean(props.config.glow))

const glowRadius = computed(() =>
  clamp(readNumber(props.config.glowRadius, 10), 0, 40),
)

const style = computed<TextBlockStyle>(() => {
  const background = readText(props.config.background)
  const letterSpacing = clamp(readNumber(props.config.letterSpacing, 0), 0, 40)
  const opacity = clamp(readNumber(props.config.opacity, 1), 0, 1)
  const family = fontFamilyOf(
    readEnum(props.config.fontFamily, FONT_FAMILY_KINDS, 'sans'),
    readTrimmedText(props.config.fontFamilyCustom),
  )
  const value: TextBlockStyle = {
    padding: `${clamp(readNumber(props.config.padding, 8), 0, 48)}px`,
    // 兜底与清单里的 default 必须逐字同值：先看画布的正文字色，画布也没配才走主题色
    color: readText(
      props.config.color,
      'var(--card-text, var(--text-primary))',
    ),
    fontSize: `${clamp(readNumber(props.config.fontSize, 16), 8, 120)}px`,
    fontWeight: clamp(readNumber(props.config.weight, 400), 100, 900),
    lineHeight: clamp(readNumber(props.config.lineHeight, 1.4), 1, 3),
    textAlign: readEnum(
      props.config.align,
      ['left', 'center', 'right'] as const,
      'left',
    ),
    justifyContent:
      V_ALIGNS[
        readEnum(
          props.config.vAlign,
          ['top', 'center', 'bottom'] as const,
          'center',
        )
      ],
    // 滚动档才给滚动条；省略号的横向截断落在每一行自己身上
    overflow: overflow.value === 'scroll' ? 'auto' : 'hidden',
  }
  // 以下四项一律「没配 = 不注入」：注入了就再也继承不到外层的排版
  if (background !== '') value.background = background
  // ⚠ 字距的 0 是「沿用样式表里的 0.02em」，不是真的 0：改成真 0 会让所有没配过
  //   字距的存量大屏一起变窄，故哨兵语义只增不改（理由见清单里这一项的 help）
  if (letterSpacing > 0) value.letterSpacing = `${letterSpacing}px`
  if (opacity < 1) value.opacity = opacity
  if (family !== '') value.fontFamily = family
  if (isGlowing.value) value['--dt-text-glow-radius'] = `${glowRadius.value}px`
  return value
})
</script>

<template>
  <ModulePanel :title="title">
    <div
      class="dt-text-block"
      :class="{
        'dt-text-block--glow': isGlowing,
        'dt-text-block--ellipsis': overflow === 'ellipsis',
      }"
      :style="style"
    >
      <span v-for="line in lines" :key="line.key" class="dt-text-block__line">{{
        line.text
      }}</span>
    </div>
  </ModulePanel>
</template>

<style scoped lang="scss">
.dt-text-block {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  letter-spacing: 0.02em;
}

.dt-text-block__line {
  display: block;
  // 用空格/制表排版的行内连续空白原样保留，否则会被 HTML 折成一个空格
  white-space: pre-wrap;
}

// 逐行省略号：行内不换行，横向截断；纵向由容器的 overflow 裁
.dt-text-block--ellipsis .dt-text-block__line {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

// 辉光取文字自己的颜色，换肤时跟着一起走；半径的兜底与清单里的 default 同值
.dt-text-block--glow {
  text-shadow: 0 0 var(--dt-text-glow-radius, 10px) currentcolor;
}
</style>
