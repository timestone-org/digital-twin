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
import { computed, ref, watch } from 'vue'

import type { MomentMode } from '../scripts/moment'
import {
  RELATIVE_PRESETS,
  isRelative,
  modeOf,
  seedFor,
} from '../scripts/moment'

const props = withDefaults(
  defineProps<{
    modelValue: string
    label: string
    hint: string
    isReadonly: boolean
    allowBlank?: boolean
    blankLabel?: string
    blankHint?: string
    presets?: readonly { value: string; label: string }[]
  }>(),
  { allowBlank: true },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const modes = computed<readonly { value: MomentMode; label: string }[]>(() => [
  { value: 'relative', label: '相对' },
  { value: 'absolute', label: '绝对' },
  ...(props.allowBlank === false
    ? []
    : [{ value: 'blank' as const, label: props.blankLabel ?? '不限' }]),
])

const mode = ref<MomentMode>('blank')
let pendingValue: string | undefined
watch(
  () => props.modelValue,
  (value) => {
    if (value === pendingValue) {
      pendingValue = undefined
      return
    }
    pendingValue = undefined
    mode.value = value === '' && !props.allowBlank ? 'absolute' : modeOf(value)
  },
  { immediate: true },
)
const presetValue = computed(() =>
  (props.presets ?? RELATIVE_PRESETS).some(
    (item) => item.value === props.modelValue,
  )
    ? props.modelValue
    : '',
)
const error = computed(() =>
  mode.value === 'relative' && !isRelative(props.modelValue)
    ? '相对写法形如 -90d / -12h'
    : '',
)

function switchTo(next: string): void {
  if (props.isReadonly) return
  const wanted = modes.value.find((item) => item.value === next)?.value
  if (wanted === undefined) return
  mode.value = wanted
  update(seedFor(wanted))
}

function update(value: string): void {
  if (props.isReadonly) return
  pendingValue = value
  emit('update:modelValue', value)
}
</script>

<template>
  <DtField :label="props.label" :hint="props.hint">
    <DtSegmented
      v-if="!props.isReadonly"
      :model-value="mode"
      :options="modes"
      size="sm"
      aria-label="时刻写法"
      @update:model-value="switchTo"
    />
    <p v-else class="dt-ml-moment__blank">
      {{ modes.find((item) => item.value === mode)?.label }}
    </p>
    <template v-if="mode === 'relative'">
      <DtSelect
        :model-value="presetValue"
        :options="props.presets ?? RELATIVE_PRESETS"
        placeholder="常用档"
        size="sm"
        :disabled="props.isReadonly"
        @update:model-value="update"
      />
      <DtInput
        :model-value="props.modelValue"
        placeholder="或自己写，如 -12h"
        size="sm"
        :error="error"
        :disabled="props.isReadonly"
        @update:model-value="update"
      />
    </template>
    <DtDateTimeInput
      v-else-if="mode === 'absolute'"
      :model-value="props.modelValue"
      size="sm"
      :disabled="props.isReadonly"
      @update:model-value="update"
    />
    <p v-else class="dt-ml-moment__blank">
      {{ props.blankHint ?? '不限——起始取最早，截止取到此刻' }}
    </p>
  </DtField>
</template>

<style scoped lang="scss">
.dt-ml-moment__blank {
  margin: 0;
  color: var(--text-disabled);
  font-size: var(--ctl-hint-fs-sm);
}
</style>
