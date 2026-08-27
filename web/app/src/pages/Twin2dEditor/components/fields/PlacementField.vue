<script setup lang="ts">
/**
 * @fileoverview 摆位五档（排流 / 铺满 / 绝对 / 九宫锚点 / 周长贴边）的一格编辑面。
 *
 * ⚠ 九档锚点**一档不少**：参考项目的编辑器只给四档，手写 `'c'` 渲染得出来却选不到，
 *   一改就丢。九格按三行三列摆，不照 `TWIN_2D_ANCHORS` 的文档序（那是 t/b/l/r/… 的
 *   次序，直接 v-for 会摆成一团看不出方位），完整性由契约用例逐档点一遍钉住。
 * ⚠ 换档一律经 `normalizePlacement` 取缺省，不在这里抄一份：抄的那份一旦与归一化
 *   不一致，新换的这一档会在「存一次再读回来」之后悄悄变样。
 * ⚠ 长度框是逐键解析的，**解析不出就不写回文档**（`5e` 是 `5em` 打到一半）：写回去
 *   会把它压成 0，于是 `em` 与小数点永远打不完。失焦时把框拨回文档里的值。
 * ⚠ 控件自己不碰文档，只 emit；连续输入并成一帧撤销的时机由检查器定：逐键
 *   `commitMerged(next, key)`，收到本控件的 `blur` 时 `endMerge()`。
 */
import {
  TWIN_2D_PLACEMENT_KINDS,
  normalizePlacement,
  optionalLen,
  sanitizeCssValue,
} from '@dt/twin2d'
import type {
  Twin2dAnchor9,
  Twin2dInset,
  Twin2dLen,
  Twin2dPerimAt,
  Twin2dPlacement,
  Twin2dPlacementKind,
} from '@dt/twin2d'
import { DtButton, DtInput, DtNumberInput, DtSelect } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import { TWIN_2D_UNIT_RANGE } from '../../scripts/inspectorFields'

const props = defineProps<{ modelValue: Twin2dPlacement }>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dPlacement]
  blur: []
}>()

type AbsAt = Extract<Twin2dPlacement, { kind: 'abs' }>
type AnchorAt = Extract<Twin2dPlacement, { kind: 'anchor' }>
type FillAt = Extract<Twin2dPlacement, { kind: 'fill' }>
type AbsEdge = 'top' | 'right' | 'bottom' | 'left'

/** `tx` / `ty` 缺省不推移；与渲染层 `absCss` 的兜底逐字相同。 */
const NO_OFFSET = '0'

const KIND_LABELS: Readonly<Record<Twin2dPlacementKind, string>> = {
  flow: '参与排流',
  fill: '铺满父级',
  abs: '绝对定位',
  anchor: '九宫锚点',
  perim: '周长贴边',
}

const KIND_OPTIONS = TWIN_2D_PLACEMENT_KINDS.map((value) => ({
  value,
  label: KIND_LABELS[value],
}))

/** 四向内缩的次序与文档一致：t / r / b / l。 */
const INSET_CELLS = [
  { key: 'i0', label: '上内缩' },
  { key: 'i1', label: '右内缩' },
  { key: 'i2', label: '下内缩' },
  { key: 'i3', label: '左内缩' },
] as const

const ABS_CELLS = [
  { key: 'top', label: '上' },
  { key: 'right', label: '右' },
  { key: 'bottom', label: '下' },
  { key: 'left', label: '左' },
] as const satisfies readonly { key: AbsEdge; label: string }[]

/** 九格按方位摆，顺序就是屏幕上的三行三列。 */
const ANCHOR_CELLS = [
  'tl',
  't',
  'tr',
  'l',
  'c',
  'r',
  'bl',
  'b',
  'br',
] as const satisfies readonly Twin2dAnchor9[]

const ANCHOR_LABELS: Readonly<Record<Twin2dAnchor9, string>> = {
  tl: '左上',
  t: '上',
  tr: '右上',
  l: '左',
  c: '居中',
  r: '右',
  bl: '左下',
  b: '下',
  br: '右下',
}

/** 框里的原文，键与上面几张表的 `key` 一致。 */
const drafts = ref<Record<string, string>>({})

/** 焦点还在本控件里；在里面时不拿文档里的值去盖用户正敲着的那半截。 */
const focused = ref(false)

