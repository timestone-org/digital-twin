<script setup lang="ts">
/**
 * @fileoverview 标注检查器：三档 kind、几何、描边与填充、标签排版，以及相对节点层的
 * 上下两档 `zOrder`。收「当前这一条标注 + 整份配置」，产出整份新配置往上抛，
 * 本组件一处都不碰文档态与撤销栈。
 *
 * ⚠ `zOrder` 必须在这里给得出来：编辑器与运行态都按它把标注分成节点层上下两摞，
 *   参考项目的编辑器不分层，于是配了 `below` 的标注在编辑器里看着在上、上了大屏跑到
 *   下面，所见即所得在这一项上是假的（docs/MODULE_TWIN_2D_DESIGN.md §7.10 #74）。
 * ⚠ 文本与数字一律走合并撤销（`merge` + 焦点离开时 `endMerge`）：逐帧各记一条的话，
 *   敲一行标签就往撤销栈里塞进几十格，撤销键从此按不回上一步。
 * ⚠ 这一档画不出来的控件一律不摆：辅助线没有填充，文字标注的描边线宽 / 虚线 /
 *   不随缩放全被标签自己的排版盖掉，两条对齐只在标签落在框内时才参与排版。
 *   摆一个配了没反应的控件比没有更糟。
 */
import type { FontValue } from '@dt/contracts'
import {
  TWIN_2D_MARK_ALIGN_H,
  TWIN_2D_MARK_ALIGN_V,
  TWIN_2D_MARK_KINDS,
  TWIN_2D_MARK_LABEL_POSITIONS,
  TWIN_2D_MARK_Z_ORDERS,
} from '@dt/twin2d'
import type {
  Twin2dConfig,
  Twin2dMark,
  Twin2dMarkAlignH,
  Twin2dMarkAlignV,
  Twin2dMarkKind,
  Twin2dMarkLabelPos,
  Twin2dMarkZOrder,
} from '@dt/twin2d'
import { DtInput, DtNumberInput, DtSegmented, DtSelect, DtSwitch } from '@dt/ui'
import { computed } from 'vue'

import {
  TWIN_2D_PX_RANGE,
  TWIN_2D_UNIT_RANGE,
  enumOptions,
  fieldsChanged,
} from '../../scripts/inspectorFields'
import { updateMark } from '../../scripts/markOps'
import ColorField from '../fields/ColorField.vue'

const props = defineProps<{
  /** 当前选中的那一条标注，已归一化。 */
  mark: Twin2dMark
  /** 整份配置；只读它，改动以整份新配置的形式往上抛。 */
  config: Twin2dConfig
}>()

const emit = defineEmits<{
  /** 一次性改动，落一帧撤销。 */
  change: [config: Twin2dConfig]
  /** 连续输入：同 `key` 的连着并成一帧。 */
  merge: [config: Twin2dConfig, key: string]
  /** 焦点离开输入框，这一段连续输入到此为止。 */
  endMerge: []
}>()

/** 几何四格：辅助线量两个端点，另两档量左上角与尺寸。 */
type GeomKey = 'x' | 'y' | 'w' | 'h' | 'x2' | 'y2'

const KIND_LABELS: Readonly<Record<Twin2dMarkKind, string>> = {
  rect: '辅助框',
  line: '辅助线',
  text: '文字',
}

const LABEL_POS_LABELS: Readonly<Record<Twin2dMarkLabelPos, string>> = {
  inside: '框内',
  top: '上方',
  bottom: '下方',
}

const ALIGN_H_LABELS: Readonly<Record<Twin2dMarkAlignH, string>> = {
  left: '左',
  center: '中',
  right: '右',
}

const ALIGN_V_LABELS: Readonly<Record<Twin2dMarkAlignV, string>> = {
  top: '上',
  middle: '中',
  bottom: '下',
}

const Z_ORDER_LABELS: Readonly<Record<Twin2dMarkZOrder, string>> = {
  below: '节点之下',
  above: '节点之上',
}

const GEOM_LABELS: Readonly<Record<GeomKey, string>> = {
  x: '起点 X',
  y: '起点 Y',
  w: '宽',
  h: '高',
  x2: '终点 X',
  y2: '终点 Y',
}

