<script setup lang="ts">
/**
 * @fileoverview 一个数据源下的点位表：配置 + 实时读写 + 批量导入导出。
 *
 * ⚠ 实时值来自 WS 主题 `collect:{sourceId}`，**不是**这张表自己轮询出来的：
 * 首帧由 publisher 补全量，之后只推变化的那些（COLLECT_DESIGN §9）。
 * 通道断了要在界面上说出来——不说的话，最后一批值会一直挂着冒充现值。
 *
 * ⚠ 「配了多少个点位」与「实时值覆盖多少个」不是一回事：推送按编码升序取前
 * `live_point_limit` 个，超出的那些只有配置没有实时值。这条必须写在界面上，
 * 否则用户会以为那些点位坏了。
 */
import { computed, onMounted, ref } from 'vue'
import type {
  CollectPoint,
  CollectPointItemInput,
  CollectPointUpdateInput,
  CollectSource,
  DtDataColumn,
} from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtIcon, DtInput, DtNotice, DtTag } from '@dt/ui'

import * as collect from '@/api/collect'
import PermGuard from '@/components/PermGuard.vue'
import { useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { useLiveValues } from '../useLiveValues'
import { usePointOps } from '../usePointOps'
import ImportPointsDialog from './ImportPointsDialog.vue'
import PointFormDialog from './PointFormDialog.vue'
import PointValueCell from './PointValueCell.vue'
import WriteValueDialog from './WriteValueDialog.vue'

const props = defineProps<{ source: CollectSource }>()

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'code', label: '编码', width: '12rem', card: 'title' },
  { key: 'name', label: '名称', width: '12rem' },
  { key: 'address', label: '寻址串' },
  { key: 'value', label: '当前值', width: '13rem', card: 'meta' },
  { key: 'archive', label: '归档', width: '8rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '13rem',
    card: 'actions',
  },
]

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

const formOpen = ref(false)
const editing = ref<CollectPoint | null>(null)
const presetAddress = ref<string | undefined>(undefined)

const writeOpen = ref(false)
const writing = ref<CollectPoint | null>(null)

const importOpen = ref(false)
const isExporting = ref(false)

/** 配的点位比实时推送的上限多，超出的那些没有实时值。 */
const isTruncated = computed(
  () => props.source.point_count > props.source.live_point_limit,
)

const writeSample = computed(() =>
  writing.value === null
    ? undefined
    : live.samples.value.get(writing.value.node_key),
)

function openCreate(): void {
  editing.value = null
  presetAddress.value = undefined
  formOpen.value = true
}

function openEdit(point: CollectPoint): void {
  editing.value = point
  presetAddress.value = undefined
  formOpen.value = true
}

function openWrite(point: CollectPoint): void {
  writing.value = point
  writeOpen.value = true
}

async function create(item: CollectPointItemInput): Promise<void> {
  if (!(await ops.create(item))) return
  formOpen.value = false
  await list.reload()
}

async function update(input: CollectPointUpdateInput): Promise<void> {
  const target = editing.value
  if (target === null) return
  if (!(await ops.update(target.id, input))) return
  formOpen.value = false
  await list.reload()
}

async function remove(point: CollectPoint): Promise<void> {
  if (await ops.remove(point)) await list.reload()
}

async function write(payload: { value: unknown; key: string }): Promise<void> {
  const target = writing.value
  if (target === null) return
  if (await ops.write(target, payload)) writeOpen.value = false
}

async function exportCsv(): Promise<void> {
  if (isExporting.value) return
  isExporting.value = true
  try {
    await ops.exportCsv(props.source.code)
  } finally {
    isExporting.value = false
  }
}

async function afterImport(): Promise<void> {
  await list.reload()
}

onMounted(() => {
  void list.reload()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <DtNotice v-if="!live.isConnected.value" intent="warning" icon="alert-triangle">
      实时通道未连接，下面的「当前值」可能不是现值。
    </DtNotice>

    <DtNotice v-if="isTruncated" intent="info" icon="alert-circle">
      这个数据源配了 {{ source.point_count }} 个点位，实时值只覆盖按编码升序的前
      {{ source.live_point_limit }} 个；其余点位照常采集与归档，只是这一页看不到
      它们的现值。
    </DtNotice>

    <DtDataView
      v-model:view="view"
      class="min-h-0 flex-1"
      :columns="COLUMNS"
      :rows="list.items.value"
      :loading="list.loading.value"
      :error="list.error.value"
      :pagination="list.pager.value"
      :empty="{
        title: '还没有点位',
        hint: '可以从地址空间挑，也可以用 CSV 批量导入。',
      }"
      :layout="{ minWidth: '72rem', cardColumns: 3, cardMinWidth: '22rem' }"
      @update:page="list.goToPage"
      @update:size="list.setSize"
      @retry="list.reload()"
    >
      <template #toolbar>
        <DtInput
          v-model="keyword"
          class="w-64"
          size="sm"
          placeholder="搜索编码或名称"
          @enter="list.reloadFromFirstPage()"
        >
          <template #leading><DtIcon name="search" :size="14" /></template>
        </DtInput>
        <DtButton
          variant="outline"
          size="sm"
          @click="list.reloadFromFirstPage()"
        >
          查询
        </DtButton>
        <PermGuard :codes="[PERMISSION_CODES.collectManage]">
          <DtButton size="sm" icon="plus" @click="openCreate">新建点位</DtButton>
          <DtButton
            variant="outline"
            size="sm"
            icon="upload"
            @click="importOpen = true"
          >
            批量导入
          </DtButton>
        </PermGuard>
        <DtButton
          variant="outline"
          size="sm"
          icon="download"
          :loading="isExporting"
          @click="exportCsv"
        >
          导出 CSV
        </DtButton>
      </template>

      <template #summary>共 {{ list.total.value }} 个点位</template>

      <template #cell-code="{ row }">
        <DtTag mono size="sm">{{ row.code }}</DtTag>
      </template>

      <template #cell-name="{ row }">
        <span class="truncate">{{ row.name }}</span>
      </template>

      <template #cell-address="{ row }">
        <span class="font-mono text-xs break-all">{{ row.address }}</span>
      </template>

      <template #cell-value="{ row }">
        <PointValueCell
          :sample="live.samples.value.get(row.node_key)"
          :unit="row.unit"
        />
      </template>

      <template #cell-archive="{ row }">
        <DtTag :intent="row.archive_enabled ? 'success' : 'neutral'" size="sm">
          {{ row.archive_enabled ? '归档' : '不归档' }}
        </DtTag>
      </template>

      <template #cell-actions="{ row }">
        <div class="flex items-center justify-end gap-1">
          <PermGuard :codes="[PERMISSION_CODES.collectOperate]">
            <DtButton variant="ghost" size="sm" @click="openWrite(row)">
              写值
            </DtButton>
          </PermGuard>
          <PermGuard :codes="[PERMISSION_CODES.collectManage]">
            <DtButton variant="ghost" size="sm" @click="openEdit(row)">
              编辑
            </DtButton>
            <DtButton
              variant="ghost"
              size="sm"
              intent="danger"
              @click="remove(row)"
            >
              删除
            </DtButton>
          </PermGuard>
        </div>
      </template>
    </DtDataView>

    <PointFormDialog
      v-model="formOpen"
      :point="editing"
      :preset-address="presetAddress"
      @create="create"
      @update="update"
    />

    <WriteValueDialog
      v-model="writeOpen"
      :point="writing"
      :sample="writeSample"
      @write="write"
    />

    <ImportPointsDialog
      v-model="importOpen"
      :source-id="source.id"
      @imported="afterImport"
    />
  </div>
</template>