const fillAt = computed<FillAt | null>(() => {
  const at = props.modelValue
  return at.kind === 'fill' ? at : null
})

const absAt = computed<AbsAt | null>(() => {
  const at = props.modelValue
  return at.kind === 'abs' ? at : null
})

const anchorAt = computed<AnchorAt | null>(() => {
  const at = props.modelValue
  return at.kind === 'anchor' ? at : null
})

const perimAt = computed<Twin2dPerimAt | null>(() => {
  const at = props.modelValue
  return at.kind === 'perim' ? at : null
})

/** 文档里的长度 → 框里的文本。 */
function lenText(len: Twin2dLen): string {
  return typeof len === 'number' ? String(len) : len
}

/** 可缺席的一边：`null` 就是空框。 */
function edgeText(len: Twin2dLen | null): string {
  return len === null ? '' : lenText(len)
}

/** 当前这一档要显示的全部文本框。 */
function textOf(at: Twin2dPlacement): Record<string, string> {
  if (at.kind === 'fill') {
    return {
      i0: lenText(at.inset[0]),
      i1: lenText(at.inset[1]),
      i2: lenText(at.inset[2]),
      i3: lenText(at.inset[3]),
    }
  }
  if (at.kind !== 'abs') return {}
  return {
    top: edgeText(at.top),
    right: edgeText(at.right),
    bottom: edgeText(at.bottom),
    left: edgeText(at.left),
    tx: at.tx,
    ty: at.ty,
  }
}

function seed(): void {
  drafts.value = textOf(props.modelValue)
}

watch(
  () => props.modelValue,
  () => {
    if (!focused.value) seed()
  },
  { immediate: true },
)

function setDraft(key: string, text: string): void {
  drafts.value = { ...drafts.value, [key]: text }
}

function onFocusIn(): void {
  focused.value = true
}

function onFocusOut(): void {
  focused.value = false
  seed()
  emit('blur')
}

function writeKind(next: string): void {
  const kind = TWIN_2D_PLACEMENT_KINDS.find((item) => item === next)
  if (kind === undefined || kind === props.modelValue.kind) return
  emit('update:modelValue', normalizePlacement({ kind }))
}

/** 换掉四向内缩里的一格；元组整份换，就地改下标不换引用等于没改。 */
function insetWith(
  inset: Twin2dInset,
  index: number,
  value: Twin2dLen,
): Twin2dInset {
  return [
    index === 0 ? value : inset[0],
    index === 1 ? value : inset[1],
    index === 2 ? value : inset[2],
    index === 3 ? value : inset[3],
  ]
}

function onInset(index: number, raw: string): void {
  setDraft(INSET_CELLS[index]?.key ?? '', raw)
  const at = fillAt.value
  const len = optionalLen(raw)
  if (at === null || len === null) return
  emit('update:modelValue', {
    kind: 'fill',
    inset: insetWith(at.inset, index, len),
  })
}

function onAbsEdge(edge: AbsEdge, raw: string): void {
  setDraft(edge, raw)
  const at = absAt.value
  const len = optionalLen(raw)
  // 空串是有意义的一档：这一边不给，由对边与自身尺寸决定位置
  if (at === null || (len === null && raw.trim() !== '')) return
  emit('update:modelValue', {
    ...at,
    top: edge === 'top' ? len : at.top,
    right: edge === 'right' ? len : at.right,
    bottom: edge === 'bottom' ? len : at.bottom,
    left: edge === 'left' ? len : at.left,
  })
}

function onOffset(axis: 'tx' | 'ty', raw: string): void {
  const clean = sanitizeCssValue(raw, NO_OFFSET)
  setDraft(axis, raw)
  const at = absAt.value
  if (at === null) return
  emit('update:modelValue', {
    ...at,
    tx: axis === 'tx' ? clean : at.tx,
    ty: axis === 'ty' ? clean : at.ty,
  })
}

function writeAnchor(patch: Partial<AnchorAt>): void {
  const at = anchorAt.value
  if (at !== null) emit('update:modelValue', { ...at, ...patch })
}

function writePerim(patch: Partial<Twin2dPerimAt>): void {
  const at = perimAt.value
  if (at !== null) emit('update:modelValue', { ...at, ...patch })
}
</script>

