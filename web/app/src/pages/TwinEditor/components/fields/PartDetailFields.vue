<script setup lang="ts">
/**
 * @fileoverview 部件详情弹窗：标题、弹窗里那块 3D、数据卡片的风格，以及卡片上的
 * 读数字段。
 *
 * ⚠ 弹窗里那块 3D **只装这一个部件**：它自己起一套场景，把部件克隆一份摆进去，
 * 与画布上那棵模型树互不干扰，关掉弹窗也没有任何要还原的东西。
 * ⚠ 字段用的是信息牌那一套画法，但走的是**另一个绑定槽**（`partFieldValues`）：
 * 行号与信息牌各数各的，两边互不影响。
 * ⚠ 字段一律占绑定行，与「近距点击弹不弹窗」无关：按动作过滤会让用户在下拉里
 * 翻一下就把这个部件已经绑好的点位整片丢掉。配了字段却不弹窗由诊断报出来。
 */
import type { TwinPanelField, TwinPartDetail } from '@dt/twin-config'
import {
  TWIN_PANEL_VARIANTS,
  detailPanelOf,
  type TwinPart,
} from '@dt/twin-config'
import {
  DtColorInput,
  DtField,
  DtInput,
  DtNumberInput,
  DtSelect,
  DtSwitch,
} from '@dt/ui'
import { computed } from 'vue'

import { PANEL_VARIANT_OPTIONS } from '../../scripts/panelVariants'
import PanelFieldList from './PanelFieldList.vue'

const props = defineProps<{
  /** 整个部件；标题留空时退回它的名字，字段列表也按它派行号。 */
  part: TwinPart
  /** 本部件之前已有多少行摊平的详情字段。 */
  rowOffset: number
}>()

const emit = defineEmits<{ 'update:modelValue': [TwinPartDetail] }>()

const COLUMN_RANGE = { min: 1, max: 4, step: 1 }
// ⚠ 两条区间必须与 `normalizePartDetail` 的夹取区间一致：给得出、收得回，
// 用户会看到自己刚填的值被弹回去，而没有任何提示说明为什么
const HEIGHT_RANGE = { min: 120, max: 720, step: 10 }
const WIDTH_RANGE = { min: 320, max: 1200, step: 20 }

/** 常用的几个语义色，省得每次去翻 token 名。 */
const SWATCHES = [
  '--accent-primary',
  '--state-success',
  '--state-warning',
  '--state-danger',
] as const

const detail = computed(() => props.part.detail)

/** 卡片长什么样在这里现算一份，与运行态卡片同一支换形函数。 */
const preview = computed(() => detailPanelOf(props.part))

function write(patch: Partial<TwinPartDetail>): void {
  emit('update:modelValue', { ...detail.value, ...patch })
}

function writeVariant(next: string): void {
  const found = TWIN_PANEL_VARIANTS.find((item) => item === next)
  if (found !== undefined) write({ variant: found })
}

function writeFields(fields: TwinPanelField[]): void {
  write({ fields })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <DtInput
      :model-value="detail.title"
      label="标题"
      :hint="`留空 = 用部件名「${part.name}」`"
      size="sm"
      @update:model-value="write({ title: $event })"
    />
    <DtInput
      :model-value="detail.subtitle"
      label="副标题"
      hint="标题上方那行小字；留空 = 不画"
      size="sm"
      @update:model-value="write({ subtitle: $event })"
    />
    <DtField label="风格" size="sm">
      <DtSelect
        :model-value="detail.variant"
        :options="PANEL_VARIANT_OPTIONS"
        aria-label="风格"
        size="sm"
        @update:model-value="writeVariant"
      />
    </DtField>
    <DtColorInput
      :model-value="detail.accent"
      :swatches="SWATCHES"
      label="主题色"
      hint="留空 = 跟随大屏主题色"
      size="sm"
      @update:model-value="write({ accent: $event })"
    />
    <DtNumberInput
      :model-value="detail.columns"
      :range="COLUMN_RANGE"
      label="字段列数"
      size="sm"
      @update:model-value="write({ columns: $event ?? 1 })"
    />

    <DtSwitch
      :model-value="detail.showModel"
      label="弹窗里画这个部件的模型"
      size="sm"
      @update:model-value="write({ showModel: $event })"
    />
    <p class="text-xs text-text-disabled">
      弹窗里那块 3D 只装这一个部件，自己一套场景，能单独转着看。
    </p>
    <DtSwitch
      v-if="detail.showModel"
      :model-value="detail.autoRotate"
      label="模型自转"
      size="sm"
      @update:model-value="write({ autoRotate: $event })"
    />
    <DtNumberInput
      v-if="detail.showModel"
      :model-value="detail.modelHeight"
      :range="HEIGHT_RANGE"
      label="模型区高度"
      unit="px"
      size="sm"
      @update:model-value="write({ modelHeight: $event ?? HEIGHT_RANGE.min })"
    />
    <DtNumberInput
      :model-value="detail.width"
      :range="WIDTH_RANGE"
      label="弹窗宽度"
      unit="px"
      size="sm"
      @update:model-value="write({ width: $event ?? WIDTH_RANGE.min })"
    />

    <PanelFieldList
      :panel="preview"
      :row-offset="rowOffset"
      owner="部件"
      @update:fields="writeFields"
    />
  </div>
</template>
