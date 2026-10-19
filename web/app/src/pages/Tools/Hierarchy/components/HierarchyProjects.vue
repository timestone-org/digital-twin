<script setup lang="ts">
/** @fileoverview 层级图项目导航、搜索与分页。 */
import { computed } from 'vue'
import { listEmptyState } from '@/utils/listEmpty'
import { DtButton, DtDataView, DtInput } from '@dt/ui'
import type { DtDataColumn } from '@dt/contracts'
import { useViewMode } from '@/composables/useViewMode'
import type { useHierarchyProjects } from '../scripts/useHierarchyProjects'
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
  { key: 'node_count', label: '计量节点', card: 'meta' },
]
</script>
<template>
  <aside
    class="flex min-h-0 w-60 shrink-0 flex-col gap-3 border-r border-border-subtle pr-3"
  >
    <DtInput
      :model-value="projects.query.value"
      label="我的层级图"
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
      :columns="COLUMNS"
      :rows="projects.items.value"
      :loading="projects.loading.value"
      :error="projects.error.value || null"
      :layout="{ minWidth: '0', cardColumns: 1, cardMinWidth: '0' }"
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
      <template #cell-title="{ row }">
        <DtButton
          variant="ghost"
          size="sm"
          :disabled="projects.loading.value"
          :aria-pressed="selected === row.id"
          @click="emit('open', row.id)"
        >
          {{ row.title }}
        </DtButton>
      </template>
      <template #cell-node_count="{ row }">
        {{ row.node_count }} 个 · v{{ row.revision }}
      </template>
    </DtDataView>
  </aside>
</template>
