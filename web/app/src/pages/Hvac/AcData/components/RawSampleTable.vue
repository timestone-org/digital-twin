<script setup lang="ts">
/**
 * @fileoverview 原始数据表格：一列时刻 + 每个指标一列，横向滚动。
 *
 * ⚠ 列与插槽由同一份目录生成（见 ../sampleTable.ts），所以不存在
 * 「插槽名与列名对不上、那一列静静渲染成占位符」这条本仓最典型的静默失效。
 * ⚠ 分页是游标不是页码，因此不给 DtDataView 传 `pagination`，改用「加载更多」
 * 追加——时序集合按页码翻会静默重复或漏行。
 */
import { DtButton, DtDataView, DtSpinner } from '@dt/ui'

import type { SampleColumn, SampleRow } from '../scripts/sampleTable'

defineProps<{
  columns: readonly SampleColumn[]
  rows: readonly SampleRow[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: string | null
}>()

const emit = defineEmits<{ more: []; retry: [] }>()
</script>

<template>
  <DtDataView
    class="min-h-0 flex-1"
    view="table"
    :columns="columns"
    :rows="rows"
    :loading="loading"
    :error="error"
    :layout="{ toggle: false, minWidth: `${columns.length * 9}rem` }"
    :empty="{
      title: '这段时间没有数据',
      hint: '换一个时间段试试；外部库自 2023-01-01 起才有记录。',
    }"
    @retry="emit('retry')"
  >
    <template #summary>
      已加载 {{ rows.length }} 行{{ hasMore ? '，还有更多' : '' }}
    </template>

    <template
      v-for="column in columns"
      :key="column.key"
      #[column.slot]="{ row }"
    >
      {{ row.cells[column.key] }}
    </template>
  </DtDataView>

  <div v-if="hasMore" class="flex justify-center">
    <DtButton
      size="sm"
      variant="ghost"
      :disabled="loadingMore"
      @click="emit('more')"
    >
      <DtSpinner v-if="loadingMore" :size="14" label="正在加载" />
      <span v-else>加载更多</span>
    </DtButton>
  </div>
</template>
