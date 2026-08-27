<script lang="ts">
/**
 * @fileoverview 行里的进度件：`bar` 是细条（小字 + 占比读数 + 可选发光圆点 + 轨道），
 * `track` 是粗轨道（四根等距刻度 + 虚线目标标记 + 轨道内 pill）。
 * ⚠ 条宽由取值层夹到 [0,100] 而占比读数不夹：120% 正是要让人看见的那个异常
 * （MODULE_INFO_CARD_DESIGN §4.2）。
 */

/** 进度件的两档形态。 */
export type MeterKind = 'bar' | 'track'

/** 粗轨道那一档的量程：刻度、目标标记与轨道内 pill 都从它来。 */
export interface MeterScale {
  min: number
  max: number
  /** 目标标记的原值；`null` = 不画标记 */
  target: number | null
  targetLabel: string
  /** 「万」格式；⚠ `max` 不到一万时整件回落，小量程走万会让刻度全塌成「0.0万」 */
  wanFormat: boolean
  /** ⚠ 刻度与 pill 共用这一份小数位：参考仓刻度写死 1 位而 pill 另有一档，同一张卡两套口径 */
  wanDigits: number
  /** pill 读数的小数位；刻度一律取整 */
  precision: number
  /** 轨道内 pill 的读数原值；`null` = 不画 pill */
  pillValue: number | null
  pillUnit: string
}
</script>

<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'

import { fmtDecimal, fmtNumber, NO_DATA } from '../../shared/format'
import type { MeterView } from './rowAlarm'

const props = withDefaults(
  defineProps<{
    meter: MeterView
    /** 条前面的 4px 发光圆点 */
    dot: boolean
    kind?: MeterKind
    scale?: MeterScale | null
  }>(),
  { kind: 'bar', scale: null },
)

// 「万」的门槛，也是量程上界够不够格走这一档的判据
const WAN = 10000
// 刻度根数，首末两根落在轨道两端
const TICK_COUNT = 4
// 贴到轨道两端多近就换对齐基准
const EDGE_FRAC = 0.02

/** 「万」格式此刻生不生效。⚠ 量程上界不到一万时整件回落，不只回落刻度。 */
const useWan = computed(() => {
  const scale = props.scale
  return scale !== null && scale.wanFormat && scale.max >= WAN
})

/**
 * 刻度文案：整数，或「万」。
 * @param value 刻度处的量程值
 */
function tickText(value: number): string {
  const digits = props.scale?.wanDigits ?? 0
  return useWan.value
    ? `${fmtDecimal(value / WAN, digits)}万`
    : fmtNumber(value, 0)
}

/**
 * pill 与目标标签的读数：按量程的小数位，或「万」。
 * @param value 要写出来的原值
 */
function readoutText(value: number): string {
  const scale = props.scale
  return useWan.value
    ? `${fmtDecimal(value / WAN, scale?.wanDigits ?? 0)}万`
    : fmtNumber(value, scale?.precision ?? 0)
}

/**
 * 贴边的那一根换对齐基准，否则居中的一半会溢出卡片被裁掉。
 * @param frac 落点在量程上的比例
 */
function edgeShift(frac: number): string {
  if (frac <= EDGE_FRAC) return '0'
  return frac >= 1 - EDGE_FRAC ? '-100%' : '-50%'
}

/** 目标标记落在量程上的比例；量程倒挂或没配目标一律不画。 */
const targetFrac = computed(() => {
  const scale = props.scale
  if (scale === null || scale.target === null) return null
  const span = scale.max - scale.min
  if (span <= 0) return null
  return Math.max(0, Math.min(1, (scale.target - scale.min) / span))
})

const targetText = computed(() => {
  const scale = props.scale
  if (scale === null || scale.target === null) return ''
  return `${scale.targetLabel}${readoutText(scale.target)}`
})

const targetLabelStyle = computed<CSSProperties>(() => {
  const frac = targetFrac.value ?? 0
  return { left: `${frac * 100}%`, transform: `translateX(${edgeShift(frac)})` }
})

/** 四根等距刻度，只有粗轨道档带量程时才画。 */
const ticks = computed(() => {
  const scale = props.scale
  if (scale === null || props.kind !== 'track') return []
  const span = scale.max - scale.min
  return Array.from({ length: TICK_COUNT }, (_, index) => {
    const frac = index / (TICK_COUNT - 1)
    return {
      key: `tick-${String(index)}`,
      label: tickText(scale.min + span * frac),
      style: {
        left: `${frac * 100}%`,
        transform: `translateX(${edgeShift(frac)})`,
      } satisfies CSSProperties,
    }
  })
})

