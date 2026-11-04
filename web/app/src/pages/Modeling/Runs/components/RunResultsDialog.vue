<script setup lang="ts">
/** @fileoverview 单次训练的冻结结果、按步骤查看与手动刷新。 */
import type { ModelingRunSummary } from '@dt/contracts'
import { DtIconButton, DtModal, DtNotice, DtPageState, DtSelect } from '@dt/ui'
import { computed } from 'vue'
import { formatDateTime } from '@/utils/datetime'
import { STATE_LABELS, stateOf } from '../../Canvas/scripts/nodeState'
import { runLabel } from '../../scripts/instancePresentation'
import { useRunResults } from '../scripts/useRunResults'
import RunResultContent from './RunResultContent.vue'
const props = defineProps<{
  run: ModelingRunSummary | null
  pipelineName?: string
}>()
const emit = defineEmits<{ close: [] }>()
const results = useRunResults(() => props.run?.id ?? null)
const shownRun = computed(() => results.run.value ?? props.run)
const options = computed(() =>
  results.nodes.value.map((node, index) => ({
    value: node.node_id,
    label: `${index + 1}. ${node.alias || results.operators.value.find((item) => item.code === node.operator)?.name || node.operator} · ${STATE_LABELS[stateOf(node.status)]}`,
  })),
)
</script>
<template>
  <DtModal
    :model-value="run !== null"
    :title="`${pipelineName || '工作流'} · 本次训练结果`"
    width="76rem"
    @update:model-value="emit('close')"
  >
    <div class="run-results">
      <dl v-if="shownRun" class="run-results__summary">
        <div>
          <dt>训练时间</dt>
          <dd>{{ formatDateTime(shownRun.created_at) }}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{{ runLabel(shownRun.status) }}</dd>
        </div>
        <div>
          <dt>数据行数</dt>
          <dd>{{ shownRun.row_count ?? '未记录' }}</dd>
        </div>
        <div class="run-results__identity">
          <dt>训练记录 ID</dt>
          <dd>
            <code>{{ shownRun.id }}</code>
          </dd>
        </div>
      </dl>
      <DtNotice v-if="shownRun?.error_text" intent="warning">{{
        shownRun.error_text
      }}</DtNotice>
      <DtNotice v-if="shownRun?.is_source_truncated" intent="warning">
        本次训练取数达到上限，结果仅基于实际取回的数据。
      </DtNotice>
      <DtPageState
        v-if="results.loading.value || results.error.value"
        :loading="results.loading.value"
        :error="results.error.value"
        :empty="false"
        @retry="void results.refresh()"
      />
      <template v-else-if="results.run.value">
        <DtNotice v-if="results.run.value.nodes.length === 0" intent="info">
          本次训练没有可读取的节点结果。
          <DtIconButton
            icon="refresh-cw"
            label="刷新本次训练结果"
            @click="void results.refresh()"
          />
        </DtNotice>
        <template v-else>
          <DtSelect
            :model-value="results.nodeId.value"
            label="选择训练步骤"
            :options="options"
            @update:model-value="void results.selectNode($event)"
          >
            <template #actions
              ><DtIconButton
                icon="refresh-cw"
                label="刷新本次训练结果"
                :loading="results.loading.value"
                @click="void results.refresh()"
            /></template>
          </DtSelect>
          <DtNotice v-if="results.catalogError.value" intent="info">
            算子说明暂时无法加载，结果仍按本次训练记录显示。
            <DtIconButton
              icon="refresh-cw"
              label="重新加载算子说明"
              @click="void results.refreshOperators()"
            />
          </DtNotice>
          <DtNotice v-if="!results.run.value.is_keeping_frames" intent="info"
            >本次训练未另存全量
            CSV；已保存的结果摘要和分析报告仍可查看。</DtNotice
          >
          <RunResultContent
            :detail="results.node.value"
            :run-id="results.run.value.id"
            :config="results.config.value"
            :operator="results.operator.value"
            :loading="results.nodeLoading.value"
            :error="results.nodeError.value"
            @retry="void results.refreshNode()"
          />
        </template>
      </template>
    </div>
  </DtModal>
</template>
<style scoped lang="scss">
.run-results {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1rem;
  &__summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1rem;
    margin: 0;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border-subtle);
  }
  &__summary div {
    min-width: 0;
  }
  &__summary dt {
    margin-bottom: 0.375rem;
    color: var(--text-secondary);
    font-size: var(--font-size-caption);
  }
  &__summary dd {
    margin: 0;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  &__identity {
    grid-column: 1 / -1;
  }
  &__identity code {
    font-size: var(--font-size-caption);
  }
}
@media (max-width: 40rem) {
  .run-results__summary {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
