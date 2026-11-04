<script setup lang="ts">
/**
 * @fileoverview 已发布的模型版本一览。
 *
 * ⚠ 「不可用」要**说出原因**：一个版本可能因为算子不支持取数、也可能因为训练那
 * 次的特征列已经不在台账里，两者的补救办法完全不同。
 */
import type {
  DtDataColumn,
  DtDataViewMode,
  ModelingVersionSummary,
} from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import type { DtDataViewSelection, DtPaginationState } from '@dt/ui'
import { DtButton, DtDataView, DtIconButton, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import { formatDateTime } from '@/utils/datetime'
import { taskLabel } from '../../scripts/taskPresentation'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '名称', card: 'title' },
  {
    key: 'version',
    label: '版本',
    width: '5rem',
    align: 'right',
    card: 'meta',
  },
  { key: 'algo', label: '算法', width: '10rem' },
  { key: 'task', label: '模型类型', width: '8rem' },
  { key: 'target_key', label: '目标列', width: '11rem' },
  { key: 'servable', label: '可用于取数', width: '13rem' },
  { key: 'created_at', label: '生成时间', width: '10rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '21rem',
    card: 'actions',
  },
]

const EMPTY = {
  title: '还没有训练模型',
  hint: '成功训练后自动保存可服务模型，可直接发布或绑定公式。',
}

const props = defineProps<{
  rows: readonly ModelingVersionSummary[]
  isLoading: boolean
  error: string | null
  pagination: DtPaginationState
  selection?: DtDataViewSelection<ModelingVersionSummary> | undefined
  actionsDisabled?: boolean | undefined
}>()

const view = defineModel<DtDataViewMode>('view', { required: true })

defineEmits<{
  'update:page': [page: number]
  'update:size': [size: number]
  'update:selectedIds': [ids: string[]]
  detail: [row: ModelingVersionSummary]
  bind: [row: ModelingVersionSummary]
  retire: [row: ModelingVersionSummary]
  rename: [row: ModelingVersionSummary]
  remove: [row: ModelingVersionSummary]
  deploy: [row: ModelingVersionSummary]
}>()
</script>

<template>
  <DtDataView
    v-model:view="view"
    :columns="COLUMNS"
    :rows="props.rows"
    :loading="props.isLoading"
    :error="props.error"
    :empty="EMPTY"
    :pagination="props.pagination"
    :selection="props.selection"
    :layout="{
      fixedLayout: true,
      minWidth: '77rem',
      cardColumns: 3,
      cardMinWidth: '20rem',
    }"
    @update:page="$emit('update:page', $event)"
    @update:size="$emit('update:size', $event)"
    @update:selected-ids="$emit('update:selectedIds', $event)"
  >
    <template #toolbar><slot name="toolbar" /></template>
    <template #cell-name="{ row }">
      <span class="block truncate" :title="row.name">{{ row.name }}</span>
    </template>
    <template #cell-version="{ row }">v{{ row.version }}</template>
    <template #cell-algo="{ row }">
      <code class="dt-ml-versions__code" :title="row.algo">{{ row.algo }}</code>
    </template>
    <template #cell-task="{ row }">{{ taskLabel(row.task) }}</template>
    <template #cell-target_key="{ row }">
      <code class="dt-ml-versions__code" :title="row.target_key ?? undefined">
        {{
          row.target_key ??
          (row.task === 'rule_calculation'
            ? '规则计算（无目标列）'
            : '无监督（无目标列）')
        }}
      </code>
    </template>
    <template #cell-servable="{ row }">
      <DtTag v-if="row.is_servable" intent="success" size="sm">可用</DtTag>
      <span v-else class="dt-ml-versions__why max-w-full">
        <DtTag class="shrink-0" intent="danger" size="sm">不可用</DtTag>
        <span
          class="min-w-0 [overflow-wrap:anywhere]"
          :title="row.unservable_reason ?? ''"
        >
          {{ row.unservable_reason }}
        </span>
      </span>
    </template>
    <template #cell-created_at="{ row }">
      {{ formatDateTime(row.created_at) }}
    </template>
    <template #cell-actions="{ row }">
      <DtIconButton
        icon="eye"
        label="详情"
        tooltip="查看模型详情"
        @click="$emit('detail', row)"
      />
      <PermGuard :codes="[PERMISSION_CODES.modelingPublish]">
        <DtButton
          variant="ghost"
          size="sm"
          :disabled="props.actionsDisabled || !row.is_servable"
          @click="$emit('deploy', row)"
          >发布模型</DtButton
        >
        <DtIconButton
          icon="pencil"
          label="改名"
          tooltip="修改模型名称和说明"
          :disabled="props.actionsDisabled"
          @click="$emit('rename', row)"
        />
        <DtButton
          variant="ghost"
          size="sm"
          :disabled="
            props.actionsDisabled ||
            !row.is_servable ||
            row.task === 'rule_calculation'
          "
          @click="$emit('bind', row)"
        >
          绑公式
        </DtButton>
        <DtIconButton
          icon="power-off"
          label="下线"
          :disabled="props.actionsDisabled"
          @click="$emit('retire', row)"
        />
        <DtIconButton
          icon="trash"
          label="删除"
          intent="danger"
          :disabled="props.actionsDisabled"
          @click="$emit('remove', row)"
        />
      </PermGuard>
    </template>
  </DtDataView>
</template>

<style scoped lang="scss">
.dt-ml-versions {
  &__code {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__why {
    display: inline-flex;
    gap: 0.375rem;
    align-items: flex-start;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
  }
}
</style>
