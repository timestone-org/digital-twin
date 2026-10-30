<script setup lang="ts">
/** @fileoverview 将已保存的设计发布成不可变模板版本。 */
import {
  DtButton,
  DtInput,
  DtModal,
  DtNotice,
  DtTextarea,
  useToast,
} from '@dt/ui'
import { onBeforeUnmount, ref, watch } from 'vue'
import { publishTemplate } from '@/api/modelingTemplates'
import { useFormDirty } from '@/composables/useFormDirty'
import { describeModelingError } from '../scripts/instancePresentation'
const props = defineProps<{ pipeline: { id: string; name: string } | null }>()
const emit = defineEmits<{ close: [] }>()
const name = ref('')
const description = ref('')
const busy = ref(false)
const error = ref('')
const { isDirty, markClean } = useFormDirty([name, description])
let isDisposed = false
onBeforeUnmount(() => {
  isDisposed = true
})
const toast = useToast()
watch(
  () => props.pipeline,
  (pipeline) => {
    name.value = pipeline?.name ?? ''
    description.value = ''
    error.value = ''
    markClean()
  },
  { immediate: true },
)
async function publish(): Promise<void> {
  if (!props.pipeline || busy.value || !name.value.trim()) return
  const targetId = props.pipeline.id
  const isCurrent = () => !isDisposed && props.pipeline?.id === targetId
  busy.value = true
  error.value = ''
  try {
    const result = await publishTemplate({
      pipeline_id: props.pipeline.id,
      name: name.value,
      description: description.value.trim() || null,
    })
    if (!isCurrent()) return
    toast.success(
      `工作流 ${result.name} v${result.version} 已发布，可在已发布工作流中创建模型`,
    )
    emit('close')
  } catch (caught) {
    if (isCurrent()) error.value = describeModelingError(caught)
  } finally {
    if (isCurrent()) busy.value = false
  }
}
</script>
<template>
  <DtModal
    :model-value="pipeline !== null"
    title="发布建模工作流"
    width="46rem"
    :close-on-backdrop="!busy"
    :dirty="isDirty"
    @update:model-value="!busy && emit('close')"
  >
    <div class="flex flex-col gap-4">
      <DtNotice intent="info">
        将已保存的算子与连线快照保存为固定版本的建模模板。每次发布形成新工作流版本，已有模型保留创建时的版本。
      </DtNotice>

      <DtInput v-model="name" label="工作流名称" :maxlength="128" required />

      <DtTextarea
        v-model="description"
        label="工作流用途"
        placeholder="说明适用对象、输入数据要求与输出含义"
        :rows="4"
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

      <DtButton :disabled="busy || !name.trim()" @click="void publish()">
        {{ busy ? '发布中…' : '发布工作流' }}
      </DtButton>
    </template>
  </DtModal>
</template>
