<script setup lang="ts">
/**
 * @fileoverview `type: 'string'` 的控件。打字是连续输入，撤销栈按 (节点,字段) 并成一笔。
 */
import { readText } from '@dt/modules'
import { DtInput } from '@dt/ui'
import { computed } from 'vue'

import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

const text = computed(() => readText(props.value))
</script>

<template>
  <DtInput
    :model-value="text"
    size="sm"
    :disabled="disabled"
    :placeholder="field.placeholder"
    @update:model-value="emit('update', $event, true)"
  />
</template>
