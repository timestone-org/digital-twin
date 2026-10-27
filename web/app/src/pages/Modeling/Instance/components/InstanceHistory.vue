<script setup lang="ts">
/** @fileoverview 单个模型的训练历史和可部署版本。 */
import type {
  DtDataColumn,
  ModelingRunSummary,
  ModelingVersionSummary,
} from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView } from '@dt/ui'
import { RouterLink } from 'vue-router'
import PermGuard from '@/components/PermGuard.vue'
import { formatDateTime } from '@/utils/datetime'
import { useViewMode } from '@/composables/useViewMode'
import { runLabel } from '../../scripts/instancePresentation'
const runView = useViewMode('instance-training-history')
const versionView = useViewMode('instance-model-versions')
const props = defineProps<{
  id: string
  runs: ModelingRunSummary[]
  versions: ModelingVersionSummary[]
  totals: { runs: number; versions: number }
  busy: boolean
}>()
const emit = defineEmits<{
  refresh: []
  publish: [run: ModelingRunSummary]
  deploy: [version: ModelingVersionSummary]
}>()
function isPublished(id: string): boolean {
  return props.versions.some((version) => version.run_id === id)
}
const runColumns: readonly DtDataColumn[] = [
  { key: 'created_at', label: '训练时间' },
  { key: 'status', label: '状态' },
  { key: 'error_text', label: '结果说明' },
  { key: 'actions', label: '操作', width: '15rem' },
]
const versionColumns: readonly DtDataColumn[] = [
  { key: 'name', label: '模型版本' },
  { key: 'algo', label: '算法' },
  { key: 'is_servable', label: '版本状态' },
  { key: 'actions', label: '操作', width: '8rem' },
]
</script>
<template>
  <section class="instance-section">
    <div class="instance-heading">
      <div>
        <h2>训练记录</h2>

        <p>
          每次训练保留独立的参数快照与结果。显示最近 20 次，共
          {{ totals.runs }} 次。
        </p>
      </div>

      <DtButton variant="ghost" size="sm" @click="emit('refresh')">
        刷新状态
      </DtButton>
    </div>

    <DtDataView
      v-model:view="runView"
      :fill="false"
      :columns="runColumns"
      :rows="runs"
      :empty="{
        title: '尚未训练',
        hint: '保存参数后，点击页面右上方的开始训练。',
      }"
    >
      <template #cell-created_at="{ row }">
        {{ formatDateTime(row.created_at) }}
      </template>

      <template #cell-error_text="{ row }">{{
        row.error_text || '—'
      }}</template>
      <template #cell-status="{ row }">
        {{ runLabel(row.status) }}
      </template>

      <template #cell-actions="{ row }">
        <div class="flex gap-2">
          <RouterLink :to="`/modeling/pipelines/${id}?run_id=${row.id}`">
            <DtButton size="sm" variant="ghost"> 查看结果 </DtButton>
          </RouterLink>

          <PermGuard :codes="[PERMISSION_CODES.modelingPublish]">
            <DtButton
              v-if="row.status === 'succeeded' && !isPublished(row.id)"
              size="sm"
              :disabled="busy"
              @click="emit('publish', row)"
            >
              发布版本
            </DtButton>
          </PermGuard>
        </div>
      </template>
    </DtDataView>
  </section>

  <section class="instance-section">
    <div class="instance-heading">
      <div>
        <h2>模型版本</h2>

        <p>
          成功训练后发布版本，再创建对外服务。显示最近 20 个版本，共
          {{ totals.versions }} 个。
        </p>
      </div>
    </div>

    <DtDataView
      v-model:view="versionView"
      :fill="false"
      :columns="versionColumns"
      :rows="versions"
      :empty="{
        title: '还没有模型版本',
        hint: '训练成功后，在训练记录中发布模型版本。',
      }"
    >
      <template #cell-name="{ row }">
        {{ row.name }} · v{{ row.version }}
      </template>

      <template #cell-algo="{ row }">{{ row.algo }}</template>
      <template #cell-is_servable="{ row }">
        <span :title="row.unservable_reason ?? ''">
          {{ row.is_servable ? '可部署' : row.unservable_reason || '不可部署' }}
        </span>
      </template>

      <template #cell-actions="{ row }">
        <PermGuard :codes="[PERMISSION_CODES.modelingPublish]">
          <DtButton
            size="sm"
            :disabled="!row.is_servable"
            @click="emit('deploy', row)"
          >
            部署
          </DtButton>
        </PermGuard>
      </template>
    </DtDataView>
  </section>
</template>
<style scoped lang="scss">
.instance-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
}
.instance-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}
h2 {
  font-size: var(--font-size-section);
  font-weight: 600;
}
p {
  color: var(--text-secondary);
  font-size: var(--font-size-compact);
}
</style>
