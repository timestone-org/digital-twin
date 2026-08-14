<script setup lang="ts">
/**
 * @fileoverview `type: 'style'` 的控件：前景 / 背景 / 边框 / 圆角 / 阴影 / 内边距 / 不透明度七键。
 * ⚠ 没设置的键**不写进配置**：缺席即「用主题的那一份」，物化成空键会把主题覆盖掉。
 */
import { readRecord } from '@dt/modules'
import { DtColorInput, DtField, DtInput, DtNumberInput } from '@dt/ui'
import { computed } from 'vue'

import { patchKey, subNumber, subText } from './coerce'
import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

/** 不透明度是 0–1 的比例，不是百分数。 */
const OPACITY_RANGE = { min: 0, max: 1, step: 0.05 }

const slot = computed(() => readRecord(props.value))
const color = computed(() => subText(slot.value, 'color'))
const background = computed(() => subText(slot.value, 'background'))
const border = computed(() => subText(slot.value, 'border'))
const boxShadow = computed(() => subText(slot.value, 'boxShadow'))
const padding = computed(() => subText(slot.value, 'padding'))
const borderRadius = computed(() => subNumber(slot.value, 'borderRadius'))
const opacity = computed(() => subNumber(slot.value, 'opacity'))

function patch(key: string, next: unknown, isContinuous: boolean): void {
  emit('update', patchKey(slot.value, key, next), isContinuous)
}
</script>

<template>
  <div class="grid grid-cols-2 gap-2">
    <DtField label="前景色" size="sm">
      <DtColorInput
        :model-value="color"
        size="sm"
        :disabled="disabled"
        @update:model-value="patch('color', $event, true)"
      />
    </DtField>
    <DtField label="背景" size="sm">
      <DtColorInput
        :model-value="background"
        size="sm"
        :disabled="disabled"
        @update:model-value="patch('background', $event, true)"
      />
    </DtField>
    <DtField class="col-span-2" label="边框 (CSS border)" size="sm">
      <DtInput
        :model-value="border"
        size="sm"
        :disabled="disabled"
        placeholder="1px solid var(--border-default)"
        @update:model-value="patch('border', $event, true)"
      />
    </DtField>
    <DtField label="圆角 (px)" size="sm">
      <DtNumberInput
        :model-value="borderRadius"
        size="sm"
        :disabled="disabled"
        :steppers="false"
        @update:model-value="patch('borderRadius', $event, true)"
      />
    </DtField>
    <DtField label="不透明度" size="sm">
      <DtNumberInput
        :model-value="opacity"
        :range="OPACITY_RANGE"
        size="sm"
        :disabled="disabled"
        :steppers="false"
        @update:model-value="patch('opacity', $event, true)"
      />
    </DtField>
    <DtField label="内边距 (CSS)" size="sm">
      <DtInput
        :model-value="padding"
        size="sm"
        :disabled="disabled"
        placeholder="8px 12px"
        @update:model-value="patch('padding', $event, true)"
      />
    </DtField>
    <DtField label="阴影 (CSS)" size="sm">
      <DtInput
        :model-value="boxShadow"
        size="sm"
        :disabled="disabled"
        placeholder="0 0 12px var(--accent-primary)"
        @update:model-value="patch('boxShadow', $event, true)"
      />
    </DtField>
  </div>
</template>
