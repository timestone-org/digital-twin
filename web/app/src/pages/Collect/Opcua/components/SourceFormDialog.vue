<script setup lang="ts">
/**
 * @fileoverview OPC UA、只读 Modbus TCP 与 HTTP 数据源的配置表单。
 *
 * ⚠ 编码只在新建时定：它是数据源的身份，点位身份 `{source_id}:{code}` 与归档
 * 表的压缩段键都挂在它上面（docs/COLLECT_DESIGN.md §2）。
 * ⚠ 口令三态：不填=不动、填了=改成新的、勾「清空」=删掉。合成两态的话，
 * 每次改端点都会顺手把口令抹掉。
 * ⚠ 安全模式/安全策略存进 `options_json`（`security_mode` / `security_policy`
 * 两个键）：驱动按自身能力消费，暂不支持的取值只存不生效——表单如实说明，
 * 不装作已经生效。
 */
import { computed, ref, watch } from 'vue'
import type {
  CollectReadMode,
  CollectProtocol,
  CollectSource,
  CollectSourceCreateInput,
  CollectSourceUpdateInput,
  DtNumberRange,
} from '@dt/contracts'
import { COLLECT_MIN_INTERVAL_MS, COLLECT_PROTOCOLS } from '@dt/contracts'
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
import {
  READ_MODES,
  SECURITY_MODES,
  SECURITY_POLICIES,
  splitOptions,
} from '../scripts/sourceFormOptions'
import {
  toCreateInput,
  toUpdateInput,
  validateSourceForm,
  type SourceFormValues,
} from '../scripts/sourceFormPayload'
import { defaultHttpOptions } from '../scripts/httpSourceOptions'
import HttpSourceFields from './HttpSourceFields.vue'
import OptionsEditor from './OptionsEditor.vue'
import SourceCredentialFields from './SourceCredentialFields.vue'

const props = defineProps<{
  modelValue: boolean
  source: CollectSource | null
  loading?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  create: [input: CollectSourceCreateInput]
  update: [input: CollectSourceUpdateInput]
}>()

/** 周期的取值范围。下限与后端 CHECK 约束同值，越界后端 422。 */
const INTERVAL_RANGE: DtNumberRange = {
  min: COLLECT_MIN_INTERVAL_MS,
  step: 100,
}

const isEdit = computed(() => props.source !== null)

const protocol = ref<CollectProtocol>('opcua')
const name = ref('')
const code = ref('')
const description = ref('')
const endpoint = ref('')
const securityMode = ref('None')
const securityPolicy = ref('None')
const readMode = ref<CollectReadMode>('subscribe')
const pollIntervalMs = ref(1000)
const username = ref('')
/** 空串 = 这次不改口令。 */
const credential = ref('')
/** 勾上表示把已存的口令删掉。 */
const isCredentialCleared = ref(false)
const isEnabled = ref(true)
/** 除安全两键外的其它连接参数。 */
const extraOptions = ref<Record<string, string>>({})

const error = ref<string | null>(null)

// ⚠ 这一屏十几个字段，误点一下遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty(
  [
    protocol,
    name,
    code,
    description,
    endpoint,
    securityMode,
    securityPolicy,
    readMode,
    pollIntervalMs,
    username,
    credential,
    isCredentialCleared,
    isEnabled,
    extraOptions,
  ],
  () => props.modelValue,
)

function reset(target: CollectSource | null): void {
  error.value = null
  credential.value = ''
  isCredentialCleared.value = false
  if (target === null) {
    protocol.value = 'opcua'
    name.value = ''
    code.value = ''
    description.value = ''
    endpoint.value = ''
    securityMode.value = 'None'
    securityPolicy.value = 'None'
    readMode.value = 'subscribe'
    pollIntervalMs.value = 1000
    username.value = ''
    isEnabled.value = true
    extraOptions.value = {}
    return
  }
  const split = splitOptions(target.options_json)
  protocol.value = target.protocol
  name.value = target.name
  code.value = target.code
  description.value = target.description ?? ''
  endpoint.value = target.endpoint
  securityMode.value = split.mode
  securityPolicy.value = split.policy
  readMode.value = target.read_mode
  pollIntervalMs.value = target.poll_interval_ms
  username.value = target.username ?? ''
  isEnabled.value = target.is_enabled
  extraOptions.value = split.rest
}

watch(
  () => [props.modelValue, props.source] as const,
  ([open]) => {
    if (open) reset(props.source)
  },
  { immediate: true },
)

/**
 * DtSelect 只认 `string`，而读取方式是闭合集合。
 * ⚠ 收窄靠一次显式比较而不是 `as`：控件回来的字符串真的越界时要落回默认值。
 */
const readModeValue = computed<string>({
  get: () => readMode.value,
  set: (next) => {
    readMode.value = next === 'poll' ? 'poll' : 'subscribe'
  },
})

const protocolValue = computed<string>({
  get: () => protocol.value,
  set: (next) => {
    const selected =
      COLLECT_PROTOCOLS.find((candidate) => candidate === next) ?? 'opcua'
    if (selected === protocol.value) return
    protocol.value = selected
    extraOptions.value = {}
    username.value = ''
    credential.value = ''
    isCredentialCleared.value = false
    readMode.value = selected === 'opcua' ? 'subscribe' : 'poll'
    if (protocol.value === 'modbus_tcp') {
      readMode.value = 'poll'
      isEnabled.value = false
    }
    if (protocol.value === 'http') {
      readMode.value = 'poll'
      extraOptions.value = defaultHttpOptions()
    }
  },
})

