<script setup lang="ts">
/**
 * @fileoverview 时刻字段的组合控件：相对 / 绝对 / 留空三选一，选中哪种就只显示
 * 哪一种的输入。三种写法的口径见 `../scripts/moment`。
 */
import {
  DtDateTimeInput,
  DtField,
  DtInput,
  DtSegmented,
  DtSelect,
} from '@dt/ui'
import { computed } from 'vue'

import type { MomentMode } from '../scripts/moment'
import {
  RELATIVE_PRESETS,
  isRelative,
  modeOf,
  seedFor,
} from '../scripts/moment'

const props = defineProps<{
  modelValue: string
  label: string
  hint: string
  isReadonly: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const MODES: readonly { value: MomentMode; label: string }[] = [
  { value: 'relative', label: '相对' },
  { value: 'absolute', label: '绝对' },
  { value: 'blank', label: '不限' },
]

const mode = computed(() => modeOf(props.modelValue))
const presetValue = computed(() =>
  RELATIVE_PRESETS.some((item) => item.value === props.modelValue)
    ? props.modelValue
    : '',
)
const error = computed(() =>
  mode.value === 'relative' && !isRelative(props.modelValue)
    ? '相对写法形如 -90d / -12h'
    : '',
)

function switchTo(next: string): void {
  const wanted = MODES.find((item) => item.value === next)?.value ?? 'blank'
  emit('update:modelValue', seedFor(wanted))
}
</script>

<template>
  <DtField :label="props.label" :hint="props.hint">
    <DtSegmented
      :model-value="mode"
      :options="MODES"
      size="sm"
      aria-label="时刻写法"
      @update:model-value="switchTo"
    />
    <template v-if="mode === 'relative'">
      <DtSelect
        :model-value="presetValue"
        :options="RELATIVE_PRESETS"
        placeholder="常用档"
        size="sm"
        :disabled="props.isReadonly"
        @update:model-value="emit('update:modelValue', $event)"
      />
      <DtInput
        :model-value="props.modelValue"
        placeholder="或自己写，如 -12h"
        size="sm"
        :error="error"
        :disabled="props.isReadonly"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </template>
    <DtDateTimeInput
      v-else-if="mode === 'absolute'"
      :model-value="props.modelValue"
      size="sm"
      :disabled="props.isReadonly"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <p v-else class="dt-ml-moment__blank">不限——起始取最早，截止取到此刻</p>
  </DtField>
</template>

<style scoped lang="scss">
.dt-ml-moment__blank {
  margin: 0;
  color: var(--text-disabled);
  font-size: var(--ctl-hint-fs-sm);
}
</style>
