<script setup lang="ts">
/**
 * @fileoverview 多遍描边的编辑面：每遍一行（线宽、颜色、虚线、线端、折角、不透明度、
 * 是否随舞台缩放），可增删与调序。宽底窄芯叠成双线，单遍大线宽就是母线。
 *
 * ⚠ 线宽不许落到 0：SVG 上 0 宽什么都不画，整张图看着只是「引脚没了」，既不报错也
 *   不像 bug。新一遍给 2px，归一化那边把 0 与负数一律顶回 1px。
 * ⚠ 虚线框逐键解析，认不出的**逐段丢弃**（与 `normalizeStrokes` 的判据同一份），但框里
 *   留用户敲的原文：不留的话「4 4」删掉末位后那个空格会被一并吃掉，再打就成了「48」。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import { TWIN_2D_STROKE_CAPS, TWIN_2D_STROKE_JOINS } from '@dt/twin2d'
import type {
  Twin2dStrokeCap,
  Twin2dStrokeJoin,
  Twin2dStrokePass,
} from '@dt/twin2d'
import { DtButton, DtCheckbox, DtInput, DtNumberInput, DtSelect } from '@dt/ui'
import { ref, watch } from 'vue'

import { TWIN_2D_UNIT_RANGE } from '../../scripts/inspectorFields'
import { freshTwin2dId, orderList } from '../../scripts/nodeOps'
import ColorField from './ColorField.vue'

const props = defineProps<{
  modelValue: readonly Twin2dStrokePass[]
  /** 空态那一行的说明；不给就只显示一个新增键。 */
  hint?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [readonly Twin2dStrokePass[]]
  blur: []
}>()

/** 描边遍 id 的前缀。 */
const ROW_PREFIX = 'stroke'

/** 与 `colorOr` 的兜底同一档。 */
const INHERITED_COLOR = 'currentColor'

/** 虚线段之间的分隔：空白或逗号都收。 */
const DASH_SEP = /[\s,]+/

const WIDTH_RANGE = { min: 0.1, step: 0.5 }

/** 一遍新描边：2px 实心芯线，落地就看得见。 */
const NEW_STROKE: Omit<Twin2dStrokePass, 'id'> = Object.freeze({
  width: 2,
  color: INHERITED_COLOR,
  dash: Object.freeze([]),
  cap: 'butt',
  join: 'miter',
  opacity: 1,
  nonScaling: false,
})

const CAP_LABELS: Readonly<Record<Twin2dStrokeCap, string>> = {
  butt: '平头',
  round: '圆头',
  square: '方头',
}

const JOIN_LABELS: Readonly<Record<Twin2dStrokeJoin, string>> = {
  miter: '尖角',
  round: '圆角',
  bevel: '斜切',
}

const CAP_OPTIONS = TWIN_2D_STROKE_CAPS.map((value) => ({
  value,
  label: CAP_LABELS[value],
}))

const JOIN_OPTIONS = TWIN_2D_STROKE_JOINS.map((value) => ({
  value,
  label: JOIN_LABELS[value],
}))

/** 每一行虚线框里的原文，键是行 id。 */
const drafts = ref<Record<string, string>>({})

/** 焦点还在本控件里；在里面时不拿文档里的值去盖用户正敲着的那半截。 */
const focused = ref(false)

function dashText(dash: readonly number[]): string {
  return dash.join(' ')
}

function seed(): void {
  drafts.value = Object.fromEntries(
    props.modelValue.map((row) => [row.id, dashText(row.dash)]),
  )
}

watch(
  () => props.modelValue,
  () => {
    if (!focused.value) seed()
  },
  { immediate: true },
)

function onFocusIn(): void {
  focused.value = true
}

function onFocusOut(): void {
  focused.value = false
  seed()
  emit('blur')
}

function write(next: readonly Twin2dStrokePass[]): void {
  emit('update:modelValue', next)
}

function patchRow(id: string, patch: Partial<Twin2dStrokePass>): void {
  write(
    props.modelValue.map((row) => (row.id === id ? { ...row, ...patch } : row)),
  )
}

function addRow(): void {
  const taken = new Set(props.modelValue.map((row) => row.id))
  write([
    ...props.modelValue,
    { ...NEW_STROKE, id: freshTwin2dId(ROW_PREFIX, taken) },
  ])
}

