<script setup lang="ts">
/**
 * @fileoverview `type: 'enum'` 的控件。
 * ⚠ 选项的取值可以是数字或布尔，下拉只吃字符串——选中之后要按字符串回找原值再写回去，
 * 否则一个数字枚举会被静默写成字符串，模块那边按 `=== 1` 判断就再也不成立了。
 */
import { DtSelect } from '@dt/ui'
import { computed } from 'vue'

import { optionKey, optionValueOf, optionsOf } from './coerce'
import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

const options = computed(() => optionsOf(props.field))
const current = computed(() => optionKey(props.value))

function pick(raw: string): void {
  emit('update', optionValueOf(props.field, raw), false)
}
</script>

<template>
  <DtSelect
    :model-value="current"
    :options="options"
    size="sm"
    :disabled="disabled"
    :aria-label="field.label"
    @update:model-value="pick"
  />
</template>
