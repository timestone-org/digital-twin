<script setup lang="ts">
/**
 * @fileoverview 达标预测：左选房间、右看该房间的模型，建、看、重训、删。
 *
 * ⚠ 训练是异步的：列表上有 queued/training 的行就轮询刷新，全部到终态即停。
 * 轮询只替换模型数组，**不许顺带重置左栏选中或表格排序态**。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { AcModel, DtTableSort, Room } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtEmpty, useConfirm, useToast } from '@dt/ui'

import * as hvac from '@/api/hvac'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useViewMode } from '@/composables/useViewMode'
import CreateModelDialog from './components/CreateModelDialog.vue'
import ModelTable from './components/ModelTable.vue'
import RoomSidebar from './components/RoomSidebar.vue'
import { buildRoomListing, resolveRoomId } from './roomGroups'
import {
  isModelBusy,
  sortModelRows,
  toModelRows,
  type ModelRow,
} from '@/features/hvac/modelView'

// 训练中列表的刷新间隔
const POLL_INTERVAL_MS = 5000

const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const fetcher = useRacedFetch()
const view = useViewMode('hvac-models')

const models = ref<AcModel[]>([])
const rooms = ref<Room[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const isCreating = ref(false)
const roomId = ref('')
const sort = ref<DtTableSort | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

const listing = computed(() => buildRoomListing(rooms.value, models.value))
const current = computed(
  () =>
    listing.value.entries.find((entry) => entry.id === roomId.value) ?? null,
)
const roomModels = computed(() =>
  models.value.filter((model) => model.room.id === roomId.value),
)
const rows = computed<ModelRow[]>(() =>
  sortModelRows(toModelRows(roomModels.value), sort.value),
)
// ⚠ 只有还挂着空调的房间才预填：左栏为了保住历史模型也收没有空调的房间，
// 而新建对话框的房间选择器只列有空调的，预填一个不在选项里的 id 会让它显示空白
const createRoomId = computed(() =>
  (current.value?.acUnitCount ?? 0) > 0 ? roomId.value : '',
)

// 首次选中要等两条取数都回来：模型数既决定「哪些房间进栏」，也决定兜底选谁
let roomsSettled = false
let modelsSettled = false
let selectionPending = true

onMounted(() => {
  void load()
  void loadRooms()
})

onBeforeUnmount(() => {
  stopPolling()
})

async function load(): Promise<void> {
  loading.value = true
  await fetcher.run(() => hvac.listAcModels(), {
    ok: (items) => {
      models.value = items
      error.value = null
      syncPolling(items)
    },
    fail: (caught) => {
      error.value = describeError(caught)
    },
    settled: () => {
      loading.value = false
      modelsSettled = true
      resolveSelection()
    },
  })
}

async function loadRooms(): Promise<void> {
  try {
    rooms.value = (await hvac.listRooms({ size: 200 })).items
  } catch {
    // 房间列表拿不到时左栏是空态，右区跟着空——不比半份房间更糟
    rooms.value = []
  }
  roomsSettled = true
  resolveSelection()
}

/** 首次落定选中项：地址栏给的那个存在就用它，否则按兜底次序挑一个。 */
function resolveSelection(): void {
  if (!selectionPending || !roomsSettled || !modelsSettled) return
  selectionPending = false
  selectRoom(resolveRoomId(listing.value.entries, wantedRoomId()))
}

/** 地址栏里带来的房间。⚠ 校验要等房间列表到手再做，否则会洗掉深链。 */
function wantedRoomId(): string {
  const raw = route.query['room']
  if (Array.isArray(raw)) return raw[0] ?? ''
  return typeof raw === 'string' ? raw : ''
}

/**
 * 选中一个房间并写回地址栏。
 * ⚠ 用 replace 不用 push：房间是页内筛选不是导航步骤，push 会让后退键把
 * 用户一个一个倒着走过点过的每个房间。
 * @param id 房间 id，空串表示没有可选的房间
 */
function selectRoom(id: string): void {
  roomId.value = id
  if (id === '' || wantedRoomId() === id) return
  void router.replace({ query: { ...route.query, room: id } })
}

/** 有训练中的行才轮询；全部到终态就停，不给后端白打点。 */
function syncPolling(items: readonly AcModel[]): void {
  const busy = items.some(isModelBusy)
  if (busy && pollTimer === null) {
    pollTimer = setInterval(() => {
      void load()
    }, POLL_INTERVAL_MS)
  }
  if (!busy) stopPolling()
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function open(row: ModelRow): void {
  void router.push(`/hvac/models/${row.id}`)
}

async function retrain(row: ModelRow): Promise<void> {
  try {
    await hvac.retrainAcModel(row.id)
    toast.success('重训已排队')
    await load()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

async function remove(row: ModelRow): Promise<void> {
  const accepted = await confirm.ask({
    title: '删除模型',
    message: `「${row.name}」的评估与逐条对比会一并删除，此操作不可恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!accepted) return
  try {
    await hvac.deleteAcModel(row.id)
    toast.success('已删除')
    await load()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

function onCreated(modelId: string): void {
  isCreating.value = false
  toast.success('训练已排队')
  void router.push(`/hvac/models/${modelId}`)
}
</script>

<template>
  <AppShell
    title="达标预测"
    subtitle="给定当前条件与一个运行组合，预测多久达标"
  >
    <!-- 两侧都要 min-h-0，右区还要 min-w-0：少 min-h-0 不是滚动而是把整页撑长，
         而 AppShell 的 main 是 overflow-hidden；少 min-w-0 则宽表格顶破页面横滚 -->
    <div class="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
      <RoomSidebar
        class="max-h-64 shrink-0 lg:max-h-none lg:w-72"
        :entries="listing.entries"
        :hidden-count="listing.hiddenCount"
        :selected="roomId"
        @select="selectRoom"
      />

      <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <template v-if="current">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <h2 class="truncate text-sm font-semibold text-text-primary">
                {{ current.name }}
              </h2>
              <p class="text-xs text-text-secondary">
                {{ current.workshopName }} · {{ current.acUnitCount }} 台空调 ·
                {{ current.modelCount }} 个模型
              </p>
            </div>
            <!-- 建模永远是针对某个房间的，入口贴着房间上下文最不容易选错 -->
            <PermGuard :codes="[PERMISSION_CODES.acManage]">
              <DtButton intent="primary" size="sm" @click="isCreating = true">
                新建模型
              </DtButton>
            </PermGuard>
          </div>

          <ModelTable
            :rows="rows"
            :loading="loading"
            :error="error"
            :sort="sort"
            :view="view"
            @open="open"
            @retrain="retrain"
            @remove="remove"
            @retry="load"
            @update:sort="sort = $event"
            @update:view="view = $event"
          />
        </template>

        <DtEmpty
          v-else
          icon="building"
          title="先配置房间"
          hint="先在空间配置页建车间与房间，并把空调挂到房间上。"
        />
      </div>
    </div>

    <CreateModelDialog
      :open="isCreating"
      :rooms="rooms"
      :room-id="createRoomId"
      @close="isCreating = false"
      @created="onCreated"
    />
  </AppShell>
</template>
