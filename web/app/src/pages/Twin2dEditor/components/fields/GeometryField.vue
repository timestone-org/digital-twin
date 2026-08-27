<script setup lang="ts">
/**
 * @fileoverview 一段 SVG 几何的编辑面：五种形状、坐标口径两档，外加「在画布上取点」
 * ——电路符号的折线与路径靠它画。
 *
 * ⚠ 取点只出**请求**，本控件不碰画布：按下键 emit `pick`，画布怎么进入取点模式由装配层
 *   接；点序列经 `picked` 回流，本控件把它写成折线的 points 或路径的 d 并在框里回显。
 * ⚠ 坐标口径换档**只换口径、不换数**：0.5 在 `unit` 下是本图元盒的中点，在 `px` 下是
 *   半个像素。静默换算会让图形在换档那一下整个跑掉，而每一处取值单看都对。
 * ⚠ 画不出来的几何会被 `normalizeShape` 整段判非法（空 d、少于两点的折线、非正的宽高与
 *   半径），所以这几处当场标红：不标的话存一次再读回来那一段凭空消失，且零报错。
 * ⚠ 折线的点逐键解析、认不出的整对丢弃，但框里留用户敲的原文：不留的话 `0,0 10,0`
 *   删掉末位后那个空格会被一并吃掉，再打就成了 `0,010`。失焦时把框拨回文档里的值。
 * ⚠ 控件自己不碰文档，只 emit；连续输入并成一帧撤销的时机由检查器定：逐键
 *   `commitMerged(next, key)`，收到本控件的 `blur` 时 `endMerge()`。
 */
import { TWIN_2D_SHAPE_KINDS, TWIN_2D_VEC_COORDS } from '@dt/twin2d'
import type { Twin2dShape, Twin2dShapeKind, Twin2dVecCoord } from '@dt/twin2d'
import type { DtNumberRange } from '@dt/contracts'
import { DtButton, DtCheckbox, DtInput, DtNumberInput, DtSelect } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import {
  twin2dParsePoints,
  twin2dPointsPath,
  twin2dPointsText,
} from '../../scripts/shapeText'
import type { Twin2dPointSeq } from '../../scripts/shapeText'

/** 取点能落到哪两种几何上。 */
type Twin2dPickTarget = 'poly' | 'path'

const props = defineProps<{
  modelValue: Twin2dShape
  /**
   * vec 的坐标口径；不给就不摆这一档——引脚符号的几何恒按 `unit` 画
   * （`buildPinViews` 拿 `marker.length` 当盒边长）。
   */
  coord?: Twin2dVecCoord
  /**
   * 画布取回来的点；null 或缺席 = 此刻没在取点。
   * ⚠ 每多取一个点给一个**新数组**，其余时刻保持同一引用：本控件按引用变化写回，
   * 每帧重造一个内容相同的数组会让它每帧都写一次。
   */
  picked?: Twin2dPointSeq | null
  /**
   * 装配层接得住取点请求时才给这个键。
   * ⚠ 缺省不给：没人接的「取点」键按下去毫无反应且零报错，比没有这个键更糟。
   */
  canPick?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dShape]
  'update:coord': [Twin2dVecCoord]
  /** 请求进入取点模式；画布怎么接由装配层定。 */
  pick: [target: Twin2dPickTarget]
  /** 请求退出取点模式。 */
  pickEnd: []
  blur: []
}>()

/** 折线至少两个点，再少 `normalizeShape` 把整段几何判非法。 */
const MIN_POINTS = 2

/** 像素档新几何的边长；归一档的边长是 1（整只盒）。 */
const PX_SPAN = 24

/** 归一档一格的步长；像素档一格一像素。 */
const UNIT_STEP = 0.05

/** 空的 d 会被整段丢掉。 */
const EMPTY_PATH_HINT = '必填：空路径会在存盘时被整段丢掉'

/** 点不够的折线会被整段丢掉。 */
const FEW_POINTS_HINT = '至少两个点，不然这一段几何会在存盘时被整段丢掉'

const KIND_LABELS: Readonly<Record<Twin2dShapeKind, string>> = {
  path: '路径',
  rect: '矩形',
  ellipse: '椭圆',
  line: '线段',
  poly: '折线',
}

