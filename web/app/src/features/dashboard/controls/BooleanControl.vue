<script setup lang="ts">
/**
 * @fileoverview `type: 'boolean'` 的控件。开关是离散动作，各成一笔撤销。
 */
import { readBoolean } from '@dt/modules'
import { DtSwitch } from '@dt/ui'
import { computed } from 'vue'

import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

const checked = computed(() => readBoolean(props.value))
</script>

<template>
  <DtSwitch
    :model-value="checked"
    size="sm"
    :disabled="disabled"
    :aria-label="field.label"
    @update:model-value="emit('update', $event, false)"
  />
</template>
