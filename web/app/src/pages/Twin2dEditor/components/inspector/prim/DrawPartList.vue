<script setup lang="ts">
/**
 * @fileoverview `ico` 的手绘一档里的几笔：每笔一段几何、一个填充与多遍描边，可增删调序。
 * 文档序就是绘制序，后画的盖在先画的上头。
 *
 * ⚠ 一笔都不剩时整个手绘档会**落回空档**（`drawIcoSrc` 见到空表就退回 `none`），
 *   图标凭空消失且零报错，所以空表时当场标红。
 * ⚠ 一笔的坐标是 **viewBox 像素**，不是本图元盒的归一值——几何那一格里换形状给的是
 *   0..1 那一档的小图形，照着画幅调大才看得见。
 * ⚠ 每一笔没有 id（它是个受限的 vec：无子树、无摆位、无变体），所以 `v-for` 的 key
 *   只能是位置，与渲染层 `drawLayersOf` 同一口径。代价是删掉中间一笔时，它下面那几行
 *   会整体重建、正在输入的那一格会丢焦点——删除是一次点击、不是连续输入，够用。
 * ⚠ 新一笔给的是**看得见**的初值：几何缺省是 0 宽的形状，加一笔等于什么都没发生。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import type { Twin2dDrawPart, Twin2dPaint, Twin2dShape } from '@dt/twin2d'
import { DtButton } from '@dt/ui'

import GeometryField from '../../fields/GeometryField.vue'
import StrokePassList from '../../fields/StrokePassList.vue'
import PaintField from './PaintField.vue'

const props = defineProps<{
  modelValue: readonly Twin2dDrawPart[]
  /** 画幅边长，新一笔照着它铺开；不给就按内置图标的 48。 */
  span?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [readonly Twin2dDrawPart[]]
  blur: []
}>()

/** 内置图标外壳的画幅。 */
const DEFAULT_SPAN = 48

/** 新一笔的线宽：与内置图标那一套同一档。 */
const NEW_WIDTH = 2

/** 一笔都不剩时的说明。 */
const EMPTY = '一笔都没有：这个手绘图标会在存盘时整个落回「不画图标」'

/** 几何那一格的说明。 */
const COORD_HINT =
  '坐标是 viewBox 像素；换形状那一下给的是 0..1 的小图形，记得调大'

function write(next: readonly Twin2dDrawPart[]): void {
  emit('update:modelValue', next)
}

/**
 * 换掉第几笔。
 * @param seat 第几笔，从 0 数
 * @param patch 这一笔要换的键
 */
function patchPart(seat: number, patch: Partial<Twin2dDrawPart>): void {
  write(
    props.modelValue.map((part, order) =>
      order === seat ? { ...part, ...patch } : part,
    ),
  )
}

/** 一笔新的：一条横贯画幅的实线，落地就看得见。 */
function blankPart(span: number): Twin2dDrawPart {
  const half = span / 2
  return {
    shape: { kind: 'line', x1: 0, y1: half, x2: span, y2: half },
    fill: { kind: 'none' },
    strokes: [
      {
        id: 'draw-stroke',
        width: NEW_WIDTH,
        color: 'currentColor',
        dash: [],
        cap: 'round',
        join: 'round',
        opacity: 1,
        nonScaling: false,
      },
    ],
  }
}

function addPart(): void {
  write([...props.modelValue, blankPart(props.span ?? DEFAULT_SPAN)])
}

function removePart(seat: number): void {
  write(props.modelValue.filter((_, order) => order !== seat))
}

/**
 * 与相邻那一笔对调。
 * @param seat 第几笔，从 0 数
 * @param up 往前挪（画得更靠底）还是往后挪
 */
function movePart(seat: number, up: boolean): void {
  const other = up ? seat - 1 : seat + 1
  const list = props.modelValue
  if (other < 0 || other >= list.length) return
  write(
    list.map((part, order) => {
      if (order === seat) return list[other] ?? part
      return order === other ? (list[seat] ?? part) : part
    }),
  )
}

function writeShape(seat: number, shape: Twin2dShape): void {
  patchPart(seat, { shape })
}

function writeFill(seat: number, fill: Twin2dPaint): void {
  patchPart(seat, { fill })
}
</script>

<template>
  <div class="flex flex-col gap-1.5" @focusout="emit('blur')">
    <p
      v-if="modelValue.length === 0"
      class="text-xs text-state-danger"
      data-test="draw-empty"
    >
      {{ EMPTY }}
    </p>

    <div
      v-for="(part, seat) in modelValue"
      :key="`part-${seat}`"
      class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-sunken p-2"
      :data-test="`draw-part-${seat}`"
    >
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
          第 {{ seat + 1 }} 笔
        </span>
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="chevron-up"
          :disabled="seat === 0"
          aria-label="上移这一笔"
          title="上移这一笔"
          :data-test="`draw-up-${seat}`"
          @click="movePart(seat, true)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="chevron-down"
          :disabled="seat === modelValue.length - 1"
          aria-label="下移这一笔"
          title="下移这一笔"
          :data-test="`draw-down-${seat}`"
          @click="movePart(seat, false)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删掉这一笔"
          title="删掉这一笔"
          :data-test="`draw-remove-${seat}`"
          @click="removePart(seat)"
        />
      </div>

      <GeometryField
        :model-value="part.shape"
        :data-test="`draw-shape-${seat}`"
        @update:model-value="writeShape(seat, $event)"
      />
      <p class="text-xs text-text-disabled">{{ COORD_HINT }}</p>

      <PaintField
        :model-value="part.fill"
        label="填充"
        :data-test="`draw-fill-${seat}`"
        @update:model-value="writeFill(seat, $event)"
      />

      <StrokePassList
        :model-value="part.strokes"
        hint="一遍都没有 = 按 SVG 缺省的 1px 画"
        :data-test="`draw-strokes-${seat}`"
        @update:model-value="patchPart(seat, { strokes: $event })"
      />
    </div>

    <DtButton
      size="sm"
      variant="soft"
      intent="neutral"
      icon="plus"
      block
      data-test="draw-add"
      @click="addPart"
    >
      加一笔
    </DtButton>
  </div>
</template>
