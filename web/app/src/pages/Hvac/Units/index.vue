<script setup lang="ts">
/**
 * @fileoverview 空调台账：全场空调的建档、改名、改房间与检索。
 *
 * 这一页是一台一台的明细；「谁跟谁在同一个房间」看「空间配置」页。
 * ⚠ 建档必须先有车间与房间——空调不允许处于没有归属的中间态，后端
 * `room_id` NOT NULL。空间本身在「空间配置」页维护，这里只选不建。
 */
import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { AcUnit, DtDataColumn } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtDataView,
  DtNotice,
  DtTag,
  useConfirm,
  useToast,
} from '@dt/ui'

import * as hvac from '@/api/hvac'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { useLocationPicker } from '@/features/hvac/useLocationPicker'
import { formatDateTime } from '@/utils/datetime'
import AcUnitFormDialog from './components/AcUnitFormDialog.vue'
import AcUnitRowActions from './components/AcUnitRowActions.vue'
import UnitFilters from './components/UnitFilters.vue'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'serial', label: '序号', width: '12rem', card: 'title' },
  { key: 'name', label: '名称', width: '14rem', card: 'meta' },
  { key: 'location', label: '所属位置' },
  { key: 'created_at', label: '建档时间', width: '12rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '7rem',
    card: 'actions',
  },
]

const EMPTY = {
  title: '还没有空调',
  hint: '先在「空间配置」建好车间与房间，再来这里逐台建档。',
}

// 边打字边发请求会把一次输入变成七八次查询，而结果只有最后一次有用
const SEARCH_DEBOUNCE_MS = 300

const toast = useToast()
const confirm = useConfirm()
const view = useViewMode('hvac-units', 'table')
const {
  workshopId,
  roomId,
  workshopOptions,
  roomOptions,
  loadWorkshops,
  error: pickerError,
} = useLocationPicker('全部')

const keyword = ref('')
const editing = ref<AcUnit | null>(null)
const isFormOpen = ref(false)

const list = useAsyncList<AcUnit>((query) =>
  hvac.listAcUnits({
    ...query,
    q: keyword.value || undefined,
    workshop_id: workshopId.value || undefined,
    room_id: roomId.value || undefined,
  }),
)

// ⚠ 定时器必须在卸载时清掉：页面切走后它照样会到点触发，对着已卸载的组件
// 写状态，而这既不报错也不显形，只是偶发地多发一次上一页的请求。
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(keyword, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void list.reloadFromFirstPage()
  }, SEARCH_DEBOUNCE_MS)
})
onUnmounted(() => {
  clearTimeout(searchTimer)
})

watch([workshopId, roomId], () => {
  void list.reloadFromFirstPage()
})

function openCreate(): void {
  editing.value = null
  isFormOpen.value = true
}

function openEdit(unit: AcUnit): void {
  editing.value = unit
  isFormOpen.value = true
}

async function afterWrite(message: string): Promise<void> {
  toast.success(message)
  await list.reload()
}

async function removeUnit(unit: AcUnit): Promise<void> {
  const confirmed = await confirm.ask({
    title: '删除空调',
    message: `将从台账中删除「${unit.serial} · ${unit.name}」，且不可恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!confirmed) return
  try {
    await hvac.deleteAcUnit(unit.id)
    await afterWrite('空调已删除')
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

onMounted(() => {
  void loadWorkshops()
  void list.reload()
})
</script>

<template>
  <AppShell title="空调台账" subtitle="全场空调的建档与检索">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.acManage]">
        <DtButton size="sm" icon="plus" @click="openCreate">新建空调</DtButton>
      </PermGuard>
    </template>

    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtNotice v-if="pickerError" intent="danger">{{ pickerError }}</DtNotice>

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="list.items.value"
        :loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        :empty="EMPTY"
        :layout="{ minWidth: '52rem', cardColumns: 3, cardMinWidth: '18rem' }"
        @update:page="list.goToPage"
        @update:size="list.setSize"
        @retry="list.reload()"
      >
        <template #toolbar>
          <UnitFilters
            :keyword="keyword"
            :workshop-id="workshopId"
            :room-id="roomId"
            :workshop-options="workshopOptions"
            :room-options="roomOptions"
            @update:keyword="keyword = $event"
            @update:workshop-id="workshopId = $event"
            @update:room-id="roomId = $event"
          />
        </template>

        <template #summary>共 {{ list.total.value }} 台</template>

        <template #cell-serial="{ row }">
          <DtTag mono size="sm">{{ row.serial }}</DtTag>
        </template>

        <template #cell-name="{ row }">
          <span class="truncate">{{ row.name }}</span>
        </template>

        <template #cell-location="{ row }">
          <span class="truncate text-secondary">
            {{ row.workshop.name }} · {{ row.room.name }}
          </span>
        </template>

        <template #cell-created_at="{ row }">
          {{ formatDateTime(row.created_at) }}
        </template>

        <template #cell-actions="{ row }">
          <AcUnitRowActions
            :unit="row"
            @edit="openEdit($event)"
            @remove="removeUnit($event)"
          />
        </template>
      </DtDataView>
    </div>

    <AcUnitFormDialog
      v-model="isFormOpen"
      :unit="editing"
      @saved="afterWrite($event)"
    />
  </AppShell>
</template>
