<script setup lang="ts">
/**
 * @fileoverview `type: 'font'` 的控件：字体族 / 字号 / 字重 / 字间距 / 颜色五键。
 * ⚠ 没设置的键**不写进配置**：缺席即「跟随主题」，物化成空键之后这条路径就没了。
 */
import type { DtSelectOption } from '@dt/contracts'
import { readRecord } from '@dt/modules'
import { DtColorInput, DtField, DtInput, DtNumberInput, DtSelect } from '@dt/ui'
import { computed } from 'vue'

import { patchKey, subNumber, subText } from './coerce'
import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

/** 字重预设，空串这一项就是「不写这个键」。 */
const WEIGHT_OPTIONS: readonly DtSelectOption[] = [
  { value: '', label: '跟随主题' },
  { value: '400', label: '常规 400' },
  { value: '500', label: '中等 500' },
  { value: '600', label: '加粗 600' },
  { value: '700', label: '粗 700' },
]

/** 字间距按 0.1px 调，整数步长在小字号上一步就过头。 */
const LETTER_SPACING_RANGE = { step: 0.1 }

const font = computed(() => readRecord(props.value))
const family = computed(() => subText(font.value, 'family'))
const size = computed(() => subNumber(font.value, 'size'))
const letterSpacing = computed(() => subNumber(font.value, 'letterSpacing'))
const color = computed(() => subText(font.value, 'color'))

const weight = computed(() => {
  const raw = font.value['weight']
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return typeof raw === 'string' ? raw : ''
})

// 配置里的字重可以是 CSS 关键字（bold 之类），不在预设里就补一条，
// 否则下拉回显成空白，用户会以为这一项没配过
const weightOptions = computed<DtSelectOption[]>(() => {
  const listed = [...WEIGHT_OPTIONS]
  const current = weight.value
  if (current !== '' && !listed.some((option) => option.value === current)) {
    listed.push({ value: current, label: current })
  }
  return listed
})

function patch(key: string, next: unknown, isContinuous: boolean): void {
  emit('update', patchKey(font.value, key, next), isContinuous)
}

function pickWeight(raw: string): void {
  const asNumber = Number(raw)
  patch(
    'weight',
    Number.isFinite(asNumber) && raw !== '' ? asNumber : raw,
    false,
  )
}
</script>

<template>
  <div class="grid grid-cols-2 gap-2">
    <DtField class="col-span-2" label="字体族" size="sm">
      <DtInput
        :model-value="family"
        size="sm"
        :disabled="disabled"
        placeholder="跟随主题；或 sans-serif"
        @update:model-value="patch('family', $event, true)"
      />
    </DtField>
    <DtField label="字号 (px)" size="sm">
      <DtNumberInput
        :model-value="size"
        size="sm"
        :disabled="disabled"
        :steppers="false"
        @update:model-value="patch('size', $event, true)"
      />
    </DtField>
    <DtField label="字重" size="sm">
      <DtSelect
        :model-value="weight"
        :options="weightOptions"
        size="sm"
        :disabled="disabled"
        aria-label="字重"
        @update:model-value="pickWeight"
      />
    </DtField>
    <DtField label="字间距 (px)" size="sm">
      <DtNumberInput
        :model-value="letterSpacing"
        :range="LETTER_SPACING_RANGE"
        size="sm"
        :disabled="disabled"
        :steppers="false"
        @update:model-value="patch('letterSpacing', $event, true)"
      />
    </DtField>
    <DtField label="颜色" size="sm">
      <DtColorInput
        :model-value="color"
        size="sm"
        :disabled="disabled"
        @update:model-value="patch('color', $event, true)"
      />
    </DtField>
  </div>
</template>
