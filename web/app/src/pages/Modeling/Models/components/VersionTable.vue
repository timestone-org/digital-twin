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
import { DtButton, DtDataView, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import { formatDateTime } from '@/utils/datetime'

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
  { key: 'target_key', label: '目标列', width: '11rem' },
  { key: 'servable', label: '可用于取数', width: '13rem' },
  { key: 'created_at', label: '发布时间', width: '10rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '8rem',
    card: 'actions',
  },
]

const EMPTY = {
  title: '还没有发布过版本',
  hint: '在画布上跑出一个训练好的模型，然后从运行历史里把它发布成一个版本。',
}

const props = defineProps<{
  rows: readonly ModelingVersionSummary[]
  isLoading: boolean
  error: string | null
}>()

const view = defineModel<DtDataViewMode>('view', { required: true })

defineEmits<{
  bind: [row: ModelingVersionSummary]
  retire: [row: ModelingVersionSummary]
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
    :layout="{
      fixedLayout: true,
      minWidth: '69rem',
      cardColumns: 3,
      cardMinWidth: '20rem',
    }"
  >
    <template #toolbar><slot name="toolbar" /></template>
    <template #cell-name="{ row }">{{ row.name }}</template>
    <template #cell-version="{ row }">v{{ row.version }}</template>
    <template #cell-algo="{ row }">
      <code class="dt-ml-versions__code" :title="row.algo">{{ row.algo }}</code>
    </template>
    <template #cell-target_key="{ row }">
      <code class="dt-ml-versions__code" :title="row.target_key">
        {{ row.target_key }}
      </code>
    </template>
    <template #cell-servable="{ row }">
      <DtTag v-if="row.is_servable" intent="success" size="sm">可用</DtTag>
      <span v-else class="dt-ml-versions__why">
        <DtTag intent="danger" size="sm">不可用</DtTag>
        {{ row.unservable_reason }}
      </span>
    </template>
    <template #cell-created_at="{ row }">
      {{ formatDateTime(row.created_at) }}
    </template>
    <template #cell-actions="{ row }">
      <PermGuard :codes="[PERMISSION_CODES.modelingPublish]">
        <DtButton
          variant="ghost"
          size="xs"
          :disabled="!row.is_servable"
          @click="$emit('bind', row)"
        >
          绑公式
        </DtButton>
        <DtButton
          variant="ghost"
          size="xs"
          icon="power-off"
          title="下线"
          @click="$emit('retire', row)"
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