/** 轨道内 pill：读数 + 单位 +（占比算得出来时）占比。 */
const pillText = computed(() => {
  const scale = props.scale
  if (props.kind !== 'track' || scale === null || scale.pillValue === null) {
    return ''
  }
  const pct = props.meter.text
  const share = pct === '' || pct === NO_DATA ? '' : ` (${pct})`
  return `${readoutText(scale.pillValue)}${scale.pillUnit}${share}`
})
</script>

<template>
  <div class="il-meter" :class="`il-meter--${kind}`">
    <i v-if="meter.label !== ''" class="il-meter__label">{{ meter.label }}</i>
    <b v-if="meter.text !== ''" class="il-meter__pct">{{ meter.text }}</b>
    <i v-if="dot" class="il-meter__dot" aria-hidden="true" />
    <span class="il-meter__wrap">
      <span class="il-meter__track">
        <span
          v-if="meter.fill !== ''"
          class="il-meter__fill"
          :style="{ width: meter.fill }"
        />
        <span v-if="pillText !== ''" class="il-meter__pill">{{
          pillText
        }}</span>
        <i
          v-if="targetFrac !== null"
          class="il-meter__target"
          :style="{ left: `${targetFrac * 100}%` }"
          aria-hidden="true"
        />
        <span
          v-if="targetText !== ''"
          class="il-meter__target-label"
          :style="targetLabelStyle"
          >{{ targetText }}</span
        >
      </span>
      <span v-if="ticks.length > 0" class="il-meter__ticks">
        <i
          v-for="tick in ticks"
          :key="tick.key"
          class="il-meter__tick"
          :style="tick.style"
          >{{ tick.label }}</i
        >
      </span>
    </span>
  </div>
</template>

<style scoped lang="scss">
.il-meter {
  // 条色只在这一层解析一次，下面四处都读它
  --il-bar: var(--il-meter-color, var(--il-row-color, var(--accent-primary)));

  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  white-space: nowrap;
  gap: 5px;
}

.il-meter__label {
  flex: none;
  color: var(--text-secondary);
  font-style: normal;
  font-size: 11px;
  line-height: 1;
}

.il-meter__pct {
  flex: none;
  color: var(--il-bar);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  text-shadow: 0 0 6px var(--il-bar);
}

.il-meter__dot {
  flex: none;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--il-bar);
  box-shadow: 0 0 6px var(--il-bar);
}

.il-meter__wrap {
  display: block;
  flex: 1 1 auto;
  min-width: 36px;
  max-width: var(--il-meter-w, 100%);
}

.il-meter__track {
  position: relative;
  display: block;
  width: 100%;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--accent-primary) 16%, transparent);
}

.il-meter--bar .il-meter__track {
  overflow: hidden;
  height: var(--il-meter-h, 4px);
  min-height: 2px;
}

// 粗轨道要露出目标标记与它上方的标签，所以这一档不裁
.il-meter--track .il-meter__track {
  overflow: visible;
  height: 18px;
  background: color-mix(in srgb, var(--border-strong) 55%, transparent);
}

.il-meter__fill {
  position: absolute;
  inset: 0 auto 0 0;
  min-width: 2px;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--il-bar);
  box-shadow: 0 0 var(--il-meter-glow, 6px) var(--il-bar);
  transition: width 0.4s ease;
}

.il-meter--track .il-meter__fill {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--il-bar) 60%, transparent),
    var(--il-bar)
  );
}

.il-meter__pill {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  color: var(--text-title);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  text-shadow: 0 1px 2px
    color-mix(in srgb, var(--text-inverse) 70%, transparent);
  pointer-events: none;
}

.il-meter__target {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 0;
  border-left: 1px dashed var(--state-warning);
}

.il-meter__target-label {
  position: absolute;
  bottom: calc(100% + 2px);
  color: var(--state-warning);
  font-size: 10px;
  white-space: nowrap;
}

.il-meter__ticks {
  position: relative;
  display: block;
  height: 14px;
  margin-top: 5px;
}

.il-meter__tick {
  position: absolute;
  top: 0;
  color: var(--text-secondary);
  font-style: normal;
  font-size: 10px;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .il-meter__fill {
    transition: none;
  }
}
</style>
