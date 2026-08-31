<script setup lang="ts">
/**
 * @fileoverview 进度条部件：**只算**占比，画法整件交给共用的 `MeterBar`——
 * info-list 的行里用的是同一份，不留第二套 CSS（MODULE_DATA_CARD_DESIGN §5.1）。
 *
 * ⚠ 两条路都算不出占比时整件不画：**绝不拿 0% 冒充「算不出来」**，
 * 那会让一条满量程的管道看着像空的。
 */
import { computed } from 'vue'

import type { CardPartProps, CardSlotKey } from '../../../../cardParts/types'
import { CARD_SLOT_KEYS } from '../../../../cardParts/types'
import {
  readBoolean,
  readEnum,
  readNumber,
  readText,
} from '../../../../shared/config'
import { fmtTrim, toNumOrNull } from '../../../../shared/format'
import MeterBar from '../../../../shared/MeterBar.vue'
import { litSegments } from '../../../../shared/meter'
import type { MeterScale, MeterVars, MeterView } from '../../../../shared/meter'

// ⚠ 三件套一个都不能少：没声明的那个会掉成透传属性，在 DOM 上留下
//   `meta="[object Object]"` 这种脏东西，而两侧都不报错
const props = defineProps<CardPartProps>()

const LOOKS = ['bar', 'track', 'segments'] as const
// 分段档缺省几格：图上那种一排格子多在十几格，太少看着像刻度、太多糊成一条
const DEFAULT_SEGMENTS = 16
const SOURCES = ['auto', 'ratio', 'range', 'share'] as const

const look = computed(() => readEnum(props.part.look, LOOKS, 'bar'))

const source = computed(() => readEnum(props.part.source, SOURCES, 'auto'))

/** 读哪个槽；「自动」档不看它。 */
const slot = computed<CardSlotKey>(() =>
  readEnum(props.part.slot, CARD_SLOT_KEYS, 'value'),
)

/** 按量程折算。⚠ 量程倒挂（上限 ≤ 下限）时算不出，返回 null 而不是 0。 */
function byRange(value: number): number | null {
  const min = readNumber(props.part.min, 0)
  const max = readNumber(props.part.max, 100)
  const span = max - min
  return span <= 0 ? null : ((value - min) / span) * 100
}

/**
 * 占比（未夹取的原值）。
 * ⚠ 「自动」档保的是 §2.2 那条口径：`ratio` 槽多数场合可以不接。
 * ⚠ 每一档算不出来时都返回 null 而不是 0：量程倒挂、合计为 0、槽里没值，
 * 三种都是「算不出来」，画成 0% 会让一条满量程的管道看着像空的。
 */
const percent = computed<number | null>(() => {
  if (source.value === 'auto') {
    const ratio = toNumOrNull(props.cell.values.ratio)
    if (ratio !== null) return ratio
    const value = toNumOrNull(props.cell.values.value)
    return value === null ? null : byRange(value)
  }
  const value = toNumOrNull(props.cell.values[slot.value])
  if (value === null) return null
  if (source.value === 'ratio') return value
  if (source.value === 'range') return byRange(value)
  const total = props.cell.totals[slot.value]
  // ⚠ 合计为 0 时不是 0%，是算不出来：除零画出来是 Infinity%
  return total === undefined || total === 0 ? null : (value / total) * 100
})

/**
 * 交给画法的那份视图。
 * ⚠ 条宽夹到 [0,100] 而占比读数**不夹**：120% 正是要让人看见的那个异常。
 */
const view = computed<MeterView>(() => {
  const pct = percent.value
  if (pct === null)
    return { show: false, label: '', text: '', fill: '', segments: null }
  const clamped = Math.max(0, Math.min(100, pct))
  return {
    show: true,
    label: readText(props.part.caption),
    text: readBoolean(props.part.showPercent, true)
      ? `${fmtTrim(pct, 1)}%`
      : '',
    fill: `${fmtTrim(clamped, 1)}%`,
    segments:
      look.value === 'segments'
        ? litSegments(pct, readNumber(props.part.segments, DEFAULT_SEGMENTS))
        : null,
  }
})

/** 粗轨道那一档的量程；细条档不给，`MeterBar` 据此不画刻度与 pill。 */
const scale = computed<MeterScale | null>(() => {
  if (look.value !== 'track') return null
  const target = readBoolean(props.part.showTarget, false)
    ? toNumOrNull(props.cell.values.aux)
    : null
  return {
    min: readNumber(props.part.min, 0),
    max: readNumber(props.part.max, 100),
    target,
    targetLabel: readText(props.part.targetLabel, '目标 '),
    wanFormat: false,
    wanDigits: 1,
    precision: props.cell.format.precision,
    pillValue: null,
    pillUnit: props.cell.format.unit,
  }
})

/** 注入给画法的那几个变量。⚠ 「没配 = 不写键」：写了就再也回落不到样式里的缺省。 */
const vars = computed<MeterVars>(() => {
  const width = readNumber(props.part.width, 0)
  const color = readText(props.part.color)
  const glow = readNumber(props.part.glow, 6)
  const out: MeterVars = {
    '--dt-meter-h': `${String(readNumber(props.part.height, 4))}px`,
    '--dt-meter-w': width === 0 ? '100%' : `${String(width)}px`,
  }
  if (color !== '') out['--dt-meter-color'] = color
  if (glow > 0) out['--dt-meter-glow'] = `${String(glow)}px`
  if (look.value === 'segments') {
    out['--dt-meter-gap'] = `${String(readNumber(props.part.gap, 3))}px`
  }
  return out
})
</script>

<template>
  <div v-if="view.show" class="dc-meter" :style="vars">
    <MeterBar
      :meter="view"
      :dot="readBoolean(part.dot, false)"
      :kind="look"
      :scale="scale"
    />
  </div>
</template>

<style scoped>
.dc-meter {
  width: 100%;
  min-width: 0;
}
</style>
