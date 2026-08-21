<script setup lang="ts">
/**
 * @fileoverview 一张信息牌上的字段列表：增删改与上下移。
 *
 * ⚠ 本模块最安静的一个坑：牌上字段的实时值是按「**所有信息牌的字段摊平之后**」
 * 的文档序对齐的（见 `flattenPanelFields`）。在前面插一个字段，会让它之后的每一行
 * ——包括后面每一张牌——整体后移一格。所以每一行都标出它当前的行号，让用户看得见
 * 自己动了什么；`rowOffset` 是本牌之前已有多少行，页面知道全部牌时传进来。
 */
import {
  type TwinPanel,
  type TwinPanelField,
  flattenPanelFields,
} from '@dt/twin-config'
import {
  DtDropdownMenu,
  DtButton,
  DtEmpty,
  DtInput,
  DtNotice,
  DtNumberInput,
  DtSwitch,
} from '@dt/ui'
import type { DtMenuItem } from '@dt/contracts'
import { computed } from 'vue'

import { PANEL_FIELD_PRESETS } from '../../scripts/panelFieldPresets'

const props = defineProps<{
  panel: TwinPanel
  /** 本牌之前已有多少行摊平字段；不给就按本牌内序号显示，不假装知道全局位置。 */
  rowOffset?: number | undefined
}>()

const emit = defineEmits<{ 'update:fields': [TwinPanelField[]] }>()

const DECIMALS_RANGE = { min: 0, max: 10, step: 1 }

/** 一行字段连同它的行号与取值键。 */
const rows = computed(() =>
  flattenPanelFields([props.panel]).map((entry, index) => ({
    key: `${entry.field.key}#${index}`,
    field: entry.field,
    valueKey: entry.valueKey,
    index,
    row: (props.rowOffset ?? 0) + index + 1,
  })),
)

const rowLabel = computed(() =>
  props.rowOffset === undefined ? '本牌第' : '第',
)

/**
 * ⚠ 实时值按 `<牌 id>::<字段 key>` 索引：牌内键重了，两个字段会抢同一份值，
 * 界面上看不出是重名造成的。
 */
const duplicateKeys = computed(() => {
  const seen = new Set<string>()
  const clashed = new Set<string>()
  for (const field of props.panel.fields) {
    if (seen.has(field.key)) clashed.add(field.key)
    seen.add(field.key)
  }
  return [...clashed]
})

function write(next: TwinPanelField[]): void {
  emit('update:fields', next)
}

/** 改一行的若干属性；整份换新数组，不就地改。 */
function patch(index: number, next: Partial<TwinPanelField>): void {
  write(
    props.panel.fields.map((field, at) =>
      at === index ? { ...field, ...next } : field,
    ),
  )
}

/** 牌内不重名的新键。 */
function freshKey(): string {
  const taken = new Set(props.panel.fields.map((field) => field.key))
  let serial = props.panel.fields.length + 1
  while (taken.has(`f${serial}`)) serial += 1
  return `f${serial}`
}

/** 常用测点菜单：点一项就按它的展示口径加一个字段。 */
const presetItems = computed<DtMenuItem[]>(() =>
  PANEL_FIELD_PRESETS.map((preset) => ({
    value: preset.id,
    label:
      preset.unit === '' ? preset.label : `${preset.label}（${preset.unit}）`,
  })),
)

function addPreset(item: DtMenuItem): void {
  const preset = PANEL_FIELD_PRESETS.find((entry) => entry.id === item.value)
  if (preset === undefined) return
  write([
    ...props.panel.fields,
    {
      key: freshKey(),
      label: preset.label,
      unit: preset.unit,
      prefix: '',
      decimals: preset.decimals,
      staticText: '',
    },
  ])
}

function add(): void {
  write([
    ...props.panel.fields,
    {
      key: freshKey(),
      label: `字段 ${props.panel.fields.length + 1}`,
      unit: '',
      prefix: '',
      decimals: null,
      staticText: '',
    },
  ])
}

function removeAt(index: number): void {
  write(props.panel.fields.filter((_, at) => at !== index))
}