const KIND_OPTIONS = enumOptions(TWIN_2D_MARK_KINDS, KIND_LABELS)
const LABEL_POS_OPTIONS = enumOptions(
  TWIN_2D_MARK_LABEL_POSITIONS,
  LABEL_POS_LABELS,
)
const ALIGN_H_OPTIONS = enumOptions(TWIN_2D_MARK_ALIGN_H, ALIGN_H_LABELS)
const ALIGN_V_OPTIONS = enumOptions(TWIN_2D_MARK_ALIGN_V, ALIGN_V_LABELS)
const Z_ORDER_OPTIONS = enumOptions(TWIN_2D_MARK_Z_ORDERS, Z_ORDER_LABELS)

/** 字重：留空一档即缺席，跟随主题排版。 */
const WEIGHT_OPTIONS = [
  { value: '', label: '跟随' },
  { value: '400', label: '常规' },
  { value: '500', label: '中等' },
  { value: '600', label: '半粗' },
  { value: '700', label: '加粗' },
]

/** ⚠ 宽高不许压到 0：0 宽的框在画布上一根线都不剩，八个把手叠成一点谁也点不中。 */
const SIZE_RANGE = { min: 1, step: 1 }
const STROKE_WIDTH_RANGE = { min: 0, max: 40, step: 0.5 }
const FONT_SIZE_RANGE = { min: 6, max: 200, step: 1 }
const SPACING_RANGE = { min: -10, max: 40, step: 0.1 }

const LINE_GEOM: readonly GeomKey[] = ['x', 'y', 'x2', 'y2']
const BOX_GEOM: readonly GeomKey[] = ['x', 'y', 'w', 'h']

const isLine = computed(() => props.mark.kind === 'line')
const isText = computed(() => props.mark.kind === 'text')
const geomKeys = computed(() => (isLine.value ? LINE_GEOM : BOX_GEOM))

/** 当前六个几何值，`v-for` 按 key 取。 */
const geom = computed<Readonly<Record<GeomKey, number>>>(() => ({
  x: props.mark.x,
  y: props.mark.y,
  w: props.mark.w,
  h: props.mark.h,
  x2: props.mark.x2,
  y2: props.mark.y2,
}))

/** 两条对齐只在标签落在框内时参与排版，另两档的锚点是写死的。 */
const alignsUsed = computed(() => props.mark.labelPos === 'inside')

/**
 * 这个补丁里至少有一个字段与现值不同。
 * ⚠ 数字框每次失焦都回抛一次当前值，不比一遍的话「点进去又点出来」就白记一帧撤销。
 * @param patch 待写入的字段
 */
function changed(patch: Partial<Omit<Twin2dMark, 'id'>>): boolean {
  return fieldsChanged({ ...props.mark }, { ...patch })
}

/**
 * 把补丁落到整份配置上。
 * @param patch 待写入的字段
 */
function patched(patch: Partial<Omit<Twin2dMark, 'id'>>): Twin2dConfig {
  return updateMark(props.config, props.mark.id, patch)
}

/**
 * 一次性改动。
 * @param patch 待写入的字段
 */
function write(patch: Partial<Omit<Twin2dMark, 'id'>>): void {
  if (changed(patch)) emit('change', patched(patch))
}

/**
 * 连续输入：同一格里连着敲并成一帧撤销。
 * @param patch 待写入的字段
 * @param field 这一格的名字，参与合并键
 */
function writeMerged(
  patch: Partial<Omit<Twin2dMark, 'id'>>,
  field: string,
): void {
  if (changed(patch)) {
    emit('merge', patched(patch), `mark:${props.mark.id}:${field}`)
  }
}

function endMerge(): void {
  emit('endMerge')
}

/**
 * 换 kind。
 * ⚠ 换成辅助线时，两端重合就按当前框宽把终点推开：`x2/y2` 的归一化缺省是**起点
 * 自身**，直接换过去画出来是一条零长的线，看着像这一下什么都没发生。
 * @param next 新的 kind，认不出就不写
 */
function writeKind(next: string): void {
  const kind = TWIN_2D_MARK_KINDS.find((item) => item === next)
  if (kind === undefined || kind === props.mark.kind) return
  const mark = props.mark
  const degenerate = mark.x2 === mark.x && mark.y2 === mark.y
  if (kind !== 'line' || !degenerate) return write({ kind })
  write({ kind, x2: mark.x + mark.w, y2: mark.y })
}

