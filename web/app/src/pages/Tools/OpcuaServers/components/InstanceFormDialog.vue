<script setup lang="ts">
/**
 * @fileoverview 新建 / 编辑实例的表单。
 *
 * ⚠ 名称与端口只在新建时定：名称是人给的唯一标识；端口一旦定下，上位机的
 * 组态里就写着它，改端口等于换一个对方连不上的地址。所以两者都不在编辑面上。
 *
 * ⚠ 端口只能从池内的空闲端口里挑。池外的端口没有容器映射，服务能 bind 而
 * 上位机连不上，实例状态却显示「运行中」——所以这里只给可选项，不给自由输入，
 * 后端也会以 42113 拒绝池外取值。
 */
import { computed, ref, watch } from 'vue'
import type {
  DtRadioOption,
  DtSelectOption,
  OpcuaInstance,
  OpcuaInstanceCreateInput,
  OpcuaInstanceUpdateInput,
  OpcuaPortPool,
  OpcuaSecurityPolicy,
} from '@dt/contracts'
import { OPCUA_SECURITY_POLICIES } from '@dt/contracts'
import {
  DtButton,
  DtCheckbox,
  DtField,
  DtInput,
  DtModal,
  DtNotice,
  DtRadioGroup,
  DtSelect,
  DtSwitch,
} from '@dt/ui'

import * as opcua from '@/api/opcua'
import { describeError } from '@/composables/useAsyncList'

const props = defineProps<{
  modelValue: boolean
  instance: OpcuaInstance | null
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  create: [input: OpcuaInstanceCreateInput]
  update: [input: OpcuaInstanceUpdateInput]
}>()

const isEdit = computed(() => props.instance !== null)

const name = ref('')
const description = ref('')
const endpointPath = ref('/digitaltwin')
const namespaceUri = ref('')
const policies = ref<OpcuaSecurityPolicy[]>(['Basic256Sha256_SignAndEncrypt'])
const anonymous = ref(false)
const autostart = ref(false)

const DEFAULT_POLICIES: OpcuaSecurityPolicy[] = [
  'Basic256Sha256_SignAndEncrypt',
]

/** 端口来源。默认自动——多数人并不在意具体是哪个。 */
const PORT_MODES: readonly DtRadioOption[] = [
  { value: 'auto', label: '自动分配' },
  { value: 'manual', label: '指定端口' },
]

const portMode = ref('auto')
const port = ref('')
const pool = ref<OpcuaPortPool | null>(null)
const poolError = ref<string | null>(null)

const portOptions = computed<DtSelectOption[]>(() =>
  (pool.value?.free_ports ?? []).map((value) => ({
    value: String(value),
    label: String(value),
  })),
)

/** 池子空了就没得选，此时连「指定端口」这个选项都不该给。 */
const canPickPort = computed(() => portOptions.value.length > 0)

async function loadPool(): Promise<void> {
  try {
    pool.value = await opcua.getPortPool()
    poolError.value = null
    // 池子拿回来之后给一个默认选中项，省掉「切到指定端口却是空的」这一步
    port.value = pool.value.free_ports[0]?.toString() ?? ''
  } catch (caught) {
    pool.value = null
    poolError.value = describeError(caught)
  }
}

interface FormValues {
  name: string
  description: string
  endpointPath: string
  namespaceUri: string
  policies: OpcuaSecurityPolicy[]
  anonymous: boolean
  autostart: boolean
}

/** 表单的初始取值：编辑时来自实例，新建时用默认值。 */
function formOf(target: OpcuaInstance | null): FormValues {
  if (target === null) {
    return {
      name: '',
      description: '',
      endpointPath: '/digitaltwin',
      namespaceUri: '',
      policies: [...DEFAULT_POLICIES],
      anonymous: false,
      autostart: false,
    }
  }
  return {
    name: target.name,
    description: target.description ?? '',
    endpointPath: target.endpoint_path,
    namespaceUri: target.namespace_uri,
    policies: [...target.security_policies],
    anonymous: target.is_anonymous_allowed,
    autostart: target.is_autostart,
  }
}

/** 打开时把表单铺回该实例的取值。 */
function reset(target: OpcuaInstance | null): void {
  const form = formOf(target)
  name.value = form.name
  description.value = form.description
  endpointPath.value = form.endpointPath
  namespaceUri.value = form.namespaceUri
  policies.value = form.policies
  anonymous.value = form.anonymous
  autostart.value = form.autostart
}

