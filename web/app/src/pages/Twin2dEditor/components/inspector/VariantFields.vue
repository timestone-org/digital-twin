<script setup lang="ts">
/**
 * @fileoverview 一条变体：命中条件、作用在节点根上的覆盖，以及按图元 id 逐枚打的
 * 浅覆盖补丁。收「这一条变体 + 这份样式的图元树」，产出整条新变体往上抛。
 *
 * ⚠ 变体按**文档序**求值、后者覆盖前者，所以这张表的次序就是渲染结果的一部分。
 *   不把这条摆在明面上的话，用户配了两条互相覆盖的变体，会以为其中一条「坏了」——
 *   而两条单看都对。调序在这里出请求，落地走 `orderVariants`。
 * ⚠ 条件填不全的一条会被**整条丢弃**（`normalizeVariant` 见到判不出的条件就返回 null），
 *   所以这里不给「不判条件」那个出口，红字也一律留在条件那一格里。
 * ⚠ 补丁指向的图元不在了时当场标红：那一条补丁永远不会生效（`dangling-variant-prim`），
 *   而界面上它看着与别的一模一样。
 * ⚠ 图元树是**摊平**了列的（`box` 连子树一起）：只列根层的话，挂在盒里的那些图元
 *   一枚都覆盖不到，而它们恰恰是最常被变体动的（状态点、边框、光斑）。
 * ⚠ 本件自己不碰文档，只 emit；写回要走 `styleOps` 的 `updateVariant` / `orderVariants`，
 *   合并撤销的时机由装配层定（见 `blur`）。
 */
import type {
  Twin2dCondition,
  Twin2dPrim,
  Twin2dPrimPatch,
  Twin2dRootPatch,
  Twin2dVariant,
} from '@dt/twin2d'
import { DtButton, DtSelect } from '@dt/ui'
import { computed } from 'vue'

import { findTwin2dPrim } from '../../scripts/primOps'
import { twin2dPatchOptions } from '../../scripts/primTreeRows'
import type { Twin2dOrderMove } from '../../scripts/nodeOps'
import ConditionField from './prim/ConditionField.vue'
import RootPatchFields from './prim/RootPatchFields.vue'
import VariantPatchRow from './prim/VariantPatchRow.vue'

const props = defineProps<{
  modelValue: Twin2dVariant
  /** 这份样式的图元树；覆盖那一段按它列可选项与判悬空。 */
  prims: readonly Twin2dPrim[]
  /** 这一条在变体表里排第几，从 0 数。 */
  order: number
  /** 这份样式一共几条变体。 */
  total: number
}>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dVariant]
  /** 请求调序；落地走 `orderVariants`。 */
  move: [move: Twin2dOrderMove]
  blur: []
}>()

const patch = computed(() => props.modelValue.patch)

/** 覆盖行：连它指着的那一枚一起带上，指空了就给 null。 */
const rows = computed(() =>
  Object.entries(patch.value).map(([primId, one]) => ({
    primId,
    patch: one,
    base: findTwin2dPrim(props.prims, primId)?.prim ?? null,
  })),
)

/** 还没被覆盖的那些图元。 */
const addable = computed(() => twin2dPatchOptions(props.prims, patch.value))

const seatText = computed(
  () => `第 ${props.order + 1} 条 / 共 ${props.total} 条`,
)

function write(patched: Partial<Twin2dVariant>): void {
  emit('update:modelValue', { ...props.modelValue, ...patched })
}

/**
 * 换条件；清空那一路走不通（这一格是必填的），所以 null 原样留住旧条件。
 * @param when 新条件
 */
function writeWhen(when: Twin2dCondition | null): void {
  if (when !== null) write({ when })
}

function writeRoot(rootPatch: Twin2dRootPatch): void {
  write({ rootPatch })
}

/**
 * 换一枚图元的覆盖。
 * @param primId 被覆盖的图元 id
 * @param one 这一条覆盖的新内容
 */
function writePatch(primId: string, one: Twin2dPrimPatch): void {
  write({ patch: { ...patch.value, [primId]: one } })
}

/**
 * 给一枚图元加一条空覆盖，之后在行里逐格填。
 * @param primId 样式里那枚图元的 id
 */
function addPatch(primId: string): void {
  if (patch.value[primId] !== undefined) return
  write({ patch: { ...patch.value, [primId]: {} } })
}

/**
 * 撤掉整条覆盖。
 * @param primId 被覆盖的图元 id
 */
function removePatch(primId: string): void {
  const kept = Object.entries(patch.value).filter(([key]) => key !== primId)
  write({ patch: Object.fromEntries(kept) })
}

function onBlur(): void {
  emit('blur')
}
</script>

<template>
  <div class="flex flex-col gap-3" data-test="variant-fields">
    <section class="flex flex-col gap-1.5">
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
          {{ seatText }}
        </span>
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="chevron-up"
          :disabled="order === 0"
          aria-label="往前挪一位"
          title="往前挪一位"
          data-test="variant-up"
          @click="emit('move', 'backward')"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="chevron-down"
          :disabled="order >= total - 1"
          aria-label="往后挪一位"
          title="往后挪一位"
          data-test="variant-down"
          @click="emit('move', 'forward')"
        />
      </div>
      <p class="text-xs text-text-disabled" data-test="variant-order-hint">
        命中的变体按这张表的次序一条条盖上去，排在后面的盖住前面的。
      </p>
    </section>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-xs font-medium text-text-secondary">命中条件</h3>
      <ConditionField
        :model-value="modelValue.when"
        required
        data-test="variant-when"
        @update:model-value="writeWhen"
        @blur="onBlur"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-xs font-medium text-text-secondary">节点根覆盖</h3>
      <RootPatchFields
        :model-value="modelValue.rootPatch"
        data-test="variant-root"
        @update:model-value="writeRoot"
        @blur="onBlur"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-xs font-medium text-text-secondary">图元覆盖</h3>
      <VariantPatchRow
        v-for="row in rows"
        :key="row.primId"
        :prim-id="row.primId"
        :base="row.base"
        :patch="row.patch"
        @update="writePatch(row.primId, $event)"
        @remove="removePatch(row.primId)"
        @blur="onBlur"
      />
      <DtSelect
        v-if="addable.length > 0"
        model-value=""
        :options="addable"
        :display="{ placeholder: '给一枚图元加覆盖…' }"
        size="sm"
        aria-label="给一枚图元加覆盖"
        data-test="variant-add-patch"
        @update:model-value="addPatch"
      />
    </section>
  </div>
</template>
