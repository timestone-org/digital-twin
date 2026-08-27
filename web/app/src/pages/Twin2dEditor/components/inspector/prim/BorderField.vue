<script setup lang="ts">
/**
 * @fileoverview 一格边框：线宽、线型四档、颜色，加四条边各自画不画。
 * `box` 的边框与变体补丁里的同名格共用它。
 *
 * ⚠ 线宽 0 与线型 `none` 是**两条**「看不见边框」的路，都留着：前者是「先不画，
 *   宽度回头再调」，后者是「这一档就是无边框」，而变体补丁按键覆盖，两者覆盖出来的
 *   结果不同。摆一句说明，免得用户以为其中一条坏了。
 * ⚠ 四条边默认全画：全不勾等于没有边框，那时给一行说明——不给的话画面上「边框配了
 *   没反应」，而每一格取值单看都对。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import { TWIN_2D_BORDER_STYLES } from '@dt/twin2d'
import type { Twin2dBorder, Twin2dBorderStyle } from '@dt/twin2d'
import { DtCheckbox, DtNumberInput, DtSelect } from '@dt/ui'
import { computed } from 'vue'

import ColorField from '../../fields/ColorField.vue'

const props = defineProps<{ modelValue: Twin2dBorder; label?: string }>()

const emit = defineEmits<{ 'update:modelValue': [Twin2dBorder]; blur: [] }>()

/** 与 `colorOr` 的兜底同一档。 */
const INHERITED_COLOR = 'currentColor'

/** 线宽不许为负；0 是有意义的一档（先不画）。 */
const WIDTH_RANGE = { min: 0, step: 0.5 }

/** 一条边都不画时的说明。 */
const NO_SIDE = '四条边都没勾，这个边框画不出来'

/** 宽度为 0 时的说明。 */
const NO_WIDTH = '线宽 0 = 先不画；要「这一档就是无边框」请把线型选成无'

const STYLE_LABELS: Readonly<Record<Twin2dBorderStyle, string>> = {
  solid: '实线',
  dashed: '虚线',
  dotted: '点线',
  none: '无',
}

/** 四条边的次序与 CSS 一致：上 / 右 / 下 / 左。 */
const SIDE_CELLS = [
  { key: 'top', label: '上' },
  { key: 'right', label: '右' },
  { key: 'bottom', label: '下' },
  { key: 'left', label: '左' },
] as const satisfies readonly {
  key: keyof Twin2dBorder['sides']
  label: string
}[]

const STYLE_OPTIONS = TWIN_2D_BORDER_STYLES.map((value) => ({
  value,
  label: STYLE_LABELS[value],
}))

const sides = computed(() => props.modelValue.sides)

const noSide = computed(
  () =>
    !sides.value.top &&
    !sides.value.right &&
    !sides.value.bottom &&
    !sides.value.left,
)

function write(patch: Partial<Twin2dBorder>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function writeStyle(next: string): void {
  const style = TWIN_2D_BORDER_STYLES.find((item) => item === next)
  if (style !== undefined) write({ style })
}

/**
 * 一条边画不画。
 * @param key 哪一条边
 * @param on 画不画
 */
function writeSide(key: keyof Twin2dBorder['sides'], on: boolean): void {
  write({ sides: { ...sides.value, [key]: on } })
}
</script>

<template>
  <div class="flex flex-col gap-1.5" @focusout="emit('blur')">
    <p class="text-xs text-text-secondary">{{ label ?? '边框' }}</p>

    <div class="grid grid-cols-2 gap-1.5">
      <DtNumberInput
        :model-value="modelValue.width"
        :range="WIDTH_RANGE"
        label="线宽"
        unit="px"
        size="sm"
        :steppers="false"
        :hint="modelValue.width === 0 ? NO_WIDTH : ''"
        data-test="border-width"
        @update:model-value="write({ width: $event ?? 0 })"
      />
      <DtSelect
        :model-value="modelValue.style"
        :options="STYLE_OPTIONS"
        label="线型"
        size="sm"
        data-test="border-style"
        @update:model-value="writeStyle"
      />
    </div>

    <ColorField
      :model-value="modelValue.color"
      :fallback="INHERITED_COLOR"
      label="边框色"
      @update:model-value="write({ color: $event })"
    />

    <div class="grid grid-cols-4 gap-1" role="group" aria-label="画哪几条边">
      <DtCheckbox
        v-for="cell in SIDE_CELLS"
        :key="cell.key"
        :model-value="sides[cell.key]"
        :label="cell.label"
        :data-test="`border-side-${cell.key}`"
        @update:model-value="writeSide(cell.key, $event)"
      />
    </div>

    <p v-if="noSide" class="text-xs text-state-danger" data-test="border-none">
      {{ NO_SIDE }}
    </p>
  </div>
</template>
