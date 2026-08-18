<script setup lang="ts">
/**
 * @fileoverview 新建 / 编辑单个点位。
 *
 * ⚠ 编码只在新建时定：它是点位的身份，历史按它归档。改编码等于换一个新点位，
 * 旧曲线归旧编码（docs/COLLECT_DESIGN.md §2）。所以编辑面上没有它。
 *
 * ⚠ 寻址串是**可改的配置**：同一个物理测点换协议只改这里，历史是连续的一条。
 * 改完后端会重新问一次现场，结论如实回给用户。
 */
import { computed, ref, watch } from 'vue'
import type {
  CollectDataType,
  CollectPoint,
  CollectPointItemInput,
  CollectPointUpdateInput,
  DtNumberRange,
  DtSelectOption,
} from '@dt/contracts'
import { COLLECT_DATA_TYPES, COLLECT_MIN_INTERVAL_MS } from '@dt/contracts'
import {
  DtButton,
  DtField,
  DtInput,
  DtModal,
  DtNotice,
  DtNumberInput,
  DtSelect,
  DtSwitch,
} from '@dt/ui'
import { useFormDirty } from '@/composables/useFormDirty'

const props = defineProps<{
  modelValue: boolean
  point: CollectPoint | null
  /** 新建时预填的寻址串，从地址空间挑来的那条。 */
  presetAddress?: string | undefined
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  create: [item: CollectPointItemInput]
  update: [input: CollectPointUpdateInput]
}>()

const DATA_TYPES: readonly DtSelectOption[] = [
  { value: 'float', label: '浮点数' },
  { value: 'int', label: '整数' },
  { value: 'bool', label: '布尔' },
  { value: 'string', label: '字符串' },
]

const SAMPLING_RANGE: DtNumberRange = {
  min: COLLECT_MIN_INTERVAL_MS,
  step: 100,
}
const DEADBAND_RANGE: DtNumberRange = { min: 0, step: 0.1, precision: 3 }
const HEARTBEAT_RANGE: DtNumberRange = { min: 1000, step: 1000 }
// 下限是 0 而不是 1：0 是「跟随全局策略」这一档的表达，后端收到的是 null
const RETENTION_RANGE: DtNumberRange = { min: 0, step: 1 }

const isEdit = computed(() => props.point !== null)

const code = ref('')
const name = ref('')
const address = ref('')
const dataType = ref<CollectDataType>('float')
const unit = ref('')
const samplingIntervalMs = ref(1000)
const deadband = ref(0)
const archiveEnabled = ref(true)
const archiveMaxIntervalMs = ref(60_000)
/** 0 表示跟随全局保留策略。后端用 null 表达同一件事。 */
const retentionDays = ref(0)

const error = ref<string | null>(null)

// ⚠ 填了一半误点遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty(
  [
    code,
    name,
    address,
    dataType,
    unit,
    samplingIntervalMs,
    deadband,
    archiveEnabled,
    archiveMaxIntervalMs,
    retentionDays,
  ],
  () => props.modelValue,
)

interface FormValues {
  code: string
  name: string
  address: string
  dataType: CollectDataType
  unit: string
  samplingIntervalMs: number
  deadband: number
  archiveEnabled: boolean
  archiveMaxIntervalMs: number
  retentionDays: number
}

const DEFAULTS: FormValues = {
  code: '',
  name: '',
  address: '',
  dataType: 'float',
  unit: '',
  samplingIntervalMs: 1000,
  deadband: 0,
  archiveEnabled: true,
  archiveMaxIntervalMs: 60_000,
  retentionDays: 0,
}

/** 表单的初始取值：编辑时来自点位，新建时用默认值 + 挑来的寻址串。 */
function valuesOf(target: CollectPoint | null, preset: string): FormValues {
  if (target === null) return { ...DEFAULTS, address: preset }
  return {
    code: target.code,
    name: target.name,
    address: target.address,
    dataType: target.data_type,
    unit: target.unit ?? '',
    samplingIntervalMs: target.sampling_interval_ms,
    deadband: target.deadband,
    archiveEnabled: target.archive_enabled,
    archiveMaxIntervalMs: target.archive_max_interval_ms,
    retentionDays: target.archive_retention_days ?? 0,
  }
}

function reset(): void {
  const values = valuesOf(props.point, props.presetAddress ?? '')
  error.value = null
  code.value = values.code
  name.value = values.name
  address.value = values.address
  dataType.value = values.dataType
  unit.value = values.unit
  samplingIntervalMs.value = values.samplingIntervalMs
  deadband.value = values.deadband
  archiveEnabled.value = values.archiveEnabled
  archiveMaxIntervalMs.value = values.archiveMaxIntervalMs
  retentionDays.value = values.retentionDays
}

