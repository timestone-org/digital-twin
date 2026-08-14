<script setup lang="ts">
/**
 * @fileoverview `type: 'range'` 的控件。滑杆是连续输入。
 */
import { readNumber } from '@dt/modules'
import { DtSlider } from '@dt/ui'
import { computed } from 'vue'

import { rangeOf } from './coerce'
import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

const range = computed(() => rangeOf(props.field))
const current = computed(() => readNumber(props.value, range.value.min ?? 0))
</script>

<template>
  <DtSlider
    :model-value="current"
    :range="range"
    size="sm"
    :disabled="disabled === true"
    show-value
    @update:model-value="emit('update', $event, true)"
  />
</template>
