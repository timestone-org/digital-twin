<script setup lang="ts">
/**
 * @fileoverview 一个钻取节点上的字段列表：增删改、上下移，外加「进摘要卡片」的勾选。
 *
 * ⚠ 摘要显示哪几个字段是**勾**出来的，不是手填 key：手填的 key 一旦与字段
 * 对不上，摘要卡片上那一行就安静地不出现，而配置里明明写着。
 * ⚠ 字段的实时值按「所有钻取节点的字段摊平之后」的文档序对齐，在前面插一行会让
 * 它之后的每一行——包括后面每一个节点——整体后移一格。
 */
import type { TwinHierNode, TwinPanelField } from '@dt/twin-config'
import { HIER_SUMMARY_FALLBACK_COUNT, flattenHierFields } from '@dt/twin-config'
import {
  DtButton,
  DtCheckbox,
  DtIcon,
  DtInput,
  DtNotice,
  DtNumberInput,
} from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{
  node: TwinHierNode
  /** 本节点之前已有多少行摊平字段；不给就按本节点内序号显示。 */
  rowOffset?: number | undefined
}>()

const emit = defineEmits<{
  'update:fields': [TwinPanelField[]]
  'update:summaryFieldKeys': [string[]]
}>()

const DECIMALS_RANGE = { min: 0, max: 10, step: 1 }

const rows = computed(() =>
  flattenHierFields([props.node]).map((entry, index) => ({
    key: `${entry.field.key}#${index}`,
    field: entry.field,
    valueKey: entry.valueKey,
    index,
    row: (props.rowOffset ?? 0) + index + 1,
  })),
)

const rowLabel = computed(() =>
  props.rowOffset === undefined ? '本节点第' : '第',
)

/** 一个都没勾时摘要取前两个，界面上把这句话说出来。 */
const usingFallback = computed(() => props.node.summaryFieldKeys.length === 0)

/**
 * ⚠ 实时值按 `<节点 id>::<字段 key>` 索引：节点内键重了，两个字段会抢同一份值，
 * 界面上看不出是重名造成的。
 */
const duplicateKeys = computed(() => {
  const seen = new Set<string>()
  const clashed = new Set<string>()
  for (const field of props.node.fields) {
    if (seen.has(field.key)) clashed.add(field.key)
    seen.add(field.key)
  }
  return [...clashed]
})

function write(next: TwinPanelField[]): void {
  emit('update:fields', next)
}

function patch(index: number, next: Partial<TwinPanelField>): void {
  write(
    props.node.fields.map((field, at) =>
      at === index ? { ...field, ...next } : field,
    ),
  )
}

/** 节点内不重名的新键。 */
function freshKey(): string {
  const taken = new Set(props.node.fields.map((field) => field.key))
  let serial = props.node.fields.length + 1
  while (taken.has(`f${serial}`)) serial += 1
  return `f${serial}`
}

function add(): void {
  write([
    ...props.node.fields,
    {
      key: freshKey(),
      label: `字段 ${props.node.fields.length + 1}`,
      unit: '',
      prefix: '',
      decimals: null,
      staticText: '',
    },
  ])
}

/** 删字段的同时把它从摘要勾选里摘掉，免得留下一个指不到东西的 key。 */
function removeAt(index: number): void {
  const gone = props.node.fields[index]
  write(props.node.fields.filter((_, at) => at !== index))
  if (gone === undefined) return
  emit(
    'update:summaryFieldKeys',
    props.node.summaryFieldKeys.filter((key) => key !== gone.key),
  )
}

/**
 * 挪动一行。
 * @param index 当前位置
 * @param delta -1 上移，1 下移
 */
function move(index: number, delta: number): void {
  const to = index + delta
  const next = [...props.node.fields]
  const moved = next[index]
  if (to < 0 || to >= next.length || moved === undefined) return
  next.splice(index, 1)
  next.splice(to, 0, moved)
  write(next)
}

function isSummary(key: string): boolean {
  return props.node.summaryFieldKeys.includes(key)
}

/** 勾选按 `fields` 的次序落库，摘要卡片上的先后才与列表一致。 */
function toggleSummary(key: string, on: boolean): void {
  const picked = new Set(props.node.summaryFieldKeys)
  if (on) picked.add(key)
  else picked.delete(key)
  emit(
    'update:summaryFieldKeys',
    props.node.fields.map((field) => field.key).filter((it) => picked.has(it)),
  )
}

