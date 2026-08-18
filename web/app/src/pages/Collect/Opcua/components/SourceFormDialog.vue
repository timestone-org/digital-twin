<script setup lang="ts">
/**
 * @fileoverview 新建 / 编辑 OPC UA 数据源表单。页面只管 OPC UA 一种协议，
 * 表单里没有协议字段。
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
  CollectSource,
  CollectSourceCreateInput,
  CollectSourceUpdateInput,
  DtNumberRange,
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

import { useFormDirty } from '@/composables/useFormDirty'
import {
  READ_MODES,
  SECURITY_MODES,
  SECURITY_POLICIES,
  splitOptions,
} from '../sourceFormOptions'
import {
  toCreateInput,
  toUpdateInput,
  validateSourceForm,
  type SourceFormValues,
} from '../sourceFormPayload'
import OptionsEditor from './OptionsEditor.vue'
import SourceCredentialFields from './SourceCredentialFields.vue'

const props = defineProps<{
  modelValue: boolean
  source: CollectSource | null
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

/** 表单此刻的取值，交给纯函数去校验与组装请求体。 */
function values(): SourceFormValues {
  return {
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
  }
}

function submit(): void {
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
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtNotice v-if="error" intent="danger" icon="alert-circle">
        {{ error }}
      </DtNotice>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DtField label="名称" required>
          <DtInput v-model="name" placeholder="如：1号生产线 OPC UA" />
        </DtField>
        <DtField label="Endpoint" required>
          <DtInput
            v-model="endpoint"
            class="font-mono"
            placeholder="opc.tcp://host:4840"
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

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DtField
          label="安全模式"
          hint="存进连接参数；驱动按自身能力消费，暂不支持的取值只存不生效。"
        >
          <DtSelect v-model="securityMode" :options="SECURITY_MODES" />
        </DtField>
        <DtField label="安全策略">
          <DtSelect v-model="securityPolicy" :options="SECURITY_POLICIES" />
        </DtField>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DtField label="采集模式">
          <DtSelect v-model="readModeValue" :options="READ_MODES" />
        </DtField>
        <DtField
          v-if="readMode === 'poll'"
          label="轮询间隔（毫秒）"
          hint="仅轮询模式生效，最小 50ms。"
        >
          <DtNumberInput v-model="pollIntervalMs" :range="INTERVAL_RANGE" />
        </DtField>
      </div>

      <SourceCredentialFields
        v-model:username="username"
        v-model:credential="credential"
        v-model:is-cleared="isCredentialCleared"
        :is-edit="isEdit"
        :has-credential="source?.has_credential ?? false"
      />

      <DtField
        label="其它连接参数"
        hint="驱动特有的旁路配置，如证书路径。不清楚就留空。"
      >
        <OptionsEditor v-model="extraOptions" />
      </DtField>

      <label
        class="flex items-center justify-between rounded-md border border-border-subtle bg-surface-sunken/40 px-3 py-2.5"
      >
        <span class="text-sm text-text-secondary">启用该数据源</span>
        <DtSwitch v-model="isEnabled" aria-label="启用该数据源" />
      </label>
    </div>

    <template #footer>
      <DtButton variant="ghost" @click="emit('update:modelValue', false)">
        取消
      </DtButton>
      <DtButton :icon="isEdit ? 'save' : 'plus'" @click="submit">
        {{ isEdit ? '保存' : '创建' }}
      </DtButton>
    </template>
  </DtModal>
</template>
