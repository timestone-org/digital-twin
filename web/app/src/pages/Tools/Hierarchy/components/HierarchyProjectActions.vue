<script setup lang="ts">
/** @fileoverview 项目新建、导入、保存状态和版本操作。 */
import { computed } from 'vue'
import type { DtMenuItem } from '@dt/contracts'
import { DtButton, DtDropdownMenu, DtFilePicker, DtIcon } from '@dt/ui'
import type { useHierarchySaving } from '../scripts/useHierarchySaving'

const props = defineProps<{
  saving: ReturnType<typeof useHierarchySaving>
  status: string
  hasProject: boolean
  canEdit: boolean
  busy: boolean
}>()
const emit = defineEmits<{
  create: []
  import: [files: File[]]
  save: []
  action: [item: DtMenuItem]
}>()
const projectActions = computed<DtMenuItem[]>(() => [
  { value: 'history', label: '历史版本', icon: 'layers' },
  ...(props.canEdit
    ? [
        { value: 'duplicate', label: '复制', icon: 'copy' },
        { value: 'remove', label: '删除项目', icon: 'trash', danger: true },
      ]
    : []),
])
</script>
<template>
  <div class="hierarchy-actions flex items-center gap-2">
    <span
      v-if="hasProject"
      class="save-status"
      role="status"
      :data-pending="saving.dirty.value"
      :data-error="!!saving.error.value"
    >
      <DtIcon
        :name="
          saving.error.value
            ? 'alert-circle'
            : saving.dirty.value
              ? 'pencil'
              : 'check'
        "
        :size="14"
      />
      <span class="compact-label">
        {{ canEdit ? status : '只读模式' }}
      </span>
    </span>
    <template v-if="canEdit">
      <DtButton
        class="header-action"
        size="sm"
        aria-label="新建项目"
        title="新建项目"
        :disabled="busy"
        variant="outline"
        @click="emit('create')"
      >
        <template #leading><DtIcon name="plus" :size="14" /></template>
        <span class="compact-label">新建项目</span>
      </DtButton>
      <DtFilePicker
        label="导入配置"
        accept=".json,.xlsx"
        size="sm"
        :disabled="busy"
        @select="emit('import', $event)"
      >
        <template #default="{ open }">
          <DtButton
            class="header-action"
            size="sm"
            variant="outline"
            intent="neutral"
            icon="upload"
            aria-label="导入配置"
            title="导入配置"
            :disabled="busy"
            @click="open"
            ><span class="compact-label">导入配置</span></DtButton
          >
        </template>
      </DtFilePicker>
      <!-- 编辑会自动保存：只有还没存下的改动时才用主色催一下 -->
      <DtButton
        class="header-action"
        aria-label="保存"
        title="保存"
        size="sm"
        :variant="saving.dirty.value ? 'solid' : 'outline'"
        :disabled="!hasProject || busy || saving.saving.value"
        @click="emit('save')"
      >
        <template #leading><DtIcon name="save" :size="14" /></template
        ><span class="compact-label"> 保存 </span>
      </DtButton>
    </template>
    <DtDropdownMenu
      :items="projectActions"
      label="项目操作"
      :disabled="!hasProject || busy"
      @select="emit('action', $event)"
    />
  </div>
</template>
<style scoped lang="scss">
.save-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-caption);
  color: var(--state-success);
}
.save-status[data-pending='true'] {
  color: var(--state-warning);
}
.save-status[data-error='true'] {
  color: var(--state-danger);
}
@media (max-width: 640px) {
  .hierarchy-actions {
    gap: 4px;
  }
  .header-action {
    width: var(--ctl-h-sm);
    padding: 0;
  }
  .compact-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
