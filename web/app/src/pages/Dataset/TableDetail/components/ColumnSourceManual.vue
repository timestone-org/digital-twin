<script setup lang="ts">
/**
 * @fileoverview 列表单里「人工录入」那一档的子块：默认值与必填。
 *
 * ⚠ 默认值按这一列的数据类型解析后落库（存原值保类型），故提示语要跟着
 * 类型变：数值列里填「是」会静默变成空值，而界面上什么都不会说。
 */
import type { DatasetColumnType } from '@dt/contracts'
import { computed } from 'vue'
import { DtInput, DtSwitch } from '@dt/ui'

const props = defineProps<{ dataType: DatasetColumnType }>()

const defaultValue = defineModel<string>('defaultValue', { required: true })
const isRequired = defineModel<boolean>('isRequired', { required: true })

const HINTS: Record<DatasetColumnType, string> = {
  number: '录入表单的预填值。按数值解析，填不成数值就等于没填。',
  string: '录入表单的预填值，原样存成文本。',
  bool: '录入表单的预填值。true / 1 / 是 / on 算真，其余算假。',
}

const hint = computed(() => HINTS[props.dataType])
</script>

<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <DtInput v-model="defaultValue" label="默认值" :hint="hint" />
    <DtSwitch v-model="isRequired" label="必填" aria-label="录入时这一列必填" />
  </div>
</template>
