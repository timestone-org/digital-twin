<script setup lang="ts">
/**
 * @fileoverview 文档表：摄取状态、块数，以及重新解析与删除；大小与上传时刻挂在标题下。
 *
 * ⚠ 失败原因**直接显示在行里**，不藏进详情：那句话是后端写给最终用户的
 * （「认不出 .pdf 是什么格式」），藏起来的话用户只看得到一个红色的「失败」。
 * ⚠ 大小与上传时刻不单独成列：这张表在 ≥xl 时与试验台并排、只有 28rem 上下，
 * 再多两列「操作」就被推出视口，要横滚才够得着。
 */
import { computed } from 'vue'
import type {
  DtDataColumn,
  DtIntent,
  KnowledgeDocumentStatus,
} from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCard, DtDataView, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import type { KnowledgeDocument } from '@/api/knowledge'
import { useViewMode } from '@/composables/useViewMode'
import { formatDateTime } from '@/utils/datetime'
import { formatSize } from '@/utils/filesize'

const props = defineProps<{
  documents: readonly KnowledgeDocument[]
  loading: boolean
}>()

const emit = defineEmits<{
  reparse: [document: KnowledgeDocument]
  remove: [document: KnowledgeDocument]
}>()

const DOCUMENT_COLUMNS: readonly DtDataColumn[] = [
  { key: 'title', label: '文档', card: 'title' },
  { key: 'status', label: '状态', width: '7rem', card: 'meta' },
  { key: 'chunks', label: '块数', width: '4.5rem', align: 'right' },
  {
    key: 'actions',
    label: '操作',
    width: '8rem',
    align: 'right',
    card: 'actions',
  },
]

const DOCUMENT_EMPTY = {
  title: '还没有文档',
  hint: '点右上角「传文档」，传完后台会解析、切块、嵌入。',
}

const LABELS: Record<KnowledgeDocumentStatus, string> = {
  pending: '待处理',
  parsing: '解析中',
  chunking: '切块中',
  embedding: '嵌入中',
  indexing: '建索引中',
  ready: '已就绪',
  failed: '失败',
}

const INTENTS: Record<KnowledgeDocumentStatus, DtIntent> = {
  pending: 'neutral',
  parsing: 'info',
  chunking: 'info',
  embedding: 'info',
  indexing: 'info',
  ready: 'success',
  failed: 'danger',
}

const view = useViewMode('knowledge-documents')

const readyCount = computed(
  () => props.documents.filter((one) => one.status === 'ready').length,
)

/** 标题下那一行：大小 · 上传时刻。 */
function metaOf(row: KnowledgeDocument): string {
  return `${formatSize(row.sizeBytes)} · ${formatDateTime(row.createdAt)}`
}
</script>

<template>
  <DtCard icon="table" title="文档" class="flex min-h-0 flex-col">
    <DtDataView
      v-model:view="view"
      class="min-h-0 flex-1"
      :columns="DOCUMENT_COLUMNS"
      :rows="props.documents"
      :loading="props.loading"
      :empty="DOCUMENT_EMPTY"
      :layout="{
        minWidth: '28rem',
        fixedLayout: true,
        cardColumns: 2,
        cardMinWidth: '18rem',
        fill: true,
      }"
    >
      <template #summary>
        共 {{ props.documents.length }} 份 · {{ readyCount }} 份已就绪
      </template>

      <!-- ⚠ `block` 不能省：表格开着 fixedLayout，行内盒不截就直接压到相邻列上 -->
      <template #cell-title="{ row }">
        <span class="block truncate" :title="row.title">{{ row.title }}</span>
        <span
          v-if="row.failureReason !== ''"
          class="block truncate text-xs text-state-danger"
          :title="row.failureReason"
        >
          {{ row.failureReason }}
        </span>
        <span v-else class="block truncate text-xs text-text-secondary">
          {{ metaOf(row) }}
        </span>
      </template>

      <template #cell-status="{ row }">
        <DtTag :intent="INTENTS[row.status]" size="sm">
          {{ LABELS[row.status] }}
        </DtTag>
      </template>

      <template #cell-chunks="{ row }">{{ row.chunkCount }}</template>

      <template #cell-actions="{ row }">
        <PermGuard :codes="[PERMISSION_CODES.knowledgeWrite]">
          <div class="flex items-center justify-end gap-1">
            <DtButton variant="ghost" size="sm" @click="emit('reparse', row)">
              重新解析
            </DtButton>
            <DtButton
              variant="ghost"
              intent="danger"
              size="sm"
              icon="trash"
              aria-label="删除文档"
              title="删除文档"
              @click="emit('remove', row)"
            />
          </div>
        </PermGuard>
      </template>
    </DtDataView>
  </DtCard>
</template>
