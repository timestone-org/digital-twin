<script setup lang="ts">
/**
 * @fileoverview `vec` 的局部渐变表：每条一行（两档 kind、坐标、色标子表），可增删。
 * 填充那一格按 id 引它。
 *
 * ⚠ 坐标恒是**对象包围盒**的 0..1 归一值（SVG `gradientUnits` 的缺省档），与 vec 的
 *   `coord` 无关：跟着乘一遍盒尺寸会让渐变整个跑到形状外面去，画面上只剩纯色。
 * ⚠ 渐变 id 是身份不是标签，所以这里不给改：填充那一格按它引，改了名等于把填充指空，
 *   而 SVG 对 `fill="url(#缺)"` 是整个不上色——看着像「填充色配错了」。
 * ⚠ 正被填充引着的那一条删掉之后，那一笔会整个不上色，所以行上先标出来。
 * ⚠ 新条目与新色标给的都是**看得见**的初值，不是归一化缺省：缺省的渐变一个色标都
 *   没有，加一条等于什么都没发生，用户只会以为按钮坏了。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import { TWIN_2D_GRADIENT_KINDS } from '@dt/twin2d'
import type {
  Twin2dGradient,
  Twin2dGradientKind,
  Twin2dGradientStop,
} from '@dt/twin2d'
import { DtButton, DtNumberInput, DtSelect } from '@dt/ui'

import { TWIN_2D_UNIT_RANGE } from '../../../scripts/inspectorFields'
import { freshTwin2dId } from '../../../scripts/nodeOps'
import ColorField from '../../fields/ColorField.vue'

const props = defineProps<{
  modelValue: readonly Twin2dGradient[]
  /** 填充正引着的那个渐变 id；不给就都不标。 */
  usedId?: string
  /** 空态那一行的说明；不给就只显示一个新增键。 */
  hint?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [readonly Twin2dGradient[]]
  blur: []
}>()

/** 渐变 id 的前缀。 */
const ROW_PREFIX = 'grad'

/** 色标 id 的前缀。 */
const STOP_PREFIX = 'stop'

/** 与 `colorOr` 的兜底同一档。 */
const INHERITED_COLOR = 'currentColor'

/** 渐变收尾那一档：透到底。 */
const FADE_COLOR = 'transparent'

/** 归一坐标一格 0.05；`r` 与两端同一量纲。 */
const AXIS_RANGE = { step: 0.05 }

const KIND_LABELS: Readonly<Record<Twin2dGradientKind, string>> = {
  linear: '线性',
  radial: '径向',
}

const KIND_OPTIONS = TWIN_2D_GRADIENT_KINDS.map((value) => ({
  value,
  label: KIND_LABELS[value],
}))

/** 线性那一档的四格；次序就是 SVG 属性名的次序。 */
const LINEAR_CELLS = [
  { key: 'x1', label: '起点 X' },
  { key: 'y1', label: '起点 Y' },
  { key: 'x2', label: '终点 X' },
  { key: 'y2', label: '终点 Y' },
] as const

/** 径向那一档的五格。 */
const RADIAL_CELLS = [
  { key: 'cx', label: '圆心 X' },
  { key: 'cy', label: '圆心 Y' },
  { key: 'r', label: '半径' },
  { key: 'fx', label: '焦点 X' },
  { key: 'fy', label: '焦点 Y' },
] as const

function write(next: readonly Twin2dGradient[]): void {
  emit('update:modelValue', next)
}

function writeRow(next: Twin2dGradient): void {
  write(props.modelValue.map((row) => (row.id === next.id ? next : row)))
}

/** 两档色标：从本色渐到透明，落地就看得见。 */
function blankStops(id: string): Twin2dGradientStop[] {
  return [
    { id: `${id}-a`, color: INHERITED_COLOR, at: 0 },
    { id: `${id}-b`, color: FADE_COLOR, at: 1 },
  ]
}

/** 一条新渐变；取值是看得见的初值，不是归一化缺省。 */
function blankGradient(
  kind: Twin2dGradientKind,
  id: string,
  stops: readonly Twin2dGradientStop[],
): Twin2dGradient {
  if (kind === 'radial') {
    return { kind, id, cx: 0.5, cy: 0.5, r: 0.5, fx: 0.5, fy: 0.5, stops }
  }
  return { kind, id, x1: 0, y1: 0, x2: 1, y2: 0, stops }
}

function addRow(): void {
  const taken = new Set(props.modelValue.map((row) => row.id))
  const id = freshTwin2dId(ROW_PREFIX, taken)
  write([...props.modelValue, blankGradient('linear', id, blankStops(id))])
}

function removeRow(id: string): void {
  write(props.modelValue.filter((row) => row.id !== id))
}

/** 换档；色标跟着过去，重配一遍两个色标是最没必要的一次返工。 */
function writeKind(row: Twin2dGradient, next: string): void {
  const kind = TWIN_2D_GRADIENT_KINDS.find((item) => item === next)
  if (kind === undefined || kind === row.kind) return
  writeRow(blankGradient(kind, row.id, row.stops))
}

