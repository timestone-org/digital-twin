<script setup lang="ts">
/**
 * @fileoverview 一枚引脚符号的编辑面：伸出长度 + 上色 + 一段几何 + 多遍描边。
 *
 * ⚠ 只给形状是画不出一枚引脚的：线宽决定它与导线接不接得上，而线宽不对既不报错
 *   也不像 bug，只像「画得难看」。一遍描边都不给时落盘会补一遍 2px 的缺省
 *   （`strokesOr`），所以空表不标红，只把这句话摆在旁边。
 * ⚠ 几何恒按 `unit` 画：`buildPinViews` 拿 `marker.length` 当盒的边长喂给
 *   `svgShapeAttrs`，所以这里不摆坐标口径那一档——摆了就是一个改了没反应的下拉。
 * ⚠ 渐变那一档禁掉但不从表里删：引脚没有局部渐变表（`buildPinViews` 喂进去的是
 *   空表），引一个渐变画出来是整段不上色；而删掉这一档之后，一份从别处导进来的
 *   渐变引脚会让下拉显示成空白，用户连「它现在是哪一档」都看不出来。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import { TWIN_2D_PAINT_KINDS } from '@dt/twin2d'
import type { Twin2dPaintKind, Twin2dPinMarker } from '@dt/twin2d'
import { DtNumberInput, DtSelect } from '@dt/ui'
import { computed } from 'vue'

import ColorField from './ColorField.vue'
import GeometryField from './GeometryField.vue'
import StrokePassList from './StrokePassList.vue'

const props = defineProps<{ modelValue: Twin2dPinMarker }>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dPinMarker]
  blur: []
}>()

/** 与 `colorOr` 的兜底同一档。 */
const INHERITED_COLOR = 'currentColor'

/** 伸出长度不许落到 0：0 长的引脚盒什么都画不出来。 */
const LENGTH_RANGE = { min: 1, step: 1 }

const PAINT_LABELS: Readonly<Record<Twin2dPaintKind, string>> = {
  none: '不填充',
  color: '纯色',
  gradient: '渐变（引脚用不了）',
}

const PAINT_OPTIONS = TWIN_2D_PAINT_KINDS.map((value) => ({
  value,
  label: PAINT_LABELS[value],
  disabled: value === 'gradient',
}))

/** 纯色那一档的颜色；不是这一档时为 null。 */
const fillColor = computed<string | null>(() => {
  const fill = props.modelValue.fill
  return fill.kind === 'color' ? fill.color : null
})

/**
 * 改这一枚符号的若干字段。
 * @param patch 要覆盖的字段
 */
function write(patch: Partial<Twin2dPinMarker>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

/**
 * 换上色档；渐变那一档接不住，认不出的与没换的也不写回。
 * @param next 下拉给出的取值
 */
function writeFillKind(next: string): void {
  if (next === props.modelValue.fill.kind) return
  if (next === 'none') write({ fill: { kind: 'none' } })
  else if (next === 'color') {
    write({ fill: { kind: 'color', color: INHERITED_COLOR } })
  }
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div class="grid grid-cols-2 gap-1.5">
      <DtNumberInput
        :model-value="modelValue.length"
        :range="LENGTH_RANGE"
        label="伸出长度"
        unit="px"
        size="sm"
        :steppers="false"
        data-test="pin-length"
        @update:model-value="write({ length: $event ?? 1 })"
      />
      <DtSelect
        :model-value="modelValue.fill.kind"
        :options="PAINT_OPTIONS"
        label="填充"
        size="sm"
        data-test="pin-fill"
        @update:model-value="writeFillKind"
      />
    </div>

    <ColorField
      v-if="fillColor !== null"
      :model-value="fillColor"
      :fallback="INHERITED_COLOR"
      label="填充色"
      @update:model-value="write({ fill: { kind: 'color', color: $event } })"
      @blur="emit('blur')"
    />

    <GeometryField
      :model-value="modelValue.shape"
      @update:model-value="write({ shape: $event })"
      @blur="emit('blur')"
    />

    <StrokePassList
      :model-value="modelValue.strokes"
      hint="一遍都不给时，落盘会补一遍 2px 的缺省描边"
      @update:model-value="write({ strokes: $event })"
      @blur="emit('blur')"
    />
  </div>
</template>