const COORD_LABELS: Readonly<Record<Twin2dVecCoord, string>> = {
  unit: '归一（本图元盒的 0..1）',
  px: '设计像素',
}

const KIND_OPTIONS = TWIN_2D_SHAPE_KINDS.map((value) => ({
  value,
  label: KIND_LABELS[value],
}))

const COORD_OPTIONS = TWIN_2D_VEC_COORDS.map((value) => ({
  value,
  label: COORD_LABELS[value],
}))

/** 一格数字框：读写用的键、标签，以及它属于哪一类取值域。 */
interface Twin2dNumCell {
  key: string
  label: string
  role: 'pos' | 'size' | 'radius'
}

/** 三种「一组数就说得清」的几何各自的格子；路径与折线另有编辑面。 */
const NUM_CELLS: Readonly<Record<string, readonly Twin2dNumCell[]>> = {
  rect: [
    { key: 'x', label: '左上 X', role: 'pos' },
    { key: 'y', label: '左上 Y', role: 'pos' },
    { key: 'w', label: '宽', role: 'size' },
    { key: 'h', label: '高', role: 'size' },
    { key: 'rx', label: '圆角', role: 'radius' },
  ],
  ellipse: [
    { key: 'cx', label: '圆心 X', role: 'pos' },
    { key: 'cy', label: '圆心 Y', role: 'pos' },
    { key: 'rx', label: '横半径', role: 'size' },
    { key: 'ry', label: '纵半径', role: 'size' },
  ],
  line: [
    { key: 'x1', label: '起点 X', role: 'pos' },
    { key: 'y1', label: '起点 Y', role: 'pos' },
    { key: 'x2', label: '终点 X', role: 'pos' },
    { key: 'y2', label: '终点 Y', role: 'pos' },
  ],
}

/** 这一档没有数字格子；不每次现造一个空表，免得下游白重画。 */
const NO_CELLS: readonly Twin2dNumCell[] = Object.freeze([])

/** 折线点框里的原文；文档里存的是它解析之后的样子。 */
const pointsText = ref('')

/** 焦点还在本控件里；在里面时不拿文档里的值去盖用户正敲着的那半截。 */
const focused = ref(false)

const isPx = computed(() => props.coord === 'px')

const step = computed(() => (isPx.value ? 1 : UNIT_STEP))

/** 像素档才标单位；归一档标了反而像是「0.5 像素」。 */
const numUnit = computed<string | undefined>(() =>
  isPx.value ? 'px' : undefined,
)

const coordKind = computed<Twin2dVecCoord | null>(() => props.coord ?? null)

const pathShape = computed(() => {
  const shape = props.modelValue
  return shape.kind === 'path' ? shape : null
})

const polyShape = computed(() => {
  const shape = props.modelValue
  return shape.kind === 'poly' ? shape : null
})

const cells = computed<readonly Twin2dNumCell[]>(
  () => NUM_CELLS[props.modelValue.kind] ?? NO_CELLS,
)

/** 当前几何摊平成「键 → 数」；路径与折线摊出来是空的。 */
const numbers = computed<Readonly<Record<string, number>>>(() => {
  const shape = props.modelValue
  if (shape.kind === 'rect') {
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.h, rx: shape.rx }
  }
  if (shape.kind === 'ellipse') {
    return { cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry }
  }
  if (shape.kind === 'line') {
    return { x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2 }
  }
  return {}
})

/**
 * 一格的取值域：位置可正可负，尺寸不许落到 0（0 宽的形状什么都不画），圆角可以是 0。
 * @param role 这一格属于哪一类
 */
function rangeOf(role: Twin2dNumCell['role']): DtNumberRange {
  if (role === 'pos') return { step: step.value }
  return { min: role === 'size' ? step.value : 0, step: step.value }
}

function seed(): void {
  pointsText.value = twin2dPointsText(polyShape.value?.points ?? [])
}

// immediate 兼作初值：在 setup 根作用域直接读 props 会丢响应性
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