/**
 * 改线性那一档的一格坐标。
 * @param row 这一条渐变
 * @param key 哪一格
 * @param value 新值
 */
function writeLinear(
  row: Twin2dGradient,
  key: (typeof LINEAR_CELLS)[number]['key'],
  value: number,
): void {
  if (row.kind === 'linear') writeRow({ ...row, [key]: value })
}

/**
 * 改径向那一档的一格坐标。
 * @param row 这一条渐变
 * @param key 哪一格
 * @param value 新值
 */
function writeRadial(
  row: Twin2dGradient,
  key: (typeof RADIAL_CELLS)[number]['key'],
  value: number,
): void {
  if (row.kind === 'radial') writeRow({ ...row, [key]: value })
}

function writeStops(
  row: Twin2dGradient,
  stops: readonly Twin2dGradientStop[],
): void {
  writeRow({ ...row, stops })
}

function patchStop(
  row: Twin2dGradient,
  stopId: string,
  patch: Partial<Twin2dGradientStop>,
): void {
  writeStops(
    row,
    row.stops.map((stop) =>
      stop.id === stopId ? { ...stop, ...patch } : stop,
    ),
  )
}

function addStop(row: Twin2dGradient): void {
  const taken = new Set(row.stops.map((stop) => stop.id))
  writeStops(row, [
    ...row.stops,
    { id: freshTwin2dId(STOP_PREFIX, taken), color: INHERITED_COLOR, at: 1 },
  ])
}

function removeStop(row: Twin2dGradient, stopId: string): void {
  writeStops(
    row,
    row.stops.filter((stop) => stop.id !== stopId),
  )
}
</script>

<template>
  <div class="flex flex-col gap-1.5" @focusout="emit('blur')">
    <p
      v-if="modelValue.length === 0 && hint"
      class="text-xs text-text-disabled"
    >
      {{ hint }}
    </p>

    <div
      v-for="row in modelValue"
      :key="row.id"
      class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-sunken p-2"
      :data-test="`grad-row-${row.id}`"
    >
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
          {{ row.id }}
          <template v-if="row.id === usedId">· 填充正引着它</template>
        </span>
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删掉这条渐变"
          title="删掉这条渐变"
          :data-test="`grad-remove-${row.id}`"
          @click="removeRow(row.id)"
        />
      </div>

      <DtSelect
        :model-value="row.kind"
        :options="KIND_OPTIONS"
        label="渐变"
        size="sm"
        :data-test="`grad-kind-${row.id}`"
        @update:model-value="writeKind(row, $event)"
      />

      <div v-if="row.kind === 'linear'" class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          v-for="cell in LINEAR_CELLS"
          :key="cell.key"
          :model-value="row[cell.key]"
          :range="AXIS_RANGE"
          :label="cell.label"
          size="sm"
          :steppers="false"
          :data-test="`grad-${cell.key}-${row.id}`"
          @update:model-value="writeLinear(row, cell.key, $event ?? 0)"
        />
      </div>

      <div v-if="row.kind === 'radial'" class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          v-for="cell in RADIAL_CELLS"
          :key="cell.key"
          :model-value="row[cell.key]"
          :range="AXIS_RANGE"
          :label="cell.label"
          size="sm"
          :steppers="false"
          :data-test="`grad-${cell.key}-${row.id}`"
          @update:model-value="writeRadial(row, cell.key, $event ?? 0)"
        />
      </div>

      <div
        v-for="stop in row.stops"
        :key="stop.id"
        class="flex items-end gap-1"
        :data-test="`grad-stop-${stop.id}`"
      >
        <ColorField
          class="min-w-0 flex-1"
          :model-value="stop.color"
          :fallback="INHERITED_COLOR"
          label="色标"
          @update:model-value="patchStop(row, stop.id, { color: $event })"
        />
        <DtNumberInput
          class="w-20 shrink-0"
          :model-value="stop.at"
          :range="TWIN_2D_UNIT_RANGE"
          label="位置"
          size="sm"
          :steppers="false"
          :data-test="`grad-at-${stop.id}`"
          @update:model-value="patchStop(row, stop.id, { at: $event ?? 0 })"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删掉这个色标"
          title="删掉这个色标"
          :data-test="`grad-stop-remove-${stop.id}`"
          @click="removeStop(row, stop.id)"
        />
      </div>

      <DtButton
        size="xs"
        variant="ghost"
        intent="neutral"
        icon="plus"
        :data-test="`grad-stop-add-${row.id}`"
        @click="addStop(row)"
      >
        加一个色标
      </DtButton>
    </div>

    <DtButton
      size="sm"
      variant="soft"
      intent="neutral"
      icon="plus"
      block
      data-test="grad-add"
      @click="addRow"
    >
      新增一条渐变
    </DtButton>
  </div>
</template>
