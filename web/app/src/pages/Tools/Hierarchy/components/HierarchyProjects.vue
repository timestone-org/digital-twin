<script setup lang="ts">
/** @fileoverview 层级图项目导航、搜索与分页。 */
import { computed } from 'vue'
import { listEmptyState } from '@/utils/listEmpty'
import { DtButton, DtDataView, DtIcon, DtInput } from '@dt/ui'
import type { DtDataColumn } from '@dt/contracts'
import { useViewMode } from '@/composables/useViewMode'
import type { useHierarchyProjects } from '../scripts/useHierarchyProjects'
import HierarchyProjectSummary from './HierarchyProjectSummary.vue'
const props = defineProps<{
  projects: ReturnType<typeof useHierarchyProjects>
  selected: string
}>()
const emptyState = computed(() =>
  listEmptyState({
    isFiltered: props.projects.query.value.trim() !== '',
    subject: '层级图',
    keyword: props.projects.query.value,
    blank: { title: '暂无层级图', hint: '新建空白项目、使用示例或导入配置。' },
  }),
)
const emit = defineEmits<{ open: [id: string] }>()
const view = useViewMode('hierarchy-projects', 'card')
const COLUMNS: readonly DtDataColumn[] = [
  { key: 'title', label: '项目', card: 'title' },
  { key: 'node_count', label: '计量节点', card: 'meta', width: '4.5rem' },
]
</script>
<template>
  <aside
    class="project-panel flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3"
    aria-label="层级图项目"
  >
    <div class="flex items-center justify-between gap-2 py-1">
      <h2 class="flex items-center gap-2 text-sm font-semibold">
        <DtIcon name="folder-open" :size="16" />我的项目
      </h2>
      <span class="text-xs text-text-secondary"
        >{{ projects.total.value }} 个</span
      >
    </div>
    <DtInput
      :model-value="projects.query.value"
      aria-label="搜索项目"
      placeholder="按项目名称搜索"
      type="search"
      size="sm"
      @update:model-value="projects.setQuery"
      @enter="projects.search"
    />
    <DtButton size="sm" variant="outline" @click="projects.search">
      查询项目
    </DtButton>
    <DtDataView
      v-model:view="view"
      :class="{ 'project-table': view === 'table' }"
      :columns="COLUMNS"
      :rows="projects.items.value"
      :loading="projects.loading.value"
      :error="projects.error.value || null"
      :layout="{
        minWidth: '0',
        fixedLayout: true,
        cardColumns: 1,
        cardMinWidth: '0',
      }"
      :pagination="{
        page: projects.page.value,
        size: 20,
        total: projects.total.value,
        sizeOptions: [20],
      }"
      :empty="emptyState"
      @update:page="projects.goToPage"
      @retry="projects.refresh"
    >
      <template #card="{ row }">
        <DtButton
          class="project-card"
          variant="ghost"
          :disabled="projects.loading.value"
          :pressed="selected === row.id"
          :aria-label="row.title"
          :title="row.title"
          @click="emit('open', row.id)"
        >
          <HierarchyProjectSummary :project="row" />
        </DtButton>
      </template>
      <template #cell-title="{ row }">
        <DtButton
          variant="ghost"
          size="sm"
          :disabled="projects.loading.value"
          :aria-pressed="selected === row.id"
          class="project-link"
          :title="row.title"
          @click="emit('open', row.id)"
        >
          <HierarchyProjectSummary :project="row" part="title" />
          <template #trailing>
            <DtIcon
              name="chevron-right"
              :size="12"
              class="project-link__arrow"
            />
          </template>
        </DtButton>
      </template>
      <template #cell-node_count="{ row }">
        <HierarchyProjectSummary :project="row" part="meta" />
      </template>
    </DtDataView>
  </aside>
</template>

<style scoped lang="scss">
.project-panel {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
}
.project-table .project-link {
  --project-title-color: var(--text-primary);
  width: 100%;
  min-width: 0;
  height: auto;
  min-height: 32px;
  justify-content: flex-start;
  gap: 4px;
  padding: 4px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  box-shadow: none;
  text-align: left;

  :deep(.dt-btn__label) {
    flex: 1;
  }

  &:hover:not(:disabled),
  &:focus-visible,
  &[aria-pressed='true'] {
    --project-title-color: var(--accent-on-surface);
    color: var(--accent-on-surface);
    background: transparent;
  }

  &:hover:not(:disabled) .project-link__arrow,
  &:focus-visible .project-link__arrow,
  &[aria-pressed='true'] .project-link__arrow {
    opacity: 1;
  }

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }
}
.project-link__arrow {
  opacity: 0;
}
.project-table :deep(.dt-table th),
.project-table :deep(.dt-table td) {
  padding: 8px;
}
.project-table :deep(.dt-table th) {
  color: var(--text-secondary);
}
.project-table :deep(tbody tr:has(.project-link[aria-pressed='true']) td) {
  background: rgba(var(--accent-primary-rgb), 0.08);
}
.project-table
  :deep(tbody tr:has(.project-link[aria-pressed='true']) td:first-child) {
  box-shadow: inset 2px 0 var(--accent-primary);
}
.project-card {
  width: 100%;
  min-width: 0;
  height: auto;
  min-height: 90px;
  justify-content: flex-start;
  padding: 16px;
  border: 1px solid var(--card-border);
  border-radius: var(--card-radius);
  background: var(--card-bg);
  text-align: left;

  &:hover:not(:disabled),
  &[aria-pressed='true'] {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.1);
  }

  &[aria-pressed='true'] {
    box-shadow: inset 3px 0 var(--accent-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: -3px;
  }
}
</style>
