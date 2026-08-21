<script setup lang="ts">
/**
 * @fileoverview `type: 'textarea'` 的控件。打字是连续输入，撤销栈按 (节点,字段) 并成一笔。
 */
import { readText } from '@dt/modules'
import { DtTextarea } from '@dt/ui'
import { computed } from 'vue'

import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

const text = computed(() => readText(props.value))
</script>

<template>
  <DtTextarea
    :model-value="text"
    size="sm"
    rows="3"
    :disabled="disabled === true"
    :placeholder="field.placeholder"
    @update:model-value="emit('update', $event, true)"
  />
</template>
