<script setup lang="ts">
/** @fileoverview HTTP JSON 字段映射的选择、样例预览与元数据编辑表格。 */
import { computed } from 'vue'
import type { DtTableColumn } from '@dt/contracts'
import { COLLECT_DATA_TYPES } from '@dt/contracts'
import { DtCheckbox, DtInput, DtSelect, DtTable } from '@dt/ui'
import type { HttpPointDraft } from '../scripts/httpPointMapping'

const props = defineProps<{
  rows: readonly HttpPointDraft[]
  selected: ReadonlySet<string>
  problems: ReadonlyMap<string, string>
  isBusy: boolean
}>()
const emit = defineEmits<{
  select: [address: string, enabled: boolean]
  change: [address: string, key: 'name' | 'code' | 'fieldType', value: string]
}>()
const COLUMNS: readonly DtTableColumn[] = [
  { key: 'selected', label: '选择', width: '4rem' },
  { key: 'address', label: 'JSON Pointer', width: '13rem' },
  { key: 'preview', label: '样例值', width: '10rem' },
  { key: 'name', label: '名称', width: '10rem' },
  { key: 'code', label: '点位编码', width: '12rem' },
  { key: 'type', label: '数据类型', width: '8rem' },
]
const TYPE_OPTIONS = COLLECT_DATA_TYPES.map((value) => ({
  value,
  label: value,
}))
const tableRows = computed(() =>
  props.rows.map((row) => ({ ...row, id: row.address })),
)
</script>

<template>
  <div class="max-h-72 overflow-auto">
    <DtTable
      :columns="COLUMNS"
      :rows="tableRows"
      min-width="57rem"
      caption="HTTP 响应字段映射"
    >
      <template #cell-selected="{ row }"
        ><DtCheckbox
          :model-value="selected.has(row.address)"
          :aria-label="`选择 ${row.address}`"
          :disabled="isBusy"
          @update:model-value="emit('select', row.address, $event)"
      /></template>
      <template #cell-address="{ row }"
        ><span
          class="block max-w-52 truncate font-mono text-xs"
          :title="row.address"
          >{{ row.address }}</span
        ></template
      >
      <template #cell-preview="{ row }"
        ><span class="block max-w-40 truncate text-xs" :title="row.preview">{{
          row.preview
        }}</span></template
      >
      <template #cell-name="{ row }"
        ><DtInput
          :model-value="row.name"
          :aria-label="`${row.address} 的点位名称`"
          size="sm"
          :disabled="isBusy"
          @update:model-value="emit('change', row.address, 'name', $event)"
      /></template>
      <template #cell-code="{ row }"
        ><DtInput
          :model-value="row.code"
          :aria-label="`${row.address} 的点位编码`"
          :error="problems.get(row.address)"
          size="sm"
          :disabled="isBusy"
          @update:model-value="emit('change', row.address, 'code', $event)"
      /></template>
      <template #cell-type="{ row }"
        ><DtSelect
          :model-value="row.fieldType ?? 'float'"
          :options="TYPE_OPTIONS"
          :aria-label="`${row.address} 的数据类型`"
          size="sm"
          :disabled="isBusy"
          @update:model-value="
            emit('change', row.address, 'fieldType', $event)
          "
      /></template>
    </DtTable>
  </div>
</template>
