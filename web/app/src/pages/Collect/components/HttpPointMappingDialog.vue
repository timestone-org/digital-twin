<script setup lang="ts">
/** @fileoverview JSON 响应样例的多点位解析、预览与统一归档配置。 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { COLLECT_DATA_TYPES, COLLECT_MIN_INTERVAL_MS } from '@dt/contracts'
import {
  DtButton,
  DtEmpty,
  DtField,
  DtModal,
  DtNotice,
  DtNumberInput,
  DtSwitch,
  DtTextarea,
} from '@dt/ui'
import HttpPointMappingTable from './HttpPointMappingTable.vue'
import { useFormDirty } from '@/composables/useFormDirty'
import {
  parseHttpSample,
  type HttpPointDraft,
} from '../scripts/httpPointMapping'
import { codeProblems, toPointItems } from '../scripts/importDrafts'
import { useHttpPointImport } from '../scripts/useHttpPointImport'

const props = defineProps<{ modelValue: boolean; sourceId: string }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  imported: []
}>()
const sample = ref('')
const RESPONSE_SAMPLE = '{"data":{"temperature":23.5,"running":true}}'
const rows = ref<HttpPointDraft[]>([])
const selected = ref(new Set<string>())
const parseError = ref<string | null>(null)
const skippedNulls = ref(0)
const unsafeIntegers = ref(0)
const archiveEnabled = ref(true)
const samplingIntervalMs = ref(1000)
const deadband = ref(0)
const retentionDays = ref(0)
const state = useHttpPointImport(() => props.sourceId)
const { isDirty } = useFormDirty(
  [
    sample,
    rows,
    selected,
    archiveEnabled,
    samplingIntervalMs,
    deadband,
    retentionDays,
  ],
  () => props.modelValue,
)

const hasRows = computed(() => rows.value.length > 0)
const chosen = computed(() =>
  rows.value.filter((row) => selected.value.has(row.address)),
)
const problems = computed(() =>
  codeProblems(chosen.value, state.existing.value),
)
const isBusy = computed(
  () => state.isScanning.value || state.isSubmitting.value,
)
const canSubmit = computed(
  () =>
    !isBusy.value &&
    state.error.value === null &&
    state.outcome.value === null &&
    chosen.value.length > 0 &&
    problems.value.size === 0 &&
    samplingIntervalMs.value >= COLLECT_MIN_INTERVAL_MS,
)
const nullMessage = computed(
  () =>
    `跳过 ${skippedNulls.value} 个 null 字段；null 无法从样例推断类型，可稍后手工新建点位。`,
)
const problemMessage = computed(
  () =>
    `有 ${problems.value.size} 个已选字段的编码无效、重复或已存在，请修改编码或取消选择。`,
)
const outcomeMessage = computed(() => {
  const result = state.outcome.value
  if (result === null) return ''
  const unverified = result.unverified
    ? `${result.unverified} 个字段尚未现场校验，请在采集后核对实时值。`
    : ''
  return `已创建 ${result.created} 个点位。${unverified}`
})
const failureNotices = computed(
  () =>
    state.outcome.value?.failures.map((failure) => ({
      id: failure.batch,
      message: `第 ${failure.batch} 批创建失败：${failure.message}`,
    })) ?? [],
)

watch(
  () => [props.modelValue, props.sourceId] as const,
  ([open]) => {
    if (!open) {
      state.cancel()
      return
    }
    sample.value = ''
    rows.value = []
    selected.value = new Set()
    parseError.value = null
    skippedNulls.value = 0
    unsafeIntegers.value = 0
    archiveEnabled.value = true
    samplingIntervalMs.value = 1000
    deadband.value = 0
    retentionDays.value = 0
    void state.reset()
  },
  { immediate: true },
)
onUnmounted(state.cancel)

function parse(): void {
  const result = parseHttpSample(sample.value)
  rows.value = result.rows
  selected.value = new Set(result.rows.map((row) => row.address))
  parseError.value = result.error
  skippedNulls.value = result.skippedNulls
  unsafeIntegers.value = result.unsafeIntegers
  state.outcome.value = null
}
function select(address: string, enabled: boolean): void {
  const next = new Set(selected.value)
  if (enabled) next.add(address)
  else next.delete(address)
  selected.value = next
}
function change(
  address: string,
  key: 'name' | 'code' | 'fieldType',
  value: string,
): void {
  rows.value = rows.value.map((row) => {
    if (row.address !== address) return row
    if (key === 'fieldType')
      return {
        ...row,
        fieldType: COLLECT_DATA_TYPES.find((type) => type === value) ?? 'float',
      }
    return { ...row, [key]: value }
  })
}
async function submit(): Promise<void> {
  if (!canSubmit.value) return
  if (chosen.value.some((row) => row.name.trim() === '')) {
    parseError.value = '点位名称不能为空'
    return
  }
  const items = toPointItems(chosen.value, {
    fallbackType: 'float',
    samplingIntervalMs: samplingIntervalMs.value,
    archiveEnabled: archiveEnabled.value,
    deadband: deadband.value,
    retentionDays: retentionDays.value,
  })
  await state.submit(items, () => emit('imported'))
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :dirty="isDirty"
    title="从 JSON 响应生成点位"
    width="68rem"
    :close-on-backdrop="!isBusy"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <p class="m-0 text-sm text-text-secondary">
        粘贴接口 JSON
        响应样例，选择需要采集的字段。一个响应可解析多个点位；每个点位均可用于实时展示、历史归档与业务绑定。
      </p>
      <DtTextarea
        v-model="sample"
        label="JSON 响应样例"
        :placeholder="RESPONSE_SAMPLE"
        :rows="4"
        :disabled="isBusy"
        mono
      />
      <div>
        <DtButton
          variant="outline"
          :disabled="isBusy || sample.trim() === ''"
          @click="parse"
        >
          <span>解析并预览</span>
        </DtButton>
      </div>
      <DtNotice v-if="parseError" intent="danger" icon="alert-circle">{{
        parseError
      }}</DtNotice>
      <DtNotice v-if="state.error.value" intent="danger" icon="alert-circle">{{
        state.error.value
      }}</DtNotice>
      <DtNotice v-if="skippedNulls" intent="info" icon="alert-circle">{{
        nullMessage
      }}</DtNotice>
      <DtNotice v-if="problems.size" intent="warning" icon="alert-triangle">{{
        problemMessage
      }}</DtNotice>
      <DtNotice v-if="unsafeIntegers" intent="warning" icon="alert-triangle">
        {{ unsafeIntegers }}
        个数值超出安全整数范围，已建议字符串类型且不显示舍入后的值。上游应将大整数作为
        JSON 字符串返回，才能精确预览。
      </DtNotice>
      <DtEmpty
        v-if="rows.length === 0 && !parseError"
        size="inline"
        title="解析后在这里选择字段；数组使用下标，键名中的 / 与 ~ 会自动转义。"
      />
      <HttpPointMappingTable
        v-if="hasRows"
        :rows="rows"
        :selected="selected"
        :problems="problems"
        :is-busy="isBusy"
        @select="select"
        @change="change"
      />
      <template v-if="hasRows">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DtField
            label="采样周期（毫秒）"
            hint="多个点位共享一次请求；实际采样不快于数据源轮询周期。"
            ><DtNumberInput
              v-model="samplingIntervalMs"
              :range="{ min: COLLECT_MIN_INTERVAL_MS, step: 100 }"
              :disabled="isBusy"
          /></DtField>
          <DtSwitch
            v-model="archiveEnabled"
            label="导入后默认开启记录历史"
            :disabled="isBusy"
          />
        </div>
        <div
          v-if="archiveEnabled"
          class="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <DtField label="记录死区"
            ><DtNumberInput
              v-model="deadband"
              :range="{ min: 0, step: 0.1 }"
              :disabled="isBusy"
          /></DtField>
          <DtField label="保留期（天）" hint="0 = 跟随全局策略。"
            ><DtNumberInput
              v-model="retentionDays"
              :range="{ min: 0, step: 1 }"
              :disabled="isBusy"
          /></DtField>
        </div>
      </template>
      <DtNotice
        v-if="state.outcome.value"
        :intent="state.outcome.value.failures.length ? 'danger' : 'success'"
        icon="check"
        >{{ outcomeMessage }}</DtNotice
      >
      <DtNotice
        v-for="failure in failureNotices"
        :key="failure.id"
        intent="danger"
        icon="alert-circle"
        >{{ failure.message }}</DtNotice
      >
    </div>
    <template #footer>
      <DtButton
        variant="ghost"
        :disabled="isBusy"
        @click="emit('update:modelValue', false)"
      >
        <span>{{ state.outcome.value ? '关闭' : '取消' }}</span>
      </DtButton>
      <DtButton
        :disabled="!canSubmit"
        :loading="state.isSubmitting.value"
        @click="submit"
      >
        <span>创建 {{ chosen.length }} 个点位</span>
      </DtButton>
    </template>
  </DtModal>
</template>
