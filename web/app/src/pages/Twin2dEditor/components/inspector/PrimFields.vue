<script setup lang="ts">
/**
 * @fileoverview 一枚图元的全部属性，按 kind 分派给四个分档面之一（盒 / 矢量 / 图标 /
 * 文本）；四档共有的那十五项由各分档面里的 `PrimBaseFields` 摆在最前。
 *
 * ⚠ 这一层只分派，一处字段逻辑都不放：摊一半到这儿会让「这个字段在哪改」散成两处，
 *   而两处里总有一处会漏掉。
 * ⚠ `id` 与 `kind` 都不给改。id 是身份：节点级覆盖、变体补丁与 `v-for` 三处按它寻址，
 *   顺手换掉会让三处一起指空。换 kind 等于把渲染分支整条换掉，要换只能删了重加——
 *   摆一个「换类型」下拉会让人以为原地换过去还能留住已经配好的那些格子。
 * ⚠ 取点请求只**转交**，本件不碰画布：没人接时上层不给 `canPick`，那个键就不摆。
 * ⚠ 本件自己不碰文档，只 emit 整枚新图元；写回文档要走 `primOps` 的 `updatePrim` /
 *   `updateNodeLayer`，合并撤销的时机由装配层定（见 `blur`）。
 */
import type {
  Twin2dBoxPrim,
  Twin2dIcoPrim,
  Twin2dPrim,
  Twin2dPrimKind,
  Twin2dTxtPrim,
  Twin2dVecPrim,
} from '@dt/twin2d'
import { computed } from 'vue'

import type { Twin2dPointSeq } from '../../scripts/shapeText'
import BoxFields from './prim/BoxFields.vue'
import IcoFields from './prim/IcoFields.vue'
import TxtFields from './prim/TxtFields.vue'
import VecFields from './prim/VecFields.vue'

const props = defineProps<{
  modelValue: Twin2dPrim
  /** 画布取回来的点；null 或缺席 = 此刻没在取点。 */
  picked?: Twin2dPointSeq | null
  /** 装配层接得住取点请求时才给这个键。 */
  canPick?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dPrim]
  /** 请求进入取点模式；画布怎么接由装配层定。 */
  pick: [target: 'poly' | 'path']
  /** 请求退出取点模式。 */
  pickEnd: []
  blur: []
}>()

const KIND_LABELS: Readonly<Record<Twin2dPrimKind, string>> = {
  box: '盒',
  vec: '矢量',
  ico: '图标',
  txt: '文本',
}

// ⚠ 收窄一律在 script 里做，不靠模板里的 `v-if`：模板收窄失手时 typecheck 与
// lint 双双放行，只在运行期读到 undefined
const box = computed<Twin2dBoxPrim | null>(() =>
  props.modelValue.kind === 'box' ? props.modelValue : null,
)
const vec = computed<Twin2dVecPrim | null>(() =>
  props.modelValue.kind === 'vec' ? props.modelValue : null,
)
const ico = computed<Twin2dIcoPrim | null>(() =>
  props.modelValue.kind === 'ico' ? props.modelValue : null,
)
const txt = computed<Twin2dTxtPrim | null>(() =>
  props.modelValue.kind === 'txt' ? props.modelValue : null,
)

const kindLabel = computed(() => KIND_LABELS[props.modelValue.kind])

function write(next: Twin2dPrim): void {
  emit('update:modelValue', next)
}

function onBlur(): void {
  emit('blur')
}
</script>

<template>
  <div
    class="flex flex-col gap-2"
    :data-kind="modelValue.kind"
    data-test="prim-fields"
  >
    <p class="truncate text-xs text-text-disabled" data-test="prim-id">
      {{ modelValue.id }} · {{ kindLabel }}
    </p>

    <BoxFields
      v-if="box !== null"
      :model-value="box"
      @update:model-value="write"
      @blur="onBlur"
    />
    <VecFields
      v-else-if="vec !== null"
      :model-value="vec"
      :picked="picked ?? null"
      :can-pick="canPick === true"
      @update:model-value="write"
      @pick="emit('pick', $event)"
      @pick-end="emit('pickEnd')"
      @blur="onBlur"
    />
    <IcoFields
      v-else-if="ico !== null"
      :model-value="ico"
      @update:model-value="write"
      @blur="onBlur"
    />
    <TxtFields
      v-else-if="txt !== null"
      :model-value="txt"
      @update:model-value="write"
      @blur="onBlur"
    />
  </div>
</template>
