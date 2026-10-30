<script setup lang="ts">
/** @fileoverview 生成时 API 数据源的连接选择、请求与字段映射。 */
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  DtButton,
  DtCard,
  DtIconButton,
  DtInput,
  DtModal,
  DtNotice,
  DtSelect,
  DtTextarea,
} from '@dt/ui'
import type { ReportDocument, ReportMetric } from '@dt/contracts'
import { reportApiConnections } from '@/api/reports'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { describeError } from '@/composables/useAsyncList'
import { useFormDirty } from '@/composables/useFormDirty'
import {
  jsonObject,
  queryObject,
  sourceIsUsed,
  validateSource,
  type ApiSource,
  type ApiColumn,
} from '../scripts/apiSourceForm'

const props = defineProps<{
  modelValue: ApiSource[]
  metrics: ReportMetric[]
  document: ReportDocument
  disabled: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: ApiSource[]] }>()
const isOpen = ref(false)
const editing = ref<string | null>(null)
const connections = ref<{ code: string; name: string }[]>([])
const isLoading = ref(false)
const error = ref('')
const panelError = ref('')
const form = ref<ApiSource>(emptySource())
const query = ref('{}')
const body = ref('{}')
const columns = ref<(ApiColumn & { id: string })[]>([])
const dirty = useFormDirty([form, query, body, columns], () => isOpen.value)
const raced = useRacedFetch()
let columnSequence = 0
const connectionOptions = computed(() =>
  connections.value.map((item) => ({ value: item.code, label: item.name })),
)
const METHODS = [
  { value: 'GET', label: 'GET 查询' },
  { value: 'POST', label: 'POST 查询' },
]
const TYPES = [
  { value: 'number', label: '数值' },
  { value: 'text', label: '文本' },
  { value: 'boolean', label: '是/否' },
]
function emptySource(): ApiSource {
  return {
    code: '',
    name: '',
    connection: '',
    path: '/',
    method: 'GET',
    query: {},
    body: null,
    rows_pointer: '',
    time_pointer: null,
    columns: [],
    offset: 0,
  }
}
function loadConnections(): void {
  isLoading.value = true
  error.value = ''
  void raced.run((signal) => reportApiConnections(signal), {
    ok: (value) => {
      connections.value = value
    },
    fail: (caught) => {
      error.value = describeError(caught)
    },
    settled: () => {
      isLoading.value = false
    },
  })
}
function open(source?: ApiSource, copy = false): void {
  if (props.disabled) return
  editing.value = source && !copy ? source.code : null
  const next = source
    ? {
        ...source,
        query: { ...source.query },
        columns: source.columns.map((column) => ({ ...column })),
      }
    : emptySource()
  if (copy) copyIdentity(next)
  form.value = next
  query.value = JSON.stringify(next.query ?? {}, null, 2)
  body.value = JSON.stringify(next.body ?? {}, null, 2)
  const mapped: ApiColumn[] = next.columns.length
    ? next.columns
    : [{ key: 'value', name: '数值', pointer: '/value', data_type: 'number' }]
  columns.value = mapped.map((column) => ({
    ...column,
    id: `column-${++columnSequence}`,
  }))
  error.value = ''
  panelError.value = ''
  isOpen.value = true
  loadConnections()
}
function copyIdentity(next: ApiSource): void {
  let suffix = 1
  let code = `${next.code.slice(0, 52)}_copy`
  while (props.modelValue.some((item) => item.code === code)) {
    suffix += 1
    code = `${next.code.slice(0, 52)}_copy${suffix}`
  }
  next.code = code
  next.name = `${next.name} 副本`
}
function addColumn(): void {
  columns.value = [
    ...columns.value,
    {
      id: `column-${++columnSequence}`,
      key: `field_${columnSequence}`,
      name: '新字段',
      pointer: '',
      data_type: 'number',
    },
  ]
}
function setMethod(value: string): void {
  if (value === 'GET' || value === 'POST') form.value.method = value
}
function setType(column: ApiColumn, value: string): void {
  if (value === 'number' || value === 'text' || value === 'boolean')
    column.data_type = value
}
function save(): void {
  error.value = ''
  try {
    const next: ApiSource = {
      ...form.value,
      name: form.value.name.trim(),
      query: queryObject(query.value),
      body:
        form.value.method === 'POST' ? jsonObject(body.value, '请求体') : null,
      columns: columns.value.map(({ key, name, pointer, data_type }) => ({
        key,
        name,
        pointer,
        data_type: data_type ?? 'number',
      })),
      time_pointer: form.value.time_pointer || null,
    }
    validateSource(next)
    if (
      props.modelValue.some(
        (item) => item.code === next.code && item.code !== editing.value,
      )
    )
      throw new Error('来源编码已存在，请使用其他编码')
    if (!connections.value.some((item) => item.code === next.connection))
      throw new Error('请选择当前可用的已授权连接')
    emit(
      'update:modelValue',
      editing.value
        ? props.modelValue.map((item) =>
            item.code === editing.value ? next : item,
          )
        : [...props.modelValue, next],
    )
    isOpen.value = false
  } catch (caught) {
    error.value =
      caught instanceof Error ? caught.message : describeError(caught)
  }
}
function remove(source: ApiSource): void {
  panelError.value = ''
  if (sourceIsUsed(props.document, props.metrics, source.code)) {
    panelError.value = `“${source.name}”仍被指标或正文引用，请先移除引用再删除来源。`
    return
  }
  emit(
    'update:modelValue',
    props.modelValue.filter((item) => item.code !== source.code),
  )
}
onBeforeUnmount(() => raced.cancel())
</script>
<template>
  <DtCard title="第三方 API 数据" icon="database" padding="sm">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-secondary">
        每次试算或生成时取数，同一来源的响应可供多个指标、图表和表格使用。
      </p>
      <DtNotice v-if="panelError" intent="warning">
        {{ panelError }}
      </DtNotice>
      <div
        v-for="source in modelValue"
        :key="source.code"
        class="flex flex-col gap-1 rounded border border-border-subtle p-2"
      >
        <strong class="text-sm">{{ source.name }}</strong>
        <p class="text-sm text-secondary">
          {{ source.method }} · {{ source.columns.length }} 个字段 ·
          {{ source.offset ? `偏移 ${source.offset} 期` : '本期' }}
        </p>
        <div v-if="!disabled" class="flex gap-2">
          <DtButton
            size="sm"
            variant="ghost"
            icon="pencil"
            @click="open(source)"
          >
            配置
          </DtButton>
          <DtButton
            size="sm"
            variant="ghost"
            icon="copy"
            @click="open(source, true)"
          >
            复制
          </DtButton>
          <DtIconButton
            size="sm"
            variant="ghost"
            intent="danger"
            icon="trash"
            :label="`删除 API 来源 ${source.name}`"
            @click="remove(source)"
          />
        </div>
      </div>
      <DtButton
        v-if="!disabled"
        size="sm"
        variant="outline"
        icon="plus"
        :disabled="modelValue.length >= 10"
        @click="open()"
      >
        添加 API 数据源
      </DtButton>
    </div>
    <DtModal
      v-model="isOpen"
      width="52rem"
      :dirty="dirty.isDirty.value"
      :title="editing ? '配置 API 数据源' : '添加 API 数据源'"
    >
      <div class="flex flex-col gap-5">
        <DtNotice intent="info">
          连接与认证由管理员配置，模板只选择连接。不要在查询参数或请求体中填写密钥。
        </DtNotice>
        <div class="dt-form-grid">
          <DtInput
            v-model="form.name"
            label="来源名称"
            placeholder="例如 能管月度能耗"
          />
          <DtInput
            v-model="form.code"
            label="来源编码"
            :disabled="editing !== null"
            hint="字母开头，使用字母、数字、下划线，最多 60 字符"
          />
          <DtSelect
            v-model="form.connection"
            :options="connectionOptions"
            label="已授权连接"
            :disabled="isLoading"
          />
          <DtSelect
            :model-value="form.method ?? 'GET'"
            label="请求方式"
            :options="METHODS"
            @update:model-value="setMethod"
          />
          <DtInput
            v-model="form.path"
            class="dt-form-grid__wide"
            label="API 相对路径"
            placeholder="/api/energy/monthly"
            hint="相对于所选连接，查询参数在下方填写"
          />
          <DtInput
            :model-value="String(form.offset ?? 0)"
            label="报告期偏移"
            hint="0 本期，-1 上期；范围 -120～120"
            @update:model-value="form.offset = Number($event)"
          />
        </div>
        <DtNotice v-if="!isLoading && !connections.length" intent="warning">
          暂无可用连接。请让管理员配置报告 API 连接目录，再刷新。
        </DtNotice>
        <DtButton
          size="sm"
          variant="ghost"
          icon="refresh-cw"
          :loading="isLoading"
          @click="loadConnections"
        >
          刷新连接目录
        </DtButton>
        <div class="dt-form-grid">
          <DtTextarea
            v-model="query"
            class="dt-form-grid__wide"
            label="查询参数（JSON 对象）"
            :rows="4"
            mono
            placeholder="填写查询参数 JSON 对象"
          />
          <DtTextarea
            v-if="form.method === 'POST'"
            v-model="body"
            class="dt-form-grid__wide"
            label="请求体（JSON 对象）"
            :rows="5"
            mono
          />
          <p v-pre class="dt-form-grid__wide text-sm text-secondary">
            可用报告期参数：{{ period }} 报告期、{{ start }} 开始、{{
              end
            }}
            结束、{{ timezone }} 时区。时间范围为 [开始, 结束)。
          </p>
          <DtInput
            v-model="form.rows_pointer"
            label="数据位置（JSON Pointer）"
            placeholder="/data/items"
            hint="空值代表整个响应；对象作为一行，数组作为多行"
          />
          <DtInput
            :model-value="form.time_pointer ?? ''"
            label="时间字段（可选）"
            placeholder="/time"
            hint="相对每行，值需为带时区时间；留空使用报告期开始时间"
            @update:model-value="form.time_pointer = $event || null"
          />
        </div>
        <div class="flex flex-col gap-3">
          <strong>映射字段</strong>
          <p class="text-sm text-secondary">
            例如数据位置为 /data/items，每行的 /energy
            映射为“用电量”；根值用空字符串。字段编码保存后供指标选择。
          </p>
          <div
            v-for="column in columns"
            :key="column.id"
            class="dt-form-grid rounded border border-border-subtle p-3"
          >
            <DtInput v-model="column.name" label="字段名称" />
            <DtInput v-model="column.key" label="字段编码" />
            <DtInput
              v-model="column.pointer"
              label="字段位置（JSON Pointer）"
              placeholder="/energy"
            />
            <DtSelect
              :model-value="column.data_type ?? 'number'"
              label="数据类型"
              :options="TYPES"
              @update:model-value="setType(column, $event)"
            />
            <DtButton
              size="sm"
              variant="ghost"
              intent="danger"
              @click="columns = columns.filter((item) => item.id !== column.id)"
            >
              移除字段
            </DtButton>
          </div>
          <DtButton
            size="sm"
            variant="outline"
            icon="plus"
            :disabled="columns.length >= 50"
            @click="addColumn"
          >
            添加映射字段
          </DtButton>
        </div>
        <DtNotice v-if="error" intent="danger">
          {{ error }}
        </DtNotice>
        <p class="text-sm text-secondary">
          添加后在“报告指标”选择此来源；点击顶部“试算”执行请求并核对结果。
        </p>
      </div>
      <template #footer
        ><DtButton size="sm" :disabled="isLoading" @click="save">
          应用数据源
        </DtButton></template
      >
    </DtModal>
  </DtCard>
</template>
