<script setup lang="ts">
/** @fileoverview 生成记录、状态轮询、产物下载与警告。 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { DtButton, DtDataView, DtModal, DtNotice, DtTag } from '@dt/ui'
import type { DtDataColumn, ReportRender } from '@dt/contracts'
import * as api from '@/api/reports'
import { AppShell } from '@/components/layout'
import PermGuard from '@/components/PermGuard.vue'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { describeError } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { downloadBytes } from '@/utils/downloadJson'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'period', label: '报告期', card: 'title' },
  { key: 'status', label: '状态' },
  { key: 'warnings', label: '提示' },
  { key: 'actions', label: '操作', card: 'actions' },
]
const rows = ref<ReportRender[]>([])
const next = ref<string | null>(null)
const current = ref<string | undefined>(undefined)
const error = ref<string | null>(null)
const loading = ref(false)
const selected = ref<ReportRender | null>(null)
const view = useViewMode('report-renders')
const raced = useRacedFetch()
const active = computed(() =>
  rows.value.some(
    (row) => row.status === 'pending' || row.status === 'running',
  ),
)
const labels = {
  pending: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
}
let timer: ReturnType<typeof setInterval> | undefined
async function reload(after = current.value): Promise<void> {
  loading.value = true
  current.value = after
  await raced.run(() => api.listReportRenders(after), {
    ok: (page) => {
      rows.value = page.items
      next.value = page.next
    },
    fail: (caught) => {
      error.value = describeError(caught)
    },
    settled: () => {
      loading.value = false
    },
  })
}
onMounted(() => {
  void reload()
  timer = setInterval(() => {
    if (active.value) void reload()
  }, 2000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  raced.cancel()
})
async function latest(): Promise<void> {
  current.value = undefined
  await reload()
}
async function download(id: string): Promise<void> {
  try {
    downloadBytes(await api.downloadReport(id), `report-${id}.docx`)
  } catch (caught) {
    error.value = describeError(caught)
  }
}
</script>
<template>
  <AppShell
    title="报告生成记录"
    back-to="/reports"
    subtitle="任务状态与 Word 产物"
  >
    <template #actions>
      <RouterLink to="/reports">
        <DtButton variant="ghost" size="sm" icon="table">报告模板</DtButton>
      </RouterLink>
      <DtButton
        size="sm"
        icon="refresh-cw"
        :loading="loading"
        @click="reload()"
      >
        刷新
      </DtButton>
    </template>
    <div class="flex h-full min-h-0 flex-col gap-3">
      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="rows"
        :loading="loading"
        :error="error"
        :empty="{
          title: '还没有生成记录',
          hint: '从报告编辑页选择报告期并生成后，任务状态与 Word 产物会显示在这里。',
        }"
      >
        <template #cell-period="{ row }">{{
          row.kind === 'import' ? 'Word 导入' : row.period
        }}</template>
        <template #cell-status="{ row }">
          <DtTag
            :intent="
              row.status === 'succeeded'
                ? 'success'
                : row.status === 'failed'
                  ? 'danger'
                  : 'info'
            "
          >
            {{ labels[row.status] }}
          </DtTag>
        </template>
        <template #cell-warnings="{ row }">
          <DtButton
            variant="ghost"
            size="sm"
            icon="activity"
            @click="selected = row"
            >{{ row.error || `${row.warnings.length} 条提示` }}</DtButton
          >
        </template>
        <template #cell-actions="{ row }">
          <PermGuard :codes="['report:render']">
            <DtButton
              v-if="row.status === 'succeeded' && row.kind === 'render'"
              size="sm"
              icon="download"
              @click="download(row.id)"
            >
              下载 Word
            </DtButton>
          </PermGuard>
        </template>
      </DtDataView>
      <div class="flex gap-2">
        <DtButton
          size="sm"
          variant="ghost"
          :disabled="!current"
          @click="latest"
        >
          最新记录
        </DtButton>
        <DtButton
          size="sm"
          :disabled="!next"
          @click="reload(next ?? undefined)"
        >
          下一页
        </DtButton>
      </div>
    </div>
    <DtModal
      :model-value="selected !== null"
      title="生成提示"
      @update:model-value="selected = null"
    >
      <DtNotice v-if="selected?.error" intent="danger">{{
        selected.error
      }}</DtNotice>
      <p v-for="warning in selected?.warnings" :key="warning">
        {{ warning }}
      </p>
      <p v-if="!selected?.warnings.length && !selected?.error">
        没有生成警告。
      </p>
    </DtModal>
  </AppShell>
</template>
