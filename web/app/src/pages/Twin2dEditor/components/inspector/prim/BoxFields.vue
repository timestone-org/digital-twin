<script setup lang="ts">
/**
 * @fileoverview `box` 这一档的字段：排布六项、多层填充、边框、圆角、多层阴影、
 * 背板模糊、裁剪与光标；基类那十五项由 `PrimBaseFields` 摆在最前。
 *
 * ⚠ 子树（`children`）不在这里改：加一枚、挪一枚、调层序都要拦深度与成环，那是
 *   `primOps` 那三支的事，摆在这里会出现两条互不知情的写路径。
 * ⚠ 背板模糊要透得出东西才看得见：自己这一层填充不透明时它一点变化都没有，而每一格
 *   取值单看都对，所以那时给一行说明。
 * ⚠ 裁剪打开后子树超出的部分会被切掉——包括画在盒外的引线与角标。它不报错，只是
 *   「那一笔不见了」。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import {
  TWIN_2D_ALIGNS,
  TWIN_2D_CURSORS,
  TWIN_2D_FLOWS,
  TWIN_2D_JUSTIFIES,
} from '@dt/twin2d'
import type {
  Twin2dAlign,
  Twin2dBoxPrim,
  Twin2dCursor,
  Twin2dFlow,
  Twin2dJustify,
  Twin2dLayout,
  Twin2dPad,
  Twin2dPrimBase,
} from '@dt/twin2d'
import { DtCheckbox, DtNumberInput, DtSelect } from '@dt/ui'
import { computed } from 'vue'

import { enumOptions } from '../../../scripts/inspectorFields'
import FillList from '../../fields/FillList.vue'
import ShadowList from '../../fields/ShadowList.vue'
import BorderField from './BorderField.vue'
import PrimBaseFields from './PrimBaseFields.vue'
import RadiusField from './RadiusField.vue'

const props = defineProps<{ modelValue: Twin2dBoxPrim }>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dBoxPrim]
  blur: []
}>()

/** 间距与模糊都不许为负。 */
const NON_NEG = { min: 0, step: 1 }

/** 填充不透时背板模糊看不出来。 */
const BLUR_HINT = '要这一层填充透得出东西，模糊才看得见'

/** 四向内边距的次序与 CSS 一致：上 / 右 / 下 / 左。 */
const PAD_CELLS = [
  { key: 0, label: '上内边距' },
  { key: 1, label: '右内边距' },
  { key: 2, label: '下内边距' },
  { key: 3, label: '左内边距' },
] as const

const FLOW_LABELS: Readonly<Record<Twin2dFlow, string>> = {
  row: '横排',
  col: '竖排',
  none: '不排（各自定位）',
}

const ALIGN_LABELS: Readonly<Record<Twin2dAlign, string>> = {
  start: '起始',
  center: '居中',
  end: '末尾',
  baseline: '基线',
  stretch: '拉满',
}

const JUSTIFY_LABELS: Readonly<Record<Twin2dJustify, string>> = {
  start: '起始',
  center: '居中',
  end: '末尾',
  between: '两端对齐',
  around: '均分留白',
}

const CURSOR_LABELS: Readonly<Record<Twin2dCursor, string>> = {
  default: '默认',
  help: '问号',
  pointer: '手型',
}

const FLOW_OPTIONS = enumOptions(TWIN_2D_FLOWS, FLOW_LABELS)
const ALIGN_OPTIONS = enumOptions(TWIN_2D_ALIGNS, ALIGN_LABELS)
const JUSTIFY_OPTIONS = enumOptions(TWIN_2D_JUSTIFIES, JUSTIFY_LABELS)
const CURSOR_OPTIONS = enumOptions(TWIN_2D_CURSORS, CURSOR_LABELS)

const layout = computed(() => props.modelValue.layout)

/** 这一层的填充里有没有一层是不透的；有就提示背板模糊看不出来。 */
const opaque = computed(() =>
  props.modelValue.fills.some((fill) => fill.opacity >= 1),
)

