<script setup lang="ts">
/**
 * @fileoverview 公式绑定一览：一条台账公式绑到哪个模型版本上。
 *
 * ⚠ 绑定可能变成**孤儿**——公式条目被删掉了。这是每次列表时现算的，界面照实
 * 标出来，不装作它还好着。
 */
import type {
  DtDataColumn,
  DtDataViewMode,
  ModelingBinding,
} from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtSwitch, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'fx_code', label: '公式编码', card: 'title' },
  { key: 'version', label: '绑的版本', width: '16rem' },
  { key: 'params', label: '形参对应', width: '18rem' },
  { key: 'enabled', label: '启用', width: '6rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '7rem',
    card: 'actions',
  },
]

const EMPTY = {
  title: '还没有绑定',
  hint: '把一个可用的版本绑到一条公式编码上，台账列里就能用 PREDICT() 引用它。',
}

const props = defineProps<{
  rows: readonly ModelingBinding[]
  versionLabels: ReadonlyMap<string, string>
  isLoading: boolean
  error: string | null
}>()

const view = defineModel<DtDataViewMode>('view', { required: true })

defineEmits<{
  toggle: [row: ModelingBinding, isOn: boolean]
  unbind: [row: ModelingBinding]
}>()

/** 形参按位置对应特征列，界面上写成 `1→列名`。 */
function paramsOf(row: ModelingBinding): string {
  if (row.param_map.length === 0) return '—'
  return row.param_map.map((item, at) => `${at + 1}→${item.feature}`).join('、')
}
</script>

<template>
  <DtDataView
    v-model:view="view"
    :columns="COLUMNS"
    :rows="props.rows"
    :loading="props.isLoading"
    :error="props.error"
    :empty="EMPTY"
  >
    <template #cell-fx_code="{ row }">
      <code>{{ row.fx_code }}</code>
      <DtTag v-if="row.is_orphaned" intent="danger" size="sm">公式已删</DtTag>
    </template>
    <template #cell-version="{ row }">
      {{
        props.versionLabels.get(row.model_version_id) ?? row.model_version_id
      }}
    </template>
    <template #cell-params="{ row }">{{ paramsOf(row) }}</template>
    <template #cell-enabled="{ row }">
      <PermGuard :codes="[PERMISSION_CODES.modelingPublish]">
        <DtSwitch
          :model-value="row.is_enabled"
          aria-label="启用这条绑定"
          @update:model-value="$emit('toggle', row, $event)"
        />
        <template #fallback>
          <DtTag :intent="row.is_enabled ? 'success' : 'neutral'" size="sm">
            {{ row.is_enabled ? '启用' : '停用' }}
          </DtTag>
        </template>
      </PermGuard>
    </template>
    <template #cell-actions="{ row }">
      <PermGuard :codes="[PERMISSION_CODES.modelingPublish]">
        <DtButton
          variant="ghost"
          size="xs"
          icon="trash"
          title="解绑"
          @click="$emit('unbind', row)"
        />
      </PermGuard>
    </template>
  </DtDataView>
</template>
