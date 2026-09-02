<script setup lang="ts">
/**
 * @fileoverview 某个房间的模型表。行点开详情；重训与删除是写操作，只给 ac:manage。
 *
 * ⚠ 表格而不是卡片：同房间的多个模型只在几个数字上有差别，判断「哪个更好」
 * 是逐列比大小的活儿，同一指标钉在同一条竖线上眼睛才扫得下来。窄屏用户可以
 * 用内置切换器自己换成卡片。
 */
import type { DtDataColumn, DtDataViewMode, DtTableSort } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtHelpTip, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import {
  HOT_METRICS_HELP,
  R2_HELP,
  type ModelRow,
} from '@/features/hvac/modelView'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '名称', width: '16rem', card: 'title' },
  { key: 'status', label: '状态', width: '6rem' },
  { key: 'sets', label: '服务组合', width: '10rem', card: 'meta' },
  {
    key: 'sample',
    label: '样本',
    width: '7.5rem',
    align: 'right',
    sortable: true,
  },
  {
    key: 'r2',
    label: '热行 R²',
    width: '6rem',
    align: 'right',
    sortable: true,
  },
  {
    key: 'mae',
    label: '热行 MAE',
    width: '8rem',
    align: 'right',
    sortable: true,
  },
  { key: 'training', label: '训练', width: '10rem', sortable: true },
  {
    key: 'actions',
    label: '操作',
    width: '9rem',
    align: 'right',
    card: 'actions',
  },
]

const props = defineProps<{
  rows: readonly ModelRow[]
  loading: boolean
  error: string | null
  sort: DtTableSort | null
  view: DtDataViewMode
}>()

const emit = defineEmits<{
  open: [row: ModelRow]
  retrain: [row: ModelRow]
  remove: [row: ModelRow]
  retry: []
  'update:sort': [value: DtTableSort]
  'update:view': [value: DtDataViewMode]
}>()
</script>

<template>
  <DtDataView
    class="min-h-0 flex-1"
    :view="props.view"
    :columns="COLUMNS"
    :rows="props.rows"
    :loading="props.loading"
    :error="props.error"
    :sort="props.sort"
    :layout="{ minWidth: '72rem', cardColumns: 2, cardMinWidth: '20rem' }"
    :empty="{
      title: '这个房间还没有模型',
      hint: '用右上角的「新建模型」，拿它已抽出的开机事件训练一个。',
    }"
    @retry="emit('retry')"
    @update:sort="emit('update:sort', $event)"
    @update:view="emit('update:view', $event)"
  >
    <template #toolbar>
      <div
        class="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-text-secondary"
      >
        <span class="inline-flex items-center gap-1">
          热行指标
          <DtHelpTip label="热行指标" :text="HOT_METRICS_HELP" />
        </span>
        <span class="inline-flex items-center gap-1">
          热行 R²
          <DtHelpTip label="热行 R²" :text="R2_HELP" />
        </span>
      </div>
    </template>

    <template #cell-name="{ row }">
      <div class="dt-models__name flex min-w-0 flex-col">
        <!-- 名字本身就是打开详情的入口。⚠ 用 DtButton 而不是自己画一个
             `<button>`：手搓的那颗要自带焦点环、禁用态与换肤色，漏哪样都不报错 -->
        <DtButton
          variant="ghost"
          intent="neutral"
          size="sm"
          class="dt-models__open"
          @click="emit('open', row)"
        >
          {{ row.name }}
        </DtButton>
        <span
          v-if="row.notice"
          class="truncate text-2xs text-state-warning"
          :title="row.notice"
        >
          {{ row.notice }}
        </span>
        <span
          v-else-if="row.description"
          class="truncate text-2xs text-text-secondary"
          :title="row.description"
        >
          {{ row.description }}
        </span>
      </div>
    </template>
    <template #cell-status="{ row }">
      <DtTag size="sm" :intent="row.statusIntent">{{ row.statusLabel }}</DtTag>
    </template>
    <template #cell-sets="{ row }">
      <span class="truncate font-mono text-xs" :title="row.setsTitle">
        {{ row.sets }}
      </span>
    </template>
    <template #cell-sample="{ row }">
      <div class="flex flex-col">
        <span>{{ row.sample }}</span>
        <span v-if="row.sampleSplit" class="text-2xs text-text-disabled">
          {{ row.sampleSplit }}
        </span>
      </div>
    </template>
    <template #cell-r2="{ row }">
      <span :class="row.r2Class">{{ row.r2 }}</span>
    </template>
    <template #cell-mae="{ row }">
      <div class="flex flex-col">
        <span>{{ row.mae }}</span>
        <span
          v-if="row.coverage"
          class="text-2xs"
          :class="
            row.isCoverageLow ? 'text-state-warning' : 'text-text-disabled'
          "
        >
          覆盖 {{ row.coverage }}
        </span>
      </div>
    </template>
    <template #cell-training="{ row }">
      <div class="flex flex-col">
        <span :title="row.trainedTitle">{{ row.trained }}</span>
        <span v-if="row.window" class="text-2xs text-text-disabled">
          {{ row.window }}
        </span>
      </div>
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

<style scoped lang="scss">
// DtButton 按控件尺寸档排版，塞进表格行要收掉左右内边距并左对齐，
// 否则名字会比同一行的其它列各缩进一截（同 Assets 列表页的先例）
.dt-models__open {
  max-width: 100%;
  justify-content: flex-start;
  padding-inline: 0;
}

// 表格里名称列限宽：auto 布局下不限的话，长描述会把这一列撑开、把样本列挤成两行；
// 卡片里宽度由卡片自己定，不限
td .dt-models__name {
  max-width: 16rem;
}
</style>