function write(patch: Partial<Twin2dBoxPrim>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function writeBase(base: Twin2dPrimBase): void {
  emit('update:modelValue', { ...props.modelValue, ...base })
}

function writeLayout(patch: Partial<Twin2dLayout>): void {
  write({ layout: { ...layout.value, ...patch } })
}

function writeFlow(next: string): void {
  const flow = TWIN_2D_FLOWS.find((item) => item === next)
  if (flow !== undefined) writeLayout({ flow })
}

function writeAlign(next: string): void {
  const align = TWIN_2D_ALIGNS.find((item) => item === next)
  if (align !== undefined) writeLayout({ align })
}

function writeJustify(next: string): void {
  const justify = TWIN_2D_JUSTIFIES.find((item) => item === next)
  if (justify !== undefined) writeLayout({ justify })
}

function writeCursor(next: string): void {
  const cursor = TWIN_2D_CURSORS.find((item) => item === next)
  if (cursor !== undefined) write({ cursor })
}

/**
 * 改四向内边距里的一格；元组整份换，就地改下标不换引用等于没改。
 * @param seat 第几格，顺序 t / r / b / l
 * @param value 新的内边距
 */
function writePad(seat: number, value: number): void {
  const pad = layout.value.pad
  const next: Twin2dPad = [
    seat === 0 ? value : pad[0],
    seat === 1 ? value : pad[1],
    seat === 2 ? value : pad[2],
    seat === 3 ? value : pad[3],
  ]
  writeLayout({ pad: next })
}
</script>

<template>
  <div class="flex flex-col gap-3" @focusout="emit('blur')">
    <PrimBaseFields :model-value="modelValue" @update:model-value="writeBase" />

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">排布</h4>
      <div class="grid grid-cols-2 gap-1.5">
        <DtSelect
          :model-value="layout.flow"
          :options="FLOW_OPTIONS"
          label="排流"
          size="sm"
          data-test="box-flow"
          @update:model-value="writeFlow"
        />
        <DtNumberInput
          :model-value="layout.gap"
          :range="NON_NEG"
          label="间距"
          unit="px"
          size="sm"
          :steppers="false"
          data-test="box-gap"
          @update:model-value="writeLayout({ gap: $event ?? 0 })"
        />
        <DtSelect
          :model-value="layout.align"
          :options="ALIGN_OPTIONS"
          label="交叉轴对齐"
          size="sm"
          data-test="box-align"
          @update:model-value="writeAlign"
        />
        <DtSelect
          :model-value="layout.justify"
          :options="JUSTIFY_OPTIONS"
          label="主轴分布"
          size="sm"
          data-test="box-justify"
          @update:model-value="writeJustify"
        />
      </div>
      <DtCheckbox
        :model-value="layout.wrap"
        label="放不下时换行"
        data-test="box-wrap"
        @update:model-value="writeLayout({ wrap: $event })"
      />
      <div class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          v-for="cell in PAD_CELLS"
          :key="cell.key"
          :model-value="layout.pad[cell.key]"
          :range="NON_NEG"
          :label="cell.label"
          unit="px"
          size="sm"
          :steppers="false"
          :data-test="`box-pad-${cell.key}`"
          @update:model-value="writePad(cell.key, $event ?? 0)"
        />
      </div>
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">填充</h4>
      <FillList
        :model-value="modelValue.fills"
        hint="没有填充层 = 透明底"
        data-test="box-fills"
        @update:model-value="write({ fills: $event })"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <BorderField
        :model-value="modelValue.border"
        @update:model-value="write({ border: $event })"
      />
      <RadiusField
        :model-value="modelValue.radius"
        @update:model-value="write({ radius: $event })"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">阴影</h4>
      <ShadowList
        :model-value="modelValue.shadows"
        hint="没有阴影层 = 不投影"
        data-test="box-shadows"
        @update:model-value="write({ shadows: $event })"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">其它</h4>
      <DtNumberInput
        :model-value="modelValue.backdropBlur"
        :range="NON_NEG"
        label="背板模糊"
        unit="px"
        size="sm"
        :steppers="false"
        :hint="opaque && modelValue.backdropBlur > 0 ? BLUR_HINT : ''"
        data-test="box-blur"
        @update:model-value="write({ backdropBlur: $event ?? 0 })"
      />
      <DtCheckbox
        :model-value="modelValue.clip"
        label="裁掉超出这只盒的部分"
        data-test="box-clip"
        @update:model-value="write({ clip: $event })"
      />
      <DtSelect
        :model-value="modelValue.cursor"
        :options="CURSOR_OPTIONS"
        label="光标"
        size="sm"
        data-test="box-cursor"
        @update:model-value="writeCursor"
      />
    </section>
  </div>
</template>
