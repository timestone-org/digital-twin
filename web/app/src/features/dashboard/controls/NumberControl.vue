<script setup lang="ts">
/**
 * @fileoverview `type: 'number'` 的控件。
 * ⚠ 清空输入给的是 `undefined` 而不是 0：0 是一个合法取值，
 * 拿它冒充「没配」会让「留空回落缺省」这条路径永远走不到。
 */
import { DtNumberInput } from '@dt/ui'
import { computed } from 'vue'

import { rangeOf } from './coerce'
import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

const current = computed<number | undefined>(() =>
  typeof props.value === 'number' && Number.isFinite(props.value)
    ? props.value
    : undefined,
)
const range = computed(() => rangeOf(props.field))
</script>

<template>
  <DtNumberInput
    :model-value="current"
    :range="range"
    size="sm"
    :disabled="disabled"
    @update:model-value="emit('update', $event, true)"
  />
</template>