const pathError = computed(() =>
  (pathShape.value?.d ?? ' ').trim() === '' ? EMPTY_PATH_HINT : '',
)

const pointsError = computed(() =>
  twin2dParsePoints(pointsText.value).length < MIN_POINTS
    ? FEW_POINTS_HINT
    : '',
)

/**
 * 一档新几何：取值是**看得见**的初值，不是归一化缺省——0 宽的矩形与空路径都等于
 * 什么都没画，用户只会以为换档没生效。
 * @param kind 目标几何
 * @param span 这一档坐标口径下的「整只盒」有多长
 */
function blankShape(kind: Twin2dShapeKind, span: number): Twin2dShape {
  const half = span / 2
  const points: readonly (readonly [number, number])[] = [
    [0, span],
    [half, 0],
    [span, span],
  ]
  switch (kind) {
    case 'rect':
      return { kind, x: 0, y: 0, w: span, h: span, rx: 0 }
    case 'ellipse':
      return { kind, cx: half, cy: half, rx: half, ry: half }
    case 'line':
      return { kind, x1: 0, y1: half, x2: span, y2: half }
    case 'poly':
      return { kind, points, closed: true }
    default:
      return {
        kind: 'path',
        d: twin2dPointsPath([
          [0, 0],
          [span, span],
        ]),
      }
  }
}

function writeKind(next: string): void {
  const kind = TWIN_2D_SHAPE_KINDS.find((item) => item === next)
  if (kind === undefined || kind === props.modelValue.kind) return
  emit('update:modelValue', blankShape(kind, isPx.value ? PX_SPAN : 1))
}

function writeCoord(next: string): void {
  const coord = TWIN_2D_VEC_COORDS.find((item) => item === next)
  if (coord === undefined || coord === props.coord) return
  emit('update:coord', coord)
}

/**
 * 写一格数字：把摊平的那份数换掉一格，再按当前这一档拼回去。
 * ⚠ 框清空时不写回：空的宽高会让 `normalizeShape` 把整段几何判非法，而数字框自己
 * 会在下一拍把框拨回文档里的值。
 * @param key 这一格的键
 * @param raw 框里读出来的数，清空时是 undefined
 */
function writeNumber(key: string, raw: number | undefined): void {
  if (raw === undefined) return
  const shape = props.modelValue
  const at: Readonly<Record<string, number>> = { ...numbers.value, [key]: raw }
  const got = (cell: string, was: number): number => at[cell] ?? was
  if (shape.kind === 'rect') {
    emit('update:modelValue', {
      kind: 'rect',
      x: got('x', shape.x),
      y: got('y', shape.y),
      w: got('w', shape.w),
      h: got('h', shape.h),
      rx: got('rx', shape.rx),
    })
  } else if (shape.kind === 'ellipse') {
    emit('update:modelValue', {
      kind: 'ellipse',
      cx: got('cx', shape.cx),
      cy: got('cy', shape.cy),
      rx: got('rx', shape.rx),
      ry: got('ry', shape.ry),
    })
  } else if (shape.kind === 'line') {
    emit('update:modelValue', {
      kind: 'line',
      x1: got('x1', shape.x1),
      y1: got('y1', shape.y1),
      x2: got('x2', shape.x2),
      y2: got('y2', shape.y2),
    })
  }
}

function writePath(d: string): void {
  // ⚠ 不 trim：落盘那一步会 trim，在这里 trim 再回填 DOM，空格就永远打不出来
  if (pathShape.value !== null) emit('update:modelValue', { kind: 'path', d })
}

function writeClosed(closed: boolean): void {
  const shape = polyShape.value
  if (shape !== null) {
    emit('update:modelValue', { kind: 'poly', points: shape.points, closed })
  }
}

function onPoints(raw: string): void {
  pointsText.value = raw
  const shape = polyShape.value
  const points = twin2dParsePoints(raw)
  if (shape === null || points.length < MIN_POINTS) return
  emit('update:modelValue', { kind: 'poly', points, closed: shape.closed })
}

const pickTarget = computed<Twin2dPickTarget | null>(() => {
  const kind = props.modelValue.kind
  if (props.canPick !== true) return null
  return kind === 'poly' || kind === 'path' ? kind : null
})

