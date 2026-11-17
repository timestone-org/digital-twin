<script setup lang="ts">
/** @fileoverview 大屏中的最新成功报告：原件、生成时图表与下载。 */
import { computed, defineAsyncComponent } from 'vue'
import { useRoute } from 'vue-router'
import { DtButton, DtDisclosure, DtNotice, DtSpinner } from '@dt/ui'
import { PERMISSION_CODES } from '@dt/contracts'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/datetime'
import { downloadBytes, toFileName } from '@/utils/downloadJson'
import { useLatestReport } from './scripts/useLatestReport'

const props = defineProps<{ templateCode: string; refreshSeconds: number }>()
const route = useRoute()
const auth = useAuthStore()
const allowed = computed(
  () =>
    route.meta.public !== true &&
    auth.can([PERMISSION_CODES.reportView, PERMISSION_CODES.reportRender]),
)
const canDownload = computed(() => auth.can([PERMISSION_CODES.reportRender]))
const state = useLatestReport(
  () => props.templateCode,
  () => props.refreshSeconds,
  () => allowed.value,
)
const DocxPreview = defineAsyncComponent(
  () => import('./components/ReportDocumentPreview.vue'),
)
const current = state.document
const created = computed(() =>
  current.value
    ? formatDateTime(
        current.value.record.finished_at ?? current.value.record.created_at,
      )
    : '',
)
function download(): void {
  if (current.value && canDownload.value)
    downloadBytes(
      current.value.blob,
      `${toFileName(current.value.name)}-${current.value.record.period}.docx`,
    )
}
</script>
<template>
  <div class="report-host">
    <DtNotice v-if="!allowed" intent="info">
      <p>报告需要登录并获得查看、原件读取权限；公开大屏不展示私有报告。</p>
    </DtNotice>
    <template v-else>
      <div class="report-host__toolbar">
        <p v-if="current">
          {{ current.name }} · {{ current.record.period }} · {{ created }}
        </p>
        <p v-else>最新成功报告</p>
        <DtButton
          size="sm"
          variant="ghost"
          :loading="state.loading.value"
          @click="state.reload()"
          ><span>刷新</span></DtButton
        >
        <DtButton v-if="current && canDownload" size="sm" @click="download"
          ><span>下载 Word</span></DtButton
        >
      </div>
      <DtNotice v-if="state.error.value" intent="danger">
        <p>
          {{ state.error.value
          }}{{ current ? '；以下保留上次成功读取的报告。' : '' }}
        </p>
      </DtNotice>
      <DtSpinner v-if="state.loading.value && !current" />
      <p v-else-if="!current && !state.error.value" class="report-host__empty">
        暂无成功生成的报告
      </p>
      <div v-if="current" class="report-host__body">
        <DtDisclosure
          v-if="current.detail.warnings.length"
          :default-open="false"
          :title="`报告提示（${current.detail.warnings.length}）`"
        >
          <p v-for="warning in current.detail.warnings" :key="warning">
            {{ warning }}
          </p>
        </DtDisclosure>
        <DocxPreview :key="current.record.id" :blob="current.blob" />
      </div>
    </template>
  </div>
</template>
<style scoped lang="scss">
.report-host {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  color: var(--text-primary);
}
.report-host__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  font-size: 13px;
  border-bottom: 1px solid var(--border-subtle);
}
.report-host__toolbar > p {
  flex: 1;
  margin: 0;
}
.report-host__body {
  min-height: 0;
  flex: 1;
  overflow: auto;
}
.report-host__empty {
  margin: auto;
  color: var(--text-secondary);
}
</style>