/**
 * 几何六格里的一格；六个值整份写回，其余原样。
 * @param key 哪一格
 * @param next 新值，空框按 0 处理
 */
function writeGeom(key: GeomKey, next: number | undefined): void {
  const patch = { ...geom.value }
  patch[key] = next ?? 0
  writeMerged(patch, key)
}

/**
 * 换掉字体里的一个键；空值一律**删键**而不是写 undefined——缺席才是「跟随排版」，
 * 而 `exactOptionalPropertyTypes` 下显式的 undefined 与缺席是两回事。
 * @param font 现在的字体
 * @param key 哪一个键
 * @param value 新值，`undefined` 与空串都当作清掉
 */
function fontWith<K extends keyof FontValue>(
  font: FontValue,
  key: K,
  value: FontValue[K],
): FontValue {
  const next: FontValue = { ...font }
  if (value === undefined || value === '') delete next[key]
  else next[key] = value
  return next
}

/**
 * 五个键逐一比过；字体每次都是新对象，只比引用等于每次都算改过。
 * @param a 一份字体
 * @param b 另一份字体
 */
function sameFont(a: FontValue, b: FontValue): boolean {
  return (
    a.family === b.family &&
    a.size === b.size &&
    a.weight === b.weight &&
    a.letterSpacing === b.letterSpacing &&
    a.color === b.color
  )
}

/**
 * 写字体里的一个键。
 * @param key 哪一个键
 * @param value 新值
 */
function writeFont<K extends keyof FontValue>(
  key: K,
  value: FontValue[K],
): void {
  const font = fontWith(props.mark.font, key, value)
  if (sameFont(font, props.mark.font)) return
  writeMerged({ font }, `font.${key}`)
}

function writeLabelPos(next: string): void {
  const found = TWIN_2D_MARK_LABEL_POSITIONS.find((item) => item === next)
  if (found !== undefined) write({ labelPos: found })
}

function writeAlignH(next: string): void {
  const found = TWIN_2D_MARK_ALIGN_H.find((item) => item === next)
  if (found !== undefined) write({ labelAlignH: found })
}

function writeAlignV(next: string): void {
  const found = TWIN_2D_MARK_ALIGN_V.find((item) => item === next)
  if (found !== undefined) write({ labelAlignV: found })
}

function writeZOrder(next: string): void {
  const found = TWIN_2D_MARK_Z_ORDERS.find((item) => item === next)
  if (found !== undefined) write({ zOrder: found })
}

/**
 * 字重：下拉里是字符串，落进文档的是数字（`'跟随'` 那一档清键）。
 * @param raw 下拉当前值
 */
function writeWeight(raw: string): void {
  writeFont('weight', raw === '' ? undefined : Number(raw))
}
</script>

