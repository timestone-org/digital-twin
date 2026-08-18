<script setup lang="ts">
/**
 * @fileoverview 一个指标格：名称、读数、单位，以及「这一格为什么没有读数」。
 *
 * ⚠ 没有读数时**不留白**：三档各画各的短标签（未绑定／等待首帧／取不到），
 * 完整原因挂 `title`。留白的那一格看起来和「现场读数正好是空」一样，而后者
 * 根本不存在（DASHBOARD_DESIGN §4.3）。
 * ⚠ 单位只在有读数时画：「— kV」看着像是有读数的。
 */
import { computed, type CSSProperties } from 'vue'

import { levelColor } from '../../shared/thresholds'
import type { MetricCell, MetricLook } from './metrics'

const props = defineProps<{ cell: MetricCell; look: MetricLook }>()

const emit = defineEmits<{ pick: [value: string] }>()

/** 有读数时才谈得上告警配色，其余档一律用弱化的次要色。 */
const valueStyle = computed<CSSProperties>(() => ({
  fontSize: `${props.look.valueSize}px`,
  color:
    props.cell.state !== 'ok'
      ? 'var(--text-secondary)'
      : props.cell.level === null || props.cell.level === 'normal'
        ? props.look.valueColor
        : levelColor(props.cell.level),
}))

const labelStyle = computed<CSSProperties>(() => ({
  fontSize: `${props.look.labelSize}px`,
}))

/** 状态点：配了阈值边界的格子才有——没有判据就连「正常」都不该说。 */
const dotColor = computed(() =>
  props.cell.level === null ? '' : levelColor(props.cell.level),
)

const showDot = computed(
  () => props.look.showStatusDot && dotColor.value !== '',
)

/** 脚注这一行有没有东西可画，没有就整行不占位。 */
const hasFoot = computed(
  () =>
    showDot.value ||
    props.cell.hitLabel !== '' ||
    props.cell.stateLabel !== '' ||
    (props.look.showUpdatedAt && props.cell.updatedAt !== ''),
)

/**
 * 点这一格。
 * ⚠ 吞冒泡是**有条件**的：配了联动值就吞（否则同一次点击会再被「整块可点」
 * 兜底抛一个没有 value 的 click，toggle 类动作当场自我抵消）；没配就放它上去，
 * 那时整块那一条才是这次点击唯一的落点。
 * @param event 原生点击事件
 */
function onPick(event: MouseEvent): void {
  if (props.cell.emitValue === '') return
  event.stopPropagation()
  emit('pick', props.cell.emitValue)
}
</script>

<template>
  <div
    class="metric-cell"
    :class="[
      `metric-cell--${look.align}`,
      { 'metric-cell--row': look.isRow, 'metric-cell--blink': cell.blink },
    ]"
    :title="cell.reason === '' ? undefined : cell.reason"
    @click="onPick"
  >
    <span class="metric-cell__label" :style="labelStyle">{{ cell.label }}</span>
    <span class="metric-cell__value" :style="valueStyle">
      {{ cell.text }}
      <span v-if="cell.unit !== ''" class="metric-cell__unit">
        {{ cell.unit }}
      </span>
    </span>
    <span v-if="hasFoot" class="metric-cell__foot">
      <span
        v-if="showDot"
        class="metric-cell__dot"
        :style="{ color: dotColor }"
        aria-hidden="true"
      />
      <span v-if="cell.hitLabel !== ''" class="metric-cell__hit">
        {{ cell.hitLabel }}
      </span>
      <span
        v-if="cell.stateLabel !== ''"
        class="metric-cell__state"
        :class="{ 'metric-cell__state--bad': cell.state === 'error' }"
        role="status"
      >
        {{ cell.stateLabel }}
      </span>
      <span
        v-if="look.showUpdatedAt && cell.updatedAt !== ''"
        class="metric-cell__time"
      >
        {{ cell.updatedAt }}
      </span>
    </span>
  </div>
</template>

<style scoped lang="scss">
.metric-cell {
  display: flex;
  overflow: hidden;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.metric-cell--center {
  align-items: center;
  text-align: center;
}

// 列表行：名称在左、读数在右，脚注跟在读数后面
.metric-cell--row {
  flex-direction: row;
  align-items: baseline;
  justify-content: flex-start;
  gap: 8px;

  .metric-cell__label {
    flex: 1 1 0%;
  }

  .metric-cell__foot {
    flex: none;
  }
}

.metric-cell__label {
  overflow: hidden;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.metric-cell__value {
  display: flex;
  overflow: hidden;
  align-items: baseline;
  min-width: 0;
  line-height: 1.15;
  // 读数是等宽的：比例字体下，每跳一次数字整行都在左右抖
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  gap: 4px;
}

.metric-cell--center .metric-cell__value {
  justify-content: center;
}

.metric-cell__unit {
  flex: none;
  color: var(--text-secondary);
  font-size: 0.5em;
  font-weight: 400;
}

.metric-cell__foot {
  display: flex;
  align-items: center;
  color: var(--text-secondary);
  font-size: 11px;
  gap: 4px;
}

.metric-cell__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 5px currentColor;
}

// 取不到要显眼：它是「去查现场」的信号，与「还没配」不是一回事
.metric-cell__state--bad {
  color: var(--state-danger);
}

.metric-cell__time {
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.metric-cell--blink .metric-cell__value {
  animation: metric-cell-blink 1.1s ease-in-out infinite;
}

@keyframes metric-cell-blink {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .metric-cell--blink .metric-cell__value {
    animation: none;
  }
}
</style>