/**
 * 挪动一行。
 * @param index 当前位置
 * @param delta -1 上移，1 下移
 */
function move(index: number, delta: number): void {
  const to = index + delta
  const next = [...props.panel.fields]
  const moved = next[index]
  if (to < 0 || to >= next.length || moved === undefined) return
  next.splice(index, 1)
  next.splice(to, 0, moved)
  write(next)
}

/** 小数位有「不定位数」这一档：null ≠ 0，0 是「取整」。 */
function toggleDecimals(index: number, on: boolean): void {
  patch(index, { decimals: on ? 0 : null })
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="text-xs text-text-disabled">
      实时值按所有信息牌字段摊平后的文档序对齐：在前面插一行，它之后的每一行（含后面每一张牌）整体后移一格。
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
    >
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
          {{ rowLabel }} {{ row.row }} 行 · {{ row.valueKey }}
        </span>
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="chevron-up"
          :disabled="row.index === 0"
          aria-label="上移字段"
          title="上移字段"
          @click="move(row.index, -1)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="chevron-down"
          :disabled="row.index === rows.length - 1"
          aria-label="下移字段"
          title="下移字段"
          @click="move(row.index, 1)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删除字段"
          title="删除字段"
          @click="removeAt(row.index)"
        />
      </div>

      <div class="grid grid-cols-2 gap-1.5">
        <DtInput
          :model-value="row.field.key"
          aria-label="字段键"
          placeholder="字段键"
          size="sm"
          @update:model-value="patch(row.index, { key: $event })"
        />
        <DtInput
          :model-value="row.field.label"
          aria-label="标签"
          placeholder="标签"
          size="sm"
          @update:model-value="patch(row.index, { label: $event })"
        />
        <DtInput
          :model-value="row.field.prefix"
          aria-label="数值前缀"
          placeholder="前缀"
          size="sm"
          @update:model-value="patch(row.index, { prefix: $event })"
        />
        <DtInput
          :model-value="row.field.unit"
          aria-label="单位"
          placeholder="单位"
          size="sm"
          @update:model-value="patch(row.index, { unit: $event })"
        />
      </div>

      <div class="flex items-center gap-1.5">
        <DtSwitch
          :model-value="row.field.decimals !== null"
          aria-label="指定小数位"
          size="sm"
          @update:model-value="toggleDecimals(row.index, $event)"
        />
        <span class="shrink-0 text-xs text-text-secondary">小数位</span>
        <DtNumberInput
          v-if="row.field.decimals !== null"
          class="min-w-0 flex-1"
          :model-value="row.field.decimals"
          :range="DECIMALS_RANGE"
          aria-label="小数位"
          size="sm"
          :steppers="false"
          @update:model-value="patch(row.index, { decimals: $event ?? 0 })"
        />
        <span v-else class="min-w-0 flex-1 text-xs text-text-disabled">
          不定位数，按原值上屏
        </span>
      </div>

      <DtInput
        :model-value="row.field.staticText"
        aria-label="静态文本"
        placeholder="静态文本（没有实时值时显示）"
        size="sm"
        @update:model-value="patch(row.index, { staticText: $event })"
      />
    </div>

    <DtEmpty
      v-if="rows.length === 0"
      size="inline"
      title="这张牌上还没有字段，画出来是一张空卡片。"
    />
    <p v-else class="text-xs text-text-disabled">
      静态文本纯展示、不进求值，与「常量绑定」不是一回事。
    </p>

    <div class="flex items-center gap-2">
      <DtButton variant="soft" size="sm" icon="plus" block @click="add">
        添加字段
      </DtButton>
      <!-- 现场牌面上多半就是这十来种量，省掉逐个填标签单位小数位 -->
      <!-- ⚠ DtDropdownMenu 没有 icon prop，想换触发图标只能自供 trigger 插槽 -->
      <DtDropdownMenu
        size="sm"
        label="常用测点"
        :items="presetItems"
        data-test="panel-field-presets"
        @select="addPreset"
      />
    </div>
  </div>
</template>
