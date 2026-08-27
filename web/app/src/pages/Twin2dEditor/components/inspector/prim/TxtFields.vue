<script setup lang="ts">
/**
 * @fileoverview `txt` 这一档的字段：文本五来源、字体、行高、对齐与基线、不换行与省略、
 * 悬浮完整文本、多层阴影与描边字；基类那十五项由 `PrimBaseFields` 摆在最前。
 *
 * ⚠ `badge` 是独立的一档而不是拿 `lit` 顶：角标的字来自节点上的 `badge`，落成字面量
 *   就等于把每个节点的角标写死在样式里。
 * ⚠ 字体那五格**缺席即跟随主题**，所以清空一格写的是「删掉这个键」，不是写一个空串：
 *   `exactOptionalPropertyTypes` 下显式的 undefined 与缺席是两回事，而一个显式的
 *   undefined 落到渲染层会盖掉主题值。
 * ⚠ 行高与字体分开两格：`FontValue` 是 L0 契约包的共享形状，属性面板的字体控件不认
 *   这一档。角标那一处必须显式给 1——少了它 18px 高的药丸会被行高撑成椭圆。
 * ⚠ 省略号要跟不换行一起给才看得见：只勾省略号时文本会先换行、根本溢不出去。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import {
  TWIN_2D_TEXT_ALIGNS,
  TWIN_2D_TEXT_BASELINES,
  TWIN_2D_TXT_SRC_KINDS,
} from '@dt/twin2d'
import type {
  Twin2dPrimBase,
  Twin2dTextAlign,
  Twin2dTextBaseline,
  Twin2dTextOutline,
  Twin2dTxtPrim,
  Twin2dTxtSrc,
  Twin2dTxtSrcKind,
} from '@dt/twin2d'
import type { FontValue } from '@dt/contracts'
import { DtCheckbox, DtInput, DtNumberInput, DtSelect } from '@dt/ui'
import { computed } from 'vue'

import { enumOptions } from '../../../scripts/inspectorFields'
import ColorField from '../../fields/ColorField.vue'
import ShadowList from '../../fields/ShadowList.vue'
import PrimBaseFields from './PrimBaseFields.vue'

const props = defineProps<{ modelValue: Twin2dTxtPrim }>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dTxtPrim]
  blur: []
}>()

/** 与 `colorOr` 的兜底同一档。 */
const INHERITED_COLOR = 'currentColor'

/** 字号与行高都不许落到 0：0 会把整行压成一条缝而不报错。 */
const SIZE_RANGE = { min: 1, step: 1 }
const LINE_RANGE = { min: 0.5, step: 0.05 }
const OUTLINE_RANGE = { min: 0.5, step: 0.5 }
const SPACING_RANGE = { step: 0.1 }

/** 只勾省略号时的说明。 */
const NEED_NOWRAP = '要跟「不换行」一起勾才看得见：会换行的文本溢不出去'

/** 空槽键的说明。 */
const NEED_SLOT = '必填：取不到槽键的这一档会退成空文本'

const SRC_LABELS: Readonly<Record<Twin2dTxtSrcKind, string>> = {
  lit: '写死一段文字',
  slot: '取一个槽位读数',
  label: '节点显示名',
  id: '节点 id',
  badge: '节点角标',
}

const ALIGN_LABELS: Readonly<Record<Twin2dTextAlign, string>> = {
  start: '左',
  center: '中',
  end: '右',
}

const BASELINE_LABELS: Readonly<Record<Twin2dTextBaseline, string>> = {
  auto: '跟随',
  baseline: '基线',
  center: '居中',
}

/** 字重：留空一档即缺席，跟随主题排版。 */
const WEIGHT_OPTIONS = [
  { value: '', label: '跟随' },
  { value: '400', label: '常规' },
  { value: '500', label: '中等' },
  { value: '600', label: '半粗' },
  { value: '700', label: '加粗' },
]

