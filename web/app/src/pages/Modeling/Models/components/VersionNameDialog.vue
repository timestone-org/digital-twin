<script setup lang="ts">
/** @fileoverview 修改模型版本的展示名称与说明。 */
import type { ModelingVersion } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtTextarea } from '@dt/ui'
import { ref, watch } from 'vue'

import { useFormDirty } from '@/composables/useFormDirty'

const props = defineProps<{
  version: ModelingVersion | null
  isBusy: boolean
}>()
const emit = defineEmits<{
  submit: [name: string, description: string]
  close: []
}>()
const name = ref('')
const description = ref('')
const dirty = useFormDirty(() => ({
  name: name.value,
  description: description.value,
}))
watch(
  () => props.version,
  (version) => {
    name.value = version?.name ?? ''
    description.value = version?.description ?? ''
    dirty.markClean()
  },
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <DtModal
    :model-value="props.version !== null"
    title="修改模型名称"
    width="28rem"
    :dirty="dirty.isDirty.value"
    @update:model-value="emit('close')"
  >
    <div class="flex flex-col gap-3">
      <DtInput v-model="name" label="模型名称" aria-label="模型名称" required />
      <DtTextarea v-model="description" label="模型说明" :rows="3" />
    </div>
    <template #footer>
      <DtButton variant="ghost" @click="emit('close')">取消</DtButton>
      <DtButton
        :disabled="name.trim() === ''"
        :loading="props.isBusy"
        @click="emit('submit', name.trim(), description)"
        >保存名称</DtButton
      >
    </template>
  </DtModal>
</template>
