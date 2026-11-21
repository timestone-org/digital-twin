<script setup lang="ts">
/**
 * @fileoverview 创建节点与编辑节点配置，保留既有节点的 NodeId。
 */
import { computed, ref, watch } from 'vue'
import type {
  OpcuaCreatableNodeClass,
  OpcuaDataType,
  OpcuaNode,
  OpcuaNodeCreateInput,
  OpcuaNodeUpdateInput,
} from '@dt/contracts'
import { OPCUA_CREATABLE_NODE_CLASSES } from '@dt/contracts'
import { DtButton, DtField, DtInput, DtModal, DtNotice, DtSelect } from '@dt/ui'

import { useFormDirty } from '@/composables/useFormDirty'
import { classLabel, displayValue, isWritable } from '../scripts/nodeFacts'
import {
  CREATABLE_DATA_TYPES,
  parseInitialValue,
} from '../scripts/nodeInitialValue'

const props = defineProps<{
  modelValue: boolean
  nodes: readonly OpcuaNode[]
  editNode?: OpcuaNode | null
  busy?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  create: [input: OpcuaNodeCreateInput]
  update: [node: OpcuaNode, input: OpcuaNodeUpdateInput]
}>()

// 访问权限两档对应的 AccessLevel 掩码：只读 = CurrentRead，可写 = CurrentRead|CurrentWrite
const ACCESS_LEVELS = { readonly: 1, writable: 3 } as const
const CURRENT_WRITE = 2
type AccessChoice = keyof typeof ACCESS_LEVELS

const identifier = ref('')
const browseName = ref('')
const description = ref('')
const nodeClass = ref<OpcuaCreatableNodeClass>('variable')
const dataType = ref<OpcuaDataType>('double')
const parentId = ref('')
const initialValue = ref('')
const access = ref<AccessChoice>('readonly')
const editing = computed(() => props.editNode ?? null)

// ⚠ 填了一半误点遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty(
  [
    identifier,
    browseName,
    description,
    nodeClass,
    dataType,
    parentId,
    initialValue,
    access,
  ],
  () => props.modelValue,
)

/** 节点初值为空时由服务端采用类型默认值。@param node 当前节点 */
function initialText(node: OpcuaNode | null): string {
  return node?.initial_value == null ? '' : displayValue(node.initial_value)
}

/** 兼容数据类型为空的变量，其运行时类型默认是 string。@param node 当前节点 */
function configuredType(node: OpcuaNode | null): OpcuaDataType {
  return node === null ? 'double' : (node.data_type ?? 'string')
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const node = editing.value
    identifier.value = ''
    browseName.value = node?.browse_name ?? ''
    description.value = node?.description ?? ''
    nodeClass.value = 'variable'
    dataType.value = configuredType(node)
    parentId.value = ''
    initialValue.value = initialText(node)
    access.value =
      node !== null && isWritable(node.access_level) ? 'writable' : 'readonly'
  },
  { immediate: true },
)

const classOptions = computed(() =>
  OPCUA_CREATABLE_NODE_CLASSES.map((value) => ({
    value,
    label: classLabel(value),
  })),
)
const typeOptions = computed(() =>
  CREATABLE_DATA_TYPES.map((value) => ({ value, label: value })),
)
const parentOptions = computed(() => [
  { value: '', label: '（挂在根下）' },
  ...props.nodes
    .filter((node) => node.node_class === 'object')
    .map((node) => ({ value: node.id, label: node.browse_name })),
])

const accessOptions = [
  { value: 'readonly', label: '只读' },
  { value: 'writable', label: '可写' },
]
const accessHint = computed(() =>
  access.value === 'writable' ? '上位机将可直接写入该节点的值' : undefined,
)

const isVariable = computed(() => {
  const kind = editing.value?.node_class ?? nodeClass.value
  return kind === 'variable' || kind === 'property'
})
const typeChanged = computed(
  () => dataType.value !== configuredType(editing.value),
)
const initialChanged = computed(
  () => typeChanged.value || initialValue.value !== initialText(editing.value),
)
const parsedInitial = computed(() => {
  const node = editing.value
  const type = dataType.value
  if (!isVariable.value || (node !== null && !initialChanged.value))
    return { value: undefined, error: null }
  const parsed = parseInitialValue(initialValue.value, type)
  if (node === null || parsed.value !== undefined || parsed.error !== null)
    return parsed
  if (type === 'string' || type === 'byte_string')
    return { value: '', error: null }
  return node.initial_value == null
    ? parsed
    : { value: undefined, error: '请输入该类型的初值' }
})
const update = computed(() =>
  editing.value === null ? null : updateInput(editing.value),
)
const canSubmit = computed(
  () =>
    !props.busy &&
    (update.value === null
      ? identifier.value.trim() !== ''
      : Object.keys(update.value).length > 0) &&
    browseName.value.trim() !== '' &&
    parsedInitial.value.error === null,
)

