<script setup lang="ts">
/**
 * @fileoverview 多层填充的编辑面：每层一档 kind（纯色 / 线性 / 径向 / 条纹 / 图片），
 * 渐变那两档带色标子表，可增删与调序。多层从下往上叠。
 *
 * ⚠ 新层与新色标给的都是**看得见**的初值，不是归一化缺省：缺省的渐变一个色标都没有、
 *   条纹缝隙是 0，加一层等于什么都没发生，用户只会以为按钮坏了。
 * ⚠ 图片层没有素材引用就会被归一化整层丢掉，所以引用为空时这一格直接标红说明——
 *   不标的话，用户配好一层图片、存一次再读回来，那一层凭空消失且零报错。
 * ⚠ 每层与每个色标的 `id` 是 `v-for` 的 key 也是去重依据，不许补也不许重。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import { TWIN_2D_BACKGROUND_FITS, TWIN_2D_FILL_KINDS } from '@dt/twin2d'
import type {
  Twin2dBackgroundFit,
  Twin2dFill,
  Twin2dFillKind,
  Twin2dGradientStop,
} from '@dt/twin2d'
import { DtButton, DtInput, DtNumberInput, DtSelect } from '@dt/ui'

import { TWIN_2D_UNIT_RANGE } from '../../scripts/inspectorFields'
import { freshTwin2dId, orderList } from '../../scripts/nodeOps'
import ColorField from './ColorField.vue'

const props = defineProps<{
  modelValue: readonly Twin2dFill[]
  /** 空态那一行的说明；不给就只显示一个新增键。 */
  hint?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [readonly Twin2dFill[]]
  blur: []
}>()

type LinearFill = Extract<Twin2dFill, { kind: 'linear' }>
type RadialFill = Extract<Twin2dFill, { kind: 'radial' }>
type RepeatFill = Extract<Twin2dFill, { kind: 'repeat' }>
type ImageFill = Extract<Twin2dFill, { kind: 'image' }>
type SolidFill = Extract<Twin2dFill, { kind: 'solid' }>

/** 填充层 id 的前缀。 */
const ROW_PREFIX = 'fill'
/** 色标 id 的前缀。 */
const STOP_PREFIX = 'stop'

/** 与 `colorOr` 的兜底同一档。 */
const INHERITED_COLOR = 'currentColor'
/** 渐变收尾那一档：透到底。 */
const FADE_COLOR = 'transparent'

/** 图片层缺了引用的说明。 */
const REF_REQUIRED = '必填：没有引用的图片层会在存盘时被整层丢掉'

const ANGLE_RANGE = { min: 0, max: 360, step: 15 }
const PX_RANGE = { min: 0.5, step: 1 }

const KIND_LABELS: Readonly<Record<Twin2dFillKind, string>> = {
  solid: '纯色',
  linear: '线性渐变',
  radial: '径向渐变',
  repeat: '条纹',
  image: '图片',
}

const FIT_LABELS: Readonly<Record<Twin2dBackgroundFit, string>> = {
  cover: '铺满裁切',
  contain: '完整放入',
  stretch: '拉伸',
  tile: '平铺',
}

const KIND_OPTIONS = TWIN_2D_FILL_KINDS.map((value) => ({
  value,
  label: KIND_LABELS[value],
}))

const FIT_OPTIONS = TWIN_2D_BACKGROUND_FITS.map((value) => ({
  value,
  label: FIT_LABELS[value],
}))

function write(next: readonly Twin2dFill[]): void {
  emit('update:modelValue', next)
}

function rowOf(id: string): Twin2dFill | undefined {
  return props.modelValue.find((row) => row.id === id)
}

function writeFill(next: Twin2dFill): void {
  write(props.modelValue.map((row) => (row.id === next.id ? next : row)))
}

/** 两档色标：从本色渐到透明，落地就看得见。 */
function blankStops(id: string): Twin2dGradientStop[] {
  return [
    { id: `${id}-a`, color: INHERITED_COLOR, at: 0 },
    { id: `${id}-b`, color: FADE_COLOR, at: 1 },
  ]
}

/** 一档新填充；取值是看得见的初值，不是归一化缺省。 */
function blankFill(
  kind: Twin2dFillKind,
  id: string,
  opacity: number,
): Twin2dFill {
  switch (kind) {
    case 'linear':
      return { kind, id, angle: 180, stops: blankStops(id), opacity }
    case 'radial':
      return {
        kind,
        id,
        cx: 0.5,
        cy: 0.5,
        r: 0.5,
        stops: blankStops(id),
        opacity,
      }
    case 'repeat':
      return {
        kind,
        id,
        angle: 45,
        color: INHERITED_COLOR,
        width: 1,
        gap: 4,
        opacity,
      }
    case 'image':
      return { kind, id, ref: '', fit: 'cover', opacity }
    default:
      return { kind: 'solid', id, color: INHERITED_COLOR, opacity }
  }
}

