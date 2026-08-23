<script setup lang="ts">
/**
 * @fileoverview 数据表格里的一格：按序判「计算失败 → 取值 → 样本数标记」，
 * 再挂一枚只作标记用的人工修正角标。
 *
 * ⚠ 气泡一律 `side="bottom"`：数据表挂在一个会滚的容器里，第一行的向上气泡会
 * 贴着容器上边缘，而失败原因与样本说明恰恰只能从气泡里读到
 * （docs/DATASET_DESIGN.md §7.7）。
 * ⚠ 角标只画标记、不参与取值：`values` 出参已经是 effective（D4），再叠一次
 * `overrides[].value` 得到的是一个只在被修正过的格子上才错的数。
 */
import { computed } from 'vue'
import type { DatasetColumn } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtIcon, DtTooltip } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import {
  cellValue,
  computeErrorOf,
  formatCell,
  overrideBadge,
  overrideOf,
  sampleLevel,
  sampleTip,
  type RecordRow,
} from '../scripts/recordView'

const props = defineProps<{
  column: DatasetColumn
  row: RecordRow
  /** 本列在当前页的样本数中位数，判「样本太少」的相对基准。 */
  median: number | null
  /** 有一次写在飞：角标上的撤销键跟着禁用。 */
  busy: boolean
}>()

const emit = defineEmits<{ revoke: [column: DatasetColumn, row: RecordRow] }>()

const failure = computed(() =>
  computeErrorOf(props.row.record, props.column.key),
)

const text = computed(() =>
  formatCell(cellValue(props.column, props.row.record), props.column),
)

const sample = computed(() => {
  const count = props.row.record.samples?.[props.column.key]
  const level = sampleLevel(count, {
    agg: props.column.agg,
    median: props.median,
  })
  return { level, tip: sampleTip(count, level) }
})

const badge = computed(() => {
  const entry = overrideOf(props.row.record, props.column.key)
  return entry === null ? null : overrideBadge(entry)
})
</script>

<template>
  <!-- data-column 让一格在 DOM 里自报是哪一列：动态插槽名接错时，屏幕上只是
       某一列静静显示成另一列的数，没有任何一道现成的闸门会响 -->
  <span
    class="inline-flex min-w-0 items-center gap-1"
    :data-column="props.column.key"
  >
    <DtTooltip v-if="failure !== null" :content="failure" side="bottom">
      <span class="inline-flex items-center gap-1 text-state-danger">
        <DtIcon name="alert-circle" :size="12" />
        计算失败
      </span>
    </DtTooltip>

    <!-- ⚠ 样本太少 / 一条都没采到的格子调灰加虚线下划线，把「这个数没什么
         代表性」写在脸上；具体是几条样本由气泡说 -->
    <DtTooltip
      v-else-if="sample.tip !== ''"
      :content="sample.tip"
      side="bottom"
    >
      <span
        class="truncate text-text-disabled underline decoration-dotted underline-offset-4"
        :data-sample="sample.level"
      >
        {{ text }}
      </span>
    </DtTooltip>

    <span v-else class="truncate">{{ text }}</span>

    <DtTooltip v-if="badge" :content="badge.tip" side="bottom">
      <!-- 撤销修正单列一个码（dataset:override）：它优先于点位聚合值，等同于
           改台账上的数字。没这个码的人照样要看见角标——不然他会以为这个数就是
           采集出来的 -->
      <PermGuard :codes="[PERMISSION_CODES.datasetOverride]">
        <DtButton
          variant="ghost"
          intent="neutral"
          size="xs"
          :icon="badge.icon"
          :class="badge.toneClass"
          :disabled="props.busy"
          :aria-label="`撤销${badge.label}：${props.column.name}`"
          :data-override="badge.icon === 'database' ? 'migration' : 'human'"
          @click="emit('revoke', props.column, props.row)"
        />
        <template #fallback>
          <span
            class="inline-flex p-0.5"
            :class="badge.toneClass"
            :title="badge.label"
            :data-override="badge.icon === 'database' ? 'migration' : 'human'"
          >
            <DtIcon :name="badge.icon" :size="12" />
          </span>
        </template>
      </PermGuard>
    </DtTooltip>
  </span>
</template>
