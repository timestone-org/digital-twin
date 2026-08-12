<script setup lang="ts">
/**
 * @fileoverview 开机事件列表。游标翻页，「加载更多」追加。
 *
 * ⚠ 被人工排除的行**置灰保留、不移除**（AC_STARTUP_DESIGN §8）：删掉它
 * 会让人以为自己排掉的那条从数据里没了，于是反复排第二遍。
 * ⚠ 不可用的结局默认也列出来——丢弃原因说明数据为什么少，藏起来这件事就没人看见。
 */
import type { DtDataColumn } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtSpinner, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import type { EpisodeRow } from '../startupView'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'started', label: '起始时刻', width: '12rem', card: 'title' },
  { key: 'combination', label: '运行组合', width: '14rem', card: 'meta' },
  { key: 'duration', label: '达标时长', width: '8rem', align: 'right' },
  { key: 'outcome', label: '结果', width: '9rem' },
  { key: 'state', label: '人工排除' },
  {
    key: 'actions',
    label: '操作',
    width: '9rem',
    align: 'right',
    card: 'actions',
  },
]

defineProps<{
  rows: readonly EpisodeRow[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: string | null
}>()

const emit = defineEmits<{
  more: []
  retry: []
  inspect: [row: EpisodeRow]
  exclude: [row: EpisodeRow]
  restore: [row: EpisodeRow]
}>()
</script>

<template>
  <DtDataView
    class="min-h-0 flex-1"
    view="table"
    :columns="COLUMNS"
    :rows="rows"
    :loading="loading"
    :error="error"
    :layout="{ toggle: false, minWidth: '64rem' }"
    :empty="{
      title: '这个房间还没有开机事件',
      hint: '换一个房间，或先跑一次抽取。',
    }"
    @retry="emit('retry')"
  >
    <template #summary>
      已加载 {{ rows.length }} 条{{ hasMore ? '，还有更多' : '' }}
    </template>

    <template #cell-started="{ row }">
      <span :class="{ 'opacity-50': row.isExcluded }">{{ row.started }}</span>
    </template>
    <template #cell-combination="{ row }">
      <span class="truncate" :class="{ 'opacity-50': row.isExcluded }">
        {{ row.combination }}
      </span>
    </template>
    <template #cell-duration="{ row }">
      <span :class="{ 'opacity-50': row.isExcluded }">{{ row.duration }}</span>
    </template>
    <template #cell-outcome="{ row }">
      <DtTag size="sm" :intent="row.intent">{{ row.outcome }}</DtTag>
    </template>
    <template #cell-state="{ row }">
      <span v-if="row.isExcluded" class="truncate text-xs text-state-warning">
        已排除 · {{ row.reason }}
      </span>
      <span v-else class="text-xs text-text-disabled">—</span>
    </template>
    <template #cell-actions="{ row }">
      <div class="flex items-center justify-end gap-1">
        <DtButton
          variant="ghost"
          intent="neutral"
          size="sm"
          @click="emit('inspect', row)"
        >
          曲线
        </DtButton>
        <!-- ⚠ 排除是写操作，要 ac:manage；只读账号看得到曲线，看不到这两颗 -->
        <PermGuard :codes="[PERMISSION_CODES.acManage]">
          <DtButton
            v-if="row.isExcluded"
            variant="ghost"
            intent="neutral"
            size="sm"
            @click="emit('restore', row)"
          >
            撤销排除
          </DtButton>
          <DtButton
            v-else
            variant="ghost"
            intent="danger"
            size="sm"
            @click="emit('exclude', row)"
          >
            排除
          </DtButton>
        </PermGuard>
      </div>
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
