<script setup lang="ts">
/**
 * @fileoverview 对外服务一览：谁在开着、钉的哪个版本、配额多少。
 *
 * ⚠ 「停用」与「版本不可上线」是**两格**：一个是人关的，一个是模型本身用不了，
 * 两者的补救办法完全不同（docs/MODELING_PLATFORM_DESIGN.md D15 的防线 ⑭）。
 */
import type {
  DtDataColumn,
  DtDataViewMode,
  ModelDeployment,
} from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import type { DtDataViewSelection, DtPaginationState } from '@dt/ui'
import { DtButton, DtDataView, DtIconButton, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import { formatDateTime } from '@/utils/datetime'
import { taskLabel } from '../../scripts/taskPresentation'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '名称', card: 'title' },
  { key: 'code', label: '对外标识', width: '12rem' },
  { key: 'model', label: '钉住的版本', width: '13rem' },
  { key: 'task', label: '模型类型', width: '8rem' },
  { key: 'state', label: '状态', width: '13rem' },
  { key: 'quota', label: '配额', width: '11rem', align: 'right' },
  { key: 'created_at', label: '开通时间', width: '10rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '13rem',
    card: 'actions',
  },
]

const EMPTY = {
  title: '还没有已发布模型',
  hint: '在工作流中点击「训练并发布」，或在训练记录中选择成功模型直接发布。',
}

const props = defineProps<{
  rows: readonly ModelDeployment[]
  isLoading: boolean
  error: string | null
  selection?: DtDataViewSelection<ModelDeployment> | undefined
  actionsDisabled?: boolean | undefined
  pagination?: DtPaginationState | undefined
}>()

const view = defineModel<DtDataViewMode>('view', { required: true })

defineEmits<{
  access: [row: ModelDeployment]
  edit: [row: ModelDeployment]
  toggle: [row: ModelDeployment, isOn: boolean]
  remove: [row: ModelDeployment]
  'update:selectedIds': [ids: string[]]
  'update:page': [page: number]
  'update:size': [size: number]
  retry: []
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
    :selection="props.selection"
    :pagination="props.pagination"
    :layout="{
      fixedLayout: true,
      minWidth: '81rem',
      cardColumns: 2,
      cardMinWidth: '24rem',
    }"
    @update:selected-ids="$emit('update:selectedIds', $event)"
    @update:page="$emit('update:page', $event)"
    @update:size="$emit('update:size', $event)"
    @retry="$emit('retry')"
  >
    <template #toolbar><slot name="toolbar" /></template>
    <template #cell-name="{ row }">
      <span class="block truncate" :title="row.name">{{ row.name }}</span>
    </template>
    <template #cell-code="{ row }">
      <code class="dt-ml-deploys__code" :title="row.code">{{ row.code }}</code>
    </template>
    <template #cell-model="{ row }">
      <span
        class="block truncate"
        :title="`${row.model_name} v${row.model_version}`"
      >
        {{ row.model_name }} v{{ row.model_version }}
      </span>
    </template>
    <template #cell-state="{ row }">
      <span class="dt-ml-deploys__state max-w-full">
        <DtTag
          v-if="!row.is_enabled"
          class="shrink-0"
          intent="neutral"
          size="sm"
        >
          已停用
        </DtTag>
        <DtTag
          v-else-if="row.is_servable"
          class="shrink-0"
          intent="success"
          size="sm"
        >
          在服务
        </DtTag>
        <DtTag v-else class="shrink-0" intent="danger" size="sm"
          >版本不可用</DtTag
        >
        <span
          v-if="!row.is_servable"
          class="dt-ml-deploys__why min-w-0 [overflow-wrap:anywhere]"
        >
          {{ row.unservable_reason }}
        </span>
      </span>
    </template>
    <template #cell-task="{ row }">{{ taskLabel(row.task) }}</template>
    <template #cell-quota="{ row }">
      {{ row.rate_limit_per_minute }} 次/分 · {{ row.max_rows_per_call }} 行/次
    </template>
    <template #cell-created_at="{ row }">
      {{ formatDateTime(row.created_at) }}
    </template>
    <template #cell-actions="{ row }">
      <DtButton variant="ghost" size="sm" @click="$emit('access', row)">
        调用说明
      </DtButton>
      <PermGuard :codes="[PERMISSION_CODES.modelingPublish]">
        <DtIconButton
          icon="pencil"
          label="改配置"
          :disabled="props.actionsDisabled"
          @click="$emit('edit', row)"
        />
        <DtIconButton
          :icon="row.is_enabled ? 'power-off' : 'play'"
          :label="row.is_enabled ? '停用' : '启用'"
          :disabled="props.actionsDisabled"
          @click="$emit('toggle', row, !row.is_enabled)"
        />
        <DtIconButton
          icon="trash"
          label="删掉"
          intent="danger"
          :disabled="props.actionsDisabled"
          @click="$emit('remove', row)"
        />
      </PermGuard>
    </template>
  </DtDataView>
</template>

<style scoped lang="scss">
.dt-ml-deploys {
  &__code {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__state {
    display: inline-flex;
    gap: 0.375rem;
    align-items: flex-start;
  }

  &__why {
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
  }
}
</style>
