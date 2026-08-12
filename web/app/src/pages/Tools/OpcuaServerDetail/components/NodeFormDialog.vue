<script setup lang="ts">
/**
 * @fileoverview 新建节点。
 *
 * ⚠ 标识（identifier）由人指定且**永不自动改写**：上位系统的组态里硬编码着
 * NodeId，服务端替它换一个，现场所有组态一起废。所以冲突时只报错，
 * 这个表单也不提供任何「自动生成一个不冲突的标识」的便利。
 * ⚠ 不给 `method` 选项：方法节点要绑定 Python 回调，本服务没有可绑的用户代码，
 * 后端会直接拒。放进选项里等于摆一个点了必然失败的开关。
 */
import { computed, ref, watch } from 'vue'
import type {
  OpcuaCreatableNodeClass,
  OpcuaDataType,
  OpcuaNode,
  OpcuaNodeCreateInput,
} from '@dt/contracts'
import { OPCUA_CREATABLE_NODE_CLASSES, OPCUA_DATA_TYPES } from '@dt/contracts'
import { DtButton, DtField, DtInput, DtModal, DtNotice, DtSelect } from '@dt/ui'

const props = defineProps<{
  modelValue: boolean
  nodes: readonly OpcuaNode[]
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  create: [input: OpcuaNodeCreateInput]
}>()

const identifier = ref('')
const browseName = ref('')
const nodeClass = ref<OpcuaCreatableNodeClass>('variable')
const dataType = ref<OpcuaDataType>('double')
const parentId = ref('')
const initialValue = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    identifier.value = ''
    browseName.value = ''
    nodeClass.value = 'variable'
    dataType.value = 'double'
    parentId.value = ''
    initialValue.value = ''
  },
)

const classOptions = computed(() =>
  OPCUA_CREATABLE_NODE_CLASSES.map((value) => ({ value, label: value })),
)
const typeOptions = computed(() =>
  OPCUA_DATA_TYPES.map((value) => ({ value, label: value })),
)
const parentOptions = computed(() => [
  { value: '', label: '（挂在根下）' },
  ...props.nodes
    .filter((node) => node.node_class === 'object')
    .map((node) => ({ value: node.id, label: node.browse_name })),
])

const isVariable = computed(() => nodeClass.value !== 'object')
const canSubmit = computed(
  () => identifier.value.trim() !== '' && browseName.value.trim() !== '',
)

function submit(): void {
  if (!canSubmit.value) return
  const input: OpcuaNodeCreateInput = {
    identifier: identifier.value.trim(),
    browse_name: browseName.value.trim(),
    node_class: nodeClass.value,
    parent_id: parentId.value === '' ? null : parentId.value,
  }
  if (isVariable.value) {
    input.data_type = dataType.value
    if (initialValue.value !== '') input.initial_value = initialValue.value
  }
  emit('create', input)
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    title="新建节点"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-4">
      <DtNotice intent="warning" icon="alert-triangle">
        标识一经创建不会被服务端改写，冲突时直接报错——上位系统的组态硬编码着它。
      </DtNotice>

      <DtField label="标识" required hint="实例内唯一，将拼成 ns=2;s=<标识>">
        <DtInput v-model="identifier" placeholder="Line1.Temperature" />
      </DtField>

      <DtField label="BrowseName" required>
        <DtInput v-model="browseName" placeholder="Temperature" />
      </DtField>

      <DtField label="节点类别">
        <DtSelect v-model="nodeClass" :options="classOptions" />
      </DtField>

      <DtField label="父节点">
        <DtSelect v-model="parentId" :options="parentOptions" />
      </DtField>

      <DtField v-if="isVariable" label="数据类型">
        <DtSelect v-model="dataType" :options="typeOptions" />
      </DtField>

      <DtField v-if="isVariable" label="初值" hint="留空则用类型的零值">
        <DtInput v-model="initialValue" />
      </DtField>
    </div>

    <template #footer>
      <DtButton variant="ghost" @click="emit('update:modelValue', false)">
        取消
      </DtButton>
      <DtButton :disabled="!canSubmit" @click="submit">创建</DtButton>
    </template>
  </DtModal>
</template>
