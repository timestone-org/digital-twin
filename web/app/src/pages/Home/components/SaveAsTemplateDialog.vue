<script setup lang="ts">
/**
 * @fileoverview 把一张屏另存为整屏模板：名称 / 分类 / 描述，打开时按源屏预填。
 * 整包与缩略图都由服务端从源屏拷，这里只出这三项文字。
 */
import { computed, ref, watch } from 'vue'
import { DtButton, DtInput, DtModal, DtNotice, DtTextarea } from '@dt/ui'

import { useFormDirty } from '@/composables/useFormDirty'

import type { DashboardSummary } from '@/api/dashboardWire'

const props = withDefaults(
  defineProps<{
    open: boolean
    dashboard: DashboardSummary | null
    loading?: boolean
  }>(),
  { loading: false },
)

const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [payload: { name: string; category: string; description: string }]
}>()

const name = ref('')
const category = ref('')
const description = ref('')

// ⚠ 填了一半误点遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty(
  [name, category, description],
  () => props.open,
)

const canSubmit = computed(() => name.value.trim().length > 0 && !props.loading)

watch(
  () => [props.open, props.dashboard?.id] as const,
  ([open]) => {
    const source = props.dashboard
    if (!open || source === null) return
    name.value = `${source.name} 模板`
    category.value = ''
    description.value = source.description ?? ''
  },
  { immediate: true },
)

function submit(): void {
  if (!canSubmit.value) return
  emit('submit', {
    name: name.value.trim(),
    category: category.value.trim(),
    description: description.value.trim(),
  })
}
</script>

<template>
  <DtModal
    :model-value="open"
    :dirty="isDirty"
    title="另存为模板"
    :description="dashboard === null ? undefined : `源屏：${dashboard.name}`"
    width="34rem"
    :close-on-backdrop="!loading"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-4">
      <DtNotice icon="layers">
        模板存的是另存这一刻的整包，源屏之后改版不会回溯到模板里。
      </DtNotice>
      <DtInput v-model="name" label="模板名称" required @enter="submit" />
      <DtInput
        v-model="category"
        label="分类"
        placeholder="如：能源 / 楼宇 / 产线"
      />
      <DtTextarea
        v-model="description"
        label="描述"
        rows="3"
        placeholder="这套模板适合什么场景"
      />
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        :disabled="loading"
        @click="emit('update:open', false)"
      >
        取消
      </DtButton>
      <DtButton
        icon="save"
        :loading="loading ?? false"
        :disabled="!canSubmit"
        @click="submit"
      >
        保存模板
      </DtButton>
    </template>
  </DtModal>
</template>
