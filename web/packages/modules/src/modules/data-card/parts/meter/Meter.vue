<script setup lang="ts">
/**
 * @fileoverview 进度条部件：**只算**占比，画法整件交给共用的 `MeterBar`——
 * info-list 的行里用的是同一份，不留第二套 CSS（MODULE_DATA_CARD_DESIGN §5.1）。
 *
 * ⚠ 两条路都算不出占比时整件不画：**绝不拿 0% 冒充「算不出来」**，
 * 那会让一条满量程的管道看着像空的。
 */
import { computed } from 'vue'

import type { CardPartProps } from '../../../../cardParts/types'
import {
  readBoolean,
  readEnum,
  readNumber,
  readText,
} from '../../../../shared/config'
import { fmtTrim, toNumOrNull } from '../../../../shared/format'
import MeterBar from '../../../../shared/MeterBar.vue'
import type { MeterScale, MeterVars, MeterView } from '../../../../shared/meter'

// ⚠ 三件套一个都不能少：没声明的那个会掉成透传属性，在 DOM 上留下
//   `meta="[object Object]"` 这种脏东西，而两侧都不报错
const props = defineProps<CardPartProps>()

const LOOKS = ['bar', 'track'] as const

const look = computed(() => readEnum(props.part.look, LOOKS, 'bar'))

/**
 * 占比（未夹取的原值）。**接了「占比」槽就直接用它**，否则按量程算。
 * ⚠ 量程倒挂（上限 ≤ 下限）时算不出，返回 null 而不是 0。
 */
const percent = computed<number | null>(() => {
  const ratio = toNumOrNull(props.cell.values.ratio)
  if (ratio !== null) return ratio
  const value = toNumOrNull(props.cell.values.value)
  if (value === null) return null
  const min = readNumber(props.part.min, 0)
  const max = readNumber(props.part.max, 100)
  const span = max - min
  return span <= 0 ? null : ((value - min) / span) * 100
})

/**
 * 交给画法的那份视图。
 * ⚠ 条宽夹到 [0,100] 而占比读数**不夹**：120% 正是要让人看见的那个异常。
 */
const view = computed<MeterView>(() => {
  const pct = percent.value
  if (pct === null) return { show: false, label: '', text: '', fill: '' }
  const clamped = Math.max(0, Math.min(100, pct))
  return {
    show: true,
    label: readText(props.part.caption),
    text: readBoolean(props.part.showPercent, true)
      ? `${fmtTrim(pct, 1)}%`
      : '',
    fill: `${fmtTrim(clamped, 1)}%`,
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
