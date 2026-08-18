<script setup lang="ts">
/**
 * @fileoverview 新建项目：名称必填、描述可选，出参交父页面落库。
 * 每次打开都重置表单——留着上一次的输入会让「再建一个」变成「改上一个」。
 */
import { computed, ref, watch } from 'vue'
import { DtButton, DtIcon, DtInput, DtModal, DtTextarea } from '@dt/ui'

import { useFormDirty } from '@/composables/useFormDirty'

const props = withDefaults(
  defineProps<{ open: boolean; loading?: boolean }>(),
  { loading: false },
)

const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [payload: { name: string; description: string }]
}>()

const name = ref('')
const description = ref('')

// ⚠ 填了一半误点遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty([name, description], () => props.open)

const canSubmit = computed(() => name.value.trim().length > 0 && !props.loading)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    name.value = ''
    description.value = ''
  },
  { immediate: true },
)

function submit(): void {
  if (!canSubmit.value) return
  emit('submit', {
    name: name.value.trim(),
    description: description.value.trim(),
  })
}
</script>

<template>
  <DtModal
    :model-value="open"
    :dirty="isDirty"
    title="新建项目"
    description="项目是一组大屏的容器，主题与品牌按项目继承。"
    width="34rem"
    :close-on-backdrop="!loading"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-4">
      <DtInput
        v-model="name"
        label="项目名称"
        required
        placeholder="如：A1 园区能源中心"
        @enter="submit"
      >
        <template #leading><DtIcon name="folder" :size="14" /></template>
      </DtInput>
      <DtTextarea
        v-model="description"
        label="描述"
        rows="3"
        placeholder="这个项目装哪些大屏、给谁看"
      />
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        size="sm"
        :disabled="loading"
        @click="emit('update:open', false)"
      >
        取消
      </DtButton>
      <DtButton
        size="sm"
        icon="plus"
        :loading="loading ?? false"
        :disabled="!canSubmit"
        @click="submit"
      >
        创建项目
      </DtButton>
    </template>
  </DtModal>
</template>
