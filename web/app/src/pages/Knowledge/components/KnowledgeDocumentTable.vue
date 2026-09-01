<script setup lang="ts">
/**
 * @fileoverview 文档表：摄取状态、块数、重新解析与删除。
 *
 * ⚠ 失败原因**直接显示在行里**，不藏进详情：那句话是后端写给最终用户的
 * （「认不出 .pdf 是什么格式」），藏起来的话用户只看得到一个红色的「失败」。
 * ⚠ 摄取是异步的：状态要能手动刷新——不给刷新入口的话，用户只会一直盯着
 * 一个不动的「待处理」。
 */
import type { DtTableColumn } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtTable, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import type { KnowledgeDocument } from '@/api/knowledge'

const props = defineProps<{
  documents: readonly KnowledgeDocument[]
}>()

const emit = defineEmits<{
  reparse: [documentId: string]
  remove: [documentId: string]
}>()

const COLUMNS: readonly DtTableColumn[] = [
  { key: 'title', label: '文档' },
  { key: 'status', label: '状态', width: '11rem' },
  { key: 'chunks', label: '块数', width: '5rem', align: 'right' },
  { key: 'actions', label: '操作', width: '11rem', align: 'right' },
]

const LABELS: Record<string, string> = {
  pending: '待处理',
  parsing: '解析中',
  chunking: '切块中',
  embedding: '嵌入中',
  indexing: '建索引中',
  ready: '已就绪',
  failed: '失败',
}

function label(status: string): string {
  return LABELS[status] ?? status
}

function intent(status: string): 'success' | 'danger' | 'neutral' {
  if (status === 'ready') return 'success'
  if (status === 'failed') return 'danger'
  return 'neutral'
}
</script>

<template>
  <DtTable
    :columns="COLUMNS"
    :rows="props.documents"
    fixed-layout
    caption="这个知识库里的文档"
  >
    <template #cell-title="{ row }">
      <span class="block truncate">{{ row.title }}</span>
      <span
        v-if="row.failureReason !== ''"
        class="block truncate text-xs text-state-danger"
      >
        {{ row.failureReason }}
      </span>
    </template>

    <template #cell-status="{ row }">
      <DtTag :intent="intent(row.status)">{{ label(row.status) }}</DtTag>
    </template>

    <template #cell-chunks="{ row }">{{ row.chunkCount }}</template>

    <template #cell-actions="{ row }">
      <PermGuard :codes="[PERMISSION_CODES.knowledgeWrite]">
        <div class="flex justify-end gap-1">
          <DtButton variant="ghost" size="xs" @click="emit('reparse', row.id)">
            重新解析
          </DtButton>
          <DtButton
            variant="ghost"
            intent="danger"
            size="xs"
            @click="emit('remove', row.id)"
          >
            删除
          </DtButton>
        </div>
      </PermGuard>
    </template>
  </DtTable>
</template>
