<script setup lang="ts">
/** @fileoverview 报告试算结果，缺失与截断显式可见。 */
import { computed } from 'vue'
import { DtCard, DtNotice } from '@dt/ui'
import type { ReportPreview } from '@dt/contracts'
import { formatDateTime } from '@/utils/datetime'
import ReportChart from './ReportChart.vue'
import ReportTable from './ReportTable.vue'
const props = defineProps<{ preview: ReportPreview }>()
const apiViews = computed(() =>
  (props.preview.api_results ?? []).map((result) => ({
    ...result,
    node: { kind: 'dsTable', columns: result.columns, rows: result.rows },
  })),
)
const DATA_NODE_KINDS = new Set(['line', 'bar', 'dsChart', 'dsTable'])
const nodeViews = computed(() =>
  Object.entries(props.preview.nodes).map(([path, node]) => {
    const hasChartData =
      node.series?.some((series) =>
        series.points.some((point) => point.value !== null),
      ) ?? false
    const hasTableData = (node.rows?.length ?? 0) > 0
    return {
      path,
      node,
      hasChartData,
      hasTableData,
      isEmpty:
        DATA_NODE_KINDS.has(node.kind) &&
        !hasChartData &&
        !hasTableData &&
        !node.text,
    }
  }),
)
</script>
<template>
  <DtCard title="试算结果" icon="activity" padding="sm">
    <div class="flex flex-col gap-3">
      <p>报告期 {{ preview.period }} · {{ preview.timezone }}</p>
      <p v-if="preview.checked_at" class="text-sm text-secondary">
        核对时间
        {{ formatDateTime(preview.checked_at) }}；生成时将重新获取数据。
      </p>
      <DtNotice :intent="preview.is_valid ? 'success' : 'danger'">
        {{
          preview.is_valid
            ? '数据核对已通过'
            : '数据核对未通过，请检查来源配置与下方错误后重新试算'
        }}
      </DtNotice>
      <DtNotice
        v-for="warning in preview.warnings"
        :key="warning"
        intent="warning"
      >
        {{ warning }}
      </DtNotice>
      <div v-for="metric in preview.metrics" :key="metric.name">
        <strong> {{ metric.name }} </strong>：{{ metric.value ?? '—' }}
        <span v-if="metric.is_truncated"> （数据已截断） </span>
        <DtNotice v-if="metric.error" intent="danger">
          {{ metric.error }}。请检查该指标的数据来源与字段映射。
        </DtNotice>
        <p v-if="metric.is_stale" class="text-sm text-secondary">
          使用了报告期之前的数据，请核对取数时间。
        </p>
      </div>
      <DtCard
        v-for="source in apiViews"
        :key="source.source_code"
        :title="`API · ${source.name}`"
        padding="sm"
      >
        <p class="mb-2 text-sm text-secondary">
          本次获取 {{ source.row_count }} 行，以下展示前
          {{ source.rows.length }} 行映射结果。
        </p>
        <ReportTable v-if="source.rows.length" :node="source.node" />
        <DtNotice v-else intent="info">
          API 已返回，本期暂无匹配数据。请核对参数、数据位置与报告期。
        </DtNotice>
      </DtCard>
      <DtCard
        v-for="view in nodeViews"
        :key="view.path"
        :title="view.node.title || view.node.text || '数据节点'"
        padding="sm"
      >
        <DtNotice v-if="view.node.is_stale" intent="warning">
          使用了报告期之前的数据
        </DtNotice>
        <DtNotice v-if="view.node.is_truncated" intent="warning">
          数据已截断，请缩小范围或调整行数上限
        </DtNotice>
        <ReportChart v-if="view.hasChartData" :node="view.node" />
        <ReportTable v-if="view.hasTableData" :node="view.node" />
        <DtNotice v-if="view.isEmpty" intent="info">
          当前报告期暂无可展示数据
        </DtNotice>
      </DtCard>
    </div>
  </DtCard>
</template>
