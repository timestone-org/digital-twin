<script setup lang="ts">
/**
 * @fileoverview `type: 'array'` 的控件：按 `itemSchema` 递归摊出每一行。
 * ⚠ 行内字段的 `when` 判的是**这一行自己**的取值：条件字段与被控字段同在一行，
 * 拿整块配置去判的话，「只有开关量指标才有真值文案」这类声明会永远不成立。
 * ⚠ 增删行是**结构性**改动，各成一笔撤销；行内字段的输入才按连续输入合并。
 * ⚠ 行的 key 用「行内容 + 序号」拼不出稳定值，所以这里给每行发一个本地 id
 * 并跟着行走——直接用索引做 key 的话，删掉中间一行会让其余行的输入框内容整体错位。
 */
import type { ConfigField } from '@dt/contracts'
import { configDefaults } from '@dt/modules'
import { DtButton, DtField, DtNotice } from '@dt/ui'
import { computed, ref } from 'vue'

import { isFieldVisible } from '@/features/dashboard/configForm'
import ConfigFieldControl from './ConfigFieldControl.vue'
import { asRows, rowLabel } from './coerce'
import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

const rows = computed(() => asRows(props.value))
const itemSchema = computed(() => props.field.itemSchema ?? [])
const depth = computed(() => (props.depth ?? 0) + 1)
const canAdd = computed(
  () => rows.value.length < (props.field.maxItems ?? Number.MAX_SAFE_INTEGER),
)
const canRemove = computed(
  () => rows.value.length > (props.field.minItems ?? 0),
)

// 行的稳定本地 key：只活在本组件里，不落库
const rowKeys = ref<number[]>([])
let nextRowKey = 0

function keyOf(at: number): number {
  const existing = rowKeys.value[at]
  if (existing !== undefined) return existing
  nextRowKey += 1
  rowKeys.value = [...rowKeys.value, nextRowKey]
  return nextRowKey
}

// 行内 `when` 判的是**本行**的取值：条件字段与被控字段是同一行里的同级
const rowDefaults = computed(() => configDefaults(itemSchema.value))

/** 这一行现在该摆哪几个字段。 */
function visibleCells(row: unknown): ConfigField[] {
  const values = { ...rowDefaults.value, ...asRecord(row) }
  return itemSchema.value.filter((sub) => isFieldVisible(sub, values))
}

function asRecord(row: unknown): Record<string, unknown> {
  return typeof row === 'object' && row !== null && !Array.isArray(row)
    ? { ...row }
    : {}
}

function readCell(row: unknown, key: string): unknown {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    return undefined
  }
  const record: Record<string, unknown> = { ...row }
  return record[key]
}

function writeCell(
  at: number,
  key: string,
  next: unknown,
  isContinuous: boolean,
): void {
  const current = rows.value[at]
  const base =
    typeof current === 'object' && current !== null && !Array.isArray(current)
      ? { ...current }
      : {}
  const updated = rows.value.map((row, index) =>
    index === at ? { ...base, [key]: next } : row,
  )
  emit('update', updated, isContinuous)
}

function addRow(): void {
  rowKeys.value = [...rowKeys.value.slice(0, rows.value.length), ++nextRowKey]
  emit('update', [...rows.value, {}], false)
}

function removeRow(at: number): void {
  rowKeys.value = rowKeys.value.filter((_key, index) => index !== at)
  emit(
    'update',
    rows.value.filter((_row, index) => index !== at),
    false,
  )
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <DtNotice v-if="itemSchema.length === 0" intent="info" icon="alert-circle">
      「{{ field.label }}」没声明行内字段，改不了。
    </DtNotice>
    <div
      v-for="(row, at) in rows"
      :key="keyOf(at)"
      class="flex flex-col gap-2 rounded border border-border-subtle p-2"
    >
      <div class="flex items-center justify-between">
        <span class="text-2xs text-text-secondary">
          {{ rowLabel(field, row, at) }}
        </span>
        <DtButton
          size="sm"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删除这一行"
          :disabled="disabled || !canRemove"
          @click="removeRow(at)"
        />
      </div>
      <DtField
        v-for="sub in visibleCells(row)"
        :key="sub.key"
        :label="sub.label"
        size="sm"
      >
        <ConfigFieldControl
          :field="sub"
          :value="readCell(row, sub.key)"
          :depth="depth"
          :disabled="disabled"
          @update="
            (next: unknown, live: boolean) => writeCell(at, sub.key, next, live)
          "
        />
      </DtField>
    </div>
    <DtButton
      size="sm"
      variant="outline"
      icon="plus"
      :disabled="disabled || !canAdd || itemSchema.length === 0"
      @click="addRow"
    >
      新增一行
    </DtButton>
  </div>
</template>