const SRC_OPTIONS = enumOptions(TWIN_2D_TXT_SRC_KINDS, SRC_LABELS)
const ALIGN_OPTIONS = enumOptions(TWIN_2D_TEXT_ALIGNS, ALIGN_LABELS)
const BASELINE_OPTIONS = enumOptions(TWIN_2D_TEXT_BASELINES, BASELINE_LABELS)

const src = computed(() => props.modelValue.src)

const literal = computed(() => (src.value.kind === 'lit' ? src.value.text : ''))

const slotKey = computed(() =>
  src.value.kind === 'slot' ? src.value.slot : '',
)

const font = computed(() => props.modelValue.font)

const outline = computed(() => props.modelValue.outline)

function write(patch: Partial<Twin2dTxtPrim>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function writeBase(base: Twin2dPrimBase): void {
  emit('update:modelValue', { ...props.modelValue, ...base })
}

function writeSrc(next: Twin2dTxtSrc): void {
  write({ src: next })
}

function writeKind(next: string): void {
  const kind = TWIN_2D_TXT_SRC_KINDS.find((item) => item === next)
  if (kind === undefined || kind === src.value.kind) return
  if (kind === 'lit') writeSrc({ kind, text: '' })
  else if (kind === 'slot') writeSrc({ kind, slot: '' })
  else writeSrc({ kind })
}

function writeAlign(next: string): void {
  const align = TWIN_2D_TEXT_ALIGNS.find((item) => item === next)
  if (align !== undefined) write({ align })
}

function writeBaseline(next: string): void {
  const baseline = TWIN_2D_TEXT_BASELINES.find((item) => item === next)
  if (baseline !== undefined) write({ baseline })
}

/**
 * 换掉字体里的一个键；空值一律**删键**而不是写 undefined——缺席才是「跟随主题」。
 * @param key 哪一个键
 * @param value 新值，`undefined` 与空串都当作清掉
 */
function writeFont<K extends keyof FontValue>(
  key: K,
  value: FontValue[K],
): void {
  const next: FontValue = { ...font.value }
  if (value === undefined || value === '') delete next[key]
  else next[key] = value
  write({ font: next })
}

/**
 * 字重：下拉里是字符串，落进文档的是数字（「跟随」那一档清键）。
 * @param raw 下拉当前值
 */
function writeWeight(raw: string): void {
  writeFont('weight', raw === '' ? undefined : Number(raw))
}

/**
 * 描边字开关；打开时给一档看得见的初值。
 * @param on 描不描
 */
function toggleOutline(on: boolean): void {
  write({ outline: on ? { width: 1, color: INHERITED_COLOR } : null })
}

function writeOutline(patch: Partial<Twin2dTextOutline>): void {
  const at = outline.value
  if (at !== null) write({ outline: { ...at, ...patch } })
}
</script>

<template>
  <div class="flex flex-col gap-3" @focusout="emit('blur')">
    <PrimBaseFields :model-value="modelValue" @update:model-value="writeBase" />

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">文本</h4>
      <DtSelect
        :model-value="src.kind"
        :options="SRC_OPTIONS"
        label="来源"
        size="sm"
        data-test="txt-kind"
        @update:model-value="writeKind"
      />
      <DtInput
        v-if="src.kind === 'lit'"
        :model-value="literal"
        label="文字"
        hint="首尾空格是排版的一部分，不会被去掉"
        size="sm"
        data-test="txt-literal"
        @update:model-value="writeSrc({ kind: 'lit', text: $event })"
      />
      <DtInput
        v-if="src.kind === 'slot'"
        :model-value="slotKey"
        label="槽键"
        placeholder="heat"
        size="sm"
        :error="slotKey.trim() === '' ? NEED_SLOT : ''"
        data-test="txt-slot"
        @update:model-value="writeSrc({ kind: 'slot', slot: $event })"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">排版</h4>
      <div class="grid grid-cols-2 gap-1.5">
        <DtInput
          :model-value="font.family ?? ''"
          label="字体"
          placeholder="留空 = 跟随主题"
          size="sm"
          data-test="txt-family"
          @update:model-value="writeFont('family', $event)"
        />
        <DtNumberInput
          :model-value="font.size"
          :range="SIZE_RANGE"
          label="字号"
          unit="px"
          size="sm"
          :steppers="false"
          data-test="txt-size"
          @update:model-value="writeFont('size', $event)"
        />
        <DtSelect
          :model-value="String(font.weight ?? '')"
          :options="WEIGHT_OPTIONS"
          label="字重"
          size="sm"
          data-test="txt-weight"
          @update:model-value="writeWeight"
        />
        <DtNumberInput
          :model-value="font.letterSpacing"
          :range="SPACING_RANGE"
          label="字距"
          unit="px"
          size="sm"
          :steppers="false"
          data-test="txt-spacing"
          @update:model-value="writeFont('letterSpacing', $event)"
        />
        <DtNumberInput
          :model-value="modelValue.lineHeight ?? undefined"
          :range="LINE_RANGE"
          label="行高倍数"
          hint="留空 = 跟随主题"
          size="sm"
          :steppers="false"
          data-test="txt-line"
          @update:model-value="write({ lineHeight: $event ?? null })"
        />
      </div>
      <ColorField
        :model-value="font.color ?? ''"
        label="文字色"
        hint="留空 = 跟随上层"
        @update:model-value="writeFont('color', $event)"
      />
      <div class="grid grid-cols-2 gap-1.5">
        <DtSelect
          :model-value="modelValue.align"
          :options="ALIGN_OPTIONS"
          label="横向对齐"
          size="sm"
          data-test="txt-align"
          @update:model-value="writeAlign"
        />
        <DtSelect
          :model-value="modelValue.baseline"
          :options="BASELINE_OPTIONS"
          label="基线"
          size="sm"
          data-test="txt-baseline"
          @update:model-value="writeBaseline"
        />
      </div>
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">溢出</h4>
      <DtCheckbox
        :model-value="modelValue.nowrap"
        label="不换行"
        data-test="txt-nowrap"
        @update:model-value="write({ nowrap: $event })"
      />
      <DtCheckbox
        :model-value="modelValue.ellipsis"
        label="溢出显示省略号"
        data-test="txt-ellipsis"
        @update:model-value="write({ ellipsis: $event })"
      />
      <p
        v-if="modelValue.ellipsis && !modelValue.nowrap"
        class="text-xs text-state-danger"
        data-test="txt-ellipsis-hint"
      >
        {{ NEED_NOWRAP }}
      </p>
      <DtCheckbox
        :model-value="modelValue.titleAttr"
        label="悬浮时给出完整文本"
        data-test="txt-title"
        @update:model-value="write({ titleAttr: $event })"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">阴影与描边</h4>
      <ShadowList
        :model-value="modelValue.shadows"
        hint="没有阴影层 = 不投影"
        data-test="txt-shadows"
        @update:model-value="write({ shadows: $event })"
      />
      <DtCheckbox
        :model-value="outline !== null"
        label="描边字（标注标签那一套）"
        data-test="txt-outline"
        @update:model-value="toggleOutline"
      />
      <div v-if="outline !== null" class="flex flex-col gap-1.5">
        <DtNumberInput
          :model-value="outline.width"
          :range="OUTLINE_RANGE"
          label="描边宽"
          unit="px"
          size="sm"
          :steppers="false"
          data-test="txt-outline-width"
          @update:model-value="writeOutline({ width: $event ?? 1 })"
        />
        <ColorField
          :model-value="outline.color"
          :fallback="INHERITED_COLOR"
          label="描边色"
          @update:model-value="writeOutline({ color: $event })"
        />
      </div>
    </section>
  </div>
</template>
