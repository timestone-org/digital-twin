<script setup lang="ts">
/**
 * @fileoverview 一份帧的结果视图：取数来源、形状、每列统计、前若干行。
 *
 * ⚠ 截断要**说出来**：只显示前几行却不标注的话，用户会以为这一步只产出了这
 * 么点数据，然后照着去调上游的行数上限。
 * ⚠ 取数触顶（`provenance.is_truncated`）与「摘要只带回前几行」是两回事：前者
 * 是**数据根本没进来**，模型是在半截数据上训的；后者只影响这一屏好不好看。
 */
import type { DtTableColumn } from '@dt/contracts'
import { DtNotice, DtTable, DtTag } from '@dt/ui'
import { computed } from 'vue'

import { formatDateTime } from '@/utils/datetime'

import { grouped, niceNumber } from '../scripts/numbers'
import type { ColumnStat, FramePreview } from '../scripts/preview'

const props = defineProps<{ preview: FramePreview }>()

/** 列角色的中文名。认不出的角色不摆徽标，不瞎猜。 */
const ROLE_LABELS: Record<string, string> = {
  target: '目标列',
  feature: '特征列',
  index: '时间索引',
}

/** 「台账 energy_log · 2026-01-01 00:00 ~ 至今」。取不到来源时给空串。 */
const provenance = computed(() => {
  const source = props.preview.provenance
  if (source.tableCodes.length === 0) return ''
  const since = formatDateTime(source.since, '最早')
  const until = formatDateTime(source.until, '此刻')
  return `台账 ${source.tableCodes.join('、')} · ${since} ~ ${until}`
})

const STAT_COLUMNS: readonly DtTableColumn[] = [
  { key: 'name', label: '列' },
  { key: 'dtype', label: '类型', width: '6rem' },
  { key: 'nullRatio', label: '空值率', width: '6rem', align: 'right' },
  { key: 'uniqueCount', label: '不同值', width: '6rem', align: 'right' },
  { key: 'min', label: '最小', width: '7rem', align: 'right' },
  { key: 'p50', label: '中位', width: '7rem', align: 'right' },
  { key: 'mean', label: '均值', width: '7rem', align: 'right' },
  { key: 'max', label: '最大', width: '7rem', align: 'right' },
]

const headColumns = computed<DtTableColumn[]>(() => [
  { key: 'index', label: props.preview.indexName || '#', width: '11rem' },
  ...props.preview.columns.map((column) => ({
    key: column.key,
    label: column.name || column.key,
  })),
])

/** DtTable 认 `id` 当行键；帧的前几行本来没有主键，用行号顶上。 */
type HeadRow = { id: string } & Record<string, string>

const headRows = computed<HeadRow[]>(() =>
  props.preview.head.map((row, line) => {
    const cells: HeadRow = {
      id: String(line),
      index: props.preview.indexHead[line] ?? String(line + 1),
    }
    props.preview.columns.forEach((column, at) => {
      cells[column.key] = display(row[at])
    })
    return cells
  }),
)

// 同上：列统计表的行键就是列名
const statRows = computed(() =>
  props.preview.columns.map((column) => ({ ...column, id: column.key })),
)

/** 单元格文案。空值显式写成「—」，不显示成空白。 */
function display(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return niceNumber(value)
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? '是' : '否'
  return JSON.stringify(value) ?? ''
}

function statOf(column: ColumnStat, key: string): string {
  if (key === 'nullRatio') return `${niceNumber(column.nullRatio * 100)}%`
  if (key === 'uniqueCount') return grouped(column.uniqueCount)
  return niceNumber(
    { min: column.min, max: column.max, mean: column.mean, p50: column.p50 }[
      key
    ],
  )
}
</script>

<template>
  <div class="dt-ml-frame">
    <p v-if="provenance" class="dt-ml-frame__source">{{ provenance }}</p>
    <DtNotice
      v-if="props.preview.provenance.isTruncated"
      intent="warning"
      icon="alert-triangle"
    >
      取数触了行数上限：这一段时间里靠后的数据根本没有取进来，模型是在半截数据
      上训的。要么把「行数上限」调大，要么把时间范围缩小。
    </DtNotice>
    <p class="dt-ml-frame__shape">
      {{ grouped(props.preview.rowCount) }} 行 × {{ props.preview.colCount }} 列
    </p>
    <DtNotice v-if="props.preview.isColsTruncated" intent="warning">
      列太多，这里只列出前面一部分
    </DtNotice>
    <DtTable :columns="STAT_COLUMNS" :rows="statRows" min-width="52rem">
      <template #cell-name="{ row }">
        {{ row.name || row.key }}
        <span v-if="row.unit" class="dt-ml-frame__unit">{{ row.unit }}</span>
        <DtTag v-if="ROLE_LABELS[row.role]" intent="info" size="sm">
          {{ ROLE_LABELS[row.role] }}
        </DtTag>
      </template>
      <template #cell-dtype="{ row }">
        <code>{{ row.dtype }}</code>
      </template>
      <template #cell-nullRatio="{ row }">{{
        statOf(row, 'nullRatio')
      }}</template>
      <template #cell-uniqueCount="{ row }">{{
        statOf(row, 'uniqueCount')
      }}</template>
      <template #cell-min="{ row }">{{ statOf(row, 'min') }}</template>
      <template #cell-p50="{ row }">{{ statOf(row, 'p50') }}</template>
      <template #cell-mean="{ row }">{{ statOf(row, 'mean') }}</template>
      <template #cell-max="{ row }">{{ statOf(row, 'max') }}</template>
    </DtTable>
    <h4 class="dt-ml-frame__title">前 {{ headRows.length }} 行</h4>
    <DtTable :columns="headColumns" :rows="headRows" min-width="52rem" />
    <p v-if="props.preview.isRowsTruncated" class="dt-ml-frame__note">
      只显示了开头这几行，完整结果在下游算子里
    </p>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-frame {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  &__source {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__shape {
    margin: 0;
    color: var(--text-secondary);
    font-family: var(--font-digit);
  }

  &__title {
    margin: 0;
    color: var(--text-title);
    font-size: var(--ctl-fs-sm);
  }

  &__unit {
    color: var(--text-disabled);
  }

  &__note {
    margin: 0;
    color: var(--text-disabled);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
