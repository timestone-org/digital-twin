<script setup lang="ts">
/**
 * @fileoverview 开机事件列表。游标翻页，上一页 / 下一页**替换**当前页。
 *
 * ⚠ 被人工排除的行**置灰保留、不移除**（AC_STARTUP_DESIGN §8）：删掉它
 * 会让人以为自己排掉的那条从数据里没了，于是反复排第二遍。
 * ⚠ 不可用的结局默认也列出来——丢弃原因说明数据为什么少，藏起来这件事就没人看见。
 * ⚠ 分页是游标不是页码，因此不给 DtDataView 传 `pagination`：时序集合按页码翻
 * 会静默重复或漏行，而且这个端点根本给不出 total。
 */
import type { DtDataColumn } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCursorPager, DtDataView, DtTag } from '@dt/ui'

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

const props = defineProps<{
  rows: readonly EpisodeRow[]
  loading: boolean
  /** 1 起的页序；没有总数，所以只报到这里。 */
  page: number
  hasPrev: boolean
  hasNext: boolean
  error: string | null
}>()

const emit = defineEmits<{
  prev: []
  next: []
  retry: []
  inspect: [row: EpisodeRow]
  exclude: [row: EpisodeRow]
  restore: [row: EpisodeRow]
}>()
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <DtDataView
      class="min-h-0 flex-1"
      view="table"
      :columns="COLUMNS"
      :rows="props.rows"
      :loading="props.loading"
      :error="props.error"
      :layout="{ toggle: false, minWidth: '64rem' }"
      :empty="{
        title: '这个房间还没有开机事件',
        hint: '换一个房间，或先跑一次抽取。',
      }"
      @retry="emit('retry')"
    >
      <template #cell-started="{ row }">
        <span :class="{ 'opacity-50': row.isExcluded }">{{ row.started }}</span>
      </template>
      <template #cell-combination="{ row }">
        <span class="truncate" :class="{ 'opacity-50': row.isExcluded }">
          {{ row.combination }}
        </span>
      </template>
      <template #cell-duration="{ row }">
        <span :class="{ 'opacity-50': row.isExcluded }">{{
          row.duration
        }}</span>
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

    <DtCursorPager
      class="shrink-0"
      aria-label="开机事件翻页"
      :page="props.page"
      :count="props.rows.length"
      :has-prev="props.hasPrev"
      :has-next="props.hasNext"
      :loading="props.loading"
      @prev="emit('prev')"
      @next="emit('next')"
    />
  </div>
</template>
