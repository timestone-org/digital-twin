<script setup lang="ts">
/**
 * @fileoverview `type: 'array'` 的控件：按 `itemSchema` 递归摊出每一行。
 * ⚠ 行内字段的 `when` 判的是**这一行自己**的取值：条件字段与被控字段同在一行，
 * 拿整块配置去判的话，「只有开关量指标才有真值文案」这类声明会永远不成立。
 * ⚠ 增删、移动行是**结构性**改动，各成一笔撤销；行内字段的输入才按连续输入合并。
 * ⚠ 行的 key 用「行内容 + 序号」拼不出稳定值，所以由 `useRowKeys` 给每行发本地
 * uid：删行、换位都要连着动那把 uid，模板只读不写；外部整包替换 value
 * （撤销 / 重做 / 应用预设）时 key 按位置续用。
 */
import type { ConfigField } from '@dt/contracts'
import { configDefaults } from '@dt/modules'
import { DtButton, DtField, DtNotice } from '@dt/ui'
import { computed } from 'vue'

import { isFieldVisible } from '@/features/dashboard/configForm'
import { useRowKeys } from '@/features/dashboard/rowKeys'
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
const rowKeys = useRowKeys(() => rows.value.length)

const rowEntries = computed(() =>
  rows.value.map((row, at) => ({
    key: rowKeys.keys.value[at] ?? `row-${at}`,
    row,
  })),
)

// 行内 `when` 判的是**本行**的取值：条件字段与被控字段是同一行里的同级
const rowDefaults = computed(() => configDefaults(itemSchema.value))

/** 这一行现在该摆哪几个字段。 */
function visibleCells(row: unknown): ConfigField[] {
  const values = { ...rowDefaults.value, ...asRecord(row) }
  return itemSchema.value.filter((sub) =>
    isFieldVisible(sub, values, itemSchema.value),
  )
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
  emit('update', [...rows.value, {}], false)
}

function removeRow(at: number): void {
  rowKeys.removeAt(at)
  emit(
    'update',
    rows.value.filter((_row, index) => index !== at),
    false,
  )
}

/** 与相邻行交换数据，本地 key 跟着一起换位。 */
function moveRow(at: number, delta: -1 | 1): void {
  const to = at + delta
  if (to < 0 || to >= rows.value.length) return
  const next = [...rows.value]
  const moved = next[at]
  next[at] = next[to]
  next[to] = moved
  rowKeys.swapAt(at, to)
  emit('update', next, false)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <DtNotice v-if="itemSchema.length === 0" intent="info" icon="alert-circle">
      「{{ field.label }}」没声明行内字段，改不了。
    </DtNotice>
    <div
      v-for="(entry, at) in rowEntries"
      :key="entry.key"
      class="flex flex-col gap-2 rounded border border-border-subtle p-2"
    >
      <div class="flex items-center justify-between">
        <span class="text-2xs text-text-secondary">
          {{ rowLabel(field, entry.row, at) }}
        </span>
        <div class="flex items-center gap-1">
          <DtButton
            size="sm"
            variant="ghost"
            icon="chevron-up"
            aria-label="上移这一行"
            :disabled="disabled || at === 0"
            @click="moveRow(at, -1)"
          />
          <DtButton
            size="sm"
            variant="ghost"
            icon="chevron-down"
            aria-label="下移这一行"
            :disabled="disabled || at === rowEntries.length - 1"
            @click="moveRow(at, 1)"
          />
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
      </div>
      <DtField
        v-for="sub in visibleCells(entry.row)"
        :key="sub.key"
        :label="sub.label"
        size="sm"
      >
        <ConfigFieldControl
          :field="sub"
          :value="readCell(entry.row, sub.key)"
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
