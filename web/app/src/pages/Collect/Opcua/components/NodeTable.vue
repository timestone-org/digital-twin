<script setup lang="ts">
/**
 * @fileoverview 已导入节点表：配置 + 实时读写 + 记录历史开关 + 批量导入导出。
 *
 * ⚠ 实时值来自 WS 主题 `collect:{sourceId}`，不是这张表自己轮询出来的：
 * 首帧由 publisher 补全量，之后只推变化的那些（COLLECT_DESIGN §9）。通道断了
 * 要在界面上说出来——不说的话，最后一批值会一直挂着冒充现值。
 *
 * ⚠ 「配了多少个点位」与「实时值覆盖多少个」不是一回事：推送按编码升序取前
 * `live_point_limit` 个，超出的那些只有配置没有实时值。
 *
 * 多选的口径在 `useArchiveOps`，单条删与批量删都走 `useForceDelete` 的两级
 * 确认——批量那一路整批全删或全不删，一个点位被绑着就一个都不删。
 */
import { computed, ref, watch } from 'vue'
import type { CollectPoint, CollectSource } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtCard,
  DtCheckbox,
  DtDataView,
  DtSwitch,
  DtSelect,
  DtTag,
} from '@dt/ui'

import * as collect from '@/api/collect'
import PermGuard from '@/components/PermGuard.vue'
import { useViewMode } from '@/composables/useViewMode'
import { useAuthStore } from '@/stores/auth'
import { POINT_STATUS_OPTIONS, pointStatus } from '../scripts/pointStatus'
import { nodeTableColumns } from '../scripts/nodeTableColumns'
import { useArchiveOps } from '../scripts/useArchiveOps'
import { useForceDelete } from '../scripts/useForceDelete'
import { useLiveValues } from '../scripts/useLiveValues'
import { usePointEditing } from '../scripts/usePointEditing'
import { usePointList } from '../scripts/usePointList'
import { usePointOps } from '../scripts/usePointOps'
import BatchEditDialog from './BatchEditDialog.vue'
import BatchActionBar from './BatchActionBar.vue'
import ForceDeleteDialog from './ForceDeleteDialog.vue'
import ImportPointsDialog from './ImportPointsDialog.vue'
import NodeTableNotices from './NodeTableNotices.vue'
import NodeTableToolbar from './NodeTableToolbar.vue'
import PointCard from './PointCard.vue'
import PointDetailDialog from './PointDetailDialog.vue'
import PointFormDialog from './PointFormDialog.vue'
import PointValueCell from './PointValueCell.vue'
import WriteValueDialog from './WriteValueDialog.vue'

const props = defineProps<{ source: CollectSource }>()

const batchEditing = ref<CollectPoint[] | null>(null)
const detail = ref<CollectPoint | null>(null)
const detailSample = computed(() =>
  detail.value === null
    ? undefined
    : live.samples.value.get(detail.value.node_key),
)
const detailStale = computed(
  () =>
    detail.value !== null &&
    (!live.isConnected.value ||
      live.staleKeys.value.has(detail.value.node_key) ||
      props.source.runtime.state !== 'online'),
)

const auth = useAuthStore()
const canManage = computed(() =>
  auth.can([PERMISSION_CODES.collectManage], 'all'),
)

const COLUMNS = computed(() => nodeTableColumns(canManage.value))

const sourceId = computed(() => props.source.id)
const view = useViewMode('collect-points')

const { keyword, list, emptyState } = usePointList(() => sourceId.value)

const live = useLiveValues(sourceId)
const ops = usePointOps(() => sourceId.value)
const editing = usePointEditing(ops, () => list.reload())
const archive = useArchiveOps(() => list.reload())
const removal = useForceDelete<CollectPoint>(
  (point, force) => collect.deletePoint(point.id, force),
  (_point, message) => `${message}。强制删除会让那些大屏上的绑定就此失效。`,
  () => list.reload(),
)
const batchRemoval = useForceDelete<readonly string[]>(
  (pointIds, force) => collect.deletePoints(pointIds, force),
  (_pointIds, message) => `${message}。强制删除会让那些大屏上的绑定就此失效。`,
  () => list.reload(),
  (pointIds) => `已删除 ${pointIds.length} 个点位`,
)

const statusFilter = ref('all')
const visibleRows = computed(() =>
  list.items.value.filter(
    (row) =>
      statusFilter.value === 'all' ||
      pointStatus(
        live.samples.value.get(row.node_key),
        !live.isConnected.value ||
          live.staleKeys.value.has(row.node_key) ||
          props.source.runtime.state !== 'online',
      ) === statusFilter.value,
  ),
)
const filteredEmpty = computed(() =>
  statusFilter.value === 'all'
    ? emptyState.value
    : { title: '本页没有符合状态的点位', hint: '切换状态或翻页查看其他点位。' },
)

