<script setup lang="ts">
/**
 * @fileoverview 新建 / 改名大屏的弹窗。
 * ⚠ 设计尺寸只在**新建**时能填：改它会让存量节点的坐标全部相对错位，
 * 而错位在缩放之后看起来只是「有点挤」，不像是改坏了。
 */
import { DtButton, DtField, DtInput, DtModal, DtNumberInput } from '@dt/ui'
import { ref, watch } from 'vue'

import type { DashboardSummary } from '@/api/dashboardWire'

const props = defineProps<{
  modelValue: boolean
  /** 给了就是改名，没给就是新建。 */
  dashboard: DashboardSummary | null
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  create: [input: { name: string; designWidth: number; designHeight: number }]
  rename: [input: { name: string }]
}>()

const DEFAULT_WIDTH = 1920
const DEFAULT_HEIGHT = 1080

const name = ref('')
const width = ref(DEFAULT_WIDTH)
const height = ref(DEFAULT_HEIGHT)

watch(
  () => [props.modelValue, props.dashboard] as const,
  ([open, dashboard]) => {
    if (!open) return
    name.value = dashboard?.name ?? ''
    width.value = dashboard?.designWidth ?? DEFAULT_WIDTH
    height.value = dashboard?.designHeight ?? DEFAULT_HEIGHT
  },
  { immediate: true },
)

function submit(): void {
  const trimmed = name.value.trim()
  if (trimmed === '') return
  if (props.dashboard === null) {
    emit('create', {
      name: trimmed,
      designWidth: width.value,
      designHeight: height.value,
    })
    return
  }
  emit('rename', { name: trimmed })
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :title="dashboard ? '重命名大屏' : '新建大屏'"
    width="28rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtField label="名称" size="sm" required>
        <DtInput v-model="name" size="sm" placeholder="例如：一号厂区总览" />
      </DtField>
      <div v-if="!dashboard" class="grid grid-cols-2 gap-3">
        <DtField label="设计宽 (px)" size="sm">
          <DtNumberInput v-model="width" size="sm" :range="{ min: 320 }" />
        </DtField>
        <DtField label="设计高 (px)" size="sm">
          <DtNumberInput v-model="height" size="sm" :range="{ min: 240 }" />
        </DtField>
      </div>
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        size="sm"
        @click="emit('update:modelValue', false)"
      >
        取消
      </DtButton>
      <DtButton size="sm" :disabled="name.trim() === ''" @click="submit">
        {{ dashboard ? '保存' : '创建' }}
      </DtButton>
    </template>
  </DtModal>
</template>
