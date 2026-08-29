<script setup lang="ts">
/**
 * @fileoverview 进度件的**画法**：`bar` 是细条（小字 + 占比读数 + 可选发光圆点 + 轨道），
 * `track` 是粗轨道（四根等距刻度 + 虚线目标标记 + 轨道内 pill）。
 *
 * ⚠ 它只画，不算：`MeterView` 进来时百分比已经算完了。算法是各模块自己的行/格语义，
 * 画法是同一件事——两者分家才有得复用（MODULE_DATA_CARD_DESIGN §5.1）。
 * ⚠ 尺寸与配色**只认 `--dt-meter-*` 变量**，由调用方注入（`shared/meter.ts`）。
 */
import { computed, type CSSProperties } from 'vue'

import { fmtDecimal, fmtNumber, NO_DATA } from './format'
import type { MeterKind, MeterScale, MeterView } from './meter'

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
  <div class="dt-meter" :class="`dt-meter--${kind}`">
    <i v-if="meter.label !== ''" class="dt-meter__label">{{ meter.label }}</i>
    <b v-if="meter.text !== ''" class="dt-meter__pct">{{ meter.text }}</b>
    <i v-if="dot" class="dt-meter__dot" aria-hidden="true" />
    <span class="dt-meter__wrap">
      <span class="dt-meter__track">
        <span
          v-if="meter.fill !== ''"
          class="dt-meter__fill"
          :style="{ width: meter.fill }"
        />
        <span v-if="pillText !== ''" class="dt-meter__pill">{{
          pillText
        }}</span>
        <i
          v-if="targetFrac !== null"
          class="dt-meter__target"
          :style="{ left: `${targetFrac * 100}%` }"
          aria-hidden="true"
        />
        <span
          v-if="targetText !== ''"
          class="dt-meter__target-label"
          :style="targetLabelStyle"
          >{{ targetText }}</span
        >
      </span>
      <span v-if="ticks.length > 0" class="dt-meter__ticks">
        <i
          v-for="tick in ticks"
          :key="tick.key"
          class="dt-meter__tick"
          :style="tick.style"
          >{{ tick.label }}</i
        >
      </span>
    </span>
  </div>
</template>

<style scoped lang="scss">
.dt-meter {
  // 条色只在这一层解析一次，下面四处都读它
  /* 颜色三级回落：调用方显式给的 → 调用方声明的「跟随行/格色」→ 主题强调色。
     ⚠ 第二级是给 info-list 这类**按行染色**的调用方留的口子：它的行色靠 CSS 级联
     往下走，逐行注入 meter 色表达不了。⚠ 这里只认中性名，不认任何一个模块自己的变量。 */
  --dt-meter-ink: var(
    --dt-meter-color,
    var(--dt-meter-base, var(--accent-primary))
  );

  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  white-space: nowrap;
  gap: 5px;
}

.dt-meter__label {
  flex: none;
  color: var(--text-secondary);
  font-style: normal;
  font-size: 11px;
  line-height: 1;
}

.dt-meter__pct {
  flex: none;
  color: var(--dt-meter-ink);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  text-shadow: 0 0 6px var(--dt-meter-ink);
}

.dt-meter__dot {
  flex: none;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--dt-meter-ink);
  box-shadow: 0 0 6px var(--dt-meter-ink);
}

.dt-meter__wrap {
  display: block;
  flex: 1 1 auto;
  min-width: 36px;
  max-width: var(--dt-meter-w, 100%);
}

.dt-meter__track {
  position: relative;
  display: block;
  width: 100%;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--accent-primary) 16%, transparent);
}

.dt-meter--bar .dt-meter__track {
  overflow: hidden;
  height: var(--dt-meter-h, 4px);
  min-height: 2px;
}

// 粗轨道要露出目标标记与它上方的标签，所以这一档不裁
.dt-meter--track .dt-meter__track {
  overflow: visible;
  height: 18px;
  background: color-mix(in srgb, var(--border-strong) 55%, transparent);
}

.dt-meter__fill {
  position: absolute;
  inset: 0 auto 0 0;
  min-width: 2px;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--dt-meter-ink);
  box-shadow: 0 0 var(--dt-meter-glow, 6px) var(--dt-meter-ink);
  transition: width 0.4s ease;
}

.dt-meter--track .dt-meter__fill {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--dt-meter-ink) 60%, transparent),
    var(--dt-meter-ink)
  );
}

.dt-meter__pill {
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

.dt-meter__target {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 0;
  border-left: 1px dashed var(--state-warning);
}

.dt-meter__target-label {
  position: absolute;
  bottom: calc(100% + 2px);
  color: var(--state-warning);
  font-size: 10px;
  white-space: nowrap;
}

.dt-meter__ticks {
  position: relative;
  display: block;
  height: 14px;
  margin-top: 5px;
}

.dt-meter__tick {
  position: absolute;
  top: 0;
  color: var(--text-secondary);
  font-style: normal;
  font-size: 10px;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .dt-meter__fill {
    transition: none;
  }
}
</style>
