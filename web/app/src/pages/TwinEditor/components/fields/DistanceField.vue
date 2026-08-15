<script setup lang="ts">
/**
 * @fileoverview 一个距离阈值加它的参考系，可整条不配。
 *
 * ⚠ 「没配」与「配了个零」是两回事，界面上必须能表达前者：`null` 是不做这项限制，
 * `{ ref: 'orbit', value: 0 }` 是「距离小于 0 时生效」——后者永不成立，看起来
 * 却和没配一模一样。所以这里用一个开关切换两种状态，而不是让 0 兼职表示「关」。
 */
import {
  TWIN_DISTANCE_REFS,
  type TwinDistanceRef,
  type TwinDistanceRule,
} from '@dt/twin-config'
import { DtNumberInput, DtSelect, DtSwitch } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{
  modelValue: TwinDistanceRule | null
  label: string
  /** 打开开关时给的初值，缺省 10。 */
  fallback?: number
}>()

const emit = defineEmits<{ 'update:modelValue': [TwinDistanceRule | null] }>()

/** 参考系的说法必须跟着阈值一起给：同一个数在三种参考系下是三个位置。 */
const REF_LABELS: Readonly<Record<TwinDistanceRef, string>> = {
  orbit: '到轨道中心',
  self: '到本元素',
  'part-center': '到部件中心',
}

const options = TWIN_DISTANCE_REFS.map((value) => ({
  value,
  label: REF_LABELS[value],
}))

const enabled = computed(() => props.modelValue !== null)

function toggle(on: boolean): void {
  emit(
    'update:modelValue',
    on ? { ref: 'orbit', value: props.fallback ?? 10 } : null,
  )
}

function writeValue(next: number | undefined): void {
  if (props.modelValue === null) return
  emit('update:modelValue', { ...props.modelValue, value: next ?? 0 })
}

function writeRef(next: string): void {
  if (props.modelValue === null) return
  const ref = TWIN_DISTANCE_REFS.find((item) => item === next)
  if (ref === undefined) return
  emit('update:modelValue', { ...props.modelValue, ref })
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-text-secondary">{{ label }}</span>
      <DtSwitch
        :model-value="enabled"
        :aria-label="label"
        size="sm"
        @update:model-value="toggle"
      />
    </div>
    <div v-if="modelValue !== null" class="grid grid-cols-2 gap-1.5">
      <DtNumberInput
        :model-value="modelValue.value"
        :range="{ min: 0, step: 0.5 }"
        :aria-label="`${label} 阈值`"
        size="sm"
        :steppers="false"
        @update:model-value="writeValue"
      />
      <DtSelect
        :model-value="modelValue.ref"
        :options="options"
        :aria-label="`${label} 参考系`"
        size="sm"
        @update:model-value="writeRef"
      />
    </div>
  </div>
</template>
