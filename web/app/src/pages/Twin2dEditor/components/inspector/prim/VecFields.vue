<script setup lang="ts">
/**
 * @fileoverview `vec` 这一档的字段：坐标口径、一段几何、一个填充、多遍描边与局部渐变，
 * 外加 viewBox 拉不拉伸；基类那十五项由 `PrimBaseFields` 摆在最前。
 *
 * ⚠ 取点只**转交**：几何那一格要「在画布上点几下」，本件不碰画布，请求原样往上抛，
 *   由装配层接。没人接时上层不给 `canPick`，那个键就不摆——摆一个按下去毫无反应的键
 *   比没有更糟。
 * ⚠ 描边一遍都不配时 SVG 按 1px 黑线画，与整张图的线宽对不上，所以空表时给一行说明。
 * ⚠ `stretch` 打开等于 `preserveAspectRatio="none"`：非等比盒上图形会被拉歪，
 *   电路符号一律不要开。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import type {
  Twin2dPaint,
  Twin2dPrimBase,
  Twin2dShape,
  Twin2dVecCoord,
  Twin2dVecPrim,
} from '@dt/twin2d'
import { DtCheckbox } from '@dt/ui'
import { computed } from 'vue'

import type { Twin2dPointSeq } from '../../../scripts/shapeText'
import GeometryField from '../../fields/GeometryField.vue'
import StrokePassList from '../../fields/StrokePassList.vue'
import GradientList from './GradientList.vue'
import PaintField from './PaintField.vue'
import PrimBaseFields from './PrimBaseFields.vue'

const props = defineProps<{
  modelValue: Twin2dVecPrim
  /** 画布取回来的点；null 或缺席 = 此刻没在取点。 */
  picked?: Twin2dPointSeq | null
  /** 装配层接得住取点请求时才给这个键。 */
  canPick?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dVecPrim]
  /** 请求进入取点模式；画布怎么接由装配层定。 */
  pick: [target: 'poly' | 'path']
  /** 请求退出取点模式。 */
  pickEnd: []
  blur: []
}>()

/** 描边空表时的说明。 */
const NO_STROKE = '一遍都没有 = 按 SVG 缺省的 1px 画，与整张图的线宽对不上'

/** 渐变空表时的说明。 */
const NO_GRADIENT = '建了渐变，上面那一格才选得到「本图元的渐变」'

const gradientIds = computed(() =>
  props.modelValue.gradients.map((one) => one.id),
)

/** 填充正引着的那个渐变 id；不是渐变档就空着。 */
const usedGradient = computed(() =>
  props.modelValue.fill.kind === 'gradient' ? props.modelValue.fill.id : '',
)

function write(patch: Partial<Twin2dVecPrim>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function writeBase(base: Twin2dPrimBase): void {
  emit('update:modelValue', { ...props.modelValue, ...base })
}

function writeShape(shape: Twin2dShape): void {
  write({ shape })
}

function writeCoord(coord: Twin2dVecCoord): void {
  write({ coord })
}

function writeFill(fill: Twin2dPaint): void {
  write({ fill })
}
</script>

<template>
  <div class="flex flex-col gap-3" @focusout="emit('blur')">
    <PrimBaseFields :model-value="modelValue" @update:model-value="writeBase" />

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">几何</h4>
      <GeometryField
        :model-value="modelValue.shape"
        :coord="modelValue.coord"
        :picked="picked ?? null"
        :can-pick="canPick === true"
        data-test="vec-shape"
        @update:model-value="writeShape"
        @update:coord="writeCoord"
        @pick="emit('pick', $event)"
        @pick-end="emit('pickEnd')"
      />
      <DtCheckbox
        :model-value="modelValue.stretch"
        label="非等比盒上拉伸填满"
        data-test="vec-stretch"
        @update:model-value="write({ stretch: $event })"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">填充</h4>
      <PaintField
        :model-value="modelValue.fill"
        :gradient-ids="gradientIds"
        data-test="vec-fill"
        @update:model-value="writeFill"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">描边</h4>
      <StrokePassList
        :model-value="modelValue.strokes"
        :hint="NO_STROKE"
        data-test="vec-strokes"
        @update:model-value="write({ strokes: $event })"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">局部渐变</h4>
      <GradientList
        :model-value="modelValue.gradients"
        :used-id="usedGradient"
        :hint="NO_GRADIENT"
        data-test="vec-gradients"
        @update:model-value="write({ gradients: $event })"
      />
    </section>
  </div>
</template>
