<script setup lang="ts">
/** @fileoverview 插入或配置正文里的数据内容：先选类型，再选来源与字段，最后调展示。 */
import { useFormDirty } from '@/composables/useFormDirty'
import { computed, ref, watch } from 'vue'
import {
  DtButton,
  DtDisclosure,
  DtInput,
  DtModal,
  DtNotice,
  DtSegmented,
  DtSelect,
} from '@dt/ui'
import type { ReportBody, ReportDocument, ReportMetric } from '@dt/contracts'
import NodeDataFields from './NodeDataFields.vue'
import NodeExpressionField from './NodeExpressionField.vue'
import {
  AGGREGATIONS,
  BUCKETS,
  NODE_KINDS,
  ORDERS,
  PERIOD_OFFSETS,
  SUMMARIES,
  TIME_FORMATS,
  formError,
  formFromNode,
  isApiSource,
  isChartKind,
  isInlineKind,
  nodeFromForm,
  type NodeForm,
} from '../scripts/nodeForm'
import { useReportSources } from '../scripts/useReportSources'
const props = withDefaults(
  defineProps<{
    modelValue: boolean
    metrics: ReportMetric[]
    apiSources?: NonNullable<ReportBody['api_sources']>
    node?: ReportDocument | null
  }>(),
  { apiSources: () => [], node: null },
)
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  insert: [node: ReportDocument]
}>()
let rowCount = 0
function makeId(): string {
  rowCount += 1
  return `series-${rowCount}`
}
const form = ref<NodeForm>(formFromNode(null, makeId))
const sources = useReportSources(() => props.apiSources)
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    form.value = formFromNode(props.node, makeId)
    sources.start()
  },
  { immediate: true },
)
const dirty = useFormDirty([form], () => props.modelValue)
const problem = computed(() => formError(form.value))
const isInline = computed(() => isInlineKind(form.value.kind))
const isChart = computed(() => isChartKind(form.value.kind))
const isApi = computed(() => isApiSource(form.value.source))
const kindOptions = computed(() => {
  const type = props.node?.type
  if (!type) return NODE_KINDS
  if (type === 'dsChart')
    return NODE_KINDS.filter((item) => isChartKind(item.value))
  return NODE_KINDS.filter((item) => item.value === type)
})
function patch(value: Partial<NodeForm>): void {
  form.value = { ...form.value, ...value }
}
function changeKind(value: string): void {
  const kind = NODE_KINDS.find((item) => item.value === value)?.value
  if (!kind) return
  const pie = kind === 'pie' && form.value.xAxis === 'time'
  patch({ kind, ...(pie ? { xAxis: 'field' } : {}) })
}
function submit(): void {
  if (problem.value) return
  emit('insert', nodeFromForm(form.value, props.node))
  emit('update:modelValue', false)
}
</script>
<template>
  <DtModal
    width="52rem"
    :dirty="dirty.isDirty.value"
    :model-value="props.modelValue"
    :title="props.node ? '配置当前数据内容' : '插入数据内容'"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="dt-form-grid">
      <DtSegmented
        class="dt-form-grid__wide"
        :model-value="form.kind"
        :options="kindOptions"
        aria-label="内容类型"
        block
        @update:model-value="changeKind"
      />
      <template v-if="isInline">
        <NodeExpressionField
          :model-value="form.expression"
          :metrics="props.metrics"
          :conditional="form.kind === 'condText'"
          @update:model-value="patch({ expression: $event })"
        />
        <template v-if="form.kind === 'metricRef'">
          <DtInput
            :model-value="form.precision"
            label="小数位数（0–12）"
            size="sm"
            @update:model-value="patch({ precision: $event })"
          />
          <DtInput
            :model-value="form.unit"
            label="单位"
            size="sm"
            placeholder="如 kWh"
            @update:model-value="patch({ unit: $event })"
          />
        </template>
      </template>
      <template v-else>
        <DtInput
          class="dt-form-grid__wide"
          :model-value="form.title"
          :label="isChart ? '图表标题' : '表格标题'"
          size="sm"
          hint="显示在内容上方，Word 里同样是题注"
          @update:model-value="patch({ title: $event })"
        />
        <NodeDataFields
          :form="form"
          :sources="sources.options.value"
          :columns-of="sources.columnsOf"
          :label-of="sources.labelOf"
          :make-id="makeId"
          @patch="patch"
          @need="sources.ensure"
        />
        <DtNotice
          v-if="sources.error.value"
          class="dt-form-grid__wide"
          intent="danger"
        >
          {{ sources.error.value }}
        </DtNotice>
        <DtDisclosure
          class="dt-form-grid__wide"
          title="展示与取数选项"
          :default-open="false"
        >
          <div class="dt-form-grid">
            <template v-if="form.xAxis === 'time' || !isChart">
              <DtSelect
                :model-value="form.bucket"
                label="按时间归并"
                size="sm"
                :options="BUCKETS"
                @update:model-value="patch({ bucket: $event })"
              />
              <DtSelect
                :model-value="form.timeFormat"
                label="时间显示格式"
                size="sm"
                :options="TIME_FORMATS"
                @update:model-value="patch({ timeFormat: $event })"
              />
            </template>
            <DtSelect
              :model-value="form.agg"
              label="聚合方式"
              size="sm"
              :options="AGGREGATIONS"
              hint="归并、分类合并或按字段取值时使用"
              @update:model-value="patch({ agg: $event })"
            />
            <DtSelect
              :model-value="form.order"
              label="排列顺序"
              size="sm"
              :options="ORDERS"
              @update:model-value="patch({ order: $event })"
            />
            <template v-if="form.kind === 'dsTable'">
              <DtSelect
                :model-value="form.summary"
                label="表末汇总行"
                size="sm"
                :options="SUMMARIES"
                @update:model-value="patch({ summary: $event })"
              />
              <DtInput
                :model-value="form.precision"
                label="小数位数（0–12）"
                size="sm"
                @update:model-value="patch({ precision: $event })"
              />
              <DtSelect
                v-if="!isApi"
                :model-value="String(form.offset)"
                label="报告期"
                size="sm"
                :options="PERIOD_OFFSETS"
                @update:model-value="patch({ offset: Number($event) })"
              />
            </template>
            <DtInput
              :model-value="form.limit"
              label="最多显示条数（1–1000）"
              size="sm"
              hint="超出时保留最新的数据并提示截断"
              @update:model-value="patch({ limit: $event })"
            />
            <DtInput
              v-if="!isApi"
              :model-value="form.window"
              label="取数窗口"
              size="sm"
              hint="留空为整个报告期；如 12mo 表示截至期末的 12 个月"
              @update:model-value="patch({ window: $event })"
            />
          </div>
        </DtDisclosure>
        <p v-if="isApi" class="dt-form-grid__wide text-sm text-secondary">
          第三方 API 的报告期在数据来源里设置（复制来源并设为上期即可做环比）。
        </p>
      </template>
      <p v-if="props.node" class="dt-form-grid__wide text-sm text-secondary">
        仅修改当前这一处内容；应用后请保存模板，试算后正文里即显示新数据。
      </p>
    </div>
    <template #footer>
      <span v-if="problem" class="mr-auto text-sm text-secondary">
        {{ problem }}
      </span>
      <DtButton size="sm" :disabled="!!problem" @click="submit">
        {{ props.node ? '应用修改' : '插入正文' }}
      </DtButton>
    </template>
  </DtModal>
</template>