function addRow(): void {
  const taken = new Set(props.modelValue.map((row) => row.id))
  const id = freshTwin2dId(ROW_PREFIX, taken)
  write([...props.modelValue, blankFill('solid', id, 1)])
}

function removeRow(id: string): void {
  write(props.modelValue.filter((row) => row.id !== id))
}

/** 往表头挪（压在下面）或往表尾挪（盖在别层上头）。 */
function moveRow(id: string, up: boolean): void {
  write(orderList(props.modelValue, [id], up ? 'backward' : 'forward'))
}

function writeKind(id: string, next: string): void {
  const kind = TWIN_2D_FILL_KINDS.find((item) => item === next)
  const row = rowOf(id)
  if (kind === undefined || row === undefined || row.kind === kind) return
  writeFill(blankFill(kind, id, row.opacity))
}

function patchOpacity(id: string, opacity: number): void {
  const row = rowOf(id)
  if (row !== undefined) writeFill({ ...row, opacity })
}

function patchSolid(id: string, patch: Partial<SolidFill>): void {
  const row = rowOf(id)
  if (row?.kind === 'solid') writeFill({ ...row, ...patch })
}

function patchLinear(id: string, patch: Partial<LinearFill>): void {
  const row = rowOf(id)
  if (row?.kind === 'linear') writeFill({ ...row, ...patch })
}

function patchRadial(id: string, patch: Partial<RadialFill>): void {
  const row = rowOf(id)
  if (row?.kind === 'radial') writeFill({ ...row, ...patch })
}

function patchRepeat(id: string, patch: Partial<RepeatFill>): void {
  const row = rowOf(id)
  if (row?.kind === 'repeat') writeFill({ ...row, ...patch })
}

function patchImage(id: string, patch: Partial<ImageFill>): void {
  const row = rowOf(id)
  if (row?.kind === 'image') writeFill({ ...row, ...patch })
}

function writeStops(id: string, stops: readonly Twin2dGradientStop[]): void {
  const row = rowOf(id)
  if (row?.kind === 'linear') writeFill({ ...row, stops })
  if (row?.kind === 'radial') writeFill({ ...row, stops })
}

/** 这一层的色标；不是渐变档就是空表。 */
function stopsOf(row: Twin2dFill): readonly Twin2dGradientStop[] {
  return row.kind === 'linear' || row.kind === 'radial' ? row.stops : []
}

function patchStop(
  id: string,
  stopId: string,
  patch: Partial<Twin2dGradientStop>,
): void {
  const row = rowOf(id)
  if (row === undefined) return
  writeStops(
    id,
    stopsOf(row).map((stop) =>
      stop.id === stopId ? { ...stop, ...patch } : stop,
    ),
  )
}

function addStop(id: string): void {
  const row = rowOf(id)
  if (row === undefined) return
  const stops = stopsOf(row)
  const taken = new Set(stops.map((stop) => stop.id))
  writeStops(id, [
    ...stops,
    { id: freshTwin2dId(STOP_PREFIX, taken), color: INHERITED_COLOR, at: 1 },
  ])
}

function removeStop(id: string, stopId: string): void {
  const row = rowOf(id)
  if (row === undefined) return
  writeStops(
    id,
    stopsOf(row).filter((stop) => stop.id !== stopId),
  )
}