watch(
  () => [props.modelValue, props.instance] as const,
  ([open, target]) => {
    if (!open) return
    reset(target)
    portMode.value = 'auto'
    port.value = ''
    // 编辑时改不了端口，没必要去问池子
    if (target === null) void loadPool()
  },
  { immediate: true },
)

function togglePolicy(policy: OpcuaSecurityPolicy, checked: boolean): void {
  const next = new Set(policies.value)
  if (checked) next.add(policy)
  else next.delete(policy)
  policies.value = [...next]
}

const canSubmit = computed(
  () =>
    policies.value.length > 0 &&
    namespaceUri.value.trim() !== '' &&
    (isEdit.value || name.value.trim() !== '') &&
    (isEdit.value || portMode.value === 'auto' || port.value !== ''),
)

function submit(): void {
  if (!canSubmit.value) return
  const shared = {
    description: description.value.trim() || null,
    endpoint_path: endpointPath.value.trim(),
    namespace_uri: namespaceUri.value.trim(),
    security_policies: policies.value,
    is_anonymous_allowed: anonymous.value,
    is_autostart: autostart.value,
  }
  if (isEdit.value) {
    emit('update', shared)
    return
  }
  const input: OpcuaInstanceCreateInput = { name: name.value.trim(), ...shared }
  // 自动分配就整个不传这个字段，让服务端去挑
  if (portMode.value === 'manual') input.port = Number(port.value)
  emit('create', input)
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :title="isEdit ? '编辑实例' : '新建实例'"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-4">
      <DtNotice v-if="isEdit" intent="warning" icon="alert-triangle">
        端点路径、命名空间 URI
        与安全策略改完要重启实例才生效，重启会断开该实例上全部上位机会话。
      </DtNotice>

      <DtField v-if="!isEdit" label="名称" required>
        <DtInput
          v-model="name"
          placeholder="字母开头，可含数字、下划线与短横"
        />
      </DtField>

      <template v-if="!isEdit">
        <DtNotice v-if="poolError" intent="danger" icon="alert-triangle">
          取不到端口池：{{ poolError }}
        </DtNotice>
        <DtNotice
          v-else-if="pool && !canPickPort"
          intent="warning"
          icon="alert-triangle"
        >
          端口池已用尽（{{ pool.used }} / {{ pool.total }}），建不了新实例。
          扩池是部署期的事——容器的端口段映射要跟着一起改。
        </DtNotice>

        <DtField
          v-else-if="pool"
          label="端口"
          :hint="`池内 ${pool.total} 个端口，已用 ${pool.used}，可选 ${pool.available}；实例上限 ${pool.max_instances}`"
        >
          <div class="flex flex-col gap-2">
            <DtRadioGroup
              v-model="portMode"
              :options="PORT_MODES"
              orientation="horizontal"
              aria-label="端口来源"
            />
            <DtSelect
              v-if="portMode === 'manual'"
              v-model="port"
              :options="portOptions"
              aria-label="端口"
            />
          </div>
        </DtField>
      </template>

      <DtField label="描述">
        <DtInput v-model="description" placeholder="选填" />
      </DtField>

      <DtField label="端点路径" required>
        <DtInput v-model="endpointPath" placeholder="/digitaltwin" />
      </DtField>

      <DtField label="命名空间 URI" required>
        <DtInput v-model="namespaceUri" placeholder="urn:digitaltwin:plant" />
      </DtField>

      <DtField label="安全策略" required>
        <div class="flex flex-col gap-1">
          <DtCheckbox
            v-for="policy in OPCUA_SECURITY_POLICIES"
            :key="policy"
            :model-value="policies.includes(policy)"
            @update:model-value="togglePolicy(policy, $event)"
          >
            {{ policy }}
          </DtCheckbox>
        </div>
      </DtField>

      <DtField label="允许匿名连接">
        <DtSwitch v-model="anonymous" aria-label="允许匿名连接" />
      </DtField>

      <DtField label="随服务自启">
        <DtSwitch v-model="autostart" aria-label="随服务自启" />
      </DtField>
    </div>

    <template #footer>
      <DtButton variant="ghost" @click="emit('update:modelValue', false)">
        取消
      </DtButton>
      <DtButton :disabled="!canSubmit" @click="submit">
        {{ isEdit ? '保存' : '创建' }}
      </DtButton>
    </template>
  </DtModal>
</template>
