<script setup lang="ts">
/** @fileoverview 层级图最近保存版本的查看与恢复。 */
import { computed } from 'vue'
import { DtButton, DtDataView, DtModal } from '@dt/ui'
import type { HierarchyVersion, DtDataColumn } from '@dt/contracts'
import { formatDateTime } from '@/utils/datetime'
const props = defineProps<{
  modelValue: boolean
  versions: HierarchyVersion[]
  readonly: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  restore: [revision: number]
}>()
const rows = computed(() =>
  props.versions.map((version) => ({
    ...version,
    id: String(version.revision),
    time: formatDateTime(version.created_at),
  })),
)
const COLUMNS: readonly DtDataColumn[] = [
  { key: 'revision', label: '版本' },
  { key: 'time', label: '保存时间' },
  { key: 'actions', label: '操作' },
]
</script>
<template>
  <DtModal
    :model-value="modelValue"
    title="最近 50 个保存版本"
    width="42rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="h-96">
      <DtDataView
        view="table"
        :columns="COLUMNS"
        :rows="rows"
        :layout="{ minWidth: '0', toggle: false }"
      >
        <template #cell-revision="{ row }"> v{{ row.revision }} </template>
        <template #cell-time="{ row }">
          {{ row.time }}
        </template>
        <template #cell-actions="{ row }">
          <DtButton
            v-if="!readonly"
            size="sm"
            variant="outline"
            @click="emit('restore', row.revision)"
          >
            恢复此版本
          </DtButton>
        </template>
      </DtDataView>
    </div>
  </DtModal>
</template>
