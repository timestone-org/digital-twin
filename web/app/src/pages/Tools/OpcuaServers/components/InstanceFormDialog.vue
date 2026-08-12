<script setup lang="ts">
/**
 * @fileoverview 新建 / 编辑实例的表单。
 *
 * ⚠ 名称与端口只在新建时定：名称是人给的唯一标识，端口由服务端从池里分配，
 * 两者都不在编辑面上——改端口等于换一个上位机连不上的地址。
 */
import { computed, ref, watch } from 'vue'
import type {
  OpcuaInstance,
  OpcuaInstanceCreateInput,
  OpcuaInstanceUpdateInput,
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
  DtSwitch,
} from '@dt/ui'

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
    if (open) reset(target)
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
    (isEdit.value || name.value.trim() !== ''),
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
  if (isEdit.value) emit('update', shared)
  else emit('create', { name: name.value.trim(), ...shared })
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :title="isEdit ? '编辑实例' : '新建实例'"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-4">
      <DtNotice v-if="!isEdit" intent="info" icon="alert-circle">
        端口由服务端从固定端口池里分配，池满会直接拒绝——不会挑一个池外端口顶上。
      </DtNotice>
      <DtNotice v-else intent="warning" icon="alert-triangle">
        端点路径、命名空间 URI
        与安全策略改完要重启实例才生效，重启会断开该实例上全部上位机会话。
      </DtNotice>

      <DtField v-if="!isEdit" label="名称" required>
        <DtInput
          v-model="name"
          placeholder="字母开头，可含数字、下划线与短横"
        />
      </DtField>

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
