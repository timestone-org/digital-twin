<script setup lang="ts">
/**
 * @fileoverview 分类这一屏：混淆矩阵 + 每类 P/R/F1/支持度 + 真实占比对预测占比
 * + 正类判定（设计规格 §5-21）。指标卡在派发外壳 `MetricsView.vue` 上。
 */
import type { DtTableColumn } from '@dt/contracts'
import { DtNotice, DtTable, DtTag } from '@dt/ui'
import { computed } from 'vue'

import type { BarListItem } from '../scripts/barList'
import { buildMatrixStats } from '../scripts/matrixStats'
import { niceNumber } from '../scripts/numbers'
import { positiveClassOf } from '../scripts/positiveClass'
import type { MetricsPreview } from '../scripts/preview'

import BarList from './BarList.vue'
import MatrixTable from './MatrixTable.vue'

const props = defineProps<{ preview: MetricsPreview }>()

const CLASS_COLUMNS: readonly DtTableColumn[] = [
  { key: 'label', label: '类目', width: '10rem', align: 'left' },
  { key: 'support', label: '支持度', width: '6rem', align: 'right' },
  { key: 'precision', label: '精确率', width: '6rem', align: 'right' },
  { key: 'recall', label: '召回率', width: '6rem', align: 'right' },
  { key: 'f1', label: 'F1', width: '6rem', align: 'right' },
]

interface ClassRow {
  readonly id: string
  readonly label: string
  readonly support: string
  readonly precision: string
  readonly recall: string
  readonly f1: string
  readonly isPositive: boolean
}

const stats = computed(() =>
  buildMatrixStats(props.preview.labels, props.preview.matrix),
)

const positive = computed(() =>
  positiveClassOf(stats.value.classes, props.preview.metrics),
)

const rows = computed<ClassRow[]>(() =>
  stats.value.classes.map((item, index) => ({
    id: `class-${index}`,
    label: item.label,
    support: niceNumber(item.support),
    precision: niceNumber(item.precision),
    recall: niceNumber(item.recall),
    f1: niceNumber(item.f1),
    isPositive:
      positive.value.kind === 'found' && positive.value.label === item.label,
  })),
)

/** 真实占比与预测占比并排：模型是不是全押多数类，一看就穿帮。 */
const shares = computed<BarListItem[]>(() =>
  stats.value.classes.map((item) => ({
    name: item.label,
    before: item.actualShare,
    after: item.predictedShare,
  })),
)

const SHARE_LABELS: readonly [string, string] = ['真实占比', '预测占比']

/** 测试集一行都没有时四个指标与矩阵一起没有，这不是「模型很差」。 */
const isEmptyTest = computed(
  () => stats.value.issue === '' && stats.value.total === 0,
)

const hasClasses = computed(() => stats.value.classes.length > 0)

const positiveText = computed(
  () => `正类：${positive.value.label}——精确率 / 召回率 / F1 都是相对它算的`,
)
</script>

<template>
  <div class="dt-ml-clf">
    <DtNotice v-if="isEmptyTest" intent="warning">
      这份测试集里一行都没有，四个指标与混淆矩阵都算不出来。
    </DtNotice>
    <!-- ⚠ 正类是 config 里的一个 float，摘要里没有这一项：这里靠报上来的
         精确率与召回率反查是哪一类，对不上就不画徽标（规格 R-20） -->
    <p v-if="positive.kind === 'found'" class="dt-ml-clf__positive">
      <DtTag intent="primary" size="sm">{{ positiveText }}</DtTag>
    </p>
    <DtNotice v-else-if="positive.kind === 'absent'" intent="danger">
      正类在这份测试集里一次都没出现过，也一次都没被判到过，精确率与召回率都是
      无定义——不是 0。
    </DtNotice>
    <DtNotice v-else-if="positive.kind === 'ambiguous'" intent="info">
      有不止一类的精确率与召回率一模一样，这份摘要里认不出哪一类是正类，所以不
      标徽标。
    </DtNotice>
    <MatrixTable
      :labels="props.preview.labels"
      :matrix="props.preview.matrix"
      caption="行是真实类别、列是判成的类别；对角格越深、这一类召回率越高，错格越深、错到那一格的行数越多"
    />
    <BarList
      v-if="hasClasses"
      mode="pairs"
      :items="shares"
      :pair-labels="SHARE_LABELS"
      caption="真实占比对预测占比——两排差得远，说明模型在往某一类上押"
    />
    <div v-if="hasClasses" class="dt-ml-clf__table">
      <DtTable :columns="CLASS_COLUMNS" :rows="rows" min-width="34rem">
        <template #cell-label="{ row }">
          <span class="dt-ml-clf__name">{{ row.label }}</span>
          <DtTag v-if="row.isPositive" intent="primary" size="sm">正类</DtTag>
        </template>
        <template #cell-support="{ row }">{{ row.support }}</template>
        <template #cell-precision="{ row }">{{ row.precision }}</template>
        <template #cell-recall="{ row }">{{ row.recall }}</template>
        <template #cell-f1="{ row }">{{ row.f1 }}</template>
      </DtTable>
    </div>
    <p v-if="hasClasses" class="dt-ml-clf__note">
      精确率与召回率写成 0–1 的比率；分母为 0 的那些写「—」，那是无定义，不是
      0。
    </p>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-clf {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  &__positive {
    margin: 0;
  }

  &__name {
    margin-right: 0.375rem;
  }

  // 完整数据区不许把弹窗顶到十几屏高（规格 §3.1）
  &__table {
    overflow: auto;
    max-height: 28rem;
  }

  &__note {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