<template>
  <div class="flex flex-col gap-2" @focusin="onFocusIn" @focusout="onFocusOut">
    <DtSelect
      :model-value="modelValue.kind"
      :options="KIND_OPTIONS"
      label="摆位"
      size="sm"
      data-test="placement-kind"
      @update:model-value="writeKind"
    />

    <p
      v-if="modelValue.kind === 'flow'"
      class="text-xs text-text-disabled"
      data-test="placement-flow-hint"
    >
      留在父级的排流里，位置由父级的排布决定。
    </p>

    <div v-if="fillAt !== null" class="grid grid-cols-2 gap-1.5">
      <DtInput
        v-for="(cell, index) in INSET_CELLS"
        :key="cell.key"
        :model-value="drafts[cell.key] ?? ''"
        :label="cell.label"
        :data-test="`placement-inset-${cell.key}`"
        placeholder="8 / 10% / 1em"
        size="sm"
        @update:model-value="onInset(index, $event)"
      />
    </div>

    <div v-if="absAt !== null" class="grid grid-cols-2 gap-1.5">
      <DtInput
        v-for="cell in ABS_CELLS"
        :key="cell.key"
        :model-value="drafts[cell.key] ?? ''"
        :label="cell.label"
        :data-test="`placement-abs-${cell.key}`"
        placeholder="留空 = 不给这一边"
        size="sm"
        @update:model-value="onAbsEdge(cell.key, $event)"
      />
      <DtInput
        :model-value="drafts.tx ?? ''"
        label="自身横移"
        data-test="placement-tx"
        placeholder="-50%"
        size="sm"
        @update:model-value="onOffset('tx', $event)"
      />
      <DtInput
        :model-value="drafts.ty ?? ''"
        label="自身纵移"
        data-test="placement-ty"
        placeholder="-50%"
        size="sm"
        @update:model-value="onOffset('ty', $event)"
      />
    </div>

    <div v-if="anchorAt !== null" class="flex flex-col gap-1.5">
      <div class="grid grid-cols-3 gap-1" role="group" aria-label="锚点">
        <DtButton
          v-for="anchor in ANCHOR_CELLS"
          :key="anchor"
          size="sm"
          :pressed="anchorAt.anchor === anchor"
          :aria-label="ANCHOR_LABELS[anchor]"
          :title="ANCHOR_LABELS[anchor]"
          :data-test="`placement-anchor-${anchor}`"
          @click="writeAnchor({ anchor })"
        >
          {{ ANCHOR_LABELS[anchor] }}
        </DtButton>
      </div>
      <div class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          :model-value="anchorAt.dx"
          label="横向微调"
          unit="px"
          size="sm"
          :steppers="false"
          data-test="placement-anchor-dx"
          @update:model-value="writeAnchor({ dx: $event ?? 0 })"
        />
        <DtNumberInput
          :model-value="anchorAt.dy"
          label="纵向微调"
          unit="px"
          size="sm"
          :steppers="false"
          data-test="placement-anchor-dy"
          @update:model-value="writeAnchor({ dy: $event ?? 0 })"
        />
      </div>
    </div>

    <div v-if="perimAt !== null" class="grid grid-cols-2 gap-1.5">
      <DtNumberInput
        :model-value="perimAt.t"
        :range="TWIN_2D_UNIT_RANGE"
        label="周长位置"
        size="sm"
        :steppers="false"
        data-test="placement-perim-t"
        @update:model-value="writePerim({ t: $event ?? 0 })"
      />
      <DtNumberInput
        :model-value="perimAt.gap"
        label="外推间隙"
        unit="px"
        size="sm"
        :steppers="false"
        data-test="placement-perim-gap"
        @update:model-value="writePerim({ gap: $event ?? 0 })"
      />
      <DtNumberInput
        :model-value="perimAt.dx"
        label="横向微调"
        unit="px"
        size="sm"
        :steppers="false"
        data-test="placement-perim-dx"
        @update:model-value="writePerim({ dx: $event ?? 0 })"
      />
      <DtNumberInput
        :model-value="perimAt.dy"
        label="纵向微调"
        unit="px"
        size="sm"
        :steppers="false"
        data-test="placement-perim-dy"
        @update:model-value="writePerim({ dy: $event ?? 0 })"
      />
    </div>
  </div>
</template>
