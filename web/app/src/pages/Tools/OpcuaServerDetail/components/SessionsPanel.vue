<script setup lang="ts">
/**
 * @fileoverview 在线上位机会话。
 *
 * ⚠ 契约里**没有令牌类型**字段（匿名 / 用户名 / 证书），所以这里不展示它——
 * 编一个显示出来比不显示更糟。要展示得先扩 opcua-server 的 SessionOut。
 * ⚠ 会话数会变，所以这一页也轮询；卸载必须清掉定时器。
 *
 * 列表用 `DtDataView` 而不是裸 `DtTable`：与系统管理各页同一套工具条、
 * 空态与表格/卡片切换，两处长得不一样才是需要解释的那个。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import type { DtDataColumn, OpcuaInstance, OpcuaSession } from '@dt/contracts'
import { DtDataView, DtNotice } from '@dt/ui'

import * as opcua from '@/api/opcua'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useViewMode } from '@/composables/useViewMode'

const props = defineProps<{ instance: OpcuaInstance }>()

const SESSION_POLL_MS = 5000

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'peer', label: '对端地址', card: 'title' },
  { key: 'username', label: '用户名', card: 'meta' },
  { key: 'connected_at', label: '连接时长', width: '10rem' },
]

const sessions = ref<OpcuaSession[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const now = ref(Date.now())
const view = useViewMode('tools-opcua-sessions')
const raced = useRacedFetch()
let timer: ReturnType<typeof setInterval> | null = null

async function load(): Promise<void> {
  loading.value = true
  await raced.run(() => opcua.listSessions(props.instance.id), {
    ok: (result) => {
      sessions.value = result
      error.value = null
      now.value = Date.now()
    },
    fail: (caught) => {
      error.value = describeError(caught)
      sessions.value = []
    },
    settled: () => (loading.value = false),
  })
}

/** 连接时长。不足一分钟按秒显示，否则按分钟。 */
function since(connectedAt: string): string {
  const started = Date.parse(connectedAt)
  if (Number.isNaN(started)) return '—'
  const seconds = Math.max(0, Math.floor((now.value - started) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

const rows = computed(() =>
  sessions.value.map((session) => ({ id: session.session_id, ...session })),
)

onMounted(() => {
  void load()
  timer = setInterval(() => void load(), SESSION_POLL_MS)
})

// ⚠ 一个都不许漏：这一页在运维屏上会一直开着
onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer)
  timer = null
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <DtNotice
      v-if="!props.instance.is_running"
      intent="info"
      icon="alert-circle"
    >
      实例未运行，不会有任何上位机会话。
    </DtNotice>

    <DtDataView
      v-model:view="view"
      class="min-h-0 flex-1"
      :columns="COLUMNS"
      :rows="rows"
      :loading="loading && rows.length === 0"
      :error="error"
      :layout="{ minWidth: '40rem', cardColumns: 3, cardMinWidth: '18rem' }"
      :empty="{
        title: '当前没有上位机连接',
        hint: '上位机连上后会出现在这里',
      }"
      @retry="load()"
    >
      <template #summary>
        共 {{ rows.length }} 个会话 · 每 {{ SESSION_POLL_MS / 1000 }} 秒自动刷新
      </template>

      <template #cell-peer="{ row }">
        <span class="font-mono text-xs">{{ row.peer }}</span>
      </template>
      <template #cell-username="{ row }">
        <span>{{ row.username ?? '匿名' }}</span>
      </template>
      <template #cell-connected_at="{ row }">
        <span>{{ since(row.connected_at) }}</span>
      </template>
    </DtDataView>
  </div>
</template>
