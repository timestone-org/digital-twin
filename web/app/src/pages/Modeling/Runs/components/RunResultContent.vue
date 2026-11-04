<script setup lang="ts">
/** @fileoverview 单个历史训练步骤的结果、错误和空态。 */
import type { ModelingNodeRun, ModelingOperator } from '@dt/contracts'
import { DtEmpty, DtIconButton, DtNotice, DtPageState } from '@dt/ui'
import { computed } from 'vue'
import ResultView from '../../Canvas/components/ResultView.vue'
import ReportBlocks from '../../Canvas/components/ReportBlocks.vue'
import StatCards from '../../Canvas/components/StatCards.vue'
import { portPreviewsOf } from '../../Canvas/scripts/preview'
import { reportOf } from '../../Canvas/scripts/reportBlocks'
const props = defineProps<{
  detail: ModelingNodeRun | null
  runId: string
  config: Readonly<Record<string, unknown>>
  operator?: ModelingOperator | undefined
  loading: boolean
  error: string
}>()
const emit = defineEmits<{ retry: [] }>()
const hasPreview = computed(
  () => portPreviewsOf(props.detail?.preview ?? {}).length > 0,
)
const metricSummaries = computed(() =>
  portPreviewsOf(props.detail?.preview ?? {}).flatMap((item) =>
    item.preview.kind === 'metrics' && item.preview.metrics.length > 0
      ? [
          {
            port: item.port,
            items: item.preview.metrics.map(([key, value]) => ({ key, value })),
          },
        ]
      : [],
  ),
)
const report = computed(() => reportOf(props.detail?.report))
const hasReport = computed(
  () =>
    report.value.blocks.length > 0 ||
    report.value.note !== '' ||
    report.value.dropped.length > 0,
)
const labels = computed(() =>
  Object.fromEntries(
    (props.operator?.outputs ?? []).map((port) => [port.name, port.label]),
  ),
)
</script>
<template>
  <div class="run-result-content">
    <DtPageState v-if="loading" :loading="true" :empty="false" />
    <DtNotice v-else-if="error" intent="danger">
      无法读取此步骤的结果：{{ error }}
      <DtIconButton
        icon="refresh-cw"
        label="重新读取步骤结果"
        @click="emit('retry')"
      />
    </DtNotice>
    <template v-else-if="detail">
      <DtNotice v-if="detail.error_text" intent="warning">{{
        detail.error_text
      }}</DtNotice>
      <section
        v-for="summary in metricSummaries"
        :key="summary.port"
        class="run-result-content__metrics"
        aria-label="本次评估关键指标"
      >
        <h3>
          {{
            metricSummaries.length > 1
              ? `${labels[summary.port] ?? summary.port} · `
              : ''
          }}本次评估关键指标
        </h3>
        <StatCards :items="summary.items" />
      </section>
      <ResultView
        v-if="hasPreview"
        :key="`${runId}:${detail.node_id}`"
        :payload="detail.preview"
        :labels="labels"
        :run-id="runId"
        :node-id="detail.node_id"
        :exported-ports="detail.exported_ports"
        :report="detail.report"
        :is-preview-truncated="detail.is_preview_truncated"
        :code="detail.operator"
        :config="config"
        :operator="operator"
      />
      <ReportBlocks
        v-else-if="hasReport"
        :blocks="report.blocks"
        :dropped="report.dropped"
        :note="report.note"
      />
      <DtEmpty
        v-else
        title="此步骤没有可展示的摘要或报告"
        hint="可重新读取本次训练的步骤结果。"
      >
        <DtIconButton
          icon="refresh-cw"
          label="重新读取步骤结果"
          @click="emit('retry')"
        />
      </DtEmpty>
    </template>
  </div>
</template>
<style scoped lang="scss">
.run-result-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
  &__metrics h3 {
    margin: 0 0 0.75rem;
    color: var(--text-title);
    font-size: var(--font-size-section);
    font-weight: 600;
  }
}
</style>
