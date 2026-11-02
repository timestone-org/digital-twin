<script setup lang="ts">
/** @fileoverview 大屏导出与复制的点位绑定选择。 */
import { ref, watch } from 'vue'
import { DtButton, DtCheckbox, DtModal, DtNotice } from '@dt/ui'

const props = defineProps<{
  open: boolean
  operation: 'export' | 'copy'
  dashboardName: string
}>()
const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [includePointBindings: boolean]
}>()
const includePointBindings = ref(false)

watch(
  () => props.open,
  (open) => {
    if (open) includePointBindings.value = props.operation === 'copy'
  },
  { immediate: true },
)
</script>

<template>
  <DtModal
    :model-value="open"
    :title="operation === 'export' ? '导出大屏' : '创建副本'"
    width="32rem"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-4">
      <p class="break-words text-sm text-text-primary">{{ dashboardName }}</p>
      <DtCheckbox v-model="includePointBindings" label="保留点位绑定" />
      <DtNotice icon="circle-question">
        {{
          includePointBindings
            ? '保留实时、历史点位绑定及相关计算，适合在当前环境复制使用。'
            : '忽略实时、历史点位绑定及依赖它们的计算，适合迁移到其他环境。'
        }}
        布局、样式、静态值和台账绑定保持不变；不会复制点位本身。
      </DtNotice>
    </div>
    <template #footer>
      <DtButton variant="ghost" @click="emit('update:open', false)"
        >取消</DtButton
      >
      <DtButton
        :icon="operation === 'export' ? 'download' : 'copy'"
        data-test="confirm-transfer"
        @click="emit('submit', includePointBindings)"
        >{{ operation === 'export' ? '导出 JSON' : '创建副本' }}</DtButton
      >
    </template>
  </DtModal>
</template>
