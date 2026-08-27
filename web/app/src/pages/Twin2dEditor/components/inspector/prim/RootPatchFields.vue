<script setup lang="ts">
/**
 * @fileoverview 变体作用在**节点根**上的覆盖：抬升、等比缩放、层号、边框色、强调色与
 * 外发光。每一格自己带一个「覆盖 / 不覆盖」开关。
 *
 * ⚠ 「不覆盖」与「覆盖成缺省值」是两回事，所以关掉一格写的是**删键**：写一个缺省值
 *   进去会把样式本来配好的那一格一起按回缺省。
 * ⚠ `lift` 与 `scale` 是同一条 transform 上的两段：hover 那一档两样都要给，只给
 *   `lift` 就是「抬起来了但没变大」。
 * ⚠ hover 一类的变体必须同时抬 `z`，否则那张悬浮卡会被右邻的节点整块盖住——而它
 *   看着像「卡片被裁掉了」。
 * ⚠ 阴影**空表等于不覆盖**（`normalizeRootPatch` 见到空数组就不写这个键）：要在这一
 *   档去掉外发光，给一条透明的阴影，别把表清空。
 * ⚠ 等比缩放不许落到 0：归一化会把 ≤0 的整键丢掉，用户看到的是「填了没生效」。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import type { Twin2dRootPatch, Twin2dShadow } from '@dt/twin2d'
import { DtCheckbox, DtNumberInput } from '@dt/ui'
import { computed } from 'vue'

import ColorField from '../../fields/ColorField.vue'
import ShadowList from '../../fields/ShadowList.vue'

const props = defineProps<{ modelValue: Twin2dRootPatch }>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dRootPatch]
  blur: []
}>()

/** 与 `colorOr` 的兜底同一档。 */
const INHERITED_COLOR = 'currentColor'

/** 打开一格时给的初值：都取参考项目 hover 那一档的量。 */
const SEED_LIFT = 3
const SEED_SCALE = 1.025
const SEED_Z = 30

/** 等比缩放：≤0 的整键会被归一化丢掉。 */
const SCALE_RANGE = { min: 0.01, step: 0.005 }

/** 抬升与层号一格一步。 */
const STEP_RANGE = { step: 1 }

/** 阴影空表时的说明。 */
const SHADOW_HINT = '空表 = 不覆盖阴影；要去掉外发光请给一条透明阴影'

const patch = computed(() => props.modelValue)

function write(next: Twin2dRootPatch): void {
  emit('update:modelValue', next)
}

/**
 * 撤掉一格覆盖。
 * ⚠ 删键而不是写一个缺省值进去：浅覆盖里「不覆盖」与「覆盖成缺省值」是两回事。
 * @param key 要撤掉的那一格
 */
function clear(key: keyof Twin2dRootPatch): void {
  const next: Twin2dRootPatch = { ...patch.value }
  delete next[key]
  write(next)
}

function toggleLift(on: boolean): void {
  if (on) write({ ...patch.value, lift: SEED_LIFT })
  else clear('lift')
}

function toggleScale(on: boolean): void {
  if (on) write({ ...patch.value, scale: SEED_SCALE })
  else clear('scale')
}

function toggleZ(on: boolean): void {
  if (on) write({ ...patch.value, z: SEED_Z })
  else clear('z')
}

function toggleBorder(on: boolean): void {
  if (on) write({ ...patch.value, borderColor: INHERITED_COLOR })
  else clear('borderColor')
}

function toggleAccent(on: boolean): void {
  if (on) write({ ...patch.value, accent: INHERITED_COLOR })
  else clear('accent')
}

function toggleShadows(on: boolean): void {
  if (on) write({ ...patch.value, shadows: [] })
  else clear('shadows')
}

function writeShadows(shadows: readonly Twin2dShadow[]): void {
  write({ ...patch.value, shadows })
}
</script>

<template>
  <div class="flex flex-col gap-1.5" @focusout="emit('blur')">
    <DtCheckbox
      :model-value="patch.lift !== undefined"
      label="抬升"
      data-test="root-lift-on"
      @update:model-value="toggleLift"
    />
    <DtNumberInput
      v-if="patch.lift !== undefined"
      :model-value="patch.lift"
      :range="STEP_RANGE"
      label="向上抬"
      unit="px"
      hint="与等比缩放是同一条位移上的两段，hover 那一档两样都要给"
      size="sm"
      :steppers="false"
      data-test="root-lift"
      @update:model-value="write({ ...patch, lift: $event ?? 0 })"
    />

    <DtCheckbox
      :model-value="patch.scale !== undefined"
      label="等比缩放"
      data-test="root-scale-on"
      @update:model-value="toggleScale"
    />
    <DtNumberInput
      v-if="patch.scale !== undefined"
      :model-value="patch.scale"
      :range="SCALE_RANGE"
      label="缩放倍数"
      size="sm"
      :steppers="false"
      data-test="root-scale"
      @update:model-value="write({ ...patch, scale: $event ?? 1 })"
    />

    <DtCheckbox
      :model-value="patch.z !== undefined"
      label="层号"
      data-test="root-z-on"
      @update:model-value="toggleZ"
    />
    <DtNumberInput
      v-if="patch.z !== undefined"
      :model-value="patch.z"
      :range="STEP_RANGE"
      label="抬到第几层"
      hint="悬浮卡一类不抬它会被右邻节点整块盖住"
      size="sm"
      :steppers="false"
      data-test="root-z"
      @update:model-value="write({ ...patch, z: $event ?? 0 })"
    />

    <DtCheckbox
      :model-value="patch.borderColor !== undefined"
      label="边框色"
      data-test="root-border-on"
      @update:model-value="toggleBorder"
    />
    <ColorField
      v-if="patch.borderColor !== undefined"
      :model-value="patch.borderColor"
      :fallback="INHERITED_COLOR"
      label="边框色"
      data-test="root-border"
      @update:model-value="write({ ...patch, borderColor: $event })"
    />

    <DtCheckbox
      :model-value="patch.accent !== undefined"
      label="强调色"
      data-test="root-accent-on"
      @update:model-value="toggleAccent"
    />
    <ColorField
      v-if="patch.accent !== undefined"
      :model-value="patch.accent"
      :fallback="INHERITED_COLOR"
      label="强调色"
      data-test="root-accent"
      @update:model-value="write({ ...patch, accent: $event })"
    />

    <DtCheckbox
      :model-value="patch.shadows !== undefined"
      label="外发光"
      data-test="root-shadows-on"
      @update:model-value="toggleShadows"
    />
    <ShadowList
      v-if="patch.shadows !== undefined"
      :model-value="patch.shadows"
      :hint="SHADOW_HINT"
      data-test="root-shadows"
      @update:model-value="writeShadows"
    />
  </div>
</template>
