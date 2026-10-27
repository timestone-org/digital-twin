<script setup lang="ts">
/** @fileoverview 基于指定模板版本创建一个独立模型。 */
import type { ModelingTemplate } from '@dt/contracts'
import {
  DtButton,
  DtInput,
  DtModal,
  DtNotice,
  DtTextarea,
  useToast,
} from '@dt/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { createInstance } from '@/api/modelingTemplates'
import { describeModelingError } from '../../scripts/instancePresentation'

const props = defineProps<{ template: ModelingTemplate | null }>()
const emit = defineEmits<{ close: [] }>()
const router = useRouter()
const toast = useToast()
const name = ref('')
const code = ref('')
const description = ref('')
const busy = ref(false)
const error = ref('')
let isDisposed = false
onBeforeUnmount(() => {
  isDisposed = true
})
const valid = computed(
  () =>
    name.value.trim() !== '' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(code.value),
)
watch(
  () => props.template,
  () => {
    name.value = ''
    code.value = ''
    description.value = ''
    error.value = ''
  },
  { immediate: true },
)

async function submit(): Promise<void> {
  if (!props.template || busy.value || !valid.value) return
  const targetId = props.template.id
  const isCurrent = () => !isDisposed && props.template?.id === targetId
  busy.value = true
  error.value = ''
  try {
    const result = await createInstance({
      template_id: props.template.id,
      code: code.value,
      name: name.value,
      description: description.value.trim() || null,
    })
    if (!isCurrent()) return
    toast.success('模型已创建，接下来配置参数并训练')
    emit('close')
    await router.push(`/modeling/instances/${result.id}`)
  } catch (caught) {
    if (isCurrent()) error.value = describeModelingError(caught)
  } finally {
    if (isCurrent()) busy.value = false
  }
}
</script>

<template>
  <DtModal
    :model-value="template !== null"
    title="通过模板创建模型"
    width="46rem"
    :dirty="name !== '' || code !== ''"
    @update:model-value="!busy && emit('close')"
  >
    <div class="flex flex-col gap-4">
      <DtNotice intent="info">
        {{ template?.name }} · v{{
          template?.version
        }}。创建后可独立修改所有节点参数，模板更新不会影响此模型。
      </DtNotice>

      <DtInput
        v-model="name"
        label="模型名称"
        placeholder="例如：1 号冷机能耗预测"
        :maxlength="128"
        required
      />

      <DtInput
        v-model="code"
        label="模型编码"
        placeholder="例如：chiller-01-energy"
        hint="字母或数字开头，可含点、下划线和连字符；创建后不可修改。"
        :maxlength="64"
        required
      />

      <DtTextarea
        v-model="description"
        label="模型说明"
        :rows="3"
        :maxlength="512"
      />

      <DtNotice v-if="error" intent="danger">
        {{ error }}
      </DtNotice>
    </div>

    <template #footer>
      <DtButton variant="ghost" :disabled="busy" @click="emit('close')">
        取消
      </DtButton>

      <DtButton :disabled="!valid || busy" @click="void submit()">
        {{ busy ? '正在创建…' : '创建并配置' }}
      </DtButton>
    </template>
  </DtModal>
</template>
