<script setup lang="ts">
/**
 * @fileoverview 阈值滑杆：拖到哪一档，混淆矩阵与四个指标卡就跟到哪一档
 * （结果展示规格 §13.3）。轨道上另有一条竖线，标着打分时真正用的那个阈值。
 *
 * ⚠ 查的是后端给的那张网格，一个概率都不重算：前端手上只有抽样过的散点，
 * 拿它现算的指标与同屏那几张卡对不上账，同屏两个数打架比没有这张图更坏。
 * ⚠ 查表是同步的，所以没有竞态可防——快速拖动只是把同一张表查很多遍，不存在
 * 「后发的先回来」。也因此这里没有定时器与监听要在卸载时清理。
 */
import { DtSlider } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import { breakdownOf } from '../scripts/reportBlocks'
import { buildThresholdGrid, endsOf, standAt } from '../scripts/thresholdGrid'

import MatrixTable from './MatrixTable.vue'
import StatCards from './StatCards.vue'

const props = defineProps<{ payload: Record<string, unknown> }>()

// 竖线的位置保留几位小数：整数档在 59 档上会差出小半格
const MARK_DIGITS = 2
const MATRIX_CAPTION =
  '行是真实类别、列是判成的类别；这一张跟着上面的滑杆走，不是打分时那一张'

const grid = computed(() =>
  buildThresholdGrid(props.payload, breakdownOf(props.payload).baseline),
)

/** 用户拖到哪一档；null = 还没拖过，停在打分时那一档。 */
const picked = ref<number | null>(null)

// 换了一个节点的结果就把手放开：上一份网格的第 40 档在这一份上是另一个阈值
watch(grid, () => {
  picked.value = null
})

const seat = computed(() => picked.value ?? grid.value.trainedSeat)

const stand = computed(() => standAt(grid.value, seat.value))

const ends = computed(() => endsOf(grid.value))

const last = computed(() => Math.max(0, grid.value.rows.length - 1))

const range = computed(() => ({ min: 0, max: last.value, step: 1 }))

const hasGrid = computed(() => grid.value.rows.length > 0)

/**
 * 竖线在轨道上的位置。
 *
 * ⚠ 只给百分比、拇指那半格由外层的左右外边距让：`calc()` 里套括号在部分
 * 环境下整条声明会被丢掉，而丢掉的样子就是竖线贴在最左边——看着像「打分时
 * 的阈值是最低那一档」。
 */
const markStyle = computed(() => {
  const span = last.value === 0 ? 1 : last.value
  const share = (grid.value.trainedSeat / span) * 100
  return { left: `${share.toFixed(MARK_DIGITS)}%` }
})

const trainedText = computed(() => {
  const row = grid.value.rows[grid.value.trainedSeat]
  const near = grid.value.isExact ? '' : '最近的一档是 '
  if (row === undefined) return ''
  return `竖线是打分时用的那个阈值，${near}${row.text}（第 ${grid.value.trainedSeat + 1} 档，共 ${grid.value.rows.length} 档）`
})

const readText = computed(
  () => `拖到第 ${seat.value + 1} 档：阈值 ${stand.value.text}`,
)

function pick(value: number): void {
  picked.value = Math.min(last.value, Math.max(0, Math.round(value)))
}
</script>

<template>
  <div v-if="hasGrid" class="dt-ml-threshold">
    <DtSlider
      :model-value="seat"
      :range="range"
      label="判成正类的阈值"
      :show-value="false"
      :aria-valuetext="readText"
      @update:model-value="pick"
    />
    <!-- ⚠ 竖线得紧贴在轨道下面：隔着一行字之后，它标的是哪一档就读不出来了 -->
    <div class="dt-ml-threshold__track">
      <span class="dt-ml-threshold__rail" />
      <span class="dt-ml-threshold__mark" :style="markStyle" />
    </div>
    <p class="dt-ml-threshold__ends">
      <span>最低 {{ ends.low }}</span>
      <span>往右推门槛更高，判成正类的行更少</span>
      <span>最高 {{ ends.high }}</span>
    </p>
    <p class="dt-ml-threshold__read">{{ readText }}</p>
    <p class="dt-ml-threshold__note">{{ trainedText }}</p>
    <MatrixTable
      :labels="stand.labels"
      :matrix="stand.matrix"
      :caption="MATRIX_CAPTION"
    />
    <StatCards :items="stand.cards" space="column" />
    <p class="dt-ml-threshold__read">{{ stand.summary }}</p>
    <p class="dt-ml-threshold__note">{{ stand.offset }}</p>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-threshold {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  // 竖线自己占一条细带，压在滑杆下面：画进轨道里会被拇指盖住。
  // 左右各让开半个拇指（原生 range 的拇指宽 16px），两端那两档才对得上位置
  &__track {
    position: relative;
    height: 0.5rem;
    margin: 0 8px;
  }

  // 整条量程铺一条实线：滑杆自己那条轨道未填充的一段是 4% 的黑，浅色底上几乎
  // 看不见（实测 1.04:1），只剩左边一小截蓝的，读起来像「只能拖这么点」。
  // ⚠ 这条线是读懂量程的必需品，按 WCAG 1.4.11 要 ≥3:1——0.25 的档实测只有
  // 1.72:1（浅色），六套里没有一套够
  &__rail {
    position: absolute;
    top: 3px;
    right: 0;
    left: 0;
    height: 2px;
    background: rgba(var(--neutral-fg-rgb), 0.55);
  }

  &__mark {
    position: absolute;
    top: 0;
    width: 2px;
    height: 100%;
    background: var(--text-secondary);
  }

  &__ends {
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__read {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__note {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