<template>
  <div
    class="flex flex-col gap-4"
    data-test="mark-inspector"
    @focusout="endMerge"
  >
    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-medium text-text-secondary">类型</h3>
      <DtSegmented
        :model-value="mark.kind"
        :options="KIND_OPTIONS"
        aria-label="标注类型"
        block
        data-test="mark-kind"
        @update:model-value="writeKind"
      />
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-medium text-text-secondary">几何</h3>
      <div class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          v-for="key in geomKeys"
          :key="key"
          :model-value="geom[key]"
          :label="GEOM_LABELS[key]"
          :range="key === 'w' || key === 'h' ? SIZE_RANGE : TWIN_2D_PX_RANGE"
          unit="px"
          size="sm"
          :steppers="false"
          :data-test="`mark-geom-${key}`"
          @update:model-value="writeGeom(key, $event)"
        />
      </div>
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-medium text-text-secondary">标签</h3>
      <DtInput
        :model-value="mark.text"
        label="文字"
        placeholder="留空 = 不画标签"
        size="sm"
        data-test="mark-text"
        @update:model-value="writeMerged({ text: $event }, 'text')"
      />
      <DtSegmented
        :model-value="mark.labelPos"
        :options="LABEL_POS_OPTIONS"
        aria-label="标签位置"
        block
        data-test="mark-label-pos"
        @update:model-value="writeLabelPos"
      />
      <div v-if="alignsUsed" class="grid grid-cols-2 gap-1.5">
        <DtSegmented
          :model-value="mark.labelAlignH"
          :options="ALIGN_H_OPTIONS"
          aria-label="标签横向对齐"
          block
          data-test="mark-align-h"
          @update:model-value="writeAlignH"
        />
        <DtSegmented
          :model-value="mark.labelAlignV"
          :options="ALIGN_V_OPTIONS"
          aria-label="标签纵向对齐"
          block
          data-test="mark-align-v"
          @update:model-value="writeAlignV"
        />
      </div>
      <p v-else class="text-xs text-text-disabled" data-test="mark-align-hint">
        两条对齐只在标签落在框内时参与排版。
      </p>
      <div class="grid grid-cols-2 gap-1.5">
        <DtInput
          :model-value="mark.font.family ?? ''"
          label="字体"
          placeholder="跟随主题"
          size="sm"
          data-test="mark-font-family"
          @update:model-value="writeFont('family', $event)"
        />
        <DtNumberInput
          :model-value="mark.font.size"
          :range="FONT_SIZE_RANGE"
          label="字号"
          unit="px"
          size="sm"
          :steppers="false"
          data-test="mark-font-size"
          @update:model-value="writeFont('size', $event)"
        />
        <DtSelect
          :model-value="String(mark.font.weight ?? '')"
          :options="WEIGHT_OPTIONS"
          label="字重"
          size="sm"
          data-test="mark-font-weight"
          @update:model-value="writeWeight"
        />
        <DtNumberInput
          :model-value="mark.font.letterSpacing"
          :range="SPACING_RANGE"
          label="字距"
          unit="px"
          size="sm"
          :steppers="false"
          data-test="mark-font-spacing"
          @update:model-value="writeFont('letterSpacing', $event)"
        />
      </div>
      <ColorField
        :model-value="mark.font.color ?? ''"
        label="文字颜色"
        hint="留空 = 跟随描边色"
        @update:model-value="writeFont('color', $event)"
        @blur="endMerge"
      />
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-medium text-text-secondary">描边与填充</h3>
      <ColorField
        :model-value="mark.stroke"
        label="描边色"
        :hint="isText ? '文字标注拿它给标签兜底' : '留空 = 跟随强调色'"
        @update:model-value="writeMerged({ stroke: $event }, 'stroke')"
        @blur="endMerge"
      />
      <ColorField
        v-if="mark.kind === 'rect'"
        :model-value="mark.fill"
        label="填充色"
        hint="留空 = 空心框"
        @update:model-value="writeMerged({ fill: $event }, 'fill')"
        @blur="endMerge"
      />
      <template v-if="!isText">
        <DtNumberInput
          :model-value="mark.strokeWidth"
          :range="STROKE_WIDTH_RANGE"
          label="线宽"
          unit="px"
          size="sm"
          :steppers="false"
          data-test="mark-stroke-width"
          @update:model-value="writeMerged({ strokeWidth: $event ?? 0 }, 'sw')"
        />
        <DtSwitch
          :model-value="mark.strokeDash"
          label="虚线"
          size="sm"
          data-test="mark-stroke-dash"
          @update:model-value="write({ strokeDash: $event })"
        />
        <DtSwitch
          :model-value="mark.nonScalingStroke"
          label="描边不随舞台缩放"
          size="sm"
          data-test="mark-non-scaling"
          @update:model-value="write({ nonScalingStroke: $event })"
        />
      </template>
      <DtNumberInput
        :model-value="mark.opacity"
        :range="TWIN_2D_UNIT_RANGE"
        label="不透明度"
        size="sm"
        :steppers="false"
        data-test="mark-opacity"
        @update:model-value="writeMerged({ opacity: $event ?? 1 }, 'opacity')"
      />
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-medium text-text-secondary">层序</h3>
      <DtSegmented
        :model-value="mark.zOrder"
        :options="Z_ORDER_OPTIONS"
        aria-label="相对节点层"
        block
        data-test="mark-z-order"
        @update:model-value="writeZOrder"
      />
      <p class="text-xs text-text-disabled">
        标注分成节点层上下两摞，这一档决定它落在哪一摞；同一摞里的先后由层序命令调。
      </p>
    </section>
  </div>
</template>