const pickedPoints = computed<Twin2dPointSeq | null>(() => props.picked ?? null)

const picking = computed(() => pickedPoints.value !== null)

const pickedCount = computed(() => pickedPoints.value?.length ?? 0)

function requestPick(): void {
  const target = pickTarget.value
  if (target !== null) emit('pick', target)
}

/** 取回来的点写进几何：折线直接收，路径拼成「首点提笔、其余连线」的 d。 */
function applyPicked(points: Twin2dPointSeq): void {
  const poly = polyShape.value
  if (poly !== null) {
    const kept = [...points]
    emit('update:modelValue', {
      kind: 'poly',
      points: kept,
      closed: poly.closed,
    })
    return
  }
  if (pathShape.value !== null) {
    emit('update:modelValue', { kind: 'path', d: twin2dPointsPath(points) })
  }
}

// 取点是一段连续输入：点一下写一次（够两点才写得成几何），画布退出取点模式时收尾
watch(
  () => props.picked,
  (points) => {
    if (points === null || points === undefined) {
      emit('blur')
      return
    }
    if (points.length >= MIN_POINTS) applyPicked(points)
  },
)
</script>

<template>
  <div class="flex flex-col gap-2" @focusin="onFocusIn" @focusout="onFocusOut">
    <DtSelect
      :model-value="modelValue.kind"
      :options="KIND_OPTIONS"
      label="几何"
      size="sm"
      data-test="geometry-kind"
      @update:model-value="writeKind"
    />

    <div v-if="coordKind !== null" class="flex flex-col gap-1">
      <DtSelect
        :model-value="coordKind"
        :options="COORD_OPTIONS"
        label="坐标口径"
        size="sm"
        data-test="geometry-coord"
        @update:model-value="writeCoord"
      />
      <p class="text-xs text-text-disabled" data-test="geometry-coord-hint">
        换的是坐标系、不是数：0.5 在归一档是盒的中点，在像素档是半个像素。
      </p>
    </div>

    <DtInput
      v-if="pathShape !== null"
      :model-value="pathShape.d"
      label="路径 d"
      placeholder="M 0 0 L 24 24"
      size="sm"
      :error="pathError"
      data-test="geometry-d"
      @update:model-value="writePath"
    />

    <div v-if="cells.length > 0" class="grid grid-cols-2 gap-1.5">
      <DtNumberInput
        v-for="cell in cells"
        :key="cell.key"
        :model-value="numbers[cell.key] ?? 0"
        :range="rangeOf(cell.role)"
        :label="cell.label"
        :unit="numUnit"
        size="sm"
        :steppers="false"
        :data-test="`geometry-${cell.key}`"
        @update:model-value="writeNumber(cell.key, $event)"
      />
    </div>

    <template v-if="polyShape !== null">
      <DtInput
        :model-value="pointsText"
        label="折线点"
        placeholder="0,0 12,0 12,12"
        size="sm"
        :error="pointsError"
        data-test="geometry-points"
        @update:model-value="onPoints"
      />
      <DtCheckbox
        :model-value="polyShape.closed"
        label="闭合（首尾连起来）"
        data-test="geometry-closed"
        @update:model-value="writeClosed"
      />
    </template>

    <div v-if="pickTarget !== null" class="flex flex-col gap-1">
      <DtButton
        v-if="!picking"
        size="sm"
        variant="soft"
        intent="neutral"
        icon="square-mouse-pointer"
        block
        data-test="geometry-pick"
        @click="requestPick"
      >
        在画布上取点
      </DtButton>
      <DtButton
        v-else
        size="sm"
        variant="soft"
        intent="primary"
        icon="check"
        block
        data-test="geometry-pick-end"
        @click="emit('pickEnd')"
      >
        结束取点（已取 {{ pickedCount }} 点）
      </DtButton>
      <p
        v-if="picking && pickedCount < MIN_POINTS"
        class="text-xs text-text-disabled"
        data-test="geometry-pick-hint"
      >
        在画布上点两下以上；点序列会直接写进这一段几何。
      </p>
    </div>
  </div>
</template>
