<script setup lang="ts">
/**
 * @fileoverview `ico` 这一档的字段：图标五来源（不画 / 注册名 / 内置图标 / 素材 /
 * 手绘）加一格颜色；基类那十五项由 `PrimBaseFields` 摆在最前。
 *
 * ⚠ 颜色**按 symbol 分档生效**：`TWIN_2D_FIXED_COLOR_SPRITES` 那四枚是插画式多色的，
 *   颜色写死在 sprite 里，`ico.color` 对它们完全无效。那时把颜色格禁掉并写明原因——
 *   留着可点的话，用户点了没反应，而这既不报错也不像 bug。
 * ⚠ 注册名不在 `DtIcon` 的表里时**什么都不渲染**，零报错，所以未登记的名字当场标红；
 *   名字表按注册序摆、不排序：`localeCompare` 不钉 locale 会让本地绿、CI 红。
 * ⚠ 素材引用为空时整档落回「不画图标」（`normalizeIcoSrc`），所以空引用当场标红。
 * ⚠ 换来源不带旧值过去：注册名与素材引用是两个命名空间，带过去只会得到一个必然
 *   解析不到的引用。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import {
  TWIN_2D_ICO_SRC_KINDS,
  TWIN_2D_SPRITE_IDS,
  isFixedColorSprite,
} from '@dt/twin2d'
import type {
  Twin2dDrawPart,
  Twin2dIcoPrim,
  Twin2dIcoSrc,
  Twin2dIcoSrcKind,
  Twin2dPrimBase,
  Twin2dSpriteId,
} from '@dt/twin2d'
import { DtInput, DtNumberInput, DtSelect, ICONS, isIconName } from '@dt/ui'
import { computed } from 'vue'

import { enumOptions } from '../../../scripts/inspectorFields'
import ColorField from '../../fields/ColorField.vue'
import DrawPartList from './DrawPartList.vue'
import PrimBaseFields from './PrimBaseFields.vue'

const props = defineProps<{ modelValue: Twin2dIcoPrim }>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dIcoPrim]
  blur: []
}>()

/** 与 `colorOr` 的兜底同一档：跟随上层文字色。 */
const INHERITED_COLOR = 'currentColor'

/** 手绘一档的缺省画幅，与 `drawIcoSrc` 的兜底逐字相同。 */
const DRAW_SPAN = 48

/** 画幅不许落到 0：0 宽的 viewBox 什么都画不出来。 */
const SPAN_RANGE = { min: 1, step: 4 }

/** 换到内置图标集时落在哪一枚：挑一枚单色的，旁边那格颜色立刻就能用。 */
const FIRST_SPRITE: Twin2dSpriteId = 'ico-vsl-tank'

/** 那四枚多色图标的说明。 */
const FIXED_COLOR = '这一枚是插画式多色图标，颜色写死在图形里，这一格对它无效'

/** 未登记的注册名的说明。 */
const UNKNOWN_NAME = '这个名字不在图标表里，画出来会是一片空白'

/** 空素材引用的说明。 */
const NEED_REF = '必填：没有引用的这一档会在存盘时落回「不画图标」'

const SRC_LABELS: Readonly<Record<Twin2dIcoSrcKind, string>> = {
  none: '不画图标',
  name: '注册图标名',
  sprite: '内置图标集',
  asset: '素材库图片',
  draw: '手绘',
}

const SPRITE_LABELS: Readonly<Record<Twin2dSpriteId, string>> = {
  'ico-src-waste-heat': '余热回收',
  'ico-src-steam': '蒸汽锅炉',
  'ico-src-air-source': '空气能',
  'ico-src-solar': '太阳能',
  'ico-vsl-tank': '水箱',
  'ico-vsl-manifold': '分集水器',
  'ico-hx': '换热器',
  'ico-term-shower': '洗浴终端',
  'ico-term-radiator': '采暖终端',
  'ico-term-ac': '空调终端',
  'ico-tap': '水龙头',
}

const SRC_OPTIONS = enumOptions(TWIN_2D_ICO_SRC_KINDS, SRC_LABELS)
const SPRITE_OPTIONS = enumOptions(TWIN_2D_SPRITE_IDS, SPRITE_LABELS)

/** ⚠ 按注册序摆，不排序：`localeCompare` 不钉 locale 会让本地绿、CI 红。 */
const ICON_NAMES: readonly string[] = Object.keys(ICONS)

const src = computed(() => props.modelValue.src)

const iconName = computed(() =>
  src.value.kind === 'name' ? src.value.name : '',
)

const spriteId = computed<Twin2dSpriteId | null>(() =>
  src.value.kind === 'sprite' ? src.value.id : null,
)

const assetRef = computed(() =>
  src.value.kind === 'asset' ? src.value.ref : '',
)

const draw = computed(() => (src.value.kind === 'draw' ? src.value : null))