const PROTOCOL_OPTIONS = [
  { value: 'opcua', label: 'OPC UA' },
  { value: 'modbus_tcp', label: 'Modbus TCP（只读）' },
  { value: 'http', label: 'HTTP / HTTPS' },
]

/** 表单此刻的取值，交给纯函数去校验与组装请求体。 */
function values(): SourceFormValues {
  return {
    protocol: protocol.value,
    name: name.value,
    code: code.value,
    description: description.value,
    endpoint: endpoint.value,
    securityMode: securityMode.value,
    securityPolicy: securityPolicy.value,
    readMode: readMode.value,
    pollIntervalMs: pollIntervalMs.value,
    username: username.value,
    credential: credential.value,
    isCredentialCleared: isCredentialCleared.value,
    isEnabled: isEnabled.value,
    extraOptions: extraOptions.value,
    hasCredential: props.source?.has_credential ?? false,
  }
}

function submit(): void {
  if (props.loading === true) return
  const current = values()
  error.value = validateSourceForm(current, isEdit.value)
  if (error.value !== null) return
  if (props.source === null) emit('create', toCreateInput(current))
  else emit('update', toUpdateInput(current))
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :title="isEdit ? '编辑数据源' : '新增数据源'"
    width="36rem"
    :dirty="isDirty"
    @update:model-value="!loading && emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtNotice v-if="error" intent="danger" icon="alert-circle">
        {{ error }}
      </DtNotice>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DtSelect
          v-model="protocolValue"
          label="协议"
          required
          :options="PROTOCOL_OPTIONS"
          :disabled="isEdit"
        />
        <DtField label="名称" required>
          <DtInput v-model="name" placeholder="如：1号生产线 PLC" />
        </DtField>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DtField label="Endpoint" required>
          <DtInput
            v-model="endpoint"
            class="font-mono"
            :placeholder="
              protocol === 'opcua'
                ? 'opc.tcp://host:4840'
                : protocol === 'http'
                  ? 'https://api.example.com/metrics'
                  : 'modbus.tcp://host:502'
            "
          />
        </DtField>
      </div>

      <DtField
        label="编码"
        required
        :hint="
          isEdit
            ? '编码是数据源的身份，建好之后不可更改。'
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

      <DtField label="描述">
        <DtInput v-model="description" placeholder="可选，用于备注用途" />
      </DtField>

      <div
        v-if="protocol === 'opcua'"
        class="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <DtField
          label="安全模式"
          hint="当前仅支持 None；需要签名或加密的设备暂不能接入。"
        >
          <DtSelect v-model="securityMode" :options="SECURITY_MODES" />
        </DtField>
        <DtField label="安全策略">
          <DtSelect v-model="securityPolicy" :options="SECURITY_POLICIES" />
        </DtField>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DtSelect
          v-model="readModeValue"
          label="采集模式"
          :options="READ_MODES"
          :disabled="protocol !== 'opcua'"
        />
        <DtNumberInput
          v-if="readMode === 'poll'"
          v-model="pollIntervalMs"
          :range="INTERVAL_RANGE"
          label="轮询间隔（毫秒）"
          :hint="
            protocol !== 'opcua'
              ? '仅轮询模式生效，安全下限 1000ms。'
              : '仅轮询模式生效，最小 50ms。'
          "
        />
      </div>

      <SourceCredentialFields
        v-if="protocol === 'opcua'"
        v-model:username="username"
        v-model:credential="credential"
        v-model:is-cleared="isCredentialCleared"
        :is-edit="isEdit"
        :has-credential="source?.has_credential ?? false"
      />

      <DtField
        v-if="protocol !== 'http'"
        label="其它连接参数"
        :hint="
          protocol === 'opcua'
            ? '驱动特有的旁路配置，如证书路径。不清楚就留空。'
            : '可配置 device_id、byte_order、word_order、max_registers_per_request、max_bits_per_request；不清楚就留空。'
        "
      >
        <OptionsEditor v-model="extraOptions" />
      </DtField>

      <HttpSourceFields
        v-if="protocol === 'http'"
        v-model="extraOptions"
        v-model:username="username"
        v-model:credential="credential"
        v-model:is-cleared="isCredentialCleared"
        :is-edit="isEdit"
        :has-credential="source?.has_credential ?? false"
      />

      <label
        class="flex items-center justify-between rounded-md border border-border-subtle bg-surface-sunken/40 px-3 py-2.5"
      >
        <span class="text-sm text-text-secondary">启用该数据源</span>
        <DtSwitch v-model="isEnabled" aria-label="启用该数据源" />
      </label>
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        :disabled="loading"
        @click="emit('update:modelValue', false)"
      >
        取消
      </DtButton>
      <DtButton
        :icon="isEdit ? 'save' : 'plus'"
        :loading="loading === true"
        @click="submit"
      >
        {{ isEdit ? '保存' : '创建' }}
      </DtButton>
    </template>
  </DtModal>
</template>
