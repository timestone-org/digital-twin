<script setup lang="ts">
/** @fileoverview 报告试算结果，缺失与截断显式可见。 */
import { DtNotice } from '@dt/ui'
import type { ReportPreview } from '@dt/contracts'
import ReportChart from './ReportChart.vue'
import ReportTable from './ReportTable.vue'
defineProps<{ preview: ReportPreview }>()
</script>
<template>
  <div class="flex flex-col gap-3">
    <p>报告期 {{ preview.period }} · {{ preview.timezone }}</p>
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
    </div>
    <div
      v-for="(node, path) in preview.nodes"
      :key="path"
      class="rounded border p-3"
    >
      <p>
        {{ node.title || node.text || '数据节点' }}
      </p>
      <ReportChart v-if="node.series?.length" :node="node" />
      <ReportTable v-if="node.rows?.length" :node="node" />
    </div>
  </div>
</template>