/** 小数位有「不定位数」这一档：null ≠ 0，0 是「取整」。 */
function toggleDecimals(index: number, on: boolean): void {
  patch(index, { decimals: on ? 0 : null })
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="text-xs text-text-disabled">
      实时值按所有钻取节点字段摊平后的文档序对齐：在前面插一行，它之后的每一行（含后面每一个节点）整体后移一格。
    </p>

    <DtNotice
      v-if="duplicateKeys.length > 0"
      intent="warning"
      icon="alert-triangle"
    >
      字段键重复（{{ duplicateKeys.join('、') }}）：重名的两行会抢同一份实时值。
    </DtNotice>

    <div
      v-for="row in rows"
      :key="row.key"
      class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-sunken p-2"
      data-test="hier-field-row"
    >
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
          {{ rowLabel }} {{ row.row }} 行 · {{ row.valueKey }}
        </span>
        <button
          type="button"
          class="text-text-secondary hover:text-accent-primary disabled:text-text-disabled"
          :disabled="row.index === 0"
          aria-label="上移字段"
          title="上移字段"
          @click="move(row.index, -1)"
        >
          <DtIcon name="chevron-up" :size="13" />
        </button>
        <button
          type="button"
          class="text-text-secondary hover:text-accent-primary disabled:text-text-disabled"
          :disabled="row.index === rows.length - 1"
          aria-label="下移字段"
          title="下移字段"
          @click="move(row.index, 1)"
        >
          <DtIcon name="chevron-down" :size="13" />
        </button>
        <button
          type="button"
          class="text-text-disabled hover:text-state-danger"
          aria-label="删除字段"
          title="删除字段"
          data-test="hier-field-remove"
          @click="removeAt(row.index)"
        >
          <DtIcon name="trash" :size="13" />
        </button>
      </div>

      <div class="grid grid-cols-2 gap-1.5">
        <DtInput
          :model-value="row.field.label"
          aria-label="标签"
          placeholder="标签"
          size="sm"
          @update:model-value="patch(row.index, { label: $event })"
        />
        <DtInput
          :model-value="row.field.unit"
          aria-label="单位"
          placeholder="单位"
          size="sm"
          @update:model-value="patch(row.index, { unit: $event })"
        />
        <DtInput
          :model-value="row.field.prefix"
          aria-label="数值前缀"
          placeholder="前缀"
          size="sm"
          @update:model-value="patch(row.index, { prefix: $event })"
        />
        <DtNumberInput
          v-if="row.field.decimals !== null"
          :model-value="row.field.decimals"
          :range="DECIMALS_RANGE"
          aria-label="小数位"
          size="sm"
          :steppers="false"
          @update:model-value="patch(row.index, { decimals: $event ?? 0 })"
        />
        <DtCheckbox
          v-else
          :model-value="false"
          label="指定小数位"
          @update:model-value="toggleDecimals(row.index, $event)"
        />
      </div>

      <DtInput
        :model-value="row.field.staticText"
        aria-label="静态文本"
        placeholder="静态文本（没有实时值时显示）"
        size="sm"
        @update:model-value="patch(row.index, { staticText: $event })"
      />

      <div class="flex items-center gap-2">
        <DtCheckbox
          :model-value="isSummary(row.field.key)"
          label="进父层摘要卡片"
          data-test="hier-field-summary"
          @update:model-value="toggleSummary(row.field.key, $event)"
        />
        <code class="truncate text-3xs text-text-disabled">{{
          row.field.key
        }}</code>
      </div>
    </div>

    <p v-if="rows.length === 0" class="text-xs text-text-disabled">
      这一层还没有字段，钻进来只有名字没有读数。
    </p>
    <p v-else-if="usingFallback" class="text-xs text-text-disabled">
      一个都没勾时，父层摘要卡片取前 {{ HIER_SUMMARY_FALLBACK_COUNT }} 个字段。
    </p>

    <DtButton
      variant="soft"
      size="sm"
      icon="plus"
      block
      data-test="hier-field-add"
      @click="add"
    >
      添加字段
    </DtButton>
  </div>
</template>
