<script setup lang="ts">
/** @fileoverview 插入可配置的数据节点，表达式与取数配置分别填写。 */
import { useFormDirty } from '@/composables/useFormDirty'
import { computed, ref } from 'vue'
import { DtButton, DtInput, DtModal, DtSelect } from '@dt/ui'
import type { ReportDocument, ReportMetric } from '@dt/contracts'
const props = defineProps<{ modelValue: boolean; metrics: ReportMetric[] }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  insert: [node: ReportDocument]
}>()
const kind = ref('condText')
const expression = ref('')
const metric = ref('')
const title = ref('')
const window = ref('')
const dirty = useFormDirty(
  [kind, expression, metric, title, window],
  () => props.modelValue,
)
const kinds = [
  { value: 'condText', label: '条件文本' },
  { value: 'metricRef', label: '指标数字' },
  { value: 'line', label: '折线图' },
  { value: 'bar', label: '柱状图' },
  { value: 'dsTable', label: '台账表格' },
]
const metricOptions = computed(() =>
  props.metrics
    .filter((item) => item.table && item.key)
    .map((item) => ({ value: item.name, label: item.name })),
)
function insert(): void {
  const selected = props.metrics.find((item) => item.name === metric.value)
  const isInline = kind.value === 'condText' || kind.value === 'metricRef'
  if (!isInline && !selected) return
  const node = isInline
    ? { type: kind.value, attrs: { expr: expression.value, precision: 2 } }
    : dataNode(selected)
  if (!node) return
  emit('insert', node)
  emit('update:modelValue', false)
}
function dataNode(selected: ReportMetric | undefined): ReportDocument | null {
  if (!selected) return null
  return {
    type: kind.value === 'dsTable' ? 'dsTable' : 'dsChart',
    attrs: {
      title: title.value,
      kind: kind.value === 'bar' ? 'bar' : 'line',
      table: selected.table,
      keys: [selected.key],
      series: [
        { table: selected.table, key: selected.key, name: selected.name },
      ],
      window: window.value || null,
      limit: 100,
    },
  }
}
</script>
<template>
  <DtModal
    :dirty="dirty.isDirty.value"
    :model-value="props.modelValue"
    title="插入数据节点"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtSelect v-model="kind" label="节点类型" size="sm" :options="kinds" />
      <DtInput
        v-if="kind === 'condText' || kind === 'metricRef'"
        v-model="expression"
        label="表达式"
        size="sm"
        placeholder="IF({本期}>{上期}, '升高', '降低')"
      />
      <template v-else>
        <DtSelect
          v-model="metric"
          label="使用指标的数据来源"
          size="sm"
          :options="metricOptions"
        />
        <DtInput v-model="title" label="图表标题" size="sm" />
        <DtInput
          v-model="window"
          label="取数窗口"
          size="sm"
          hint="留空使用整个报告期；例如 12mo"
        />
      </template>
    </div>
    <template #footer>
      <DtButton size="sm" icon="plus" @click="insert">插入正文</DtButton>
    </template>
  </DtModal>
</template>