function removeRow(id: string): void {
  write(props.modelValue.filter((row) => row.id !== id))
}

/** 往表头挪（画在底下）或往表尾挪（盖在别遍上头）。 */
function moveRow(id: string, up: boolean): void {
  write(orderList(props.modelValue, [id], up ? 'backward' : 'forward'))
}

/** 认不出与负数的段逐个丢弃，与 `normalizeStrokes` 的 `dashOf` 同一口径。 */
function parseDash(raw: string): number[] {
  const kept: number[] = []
  for (const piece of raw.trim().split(DASH_SEP)) {
    const length = Number(piece)
    if (piece === '' || !Number.isFinite(length) || length < 0) continue
    kept.push(length)
  }
  return kept
}

function onDash(id: string, raw: string): void {
  drafts.value = { ...drafts.value, [id]: raw }
  patchRow(id, { dash: parseDash(raw) })
}

function writeCap(id: string, next: string): void {
  const cap = TWIN_2D_STROKE_CAPS.find((item) => item === next)
  if (cap !== undefined) patchRow(id, { cap })
}

function writeJoin(id: string, next: string): void {
  const join = TWIN_2D_STROKE_JOINS.find((item) => item === next)
  if (join !== undefined) patchRow(id, { join })
}
</script>

<template>
  <div
    class="flex flex-col gap-1.5"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
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
      :data-test="`stroke-row-${row.id}`"
    >
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
          第 {{ index + 1 }} 遍
        </span>
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="chevron-up"
          :disabled="index === 0"
          aria-label="上移这一遍"
          title="上移这一遍"
          :data-test="`stroke-up-${row.id}`"
          @click="moveRow(row.id, true)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="chevron-down"
          :disabled="index === modelValue.length - 1"
          aria-label="下移这一遍"
          title="下移这一遍"
          :data-test="`stroke-down-${row.id}`"
          @click="moveRow(row.id, false)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删除这一遍"
          title="删除这一遍"
          :data-test="`stroke-remove-${row.id}`"
          @click="removeRow(row.id)"
        />
      </div>

      <div class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          :model-value="row.width"
          :range="WIDTH_RANGE"
          label="线宽"
          unit="px"
          size="sm"
          :steppers="false"
          :data-test="`stroke-width-${row.id}`"
          @update:model-value="patchRow(row.id, { width: $event ?? 1 })"
        />
        <DtNumberInput
          :model-value="row.opacity"
          :range="TWIN_2D_UNIT_RANGE"
          label="不透明度"
          size="sm"
          :steppers="false"
          :data-test="`stroke-opacity-${row.id}`"
          @update:model-value="patchRow(row.id, { opacity: $event ?? 1 })"
        />
        <DtSelect
          :model-value="row.cap"
          :options="CAP_OPTIONS"
          label="线端"
          size="sm"
          :data-test="`stroke-cap-${row.id}`"
          @update:model-value="writeCap(row.id, $event)"
        />
        <DtSelect
          :model-value="row.join"
          :options="JOIN_OPTIONS"
          label="折角"
          size="sm"
          :data-test="`stroke-join-${row.id}`"
          @update:model-value="writeJoin(row.id, $event)"
        />
      </div>

      <DtInput
        :model-value="drafts[row.id] ?? ''"
        label="虚线"
        placeholder="留空 = 实线；4 4 = 等长虚线"
        size="sm"
        :data-test="`stroke-dash-${row.id}`"
        @update:model-value="onDash(row.id, $event)"
      />

      <ColorField
        :model-value="row.color"
        :fallback="INHERITED_COLOR"
        label="颜色"
        @update:model-value="patchRow(row.id, { color: $event })"
      />

      <DtCheckbox
        :model-value="row.nonScaling"
        label="线宽不随舞台缩放"
        :data-test="`stroke-nonscaling-${row.id}`"
        @update:model-value="patchRow(row.id, { nonScaling: $event })"
      />
    </div>

    <DtButton
      size="sm"
      variant="soft"
      intent="neutral"
      icon="plus"
      block
      data-test="stroke-add"
      @click="addRow"
    >
      新增一遍描边
    </DtButton>
  </div>
</template>
