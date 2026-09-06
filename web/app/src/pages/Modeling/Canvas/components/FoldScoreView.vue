<script setup lang="ts">
/**
 * @fileoverview 交叉验证这一屏：均值与最差一折两条横条 + ±1σ 误差棒
 * （设计规格 §5-24）。指标卡在派发外壳 `MetricsView.vue` 上。
 */
import { DtNotice } from '@dt/ui'
import { computed } from 'vue'

import type { BarListItem } from '../scripts/barList'
import { niceNumber } from '../scripts/numbers'

import BarList from './BarList.vue'

const props = withDefaults(
  defineProps<{
    /** 后端 `diagnostics._summary` 的四个标量。 */
    metrics: readonly (readonly [string, number | null])[]
    /**
     * 这一路带回了讲解块——逐折分数与折布局就在其中，同屏上方已经画出来了。
     *
     * ⚠ 缺省是 false：老运行只有那四个标量，那时「逐折的分没带回来」是实话。
     */
    hasFoldBlocks?: boolean
  }>(),
  { hasFoldBlocks: false },
)

const table = computed(() => new Map(props.metrics))

/** 取一个标量；没有那个键就是没算出来。Args: key。 */
function valueOf(key: string): number | null {
  return table.value.get(key) ?? null
}

const rows = computed<BarListItem[]>(() => {
  const mean = valueOf('score_mean')
  const worst = valueOf('score_worst')
  const made: BarListItem[] = []
  if (mean !== null) {
    made.push({ name: '平均分', value: mean, spread: valueOf('score_std') })
  }
  if (worst !== null) {
    made.push({ name: '最差一折', value: worst, tone: 'dropped' })
  }
  return made
})

/**
 * 波动与平均分之比。
 *
 * ⚠ σ=0.03 是好是坏取决于均值多大，替用户做这一步除法是有根据的（规格 §5-24）；
 * 但三档的界还没有来源，所以只报比值不染色。
 */
const stability = computed(() => {
  const mean = valueOf('score_mean')
  const sd = valueOf('score_std')
  if (mean === null || sd === null || mean === 0) return ''
  return `波动与平均分之比 ${niceNumber(Math.abs(sd / mean))}——比值越大，说明换一折结果就变。`
})

const caption = computed(
  () => `每折的分：回归是 R²、分类是准确率；误差棒是 ±1σ。${stability.value}`,
)
</script>

<template>
  <div class="dt-ml-folds">
    <BarList
      :items="rows"
      :caption="caption"
      empty-text="这一步没有带回可画的分数"
    />
    <DtNotice v-if="!props.hasFoldBlocks" intent="info">
      逐折的分数没有随这份摘要带回来，这里只有它们的均值、波动与最差的那一折；
      每折各自的分与训练/测试段的摆法要等后端补上。
    </DtNotice>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-folds {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
</style>