/** 未登记的那个名字也摆进表里，不然用户连「它现在是谁」都看不出来。 */
const nameOptions = computed(() => {
  const known = ICON_NAMES.map((value) => ({ value, label: value }))
  const at = iconName.value
  if (at === '' || isIconName(at)) return known
  return [...known, { value: at, label: `${at}（未登记）` }]
})

const nameError = computed(() =>
  iconName.value !== '' && !isIconName(iconName.value) ? UNKNOWN_NAME : '',
)

/** 那四枚多色图标上颜色格不生效。 */
const colorLocked = computed(
  () => spriteId.value !== null && isFixedColorSprite(spriteId.value),
)

function write(patch: Partial<Twin2dIcoPrim>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function writeBase(base: Twin2dPrimBase): void {
  emit('update:modelValue', { ...props.modelValue, ...base })
}

function writeSrc(next: Twin2dIcoSrc): void {
  write({ src: next })
}

/** 一档新来源；不带旧值过去，几个命名空间互不相通。 */
function blankSrc(kind: Twin2dIcoSrcKind): Twin2dIcoSrc {
  switch (kind) {
    case 'name':
      return { kind, name: '' }
    case 'sprite':
      return { kind, id: FIRST_SPRITE }
    case 'asset':
      return { kind, ref: '' }
    case 'draw':
      return { kind, viewBox: [DRAW_SPAN, DRAW_SPAN], parts: [] }
    default:
      return { kind: 'none' }
  }
}

function writeKind(next: string): void {
  const kind = TWIN_2D_ICO_SRC_KINDS.find((item) => item === next)
  if (kind === undefined || kind === src.value.kind) return
  writeSrc(blankSrc(kind))
}

function writeSprite(next: string): void {
  const id = TWIN_2D_SPRITE_IDS.find((item) => item === next)
  if (id !== undefined) writeSrc({ kind: 'sprite', id })
}

/**
 * 改手绘的画幅。
 * @param axis 宽还是高
 * @param value 新的边长
 */
function writeSpan(axis: 0 | 1, value: number): void {
  const at = draw.value
  if (at === null) return
  const box: readonly [number, number] = [
    axis === 0 ? value : at.viewBox[0],
    axis === 1 ? value : at.viewBox[1],
  ]
  writeSrc({ ...at, viewBox: box })
}

function writeParts(parts: readonly Twin2dDrawPart[]): void {
  const at = draw.value
  if (at !== null) writeSrc({ ...at, parts })
}
</script>

<template>
  <div class="flex flex-col gap-3" @focusout="emit('blur')">
    <PrimBaseFields :model-value="modelValue" @update:model-value="writeBase" />

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">图标</h4>
      <DtSelect
        :model-value="src.kind"
        :options="SRC_OPTIONS"
        label="来源"
        size="sm"
        data-test="ico-kind"
        @update:model-value="writeKind"
      />

      <DtSelect
        v-if="src.kind === 'name'"
        :model-value="iconName"
        :options="nameOptions"
        label="图标名"
        size="sm"
        :error="nameError"
        :display="{ searchable: true, placeholder: '挑一个图标' }"
        data-test="ico-name"
        @update:model-value="writeSrc({ kind: 'name', name: $event })"
      />

      <DtSelect
        v-if="spriteId !== null"
        :model-value="spriteId"
        :options="SPRITE_OPTIONS"
        label="内置图标"
        size="sm"
        data-test="ico-sprite"
        @update:model-value="writeSprite"
      />

      <DtInput
        v-if="src.kind === 'asset'"
        :model-value="assetRef"
        label="素材引用"
        placeholder="asset:… 或 https://…"
        size="sm"
        :error="assetRef === '' ? NEED_REF : ''"
        data-test="ico-asset"
        @update:model-value="writeSrc({ kind: 'asset', ref: $event })"
      />
    </section>

    <section v-if="draw !== null" class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">手绘</h4>
      <div class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          :model-value="draw.viewBox[0]"
          :range="SPAN_RANGE"
          label="画幅宽"
          size="sm"
          :steppers="false"
          data-test="ico-vb-w"
          @update:model-value="writeSpan(0, $event ?? DRAW_SPAN)"
        />
        <DtNumberInput
          :model-value="draw.viewBox[1]"
          :range="SPAN_RANGE"
          label="画幅高"
          size="sm"
          :steppers="false"
          data-test="ico-vb-h"
          @update:model-value="writeSpan(1, $event ?? DRAW_SPAN)"
        />
      </div>
      <DrawPartList
        :model-value="draw.parts"
        :span="draw.viewBox[0]"
        data-test="ico-parts"
        @update:model-value="writeParts"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">颜色</h4>
      <DtInput
        v-if="colorLocked"
        :model-value="modelValue.color"
        label="颜色"
        size="sm"
        disabled
        :hint="FIXED_COLOR"
        data-test="ico-color-locked"
      />
      <ColorField
        v-else
        :model-value="modelValue.color"
        :fallback="INHERITED_COLOR"
        label="颜色"
        hint="缺省跟随上层文字色"
        data-test="ico-color"
        @update:model-value="write({ color: $event })"
      />
    </section>
  </div>
</template>
