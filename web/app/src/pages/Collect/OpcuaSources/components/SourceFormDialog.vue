<script setup lang="ts">
/**
 * @fileoverview 新建 / 编辑采集数据源的表单。
 *
 * ⚠ 编码只在新建时定：它是数据源的身份，点位身份 `{source_id}:{code}` 与归档
 * 表的压缩段键都挂在它上面。改编码等于换身份，历史会断成两段而没人察觉
 * （docs/COLLECT_DESIGN.md §2）。所以编辑面上没有它。
 *
 * ⚠ 口令三态：不填=不动、填了=改成新的、点「清空」=删掉。合成两态的话，
 * 每次改端点都会顺手把口令抹掉，而现象要到下次重连才出现。
 */
import { computed, ref, watch } from 'vue'
import type {
  CollectReadMode,
  CollectSource,
  CollectSourceCreateInput,
  CollectSourceUpdateInput,
  DtNumberRange,
  DtSelectOption,
} from '@dt/contracts'
import { COLLECT_MIN_INTERVAL_MS } from '@dt/contracts'
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

import OptionsEditor from './OptionsEditor.vue'

const props = defineProps<{
  modelValue: boolean
  source: CollectSource | null
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  create: [input: CollectSourceCreateInput]
  update: [input: CollectSourceUpdateInput]
}>()

const READ_MODES: readonly DtSelectOption[] = [
  { value: 'subscribe', label: '订阅（推荐）' },
  { value: 'poll', label: '轮询' },
]

/** 周期的取值范围。下限与后端 CHECK 约束同值，越界后端 422。 */
const INTERVAL_RANGE: DtNumberRange = {
  min: COLLECT_MIN_INTERVAL_MS,
  step: 100,
}

const isEdit = computed(() => props.source !== null)

const name = ref('')
const code = ref('')
const endpoint = ref('')
const readMode = ref<CollectReadMode>('subscribe')
const pollIntervalMs = ref(1000)
const isEnabled = ref(true)
const options = ref<Record<string, string>>({})
/** 空串 = 这次不改口令。 */
const credential = ref('')
/** 勾上表示把已存的口令删掉。 */
const isCredentialCleared = ref(false)

const error = ref<string | null>(null)

/**
 * DtSelect 只认 `string`，而读取方式是闭合集合。
 * ⚠ 收窄靠一次显式比较而不是 `as`：控件回来的字符串真的越界时要落回默认值，
 * 而断言会让越界值一路发到后端，换回一个说不清是哪个字段的 422。
 */
const readModeValue = computed<string>({
  get: () => readMode.value,
  set: (next) => {
    readMode.value = next === 'poll' ? 'poll' : 'subscribe'
  },
})

interface FormValues {
  name: string
  code: string
  endpoint: string
  readMode: CollectReadMode
  pollIntervalMs: number
  isEnabled: boolean
  options: Record<string, string>
}

const DEFAULTS: FormValues = {
  name: '',
  code: '',
  endpoint: '',
  readMode: 'subscribe',
  pollIntervalMs: 1000,
  isEnabled: true,
  options: {},
}

/** 表单的初始取值：编辑时来自数据源，新建时用默认值。 */
function valuesOf(target: CollectSource | null): FormValues {
  if (target === null) return { ...DEFAULTS, options: {} }
  return {
    name: target.name,
    code: target.code,
    endpoint: target.endpoint,
    readMode: target.read_mode,
    pollIntervalMs: target.poll_interval_ms,
    isEnabled: target.is_enabled,
    options: { ...target.options_json },
  }
}

function reset(target: CollectSource | null): void {
  const values = valuesOf(target)
  error.value = null
  credential.value = ''
  isCredentialCleared.value = false
  name.value = values.name
  code.value = values.code
  endpoint.value = values.endpoint
  readMode.value = values.readMode
  pollIntervalMs.value = values.pollIntervalMs
  isEnabled.value = values.isEnabled
  options.value = values.options
}

watch(
  () => [props.modelValue, props.source] as const,
  ([open]) => {
    if (open) reset(props.source)
  },
  { immediate: true },
)

