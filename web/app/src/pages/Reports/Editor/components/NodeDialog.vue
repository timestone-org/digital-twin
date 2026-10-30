<script setup lang="ts">
/** @fileoverview 插入可配置的数据节点，表达式与取数配置分别填写。 */
import { useFormDirty } from '@/composables/useFormDirty'
import { computed, ref, watch } from 'vue'
import { DtButton, DtCheckbox, DtInput, DtModal, DtSelect } from '@dt/ui'
import type { ReportDocument, ReportMetric } from '@dt/contracts'
const props = defineProps<{
  modelValue: boolean
  metrics: ReportMetric[]
  node?: ReportDocument | null
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  insert: [node: ReportDocument]
}>()
const kind = ref('condText')
const expression = ref('')
const metric = ref('')
const additional = ref<string[]>([])
const title = ref('')
const window = ref('')
const precision = ref('2')
const unit = ref('')
const limit = ref('1000')
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const node = props.node
    const attrs = node?.attrs ?? {}
    const string = (key: string, fallback = '') => {
      const value = attrs[key]
      return typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : fallback
    }
    kind.value =
      node?.type === 'dsChart'
        ? string('kind', 'line')
        : (node?.type ?? 'condText')
    expression.value = string('expr')
    title.value = string('title')
    window.value = string('window')
    precision.value = string(
      node?.type === 'dsTable' ? 'decimals' : 'precision',
      '2',
    )
    unit.value = string('unit')
    limit.value = string('limit', '1000')
    metric.value = ''
    additional.value = []
  },
  { immediate: true },
)
function validInteger(value: string, min: number, max: number): boolean {
  return /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max
}
const valid = computed(() => {
  const inline = kind.value === 'condText' || kind.value === 'metricRef'
  if (inline && !expression.value.trim()) return false
  if (!inline && !props.node && !metric.value) return false
  return (
    validInteger(precision.value, 0, 12) && validInteger(limit.value, 1, 1000)
  )
})
const dirty = useFormDirty(
  [kind, expression, metric, additional, title, window, precision, unit, limit],
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
const extraMetrics = computed(() => {
  const selected = props.metrics.find((item) => item.name === metric.value)
  return props.metrics.filter(
    (item) =>
      item.table &&
      item.key &&
      item.name !== metric.value &&
      compatibleMetric(item, selected),
  )
})
function compatibleMetric(
  item: ReportMetric,
  selected: ReportMetric | undefined,
): boolean {
  if (!selected) return false
  if (windowKey(item) !== windowKey(selected)) return false
  return (
    kind.value !== 'dsTable' ||
    (item.table === selected.table &&
      (item.offset ?? 0) === (selected.offset ?? 0))
  )
}
function windowKey(item: ReportMetric): string {
  return JSON.stringify([item.window ?? null, item.anchor ?? 'period'])
}
watch(metric, () => {
  additional.value = []
})
function selectAdditional(name: string, checked: boolean): void {
  additional.value = checked
    ? [...additional.value, name]
    : additional.value.filter((value) => value !== name)
}
function insert(): void {
  if (!valid.value) return
  const selected = props.metrics.find((item) => item.name === metric.value)
  const isInline = kind.value === 'condText' || kind.value === 'metricRef'
  if (!isInline && !selected && !props.node) return
  const node = isInline
    ? {
        type: kind.value,
        attrs: {
          ...props.node?.attrs,
          expr: expression.value,
          precision: Number(precision.value),
          unit: unit.value,
        },
      }
    : dataNode(selected)
  if (!node) return
  emit('insert', node)
  emit('update:modelValue', false)
}
function sourceAttrs(selected: ReportMetric): Record<string, unknown> {
  const selections = [
    selected,
    ...extraMetrics.value.filter((item) =>
      additional.value.includes(item.name),
    ),
  ]
  return {
    table: selected.table,
    offset: kind.value === 'dsTable' ? (selected.offset ?? 0) : 0,
    anchor: selected.anchor ?? 'period',
    window: window.value || selected.window || null,
    keys: [...new Set(selections.map((item) => item.key))],
    series: selections.map((item) => ({
      table: item.table,
      key: item.key,
      name: item.name,
      offset: item.offset ?? 0,
    })),
  }
}
function dataNode(selected: ReportMetric | undefined): ReportDocument | null {
  if (!selected && !props.node) return null
  return {
    type: kind.value === 'dsTable' ? 'dsTable' : 'dsChart',
    attrs: {
      ...nodeSettings(),
      ...(selected ? sourceAttrs(selected) : {}),
      ...apiSettings(selected),
    },
  }
}
function nodeSettings(): Record<string, unknown> {
  return {
    ...props.node?.attrs,
    title: title.value,
    kind: kind.value === 'bar' ? 'bar' : 'line',
    window: window.value || null,
    limit: Number(limit.value),
    decimals: Number(precision.value),
  }
}
function apiSettings(
  selected: ReportMetric | undefined,
): Record<string, unknown> {
  const table = selected?.table ?? props.node?.attrs?.['table']
  return typeof table === 'string' && table.startsWith('api:')
    ? { offset: 0, anchor: 'period', window: null }
    : {}
}
</script>
<template>
  <DtModal
    width="46rem"
    :dirty="dirty.isDirty.value"
    :model-value="props.modelValue"
    :title="props.node ? '配置当前数据内容' : '插入数据节点'"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="dt-form-grid">
      <DtSelect
        v-model="kind"
        label="节点类型"
        size="sm"
        :options="
          props.node?.type === 'dsChart'
            ? kinds.filter(
                (item) => item.value === 'line' || item.value === 'bar',
              )
            : kinds
        "
        :disabled="!!props.node && props.node.type !== 'dsChart'"
      />
      <DtInput
        v-if="kind === 'condText' || kind === 'metricRef'"
        v-model="expression"
        class="dt-form-grid__wide"
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
          :hint="
            props.node
              ? '留空保留当前数据来源及全部序列；选择指标会替换为该指标的数据来源'
              : '先在右侧指标面板配置数据来源'
          "
        />
        <div
          v-if="metric && extraMetrics.length"
          class="dt-form-grid__wide flex flex-col gap-2"
        >
          <p class="text-sm text-secondary">
            {{ kind === 'dsTable' ? '附加列（同一数据来源）' : '附加图表序列' }}
          </p>
          <DtCheckbox
            v-for="item in extraMetrics"
            :key="item.name"
            :model-value="additional.includes(item.name)"
            :label="item.name"
            @update:model-value="selectAdditional(item.name, $event)"
          />
        </div>
        <DtInput v-model="title" label="图表标题" size="sm" />
        <DtInput
          v-model="window"
          label="取数窗口"
          size="sm"
          hint="留空使用整个报告期；例如 12mo"
        />
      </template>
      <DtInput
        v-if="kind === 'metricRef' || kind === 'dsTable'"
        v-model="precision"
        label="小数位数（0–12）"
        size="sm"
      />
      <DtInput
        v-if="kind === 'metricRef'"
        v-model="unit"
        label="单位"
        size="sm"
      />
      <DtInput
        v-if="kind !== 'metricRef' && kind !== 'condText'"
        v-model="limit"
        label="最多显示行数（1–1000）"
        size="sm"
      />
      <p v-if="props.node" class="dt-form-grid__wide text-sm text-secondary">
        仅修改当前这一处内容；应用后请保存模板。
      </p>
    </div>
    <template #footer>
      <DtButton size="sm" :disabled="!valid" @click="insert">{{
        props.node ? '应用修改' : '插入正文'
      }}</DtButton>
    </template>
  </DtModal>
</template>