const hasPoints = computed(() => list.total.value > 0)
const hasRows = computed(() => list.items.value.length > 0)
const hasSelection = computed(() => archive.selectedCount.value > 0)

const batchDeleteName = computed(
  () => `${batchRemoval.target.value?.length ?? 0} 个点位`,
)

const writeSample = computed(() =>
  editing.writing.value === null
    ? undefined
    : live.samples.value.get(editing.writing.value.node_key),
)

async function afterImport(): Promise<void> {
  await list.reload()
}

/** 供父页在「浏览树导入完成」后刷新当前页。 */
async function reload(): Promise<void> {
  await list.reload()
}

function openBatchEdit(): void {
  batchEditing.value = list.items.value.filter((row) =>
    archive.selected.value.has(row.id),
  )
}

function selectPage(): void {
  archive.selectAll(visibleRows.value.map((one) => one.id))
}

defineExpose({ reload })

// 换源要清多选；搜索词与重拉由 usePointList 自己管
watch(
  sourceId,
  () => {
    archive.clearSelection()
    detail.value = null
  },
  { immediate: true },
)

watch(
  () => [list.pager.value.page, list.pager.value.size, keyword.value],
  () => archive.clearSelection(),
)
watch(list.items, (rows) => {
  const ids = new Set(rows.map((row) => row.id))
  archive.selected.value = new Set(
    [...archive.selected.value].filter((id) => ids.has(id)),
  )
})
</script>

