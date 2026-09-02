<script setup lang="ts">
/**
 * @fileoverview 当前项目的标题条：项目名、规模、搜索框，以及项目设置 / 导入 / 新建大屏。
 */
import { computed } from 'vue'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtIcon, DtInput } from '@dt/ui'

import type { ProjectSummary } from '@/api/dashboardWire'
import PermGuard from '@/components/PermGuard.vue'

const props = defineProps<{
  project: ProjectSummary | null
  /** 当前项目下大屏的总数，可能大于网格里已列出的条数。 */
  total: number
  listed: number
  search: string
}>()

const emit = defineEmits<{
  'update:search': [keyword: string]
  settings: []
  import: []
  create: []
}>()

/** 编辑面（改项目、改屏）与管理面（建屏、导入、删项目）合起来才够开设置弹窗。 */
const SETTINGS_CODES = [
  PERMISSION_CODES.dashboardEdit,
  PERMISSION_CODES.dashboardManage,
]
const MANAGE_CODES = [PERMISSION_CODES.dashboardManage]

const summary = computed(() => {
  const hidden = props.total - props.listed
  const scale = `${props.total} 个大屏`
  // ⚠ 截断要说出来：不说的话「搜不到」看起来就是这张屏不存在
  return hidden > 0 ? `${scale}（已列出前 ${props.listed} 个）` : scale
})
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-3">
    <div class="min-w-0 shrink grow basis-64">
      <h2
        class="dt-glow-text truncate font-display text-xl font-bold tracking-wide"
      >
        {{ project?.name ?? '—' }}
      </h2>
      <p class="mt-1 truncate text-xs text-text-disabled">
        <span class="text-text-secondary">{{ summary }}</span>
        <span v-if="project?.description">· {{ project.description }}</span>
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <DtInput
        class="w-56"
        size="sm"
        :model-value="search"
        placeholder="搜索当前项目的大屏"
        aria-label="搜索当前项目的大屏"
        data-test="dashboard-search"
        @update:model-value="emit('update:search', $event)"
      >
        <template #leading><DtIcon name="search" :size="14" /></template>
        <!-- 一键清空。搜不到时空态只说「改个词」，得有个地方能一下退回全部 -->
        <template v-if="search !== ''" #trailing>
          <DtButton
            size="sm"
            variant="ghost"
            intent="neutral"
            icon="close"
            aria-label="清空搜索"
            data-test="clear-search"
            @click="emit('update:search', '')"
          />
        </template>
      </DtInput>

      <PermGuard :codes="SETTINGS_CODES" mode="any">
        <DtButton
          size="sm"
          variant="ghost"
          intent="neutral"
          icon="settings"
          :disabled="project === null"
          data-test="open-project-settings"
          @click="emit('settings')"
        >
          设置
        </DtButton>
      </PermGuard>

      <PermGuard :codes="MANAGE_CODES">
        <DtButton
          size="sm"
          variant="soft"
          icon="upload"
          :disabled="project === null"
          data-test="open-import"
          @click="emit('import')"
        >
          导入
        </DtButton>
        <DtButton
          size="sm"
          icon="plus"
          :disabled="project === null"
          data-test="open-new-dashboard"
          @click="emit('create')"
        >
          新建大屏
        </DtButton>
      </PermGuard>
    </div>
  </header>
</template>
