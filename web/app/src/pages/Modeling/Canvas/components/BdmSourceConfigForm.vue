<script setup lang="ts">
/** @fileoverview 能管取数专用配置：目录选择、业务时间与公式粒度、输出限制。 */
import type { ModelingBdmCapabilities } from '@dt/contracts'
import { DtButton, DtNotice, DtSelect, DtTag } from '@dt/ui'
import { computed, onScopeDispose, ref, watch } from 'vue'

import { getModelingBdmCapabilities } from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import type { ConfigStatus } from '../scripts/configValues'
import type { FormField, FormOptions } from '../scripts/schemaForm'
import {
  BDM_MINUTE_INTERVALS,
  BDM_RECENT_RANGES,
  bdmIntervalError,
  bdmText,
  bdmTimeError,
} from '../scripts/bdmConfig'
import BdmIdentifierPicker from './BdmIdentifierPicker.vue'
import ConfigForm from './ConfigForm.vue'
import MomentInput from './MomentInput.vue'

const props = defineProps<{
  fields: readonly FormField[]
  config: Record<string, unknown>
  options: FormOptions
  isReadonly: boolean
}>()
const emit = defineEmits<{
  change: [key: string, value: unknown]
  status: [value: ConfigStatus]
}>()
const capabilities = ref<ModelingBdmCapabilities | null>(null)
const capabilityError = ref('')
const isCapabilityLoading = ref(false)
const raced = useRacedFetch()
const drafts = ref<Record<string, ConfigStatus>>({})
const kind = computed(() => bdmText(props.config, 'kind', 'point'))
const granularity = computed(() => bdmText(props.config, 'granularity', 'day'))
const isIntraday = computed(
  () =>
    kind.value === 'formula' && ['hour', 'minute'].includes(granularity.value),
)
const identifiersField = computed(() =>
  props.fields.find((field) => field.key === 'identifiers'),
)
const identifiers = computed(() => {
  const value = props.config['identifiers']
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
})
const kindOptions = [
  { value: 'point', label: '采集点历史' },
  { value: 'raw', label: '产供用属性历史' },
  { value: 'formula', label: 'EMS 公式结果' },
]
const granularityNames: Record<string, string> = {
  day: '按天',
  month: '按月',
  hour: '按小时',
  minute: '按分钟',
}
const granularities = computed(() =>
  (
    props.fields.find((field) => field.key === 'granularity')?.options ?? []
  ).map((item) => ({
    value: item.value,
    label: granularityNames[item.value] ?? item.label,
  })),
)
const intervalOptions = computed(() =>
  (capabilities.value?.minute_intervals ?? BDM_MINUTE_INTERVALS).map(
    (value) => ({ value: String(value), label: `${value} 分钟` }),
  ),
)
const outputFields = computed(() =>
  props.fields
    .filter((field) => ['value_type', 'row_limit'].includes(field.key))
    .map((field) =>
      field.key === 'value_type'
        ? {
            ...field,
            hint: '数值模式会把无法转换的值保留为空，并在结果中说明。',
            options: [
              { value: 'number', label: '数值（训练与分析）' },
              { value: 'string', label: '原始文本' },
            ],
          }
        : field,
    ),
)
const timeError = computed(
  () => bdmTimeError(props.config) || bdmIntervalError(props.config),
)
const status = computed<ConfigStatus>(() => {
  if (props.isReadonly) return { message: '', hasDraft: false }
  const issues = Object.values(drafts.value)
  const first =
    issues.find((item) => item.hasDraft) ?? issues.find((item) => item.message)
  return {
    message: first?.message || timeError.value,
    hasDraft: issues.some((item) => item.hasDraft),
  }
})
watch(status, (value) => emit('status', value), { immediate: true })

function setStatus(key: string, value: ConfigStatus): void {
  drafts.value = { ...drafts.value, [key]: value }
}
function change(key: string, value: unknown): void {
  if (!props.isReadonly) emit('change', key, value)
}
async function loadCapabilities(): Promise<void> {
  isCapabilityLoading.value = true
  capabilityError.value = ''
  await raced.run(getModelingBdmCapabilities, {
    ok: (value) => {
      capabilities.value = value
    },
    fail: (caught) => {
      capabilityError.value = describeError(caught)
    },
    settled: () => {
      isCapabilityLoading.value = false
    },
  })
}
void loadCapabilities()
onScopeDispose(() => raced.cancel())
</script>

