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

/**
 * 主题令牌色板：选中的是 `--token` 本身而不是解析色，换肤时跟着走。
 * 名字必须真实存在于 `@dt/tokens` 的 `TOKEN_CSS_VAR`——写错不报错，只是渲染成透明。
 */
const THEME_SWATCHES: readonly string[] = [
  '--accent-primary',
  '--accent-secondary',
  '--state-success',
  '--state-warning',
  '--state-danger',
  '--state-info',
  '--text-primary',
  '--text-secondary',
]

const color = computed(() => readText(props.value))
</script>

<template>
  <DtColorInput
    :model-value="color"
    size="sm"
    :disabled="disabled"
    :placeholder="field.placeholder"
    :swatches="THEME_SWATCHES"
    @update:model-value="emit('update', $event, true)"
  />
</template>