<template>
  <DtCard icon="table" title="已导入节点" class="flex min-h-0 flex-col">
    <template #actions>
      <DtTag v-if="hasPoints" size="sm">
        {{ list.total.value }}
      </DtTag>
    </template>

    <div class="flex min-h-0 flex-1 flex-col gap-3">
      <NodeTableNotices
        :source="source"
        :is-connected="live.isConnected.value"
      />

      <BatchActionBar
        v-if="hasSelection"
        :count="archive.selectedCount.value"
        :busy="archive.batchBusy.value"
        @edit="openBatchEdit"
        @batch="archive.batchArchive"
        @remove="batchRemoval.ask([...archive.selected.value])"
        @clear="archive.clearSelection"
      />

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="visibleRows"
        :loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        :empty="filteredEmpty"
        :layout="{
          minWidth: '83rem',
          fixedLayout: true,
          cardColumns: 4,
          cardMinWidth: '18rem',
        }"
        @update:page="list.goToPage"
        @update:size="list.setSize"
        @retry="list.reload()"
      >
        <template #toolbar>
          <DtSelect
            v-model="statusFilter"
            :options="POINT_STATUS_OPTIONS"
            aria-label="本页点位状态"
            size="sm"
          />
          <NodeTableToolbar
            v-model:keyword="keyword"
            :has-rows="hasRows"
            :exporting="editing.exporting.value"
            @search="list.reloadFromFirstPage()"
            @select-page="selectPage"
            @create="editing.openCreate"
            @import-csv="editing.importOpen.value = true"
            @export-csv="editing.exportCsv(source.code)"
          />
        </template>

        <template #summary
          >共 {{ list.total.value }} 个点位 · 本页显示
          {{ visibleRows.length }} / {{ list.items.value.length }}</template
        >

        <template #card="{ row }">
          <PointCard
            :point="row"
            :sample="live.samples.value.get(row.node_key)"
            :stale="
              !live.isConnected.value ||
              live.staleKeys.value.has(row.node_key) ||
              source.runtime.state !== 'online'
            "
            :selected="archive.selected.value.has(row.id)"
            :archive-busy="archive.rowBusy.value.has(row.id)"
            :can-write="source.protocol === 'opcua'"
            :error="archive.failures.value.get(row.id)"
            @detail="detail = row"
            @select="archive.toggleSelect(row.id, $event)"
            @archive="archive.toggleArchive(row, $event)"
            @write="editing.openWrite(row)"
            @edit="editing.openEdit(row)"
            @remove="removal.ask(row)"
          />
        </template>

        <template #cell-select="{ row }">
          <DtCheckbox
            :model-value="archive.selected.value.has(row.id)"
            :aria-label="`选择 ${row.name}`"
            @update:model-value="archive.toggleSelect(row.id, $event)"
          />
        </template>

        <!-- ⚠ 这三个单元格的 `block` 不能省：`truncate` 是
             `overflow/text-overflow/white-space` 三件套，而它们对行内盒不生效。
             表格开着 fixedLayout、单元格不再被内容撑开，不截就直接压到相邻列上 -->
        <template #cell-name="{ row }">
          <DtButton
            variant="ghost"
            size="sm"
            class="max-w-full"
            :title="row.name"
            @click="detail = row"
          >
            <span class="block truncate">
              {{ row.name }}
            </span>
          </DtButton>
          <span
            v-if="archive.failures.value.has(row.id)"
            class="block text-xs text-state-danger"
          >
            {{ archive.failures.value.get(row.id) }}
          </span>
        </template>

        <template #cell-code="{ row }">
          <DtTag mono size="sm" class="max-w-full truncate">
            {{ row.code }}
          </DtTag>
        </template>

        <!-- ⚠ 寻址串一律单行截断，绝不换行：它没有空格，换行只能按字符断
             （`break-all`），一条 76 字符的寻址串会把行撑到 200px 以上，一屏就只
             剩两三行。完整值挂在 title 上，卡片视图里也摆得下 -->
        <template #cell-address="{ row }">
          <span class="block truncate font-mono text-xs" :title="row.address">
            {{ row.address }}
          </span>
        </template>

        <template #cell-type="{ row }">
          <span class="text-xs text-text-secondary">
            {{ row.data_type }}
          </span>
        </template>

        <template #cell-unit="{ row }">
          <span class="text-xs text-text-secondary">
            {{ row.unit ?? '—' }}
          </span>
        </template>

        <template #cell-value="{ row }">
          <PointValueCell
            :sample="live.samples.value.get(row.node_key)"
            :unit="row.unit"
            :stale="
              !live.isConnected.value ||
              live.staleKeys.value.has(row.node_key) ||
              source.runtime.state !== 'online'
            "
          />
        </template>

        <!-- 记录历史开关置灰而非消失（无改点位权限时）：整列藏掉会被误当成
             「不支持归档」 -->
        <template #cell-archive="{ row }">
          <DtSwitch
            size="sm"
            :model-value="row.archive_enabled"
            :disabled="archive.rowBusy.value.has(row.id) || !canManage"
            :aria-label="
              row.archive_enabled
                ? `正在记录历史：${row.name}`
                : `未记录历史：${row.name}`
            "
            @update:model-value="archive.toggleArchive(row, $event)"
          />
        </template>

        <template #cell-actions="{ row }">
          <div class="flex items-center justify-end gap-1">
            <PermGuard
              v-if="source.protocol === 'opcua'"
              :codes="[PERMISSION_CODES.collectOperate]"
            >
              <DtButton
                variant="ghost"
                size="sm"
                @click="editing.openWrite(row)"
              >
                写值
              </DtButton>
            </PermGuard>
            <PermGuard :codes="[PERMISSION_CODES.collectManage]">
              <DtButton
                variant="ghost"
                size="sm"
                icon="settings-2"
                aria-label="点位设置（记录历史 / 死区 / 心跳 / 保留期）"
                @click="editing.openEdit(row)"
              />
              <DtButton
                variant="ghost"
                size="sm"
                icon="trash"
                intent="danger"
                aria-label="删除点位"
                @click="removal.ask(row)"
              />
            </PermGuard>
          </div>
        </template>
      </DtDataView>
    </div>

    <BatchEditDialog
      v-if="batchEditing"
      :points="batchEditing"
      @close="batchEditing = null"
      @saved="list.reload()"
    />
    <PointDetailDialog
      :point="detail"
      :sample="detailSample"
      :stale="detailStale"
      @close="detail = null"
    />

    <PointFormDialog
      v-model="editing.formOpen.value"
      :point="editing.editing.value"
      :protocol="source.protocol"
      @create="editing.create"
      @update="editing.update"
    />

    <WriteValueDialog
      v-model="editing.writeOpen.value"
      :point="editing.writing.value"
      :sample="writeSample"
      :busy="editing.writeBusy.value"
      @write="editing.write"
    />

    <ImportPointsDialog
      v-model="editing.importOpen.value"
      :source-id="source.id"
      @imported="afterImport"
    />

    <ForceDeleteDialog
      v-model="removal.open.value"
      title="删除点位"
      :name="removal.target.value?.name"
      message="它已归档的历史会保留，按编码存放。此操作不可撤销。"
      :conflict="removal.conflict.value"
      :loading="removal.busy.value"
      @confirm="removal.confirm"
    />

    <ForceDeleteDialog
      v-model="batchRemoval.open.value"
      title="批量删除点位"
      :name="batchDeleteName"
      message="它们已归档的历史会保留，按编码存放。此操作不可撤销。"
      :conflict="batchRemoval.conflict.value"
      :loading="batchRemoval.busy.value"
      @confirm="batchRemoval.confirm"
    />
  </DtCard>
</template>