/** 轮询周期只在轮询模式下有意义，订阅模式下它是驱动降级时的兜底。 */
const intervalHint = computed(() =>
  readMode.value === 'poll'
    ? '每隔这么久读一轮全部点位。'
    : '驱动不支持订阅时自动降级为轮询，届时按这个周期。',
)

function validate(): string | null {
  if (name.value.trim() === '') return '请填写名称'
  if (!isEdit.value && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(code.value.trim()))
    return '编码只能用字母、数字与 . _ -，且以字母或数字开头'
  if (endpoint.value.trim() === '') return '请填写端点地址'
  if (pollIntervalMs.value < COLLECT_MIN_INTERVAL_MS)
    return `周期不能小于 ${COLLECT_MIN_INTERVAL_MS} 毫秒`
  return null
}

function submit(): void {
  error.value = validate()
  if (error.value !== null) return
  if (props.source === null) {
    emit('create', {
      name: name.value.trim(),
      code: code.value.trim(),
      protocol: 'opcua',
      endpoint: endpoint.value.trim(),
      credential: credential.value === '' ? undefined : credential.value,
      options_json: options.value,
      read_mode: readMode.value,
      poll_interval_ms: pollIntervalMs.value,
      is_enabled: isEnabled.value,
    })
    return
  }
  emit('update', {
    name: name.value.trim(),
    endpoint: endpoint.value.trim(),
    ...credentialChange(),
    options_json: options.value,
    read_mode: readMode.value,
    poll_interval_ms: pollIntervalMs.value,
    is_enabled: isEnabled.value,
  })
}

/** 口令三态落到请求体上：不动就整个字段都不带。 */
function credentialChange(): { credential?: string | null } {
  if (isCredentialCleared.value) return { credential: null }
  if (credential.value !== '') return { credential: credential.value }
  return {}
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :title="isEdit ? '编辑数据源' : '新建数据源'"
    width="34rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtNotice v-if="error" intent="danger" icon="alert-circle">
        {{ error }}
      </DtNotice>

      <DtField label="名称" required>
        <DtInput v-model="name" placeholder="如：一号车间 PLC" />
      </DtField>

      <DtField
        label="编码"
        required
        :hint="
          isEdit
            ? '编码是数据源的身份，建好之后不可更改——改它等于换一个新数据源，历史会断成两段。'
            : '点位身份与历史归档都挂在它上面，建好之后不可更改。'
        "
      >
        <DtInput
          v-model="code"
          class="font-mono"
          :disabled="isEdit"
          placeholder="如：plant1_plc"
        />
      </DtField>

      <DtField label="端点地址" required hint="OPC UA 的 opc.tcp 端点。">
        <DtInput
          v-model="endpoint"
          class="font-mono"
          placeholder="opc.tcp://10.0.0.2:4840"
        />
      </DtField>

      <DtField
        label="口令"
        :hint="
          isEdit
            ? '留空表示不改动已配置的口令。'
            : '匿名连接可以不填。口令只以密文入库，任何接口都不会回它。'
        "
      >
        <DtInput
          v-model="credential"
          type="password"
          :disabled="isCredentialCleared"
          placeholder="留空表示不修改"
        />
      </DtField>

      <DtField v-if="isEdit && source?.has_credential" label="清空口令">
        <DtSwitch v-model="isCredentialCleared" label="删掉已配置的口令" />
      </DtField>

      <DtField label="读取方式">
        <DtSelect v-model="readModeValue" :options="READ_MODES" />
      </DtField>

      <DtField label="轮询周期（毫秒）" :hint="intervalHint">
        <DtNumberInput v-model="pollIntervalMs" :range="INTERVAL_RANGE" />
      </DtField>

      <DtField
        label="连接参数"
        hint="驱动特有的旁路配置，如安全策略、证书路径。不清楚就留空。"
      >
        <OptionsEditor v-model="options" />
      </DtField>

      <DtField label="启用">
        <DtSwitch v-model="isEnabled" label="下发给采集器并开始采集" />
      </DtField>
    </div>

    <template #footer>
      <DtButton variant="ghost" @click="emit('update:modelValue', false)">
        取消
      </DtButton>
      <DtButton @click="submit">保存</DtButton>
    </template>
  </DtModal>
</template>
