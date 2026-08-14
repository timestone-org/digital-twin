<script setup lang="ts">
/**
 * @fileoverview `type: 'color'` 的控件。取色器是拖出来的，按连续输入合并。
 */
import { readText } from '@dt/modules'
import { DtColorInput } from '@dt/ui'
import { computed } from 'vue'

import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

const color = computed(() => readText(props.value))
</script>

<template>
  <DtColorInput
    :model-value="color"
    size="sm"
    :disabled="disabled"
    :placeholder="field.placeholder"
    @update:model-value="emit('update', $event, true)"
  />
</template>