<template>
  <div class="dt-bdm-config">
    <div class="dt-bdm-config__connection">
      <DtTag
        v-if="capabilities"
        :intent="capabilities.is_configured ? 'info' : 'warning'"
      >
        {{ capabilities.is_configured ? '能管连接已配置' : '能管连接未启用' }}
      </DtTag>
      <span v-if="capabilities?.timezone">
        能管业务时区：{{ capabilities.timezone }}
      </span>
      <span v-if="isCapabilityLoading" role="status"> 正在读取连接配置… </span>
      <DtButton
        v-if="capabilityError"
        variant="ghost"
        @click="loadCapabilities"
      >
        重新读取连接配置
      </DtButton>
    </div>
    <DtNotice v-if="capabilityError" intent="warning">
      {{ capabilityError }}
    </DtNotice>
    <DtNotice
      v-if="capabilities && !capabilities.is_configured"
      intent="warning"
    >
      可以先配置算子。运行前请联系管理员启用能管连接，地址与密钥由服务端统一管理。
    </DtNotice>
    <div class="dt-bdm-config__layout">
      <section class="dt-bdm-config__data" aria-label="选择数据">
        <h3>1 · 选择数据</h3>
        <DtSelect
          :model-value="kind"
          :options="kindOptions"
          label="数据类别"
          :disabled="props.isReadonly"
          hint="切换类别会清空已选项；每个标识输出一列"
          @update:model-value="change('kind', $event)"
        />
        <BdmIdentifierPicker
          v-if="identifiersField"
          :kind="kind"
          :field="identifiersField"
          :model-value="identifiers"
          :is-readonly="props.isReadonly"
          @update:model-value="change('identifiers', $event)"
          @status="setStatus('identifiers', $event)"
        />
      </section>
      <div class="dt-bdm-config__settings">
        <section aria-label="时间与粒度">
          <h3>2 · 时间与粒度</h3>
          <DtSelect
            v-if="kind === 'formula'"
            :model-value="granularity"
            :options="granularities"
            label="公式粒度"
            :disabled="props.isReadonly"
            @update:model-value="change('granularity', $event)"
          />
          <DtSelect
            v-if="kind === 'formula' && granularity === 'minute'"
            :model-value="String(props.config['interval_minutes'] ?? 1)"
            :options="intervalOptions"
            label="分钟间隔"
            :disabled="props.isReadonly"
            @update:model-value="change('interval_minutes', Number($event))"
          />
          <MomentInput
            :model-value="bdmText(props.config, 'since', '-7d')"
            label="起始时刻"
            hint="包含起点；可选日期或使用相对时间"
            :allow-blank="false"
            :presets="BDM_RECENT_RANGES"
            :is-readonly="props.isReadonly"
            @update:model-value="change('since', $event)"
          />
          <MomentInput
            :model-value="bdmText(props.config, 'until', '')"
            label="截止时刻"
            hint="不包含终点；日期选择器显示浏览器本地时间"
            blank-label="运行时刻"
            blank-hint="每次运行时，自动以当时的时刻作为终点。"
            :presets="BDM_RECENT_RANGES"
            :is-readonly="props.isReadonly"
            @update:model-value="change('until', $event)"
          />
          <DtSelect
            v-if="isIntraday"
            :model-value="bdmText(props.config, 'time_alignment', 'complete')"
            label="周期边界"
            :disabled="props.isReadonly"
            :options="[
              { value: 'complete', label: '自动对齐，只取完整周期' },
              { value: 'strict', label: '严格按填写边界，未对齐时报错' },
            ]"
            @update:model-value="change('time_alignment', $event)"
          />
          <DtNotice v-if="timeError" intent="danger">
            {{ timeError }}
          </DtNotice>
          <p v-if="isIntraday" class="dt-bdm-config__hint">
            {{
              granularity === 'hour'
                ? '每 60 分钟一条。'
                : '按所选分钟间隔取数。'
            }}自动对齐会将起点向后、终点向前收至完整周期；如 15 分钟粒度的
            08:07–09:02，会读取 08:15–09:00。
          </p>
          <p v-else-if="kind === 'formula'" class="dt-bdm-config__hint">
            仅保留周期起点落在时间范围内的日／月结果；当前日／月可能尚未结束。公式值由能管系统计算。
          </p>
          <p v-else class="dt-bdm-config__hint">
            读取原始采样时刻。需要固定间隔时，可在下游接“重采样”算子。
          </p>
        </section>
        <section aria-label="输出设置">
          <h3>3 · 输出设置</h3>
          <ConfigForm
            :fields="outputFields"
            :config="props.config"
            :options="props.options"
            :is-readonly="props.isReadonly"
            @change="change"
            @status="setStatus('output', $event)"
          />
          <p class="dt-bdm-config__hint">
            按时间对齐，缺失保持为空。长时间范围自动分段，达到行数上限时保留最新记录并提示截断。
          </p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-bdm-config {
  display: grid;
  gap: 1rem;
  &__connection {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    color: var(--text-secondary);
    font-size: var(--font-size-compact);
  }
  &__layout {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
  }
  &__data,
  &__settings,
  section {
    display: grid;
    gap: 1rem;
    min-width: 0;
  }
  &__settings {
    padding-left: 1.5rem;
    border-left: 1px solid var(--border-subtle);
  }
  h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--font-size-body);
    font-weight: 600;
  }
  &__hint {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-compact);
    line-height: 1.6;
  }
  @media (max-width: 800px) {
    &__layout {
      grid-template-columns: minmax(0, 1fr);
    }
    &__settings {
      padding-left: 0;
      border-left: 0;
    }
  }
}
</style>
