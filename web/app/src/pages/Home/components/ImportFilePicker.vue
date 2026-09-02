<script setup lang="ts">
/**
 * @fileoverview 导入的第一步：选一份导出的 JSON。
 *
 * ⚠ 单独一步而不是直接弹导入确认框：确认框要摆出包里的名字、尺寸与节点数，
 * 没有包的时候它只能渲染一个空壳，而空壳看起来就像「导入功能坏了」。
 */
import { DtButton, DtFilePicker, DtModal, DtNotice } from '@dt/ui'

defineProps<{ open: boolean }>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  pick: [file: File]
}>()

function onSelect(files: File[]): void {
  const file = files[0]
  if (file !== undefined) emit('pick', file)
}
</script>

<template>
  <DtModal
    :model-value="open"
    title="导入大屏"
    description="先选一份导出的 JSON，读出来之后再决定是新建还是覆盖。"
    width="30rem"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtNotice icon="upload">
        只认本系统导出的包。包里没有任何 id，导进来是一张新屏，不会改到源屏。
      </DtNotice>
      <DtFilePicker
        accept="application/json,.json"
        label="选择导出文件"
        @select="onSelect"
      />
    </div>
    <template #footer>
      <DtButton size="sm" variant="ghost" @click="emit('update:open', false)">
        取消
      </DtButton>
    </template>
  </DtModal>
</template>
