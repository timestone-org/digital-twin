<script setup lang="ts">
/** @fileoverview 预览模拟值编辑器，仅覆盖当前对象。 */
import type { TwinSceneValues } from '@dt/twin-config'
import { DtButton, DtInput, DtSwitch } from '@dt/ui'
import { computed } from 'vue'
import {
  previewSample,
  rowSample,
  sampleText,
  type PreviewDataRow,
  type PreviewSample,
} from '../scripts/previewData'
const props = defineProps<{
  rows: readonly PreviewDataRow[]
  values: TwinSceneValues
  samples: Readonly<Record<string, PreviewSample>>
  enabled: boolean
}>()
const emit = defineEmits<{
  'update:enabled': [boolean]
  write: [{ key: string; value: PreviewSample }]
  clear: []
}>()
const fields = computed(() =>
  props.rows.map((row) => {
    const overridden = Object.hasOwn(props.samples, row.key)
    const value = overridden
      ? props.samples[row.key]
      : rowSample(props.values, row)
    return {
      ...row,
      label: row.label.split(' · ').at(-1) || row.label,
      text: sampleText(value),
      hint: overridden
        ? value === null
          ? '模拟无数据，按字段配置显示静态文案或占位符'
          : '模拟值'
        : '实时值',
    }
  }),
)
</script>
<template>
  <div
    v-if="rows.length"
    class="flex shrink-0 flex-col gap-2 border-t border-border-subtle p-2"
  >
    <div class="flex items-center justify-between gap-2">
      <DtSwitch
        :model-value="enabled"
        label="模拟数据"
        size="sm"
        @update:model-value="emit('update:enabled', $event)"
      />
      <DtButton v-if="enabled" size="xs" variant="ghost" @click="emit('clear')"
        >恢复全部实时值</DtButton
      >
    </div>
    <div v-if="enabled" class="flex max-h-44 flex-col gap-2 overflow-y-auto">
      <p class="text-xs text-state-warning">
        仅影响当前预览，不修改点位或保存配置。未修改的字段继续使用实时值。
      </p>
      <div
        v-for="field in fields"
        :key="field.key"
        class="flex items-end gap-1"
      >
        <DtInput
          class="min-w-0 flex-1"
          :label="field.label"
          :model-value="field.text"
          size="sm"
          :hint="field.hint"
          @update:model-value="
            emit('write', { key: field.key, value: previewSample($event) })
          "
        />
        <DtButton
          size="xs"
          variant="ghost"
          :aria-label="`${field.label}模拟无数据`"
          @click="emit('write', { key: field.key, value: null })"
          >无数据</DtButton
        >
      </div>
    </div>
  </div>
</template>
