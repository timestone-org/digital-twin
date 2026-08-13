<script setup lang="ts">
/**
 * @fileoverview 达标预测：每个房间的达标时长模型，建、看、重训、删。
 *
 * ⚠ 训练是异步的：列表上有 queued/training 的行就轮询刷新，全部到终态即停。
 * 轮询定时器在卸载时必须清掉。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { AcModel, Room } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, useConfirm, useToast } from '@dt/ui'

import * as hvac from '@/api/hvac'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import CreateModelDialog from './components/CreateModelDialog.vue'
import ModelTable from './components/ModelTable.vue'
import {
  isModelBusy,
  toModelRows,
  type ModelRow,
} from '@/features/hvac/modelView'

// 训练中列表的刷新间隔
const POLL_INTERVAL_MS = 5000

const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const fetcher = useRacedFetch()

const models = ref<AcModel[]>([])
const rooms = ref<Room[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const isCreating = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const rows = computed(() => toModelRows(models.value))

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
    },
  })
}

async function loadRooms(): Promise<void> {
  try {
    rooms.value = (await hvac.listRooms({ size: 200 })).items
  } catch {
    // 房间列表只服务新建对话框；拿不到时对话框里自然是空的
    rooms.value = []
  }
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
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.acManage]">
        <DtButton intent="primary" size="sm" @click="isCreating = true">
          新建模型
        </DtButton>
      </PermGuard>
    </template>

    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-3">
      <ModelTable
        :rows="rows"
        :loading="loading"
        :error="error"
        @open="open"
        @retrain="retrain"
        @remove="remove"
        @retry="load"
      />
    </div>

    <CreateModelDialog
      :open="isCreating"
      :rooms="rooms"
      @close="isCreating = false"
      @created="onCreated"
    />
  </AppShell>
</template>