function writeFit(id: string, next: string): void {
  const fit = TWIN_2D_BACKGROUND_FITS.find((item) => item === next)
  if (fit !== undefined) patchImage(id, { fit })
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
      v-for="(row, index) in modelValue"
      :key="row.id"
      class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-sunken p-2"
      :data-test="`fill-row-${row.id}`"
    >
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
          第 {{ index + 1 }} 层
        </span>
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="chevron-up"
          :disabled="index === 0"
          aria-label="上移这一层"
          title="上移这一层"
          :data-test="`fill-up-${row.id}`"
          @click="moveRow(row.id, true)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="chevron-down"
          :disabled="index === modelValue.length - 1"
          aria-label="下移这一层"
          title="下移这一层"
          :data-test="`fill-down-${row.id}`"
          @click="moveRow(row.id, false)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删除这一层"
          title="删除这一层"
          :data-test="`fill-remove-${row.id}`"
          @click="removeRow(row.id)"
        />
      </div>

      <div class="grid grid-cols-2 gap-1.5">
        <DtSelect
          :model-value="row.kind"
          :options="KIND_OPTIONS"
          label="画法"
          size="sm"
          :data-test="`fill-kind-${row.id}`"
          @update:model-value="writeKind(row.id, $event)"
        />
        <DtNumberInput
          :model-value="row.opacity"
          :range="TWIN_2D_UNIT_RANGE"
          label="不透明度"
          size="sm"
          :steppers="false"
          :data-test="`fill-opacity-${row.id}`"
          @update:model-value="patchOpacity(row.id, $event ?? 1)"
        />
      </div>

      <ColorField
        v-if="row.kind === 'solid'"
        :model-value="row.color"
        :fallback="INHERITED_COLOR"
        label="颜色"
        @update:model-value="patchSolid(row.id, { color: $event })"
      />

      <DtNumberInput
        v-if="row.kind === 'linear'"
        :model-value="row.angle"
        :range="ANGLE_RANGE"
        label="角度"
        unit="°"
        size="sm"
        :steppers="false"
        :data-test="`fill-angle-${row.id}`"
        @update:model-value="patchLinear(row.id, { angle: $event ?? 0 })"
      />

      <div v-if="row.kind === 'radial'" class="grid grid-cols-3 gap-1.5">
        <DtNumberInput
          :model-value="row.cx"
          :range="TWIN_2D_UNIT_RANGE"
          label="圆心 X"
          size="sm"
          :steppers="false"
          :data-test="`fill-cx-${row.id}`"
          @update:model-value="patchRadial(row.id, { cx: $event ?? 0 })"
        />
        <DtNumberInput
          :model-value="row.cy"
          :range="TWIN_2D_UNIT_RANGE"
          label="圆心 Y"
          size="sm"
          :steppers="false"
          :data-test="`fill-cy-${row.id}`"
          @update:model-value="patchRadial(row.id, { cy: $event ?? 0 })"
        />
        <DtNumberInput
          :model-value="row.r"
          :range="TWIN_2D_UNIT_RANGE"
          label="半径"
          size="sm"
          :steppers="false"
          :data-test="`fill-r-${row.id}`"
          @update:model-value="patchRadial(row.id, { r: $event ?? 0 })"
        />
      </div>

      <div v-if="row.kind === 'repeat'" class="flex flex-col gap-1.5">
        <div class="grid grid-cols-3 gap-1.5">
          <DtNumberInput
            :model-value="row.angle"
            :range="ANGLE_RANGE"
            label="角度"
            unit="°"
            size="sm"
            :steppers="false"
            :data-test="`fill-repeat-angle-${row.id}`"
            @update:model-value="patchRepeat(row.id, { angle: $event ?? 0 })"
          />
          <DtNumberInput
            :model-value="row.width"
            :range="PX_RANGE"
            label="条宽"
            unit="px"
            size="sm"
            :steppers="false"
            :data-test="`fill-repeat-width-${row.id}`"
            @update:model-value="patchRepeat(row.id, { width: $event ?? 1 })"
          />
          <DtNumberInput
            :model-value="row.gap"
            :range="PX_RANGE"
            label="缝隙"
            unit="px"
            size="sm"
            :steppers="false"
            :data-test="`fill-repeat-gap-${row.id}`"
            @update:model-value="patchRepeat(row.id, { gap: $event ?? 1 })"
          />
        </div>
        <ColorField
          :model-value="row.color"
          :fallback="INHERITED_COLOR"
          label="条纹色"
          @update:model-value="patchRepeat(row.id, { color: $event })"
        />
      </div>

      <div v-if="row.kind === 'image'" class="grid grid-cols-2 gap-1.5">
        <DtInput
          :model-value="row.ref"
          label="素材引用"
          placeholder="asset:… 或 https://…"
          size="sm"
          :error="row.ref === '' ? REF_REQUIRED : ''"
          :data-test="`fill-ref-${row.id}`"
          @update:model-value="patchImage(row.id, { ref: $event })"
        />
        <DtSelect
          :model-value="row.fit"
          :options="FIT_OPTIONS"
          label="铺法"
          size="sm"
          :data-test="`fill-fit-${row.id}`"
          @update:model-value="writeFit(row.id, $event)"
        />
      </div>

      <div
        v-if="row.kind === 'linear' || row.kind === 'radial'"
        class="flex flex-col gap-1"
      >
        <div
          v-for="stop in row.stops"
          :key="stop.id"
          class="flex items-end gap-1"
          :data-test="`fill-stop-${stop.id}`"
        >
          <ColorField
            class="min-w-0 flex-1"
            :model-value="stop.color"
            :fallback="INHERITED_COLOR"
            label="色标"
            @update:model-value="patchStop(row.id, stop.id, { color: $event })"
          />
          <DtNumberInput
            class="w-24 shrink-0"
            :model-value="stop.at"
            :range="TWIN_2D_UNIT_RANGE"
            label="位置"
            size="sm"
            :steppers="false"
            :data-test="`fill-stop-at-${stop.id}`"
            @update:model-value="
              patchStop(row.id, stop.id, { at: $event ?? 0 })
            "
          />
          <DtButton
            size="xs"
            variant="ghost"
            intent="danger"
            icon="trash"
            aria-label="删除色标"
            title="删除色标"
            :data-test="`fill-stop-remove-${stop.id}`"
            @click="removeStop(row.id, stop.id)"
          />
        </div>
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="plus"
          :data-test="`fill-stop-add-${row.id}`"
          @click="addStop(row.id)"
        >
          新增色标
        </DtButton>
      </div>
    </div>

    <DtButton
      size="sm"
      variant="soft"
      intent="neutral"
      icon="plus"
      block
      data-test="fill-add"
      @click="addRow"
    >
      新增一层填充
    </DtButton>
  </div>
</template>
