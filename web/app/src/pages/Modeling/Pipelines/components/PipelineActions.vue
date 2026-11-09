<script setup lang="ts">
/** @fileoverview 工作流的常用操作与按权限筛选的更多操作菜单。 */
import type { DtMenuItem, ModelingPipelineSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDropdownMenu, DtIconButton, DtTooltip } from '@dt/ui'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  row: ModelingPipelineSummary
  isSaving: boolean
  exportingId: string | null
}>()
const emit = defineEmits<{
  open: [row: ModelingPipelineSummary]
  schedule: [row: ModelingPipelineSummary]
  saveTemplate: [row: ModelingPipelineSummary]
  export: [row: ModelingPipelineSummary]
  copy: [row: ModelingPipelineSummary]
  edit: [row: ModelingPipelineSummary]
  remove: [row: ModelingPipelineSummary]
}>()
const auth = useAuthStore()
const items = computed<readonly DtMenuItem[]>(() => {
  const actions: DtMenuItem[] = []
  if (auth.can([PERMISSION_CODES.modelingRun])) {
    actions.push({
      value: 'schedule',
      label: '定时训练',
      icon: 'calendar',
      disabled: props.isSaving,
    })
  }
  if (auth.can([PERMISSION_CODES.modelingManage])) {
    actions.push(
      {
        value: 'template',
        label: '保存为模板',
        icon: 'layers',
        disabled: props.isSaving,
      },
      {
        value: 'copy',
        label: '复制工作流',
        icon: 'copy',
        disabled: props.isSaving,
      },
      {
        value: 'export',
        label: '导出 JSON',
        icon: 'download',
        disabled: props.exportingId !== null,
      },
      {
        value: 'edit',
        label: '编辑信息',
        icon: 'pencil',
        disabled: props.isSaving,
      },
      {
        value: 'remove',
        label: '删除工作流',
        icon: 'trash',
        danger: true,
        disabled: props.isSaving,
      },
    )
  }
  return actions
})
function select(item: DtMenuItem): void {
  if (item.disabled || (props.isSaving && item.value !== 'export')) return
  switch (item.value) {
    case 'schedule':
      emit('schedule', props.row)
      break
    case 'template':
      emit('saveTemplate', props.row)
      break
    case 'copy':
      emit('copy', props.row)
      break
    case 'export':
      emit('export', props.row)
      break
    case 'edit':
      emit('edit', props.row)
      break
    case 'remove':
      emit('remove', props.row)
      break
  }
}
</script>

<template>
  <div class="pipeline-actions">
    <DtButton variant="soft" size="sm" @click="emit('open', row)"
      >打开工作流</DtButton
    >
    <RouterLink
      v-slot="{ navigate }"
      :to="`/modeling/runs?pipeline_id=${row.id}`"
      custom
    >
      <DtIconButton
        icon="list-checks"
        label="训练记录"
        tooltip="查看此工作流的训练记录"
        @click="navigate"
      />
    </RouterLink>
    <DtDropdownMenu
      v-if="items.length > 0"
      :items="items"
      label="工作流更多操作"
      size="sm"
      @select="select"
    >
      <template #trigger="{ toggle, isOpen, panelId }">
        <DtTooltip v-slot="{ describedby }" content="工作流更多操作">
          <DtButton
            variant="ghost"
            intent="neutral"
            size="sm"
            icon="more-horizontal"
            aria-label="工作流更多操作"
            aria-haspopup="menu"
            :aria-expanded="isOpen"
            :aria-controls="panelId"
            :aria-describedby="describedby"
            @click="toggle"
          />
        </DtTooltip>
      </template>
    </DtDropdownMenu>
  </div>
</template>

<style scoped lang="scss">
.pipeline-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.25rem;
}
</style>
