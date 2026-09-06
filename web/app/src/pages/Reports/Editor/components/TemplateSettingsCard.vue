<script setup lang="ts">
/** @fileoverview 报告编辑页的模板基础设置卡片。 */
import { DtButton, DtCard, DtCheckbox, DtInput, DtSelect } from '@dt/ui'
import type { ReportTemplate } from '@dt/contracts'
import { GRANULARITIES } from '../../scripts/reportDocument'

defineProps<{
  name: string
  granularity: ReportTemplate['granularity']
  enabled: boolean
  disabled: boolean
  canEdit: boolean
}>()

const emit = defineEmits<{
  'update:name': [value: string]
  'update:granularity': [value: ReportTemplate['granularity']]
  'update:enabled': [value: boolean]
  openPage: []
}>()

function updateGranularity(value: string): void {
  if (
    value === 'day' ||
    value === 'month' ||
    value === 'quarter' ||
    value === 'year'
  ) {
    emit('update:granularity', value)
  }
}
</script>

<template>
  <DtCard title="模板设置" icon="settings" padding="sm">
    <div class="flex flex-col gap-3">
      <DtInput
        :model-value="name"
        label="报告名称"
        size="sm"
        :disabled="disabled"
        @update:model-value="emit('update:name', $event)"
      />
      <DtSelect
        :model-value="granularity"
        label="报告周期"
        size="sm"
        :options="GRANULARITIES"
        :disabled="disabled"
        @update:model-value="updateGranularity"
      />
      <DtCheckbox
        :model-value="enabled"
        label="启用模板"
        :disabled="disabled"
        @update:model-value="emit('update:enabled', $event)"
      />
      <DtButton
        v-if="canEdit"
        size="sm"
        variant="outline"
        icon="settings"
        @click="emit('openPage')"
      >
        页面设置
      </DtButton>
    </div>
  </DtCard>
</template>
