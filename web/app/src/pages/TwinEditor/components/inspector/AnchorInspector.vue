<script setup lang="ts">
/**
 * @fileoverview 锚点检查器：名字、世界坐标、读数的前缀/单位/小数位与显隐。
 *
 * ⚠ 小数位有「不定位数」这一档（`null`），它与「定 0 位」不是一回事：前者按原值
 * 上屏，后者会把 0.4 显示成 0。所以用一个开关切换两种状态，不让 0 兼职表示「不定」。
 */
import type { TwinAnchor, TwinVisibilityRule } from '@dt/twin-config'
import { DtButton, DtInput, DtNumberInput, DtSwitch } from '@dt/ui'

import InspectorSection from '../fields/InspectorSection.vue'
import type { TwinFrameView } from '../../scripts/coordFrame'
import PositionField from '../fields/PositionField.vue'
import VisibilityFields from '../fields/VisibilityFields.vue'

const props = defineProps<{
  modelValue: TwinAnchor
  /** 坐标基准：这几个坐标框显示的是它下面的读数。 */
  frame: TwinFrameView
  /** 视口正处在「点模型拾取位置」模式。 */
  picking: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [TwinAnchor]
  requestPickPosition: []
  cancelPick: []
}>()

/** 与归一化一致：0–10 位，四舍五入。 */
const DECIMALS_RANGE = { min: 0, max: 10, step: 1 } as const

function write(patch: Partial<TwinAnchor>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function writeVisibility(visibility: TwinVisibilityRule): void {
  write({ visibility })
}

/** 打开 = 定位数（缺省 1 位），关掉 = 不定位数。 */
function toggleDecimals(fixed: boolean): void {
  write({ decimals: fixed ? 1 : null })
}

function writeDecimals(next: number | undefined): void {
  write({ decimals: next ?? 0 })
}

function togglePick(): void {
  if (props.picking) emit('cancelPick')
  else emit('requestPickPosition')
}
</script>

<template>
  <div class="flex flex-col">
    <InspectorSection title="锚点">
      <DtInput
        :model-value="modelValue.name"
        label="名字"
        size="sm"
        @update:model-value="write({ name: $event })"
      />
    </InspectorSection>

    <InspectorSection title="位置">
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-text-secondary">坐标</span>
        <PositionField
          :model-value="modelValue.position"
          :frame="frame"
          @update:model-value="write({ position: $event })"
        />
      </div>
      <DtButton
        :pressed="picking"
        size="sm"
        icon="magnet"
        block
        @click="togglePick"
      >
        {{ picking ? '点模型表面放置…（取消）' : '从视口拾取位置' }}
      </DtButton>
    </InspectorSection>

    <InspectorSection title="读数">
      <DtInput
        :model-value="modelValue.label"
        label="前缀"
        hint="留空 = 只显示数值"
        size="sm"
        @update:model-value="write({ label: $event })"
      />
      <DtInput
        :model-value="modelValue.unit"
        label="单位"
        size="sm"
        @update:model-value="write({ unit: $event })"
      />
      <DtSwitch
        :model-value="modelValue.decimals !== null"
        label="固定小数位"
        size="sm"
        @update:model-value="toggleDecimals"
      />
      <DtNumberInput
        v-if="modelValue.decimals !== null"
        :model-value="modelValue.decimals"
        :range="DECIMALS_RANGE"
        label="小数位"
        size="sm"
        @update:model-value="writeDecimals"
      />
      <p v-else class="text-xs text-text-disabled">
        不定位数：拿到什么值就按什么值上屏，不补零也不截断。
      </p>
    </InspectorSection>

    <InspectorSection title="显隐">
      <VisibilityFields
        :model-value="modelValue.visibility"
        @update:model-value="writeVisibility"
      />
    </InspectorSection>
  </div>
</template>
