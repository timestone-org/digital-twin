<script setup lang="ts">
/**
 * @fileoverview 列配置表：顺序、名称与标识、类型与单位、来源徽标、来源详情。
 *
 * ⚠ 顺序那一格对**只读账号也要显示**：它就是录入表单的字段序与数据表的列序，
 * 只是不给上下移的按钮。整格藏掉会让人以为列是随机排的。
 * ⚠ 行内不开 `explain`：每行挂一句「只读」是纯噪音，页面顶上那一句已经说清了。
 */
import type { DatasetColumn, DtDataColumn } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import { sourceDetail, sourceMeta, typeLabel } from '../scripts/columnView'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'order', label: '顺序', width: '6.5rem' },
  { key: 'name', label: '列', card: 'title' },
  { key: 'data_type', label: '类型', width: '8rem' },
  { key: 'source', label: '来源', width: '8rem', card: 'meta' },
  { key: 'detail', label: '来源详情' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '6rem',
    card: 'actions',
  },
]

const EMPTY = {
  title: '这张台账还没有列',
  hint: '用右上角的「新增列」加几列：人工填的原始项、从点位历史汇总的采集项，再用公式算出要看的派生指标。',
}

const props = defineProps<{
  columns: readonly DatasetColumn[]
  /** 有一次重排或删除在飞，行内动作跟着禁用，免得连点排出一个来回错乱的顺序。 */
  busy: boolean
}>()

const emit = defineEmits<{
  edit: [column: DatasetColumn]
  remove: [column: DatasetColumn]
  move: [column: DatasetColumn, delta: -1 | 1]
}>()
</script>

<template>
  <!-- ⚠ 关掉表格 / 卡片切换器并钉死表格：列配置读的是「顺序 + 一行里六项的
       对照」，卡片视图两样都给不了，留一个切过去就没法用的开关不如不留 -->
  <DtDataView
    view="table"
    class="min-h-0 flex-1"
    :columns="COLUMNS"
    :rows="props.columns"
    :empty="EMPTY"
    :layout="{ minWidth: '62rem', toggle: false, fixedLayout: true }"
  >
    <template #summary>共 {{ props.columns.length }} 列</template>

    <template #cell-order="{ row, index }">
      <div class="flex items-center gap-1">
        <span class="w-4 shrink-0 text-xs text-text-secondary">
          {{ index + 1 }}
        </span>
        <PermGuard :codes="[PERMISSION_CODES.datasetManage]">
          <DtButton
            variant="ghost"
            intent="neutral"
            size="xs"
            icon="chevron-up"
            aria-label="上移"
            :disabled="index === 0 || props.busy"
            @click="emit('move', row, -1)"
          />
          <DtButton
            variant="ghost"
            intent="neutral"
            size="xs"
            icon="chevron-down"
            aria-label="下移"
            :disabled="index === props.columns.length - 1 || props.busy"
            @click="emit('move', row, 1)"
          />
        </PermGuard>
      </div>
    </template>

    <template #cell-name="{ row }">
      <div class="min-w-0">
        <p class="truncate">{{ row.name }}</p>
        <p class="truncate text-xs text-text-secondary">
          {{ '{' + row.key + '}' }}
          <span v-if="row.is_required" class="text-state-warning">必填</span>
        </p>
      </div>
    </template>

    <template #cell-data_type="{ row }">
      <span class="text-text-secondary">{{ typeLabel(row.data_type) }}</span>
      <span v-if="row.unit" class="ml-1 text-xs text-text-secondary">
        {{ row.unit }}
      </span>
    </template>

    <template #cell-source="{ row }">
      <DtTag size="sm" :intent="sourceMeta(row.source).intent">
        {{ sourceMeta(row.source).label }}
      </DtTag>
    </template>

    <!-- ⚠ 点位列先摆聚合口径再摆点位：这一格的数到底是均值、末值还是增量，
         是看数据时的头号疑问，不该非要点进编辑弹窗才知道 -->
    <template #cell-detail="{ row }">
      <div
        class="flex min-w-0 items-center gap-1.5"
        :title="sourceDetail(row).title"
      >
        <DtTag v-if="sourceDetail(row).aggLabel" size="sm" intent="primary">
          {{ sourceDetail(row).aggLabel }}
        </DtTag>
        <span class="truncate text-xs text-text-secondary">
          {{ sourceDetail(row).text }}
        </span>
      </div>
    </template>

    <template #cell-actions="{ row }">
      <div class="flex items-center justify-end gap-1">
        <PermGuard :codes="[PERMISSION_CODES.datasetManage]">
          <DtButton
            variant="ghost"
            intent="neutral"
            size="sm"
            icon="pencil"
            aria-label="编辑列"
            title="编辑列"
            :disabled="props.busy"
            @click="emit('edit', row)"
          />
          <DtButton
            variant="ghost"
            intent="danger"
            size="sm"
            icon="trash"
            aria-label="删除列"
            title="删除列"
            :disabled="props.busy"
            @click="emit('remove', row)"
          />
        </PermGuard>
      </div>
    </template>
  </DtDataView>
</template>
