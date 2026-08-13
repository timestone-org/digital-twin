<script setup lang="ts">
/**
 * @fileoverview 模型列表。行点开详情；重训与删除是写操作，只给 ac:manage。
 */
import type { DtDataColumn } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import type { ModelRow } from '@/features/hvac/modelView'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '名称', width: '12rem', card: 'title' },
  { key: 'room', label: '房间', width: '10rem', card: 'meta' },
  { key: 'status', label: '状态', width: '7rem' },
  { key: 'sample', label: '样本', width: '6rem', align: 'right' },
  { key: 'mae', label: '折外 MAE', width: '8rem', align: 'right' },
  { key: 'coverage', label: '区间覆盖', width: '7rem', align: 'right' },
  { key: 'trained', label: '训练时间', width: '11rem' },
  { key: 'notice', label: '提示' },
  {
    key: 'actions',
    label: '操作',
    width: '10rem',
    align: 'right',
    card: 'actions',
  },
]

const props = defineProps<{
  rows: readonly ModelRow[]
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  open: [row: ModelRow]
  retrain: [row: ModelRow]
  remove: [row: ModelRow]
  retry: []
}>()
</script>

<template>
  <DtDataView
    class="min-h-0 flex-1"
    view="table"
    :columns="COLUMNS"
    :rows="props.rows"
    :loading="props.loading"
    :error="props.error"
    :layout="{ toggle: false, minWidth: '72rem' }"
    :empty="{
      title: '还没有建过模型',
      hint: '先在开机事件页抽出数据，再回这里新建。',
    }"
    @retry="emit('retry')"
  >
    <template #cell-name="{ row }">
      <button
        type="button"
        class="truncate text-left text-accent-primary hover:underline"
        @click="emit('open', row)"
      >
        {{ row.name }}
      </button>
    </template>
    <template #cell-room="{ row }">
      <span class="truncate">{{ row.workshop }} · {{ row.room }}</span>
    </template>
    <template #cell-status="{ row }">
      <DtTag size="sm" :intent="row.statusIntent">{{ row.statusLabel }}</DtTag>
    </template>
    <template #cell-sample="{ row }">{{ row.sample }}</template>
    <template #cell-mae="{ row }">{{ row.mae }}</template>
    <template #cell-coverage="{ row }">{{ row.coverage }}</template>
    <template #cell-trained="{ row }">{{ row.trained }}</template>
    <template #cell-notice="{ row }">
      <span v-if="row.notice" class="truncate text-xs text-state-warning">
        {{ row.notice }}
      </span>
      <span v-else class="text-xs text-text-disabled">—</span>
    </template>
    <template #cell-actions="{ row }">
      <div class="flex items-center justify-end gap-1">
        <DtButton
          variant="ghost"
          intent="neutral"
          size="sm"
          @click="emit('open', row)"
        >
          详情
        </DtButton>
        <PermGuard :codes="[PERMISSION_CODES.acManage]">
          <DtButton
            variant="ghost"
            intent="neutral"
            size="sm"
            :disabled="row.status === 'queued' || row.status === 'training'"
            @click="emit('retrain', row)"
          >
            重训
          </DtButton>
          <DtButton
            variant="ghost"
            intent="danger"
            size="sm"
            @click="emit('remove', row)"
          >
            删除
          </DtButton>
        </PermGuard>
      </div>
    </template>
  </DtDataView>
</template>