watch(
  () => [props.modelValue, props.point, props.presetAddress] as const,
  ([open]) => {
    if (open) reset()
  },
  { immediate: true },
)

/**
 * DtSelect 只认 `string`；越界取值落回 float 而不是断言过去——
 * 断言会让一个后端不认识的类型一路发出去，换回一个说不清字段的 422。
 */
const dataTypeValue = computed<string>({
  get: () => dataType.value,
  set: (next) => {
    dataType.value = COLLECT_DATA_TYPES.find((type) => type === next) ?? 'float'
  },
})

/** 死区只对数值型有意义：布尔与字符串上它永远不触发。 */
const isNumeric = computed(
  () => dataType.value === 'float' || dataType.value === 'int',
)

function validate(): string | null {
  if (!isEdit.value && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(code.value.trim()))
    return '点位编码只能用字母、数字与 . _ -，且以字母或数字开头'
  if (name.value.trim() === '') return '请填写名称'
  if (address.value.trim() === '') return '请填写寻址串'
  if (samplingIntervalMs.value < COLLECT_MIN_INTERVAL_MS)
    return `采样周期不能小于 ${COLLECT_MIN_INTERVAL_MS} 毫秒`
  return null
}

function submit(): void {
  error.value = validate()
  if (error.value !== null) return
  const shared = {
    name: name.value.trim(),
    address: address.value.trim(),
    data_type: dataType.value,
    unit: unit.value.trim() === '' ? null : unit.value.trim(),
    sampling_interval_ms: samplingIntervalMs.value,
    deadband: isNumeric.value ? deadband.value : 0,
    archive_enabled: archiveEnabled.value,
    archive_max_interval_ms: archiveMaxIntervalMs.value,
    archive_retention_days:
      retentionDays.value > 0 ? retentionDays.value : null,
  }
  if (props.point === null)
    emit('create', { code: code.value.trim(), ...shared })
  else emit('update', shared)
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :dirty="isDirty"
    :title="isEdit ? '编辑点位' : '新建点位'"
    width="34rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtNotice v-if="error" intent="danger" icon="alert-circle">
        {{ error }}
      </DtNotice>

      <DtField
        label="点位编码"
        required
        hint="点位的身份，历史按它归档；建好之后不可更改。"
      >
        <DtInput
          v-model="code"
          class="font-mono"
          :disabled="isEdit"
          placeholder="如：outlet_temp"
        />
      </DtField>

      <DtField label="名称" required>
        <DtInput v-model="name" placeholder="如：出口温度" />
      </DtField>

      <DtField
        label="寻址串"
        required
        hint="协议地址，可以改——换协议时只改这里，历史曲线是连续的一条。"
      >
        <DtInput
          v-model="address"
          class="font-mono"
          placeholder="ns=2;s=Plant1.OutletTemp"
        />
      </DtField>

      <div class="grid grid-cols-2 gap-3">
        <DtField label="数据类型">
          <DtSelect v-model="dataTypeValue" :options="DATA_TYPES" />
        </DtField>
        <DtField label="单位">
          <DtInput v-model="unit" placeholder="如：℃" />
        </DtField>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <DtField label="采样周期（毫秒）">
          <DtNumberInput v-model="samplingIntervalMs" :range="SAMPLING_RANGE" />
        </DtField>
        <DtField
          v-if="isNumeric"
          label="死区"
          hint="变化超过它才算一次新值。填 0 表示每次变化都记。"
        >
          <DtNumberInput v-model="deadband" :range="DEADBAND_RANGE" />
        </DtField>
      </div>

      <DtField label="归档">
        <DtSwitch v-model="archiveEnabled" label="把历史值写进归档表" />
      </DtField>

      <div v-if="archiveEnabled" class="grid grid-cols-2 gap-3">
        <DtField
          label="归档心跳（毫秒）"
          hint="值不变时也至少每隔这么久落一条，曲线才不会断成一段一段。"
        >
          <DtNumberInput
            v-model="archiveMaxIntervalMs"
            :range="HEARTBEAT_RANGE"
          />
        </DtField>
        <DtField label="保留天数" hint="填 0 表示跟随全局保留策略。">
          <DtNumberInput v-model="retentionDays" :range="RETENTION_RANGE" />
        </DtField>
      </div>
    </div>

    <template #footer>
      <DtButton variant="ghost" @click="emit('update:modelValue', false)">
        取消
      </DtButton>
      <DtButton @click="submit">保存</DtButton>
    </template>
  </DtModal>
</template>