/** 只提交实际修改的配置。@param node 编辑时打开的节点 */
function updateInput(node: OpcuaNode): OpcuaNodeUpdateInput {
  const input: OpcuaNodeUpdateInput = {}
  const name = browseName.value.trim()
  const note = description.value.trim()
  if (name !== node.browse_name) input.browse_name = name
  if (note !== (node.description ?? '')) input.description = note
  if (!isVariable.value) return input
  if (typeChanged.value) input.data_type = dataType.value
  if (
    parsedInitial.value.value !== undefined &&
    (typeChanged.value || parsedInitial.value.value !== node.initial_value)
  )
    input.initial_value = parsedInitial.value.value
  const accessLevel =
    (node.access_level & ~CURRENT_WRITE) |
    (ACCESS_LEVELS[access.value] & CURRENT_WRITE)
  if (accessLevel !== node.access_level) input.access_level = accessLevel
  return input
}

function close(): void {
  if (!props.busy) emit('update:modelValue', false)
}

function submit(): void {
  if (!canSubmit.value) return
  const node = editing.value
  if (node !== null && update.value !== null) {
    emit('update', node, update.value)
    return
  }
  const input: OpcuaNodeCreateInput = {
    identifier: identifier.value.trim(),
    browse_name: browseName.value.trim(),
    node_class: nodeClass.value,
    parent_id: parentId.value === '' ? null : parentId.value,
  }
  if (isVariable.value) {
    input.data_type = dataType.value
    // 总是显式带上：省略时后端缺省为只读，节点会静默建成不可写
    input.access_level = ACCESS_LEVELS[access.value]
    if (parsedInitial.value.value !== undefined)
      input.initial_value = parsedInitial.value.value
  }
  if (description.value.trim() !== '')
    input.description = description.value.trim()
  emit('create', input)
}
</script>

<template>
  <DtModal
    width="46rem"
    :model-value="modelValue"
    :dirty="isDirty"
    :title="editing ? '编辑节点配置' : '新建节点'"
    @update:model-value="close"
  >
    <div class="dt-form-grid">
      <DtNotice
        v-if="editing"
        class="dt-form-grid__wide"
        intent="info"
        icon="alert-circle"
      >
        修改 BrowseName、数据类型或初值后，若实例正在运行，需重启实例才能生效。
      </DtNotice>

      <DtField v-if="editing" label="NodeId">
        <DtInput :model-value="editing.node_id" readonly />
      </DtField>
      <DtField
        v-else
        label="标识"
        required
        hint="实例内唯一，将拼成 ns=2;s=<标识>"
      >
        <DtInput
          v-model="identifier"
          :disabled="busy"
          placeholder="Line1.Temperature"
        />
      </DtField>

      <DtField label="BrowseName" required hint="上位机浏览时显示的名称">
        <DtInput
          v-model="browseName"
          :disabled="busy"
          maxlength="128"
          placeholder="Temperature"
        />
      </DtField>

      <DtField v-if="!editing" label="节点类别">
        <DtSelect
          v-model="nodeClass"
          :disabled="busy"
          :options="classOptions"
        />
      </DtField>

      <DtField v-if="!editing" label="父节点">
        <DtSelect
          v-model="parentId"
          :disabled="busy"
          :options="parentOptions"
        />
      </DtField>

      <DtField
        v-if="isVariable"
        label="数据类型"
        hint="本部署支持布尔、int32/int64、float/double、字符串与字节串"
      >
        <DtSelect v-model="dataType" :disabled="busy" :options="typeOptions" />
      </DtField>

      <DtField v-if="isVariable" label="访问权限" :hint="accessHint">
        <DtSelect v-model="access" :disabled="busy" :options="accessOptions" />
      </DtField>

      <DtField
        v-if="isVariable"
        label="初值"
        class="dt-form-grid__wide"
        :error="parsedInitial.error ?? undefined"
        :hint="
          editing
            ? '布尔值填写 true 或 false'
            : '留空使用类型默认值，布尔值填写 true 或 false'
        "
      >
        <DtInput v-model="initialValue" :disabled="busy" />
      </DtField>
      <DtField label="描述" class="dt-form-grid__wide">
        <DtInput v-model="description" :disabled="busy" maxlength="255" />
      </DtField>
    </div>

    <template #footer>
      <DtButton variant="ghost" :disabled="busy" @click="close">
        取消
      </DtButton>
      <DtButton :disabled="!canSubmit" @click="submit">
        {{ editing ? '保存' : '创建' }}
      </DtButton>
    </template>
  </DtModal>
</template>
