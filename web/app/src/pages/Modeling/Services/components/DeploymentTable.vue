<script setup lang="ts">
/**
 * @fileoverview 对外服务一览：谁在开着、钉的哪个版本、配额多少、几把钥匙。
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
import { DtButton, DtDataView, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import { formatDateTime } from '@/utils/datetime'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '名称', card: 'title' },
  { key: 'code', label: '对外标识', width: '12rem' },
  { key: 'model', label: '钉住的版本', width: '13rem' },
  { key: 'state', label: '状态', width: '13rem' },
  { key: 'quota', label: '配额', width: '11rem', align: 'right' },
  { key: 'key_count', label: '密钥', width: '5rem', align: 'right' },
  { key: 'created_at', label: '开通时间', width: '10rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '11rem',
    card: 'actions',
  },
]

const EMPTY = {
  title: '还没有开出对外服务',
  hint: '在模型库里挑一个可上线的版本，把它开成一个第三方系统能调的地址。',
}

const props = defineProps<{
  rows: readonly ModelDeployment[]
  isLoading: boolean
  error: string | null
}>()

const view = defineModel<DtDataViewMode>('view', { required: true })

defineEmits<{
  keys: [row: ModelDeployment]
  edit: [row: ModelDeployment]
  toggle: [row: ModelDeployment, isOn: boolean]
  remove: [row: ModelDeployment]
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
      minWidth: '78rem',
      cardColumns: 2,
      cardMinWidth: '24rem',
    }"
  >
    <template #toolbar><slot name="toolbar" /></template>
    <template #cell-name="{ row }">{{ row.name }}</template>
    <template #cell-code="{ row }">
      <code class="dt-ml-deploys__code" :title="row.code">{{ row.code }}</code>
    </template>
    <template #cell-model="{ row }">
      {{ row.model_name }} v{{ row.model_version }}
    </template>
    <template #cell-state="{ row }">
      <span class="dt-ml-deploys__state">
        <DtTag v-if="!row.is_enabled" intent="neutral" size="sm">已停用</DtTag>
        <DtTag v-else-if="row.is_servable" intent="success" size="sm">
          在服务
        </DtTag>
        <DtTag v-else intent="danger" size="sm">版本不可用</DtTag>
        <span v-if="!row.is_servable" class="dt-ml-deploys__why">
          {{ row.unservable_reason }}
        </span>
      </span>
    </template>
    <template #cell-quota="{ row }">
      {{ row.rate_limit_per_minute }} 次/分 · {{ row.max_rows_per_call }} 行/次
    </template>
    <template #cell-key_count="{ row }">{{ row.key_count }}</template>
    <template #cell-created_at="{ row }">
      {{ formatDateTime(row.created_at) }}
    </template>
    <template #cell-actions="{ row }">
      <DtButton variant="ghost" size="xs" @click="$emit('keys', row)">
        密钥
      </DtButton>
      <PermGuard :codes="[PERMISSION_CODES.modelingPublish]">
        <DtButton
          variant="ghost"
          size="xs"
          icon="pencil"
          title="改配置"
          @click="$emit('edit', row)"
        />
        <DtButton
          variant="ghost"
          size="xs"
          :icon="row.is_enabled ? 'power-off' : 'play'"
          :title="row.is_enabled ? '停用' : '启用'"
          @click="$emit('toggle', row, !row.is_enabled)"
        />
        <DtButton
          variant="ghost"
          size="xs"
          icon="trash"
          title="删掉"
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
