<script setup lang="ts">
/**
 * @fileoverview 大屏网格的两种空：搜不到，和这个项目还没有屏。
 *
 * ⚠ 「还没有屏」这一种必须把新建与导入两个入口摆在空态里。空态是新用户第一眼
 * 看到的地方，让他为了建第一张屏再去右上角找按钮，是把最需要引导的那一刻
 * 留给了最没有引导的界面。搜不到那一种则**不给**入口——那时候他要的是改词。
 */
import { computed } from 'vue'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtEmpty } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'

const props = defineProps<{
  /** 当前搜索词，非空即「搜不到」那一种。 */
  search: string
  /** 有没有建屏的权限，决定文案是引导还是解释。 */
  canManage: boolean
}>()

const emit = defineEmits<{ create: []; import: [] }>()

const MANAGE_CODES = [PERMISSION_CODES.dashboardManage]

const isSearching = computed(() => props.search.trim() !== '')

const view = computed(() =>
  isSearching.value
    ? {
        icon: 'search',
        title: '没有匹配的大屏',
        hint: `当前项目下没有名字含「${props.search.trim()}」的大屏。`,
      }
    : {
        icon: 'layout-grid',
        title: '还没有大屏',
        hint: props.canManage
          ? '从空白画布、现有大屏的副本或模板库开始建第一块屏。'
          : '当前项目还没有大屏，请联系管理员创建。',
      },
)
</script>

<template>
  <DtEmpty
    :icon="view.icon"
    :title="view.title"
    :hint="view.hint"
    data-test="dashboard-grid-empty"
  >
    <PermGuard v-if="!isSearching" :codes="MANAGE_CODES">
      <div class="flex flex-wrap items-center justify-center gap-2">
        <DtButton
          size="sm"
          icon="plus"
          data-test="empty-create-dashboard"
          @click="emit('create')"
        >
          新建大屏
        </DtButton>
        <DtButton
          size="sm"
          variant="soft"
          icon="upload"
          data-test="empty-import-dashboard"
          @click="emit('import')"
        >
          导入 JSON
        </DtButton>
      </div>
    </PermGuard>
  </DtEmpty>
</template>
