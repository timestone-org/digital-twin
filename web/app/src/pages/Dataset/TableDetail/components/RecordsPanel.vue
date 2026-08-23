<script setup lang="ts">
/**
 * @fileoverview 台账详情的「数据」分区：过期横幅 + 工具条 + 数据表格 + 两个弹窗。
 *
 * ⚠ 「下游过期」的横幅**所有人可见**，只有「立即重算」那颗按钮挂码：过期是他
 * 改历史行造成的**事实**，得让他知道去找谁重算（docs/DATASET_DESIGN.md §7.4）。
 * ⚠ 列定义从详情页那一份来（受控），数据行则由本分区自己按游标翻页持有——
 * 它只喂给这一处，且带着游标栈与写后重取，摊到父级会让父级同时管四份状态。
 * ⚠ 一列都还没有的台账，录入表单是一张空表：这时该指路去配列，而不是让人
 * 对着一个只有「数据时间」的弹窗发呆。
 */
import { computed, onMounted, watch } from 'vue'
import type { DatasetColumn, DatasetTable } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtNotice } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import OverrideBulkDialog from './OverrideBulkDialog.vue'
import RecordFormDialog from './RecordFormDialog.vue'
import RecordTable from './RecordTable.vue'
import { overrideStats, type RecordRow } from '../scripts/recordView'
import { useRecordOps } from '../scripts/useRecordOps'
import { useRecords } from '../scripts/useRecords'

const props = defineProps<{
  table: DatasetTable | null
  columns: readonly DatasetColumn[]
  /** 详情页那边有一次列的重排或删除在飞。 */
  busy: boolean
}>()

const records = useRecords(() => props.table?.id ?? '')
const ops = useRecordOps(() => props.table?.id ?? '', records)

const stats = computed(() => overrideStats(props.columns, records.rows.value))
const hasColumn = computed(() => props.columns.length > 0)
const hasFormulaColumn = computed(() =>
  props.columns.some((column) => column.source === 'formula'),
)
// 行内动作在「详情页正忙」或「本分区正忙」时一起禁掉：删一列与删一行同时在飞，
// 后回来的那个会拿着一份已经不成立的行去发请求
const isBusy = computed(() => props.busy || ops.busy.value)

onMounted(() => {
  if (props.table !== null) void records.reload()
})

// 详情页换了一张台账（同一条路由换 :tableId）时组件不会重挂，得自己重来一遍
watch(
  () => props.table?.id ?? '',
  (id) => {
    if (id !== '') void records.reload()
  },
)

function onRevoke(column: DatasetColumn, row: RecordRow): void {
  void ops.revokeCell({
    row,
    columnKey: column.key,
    columnName: column.name,
  })
}
</script>

<template>
  <div class="flex min-h-0 flex-col gap-3">
    <DtNotice v-if="!hasColumn" intent="warning" icon="alert-triangle">
      这张台账还没有列，录不进也算不出任何数据。先去「列配置」加几列。
    </DtNotice>

    <!-- 过期横幅：没有重算权限的人也要看见 -->
    <DtNotice v-if="records.isStale.value" intent="warning" icon="alert-circle">
      <span class="flex flex-wrap items-center gap-2">
        <span>
          刚刚动的是一条历史行，它之后那些行里的 PREV /
          时间窗类公式结果仍是按旧数据算的。重算之后才准。
        </span>
        <PermGuard :codes="[PERMISSION_CODES.datasetBackfill]">
          <DtButton
            size="sm"
            icon="refresh-cw"
            :loading="ops.busy.value"
            @click="ops.recompute()"
          >
            立即重算
          </DtButton>
        </PermGuard>
      </span>
    </DtNotice>

    <div class="flex flex-wrap items-center gap-2">
      <!-- 本页的修正总数：角标散在表里数不过来。迁移那一批单列一句，
           免得用户看见一片角标以为有人在动他的数据 -->
      <span v-if="stats.total > 0" class="text-xs text-text-secondary">
        本页有 {{ stats.total }} 格人工修正<template v-if="stats.migration > 0"
          >，其中
          {{ stats.migration }} 格由数据迁移带进来，不是本期的改动</template
        >
      </span>

      <div class="ml-auto flex items-center gap-2">
        <PermGuard :codes="[PERMISSION_CODES.datasetOverride]">
          <DtButton
            variant="ghost"
            intent="neutral"
            size="sm"
            icon="undo"
            :disabled="isBusy"
            @click="ops.openBulk()"
          >
            批量撤销修正
          </DtButton>
        </PermGuard>
        <!-- 全表重算与回填同码：它大批量改写历史行且吃满数据库 -->
        <PermGuard
          v-if="hasFormulaColumn"
          :codes="[PERMISSION_CODES.datasetBackfill]"
        >
          <DtButton
            variant="ghost"
            intent="neutral"
            size="sm"
            icon="refresh-cw"
            :disabled="isBusy"
            @click="ops.recompute()"
          >
            重算公式列
          </DtButton>
        </PermGuard>
        <PermGuard :codes="[PERMISSION_CODES.datasetRecordWrite]">
          <DtButton
            size="sm"
            icon="plus"
            :disabled="isBusy || !hasColumn"
            @click="ops.openCreate()"
          >
            录入数据
          </DtButton>
        </PermGuard>
      </div>
    </div>

    <RecordTable
      :rows="records.rows.value"
      :columns="props.columns"
      :loading="records.loading.value"
      :error="records.error.value"
      :page="records.page.value"
      :has-prev="records.hasPrev.value"
      :has-next="records.hasNext.value"
      :busy="isBusy"
      @retry="records.refresh()"
      @prev="records.prev()"
      @next="records.next()"
      @edit="ops.openEdit($event)"
      @remove="ops.removeRecord($event)"
      @revoke="onRevoke"
    />

    <RecordFormDialog
      v-model="ops.isFormOpen.value"
      :table-id="props.table?.id ?? ''"
      :columns="props.columns"
      :record="ops.editing.value"
      @saved="(message, hasStale) => ops.afterSaved(message, hasStale)"
    />

    <OverrideBulkDialog
      v-model="ops.isBulkOpen.value"
      :table-id="props.table?.id ?? ''"
      :columns="props.columns"
      :range="records.range.value"
      :badged-keys="stats.keys"
      @cleared="ops.afterBulk()"
    />
  </div>
</template>
