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
 * 多选与记录历史开关的口径在 `useArchiveOps`，两级删除在 `useForceDelete`。
 */
import { computed, ref, watch } from 'vue'
import type { CollectPoint, CollectSource } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtCard,
  DtCheckbox,
  DtDataView,
  DtNotice,
  DtSwitch,
  DtTag,
} from '@dt/ui'

import * as collect from '@/api/collect'
import PermGuard from '@/components/PermGuard.vue'
import { useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { useAuthStore } from '@/stores/auth'
import { nodeTableColumns } from '../nodeTableColumns'
import { useArchiveOps } from '../useArchiveOps'
import { useForceDelete } from '../useForceDelete'
import { useLiveValues } from '../useLiveValues'
import { usePointEditing } from '../usePointEditing'
import { usePointOps } from '../usePointOps'
import BatchArchiveBar from './BatchArchiveBar.vue'
import ForceDeleteDialog from './ForceDeleteDialog.vue'
import ImportPointsDialog from './ImportPointsDialog.vue'
import NodeTableToolbar from './NodeTableToolbar.vue'
import PointFormDialog from './PointFormDialog.vue'
import PointValueCell from './PointValueCell.vue'
import WriteValueDialog from './WriteValueDialog.vue'

const props = defineProps<{ source: CollectSource }>()

const auth = useAuthStore()
const canManage = computed(() =>
  auth.can([PERMISSION_CODES.collectManage], 'all'),
)

const COLUMNS = computed(() => nodeTableColumns(canManage.value))

const sourceId = computed(() => props.source.id)
const keyword = ref('')
const view = useViewMode('collect-points')

const list = useAsyncList<CollectPoint>((query) =>
  collect.listPoints({
    sourceId: sourceId.value,
    q: keyword.value || undefined,
    ...query,
  }),
)

const live = useLiveValues(sourceId)
const ops = usePointOps(() => sourceId.value)
const editing = usePointEditing(ops, () => list.reload())
const archive = useArchiveOps(() => list.reload())
const removal = useForceDelete<CollectPoint>(
  (point, force) => collect.deletePoint(point.id, force),
  (_point, message) => `${message}。强制删除会让那些大屏上的绑定就此失效。`,
  () => list.reload(),
)

/** 配的点位比实时推送的上限多，超出的那些没有实时值。 */
const isTruncated = computed(
  () => props.source.point_count > props.source.live_point_limit,
)

const hasPoints = computed(() => list.total.value > 0)
const hasRows = computed(() => list.items.value.length > 0)
const hasSelection = computed(() => archive.selectedCount.value > 0)

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

function selectPage(): void {
  archive.selectAll(list.items.value.map((one) => one.id))
}

defineExpose({ reload })

// 换源：清空搜索与多选、回到第 1 页重拉
watch(
  sourceId,
  () => {
    keyword.value = ''
    archive.clearSelection()
    void list.reloadFromFirstPage()
  },
  { immediate: true },
)

watch(list.items, () => archive.clearSelection())
</script>

<template>
  <DtCard icon="table" title="已导入节点" class="flex min-h-0 flex-col">
    <template #actions>
      <DtTag v-if="hasPoints" size="sm">
        {{ list.total.value }}
      </DtTag>
    </template>

    <div class="flex min-h-0 flex-1 flex-col gap-3">
      <DtNotice
        v-if="!live.isConnected.value"
        intent="warning"
        icon="alert-triangle"
      >
        实时通道未连接，下面的「实时值」可能不是现值。
      </DtNotice>

      <DtNotice v-if="isTruncated" intent="info" icon="alert-circle">
        这个数据源配了 {{ source.point_count }} 个点位，实时值只覆盖按编码升序
        的前 {{ source.live_point_limit }} 个；其余点位照常采集与归档，只是这
        一页看不到它们的现值。
      </DtNotice>

      <BatchArchiveBar
        v-if="hasSelection"
        :count="archive.selectedCount.value"
        :busy="archive.batchBusy.value"
        @batch="archive.batchArchive"
        @clear="archive.clearSelection"
      />

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="list.items.value"
        :loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        :empty="{
          title: '尚未导入点位',
          hint: '在左侧浏览树中勾选变量节点并导入，或用 CSV 批量导入。',
        }"
        :layout="{ minWidth: '64rem', cardColumns: 3, cardMinWidth: '22rem' }"
        @update:page="list.goToPage"
        @update:size="list.setSize"
        @retry="list.reload()"
      >
        <template #toolbar>
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

        <template #summary>共 {{ list.total.value }} 个点位</template>

        <template #cell-select="{ row }">
          <DtCheckbox
            :model-value="archive.selected.value.has(row.id)"
            :aria-label="`选择 ${row.name}`"
            @update:model-value="archive.toggleSelect(row.id, $event)"
          />
        </template>

        <template #cell-name="{ row }">
          <span class="truncate" :title="row.name">{{ row.name }}</span>
        </template>

        <template #cell-code="{ row }">
          <DtTag mono size="sm">{{ row.code }}</DtTag>
        </template>

        <template #cell-address="{ row }">
          <span class="break-all font-mono text-xs" :title="row.address">
            {{ row.address }}
          </span>
        </template>

        <template #cell-type="{ row }">
          <span class="text-xs text-text-secondary">{{ row.data_type }}</span>
        </template>

        <template #cell-unit="{ row }">
          <span class="text-xs text-text-secondary">{{ row.unit ?? '—' }}</span>
        </template>

        <template #cell-value="{ row }">
          <PointValueCell
            :sample="live.samples.value.get(row.node_key)"
            :unit="row.unit"
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
            <PermGuard :codes="[PERMISSION_CODES.collectOperate]">
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

    <PointFormDialog
      v-model="editing.formOpen.value"
      :point="editing.editing.value"
      @create="editing.create"
      @update="editing.update"
    />

    <WriteValueDialog
      v-model="editing.writeOpen.value"
      :point="editing.writing.value"
      :sample="writeSample"
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
  </DtCard>
</template>
