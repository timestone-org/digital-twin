<script setup lang="ts">
/** @fileoverview 部件状态效果：独立点位条件、常用预设及高亮和闪烁外观。 */
import {
  ANIMATION_OPERATORS,
  DEFAULT_PART_EFFECT,
  MAX_PART_EFFECT_PERIOD_MS,
  MIN_PART_EFFECT_PERIOD_MS,
  TWIN_PART_EFFECT_MODES,
  TWIN_PART_EFFECT_PATTERNS,
  type TwinPartEffect,
} from '@dt/twin-config'
import {
  DtButton,
  DtColorInput,
  DtField,
  DtNotice,
  DtNumberInput,
  DtSegmented,
  DtSelect,
  DtSlider,
  DtSwitch,
} from '@dt/ui'
import { computed } from 'vue'

import {
  applyPartEffectPreset,
  PART_EFFECT_PRESETS,
} from '../../scripts/partEffectPresets'

const props = defineProps<{
  modelValue: TwinPartEffect | null
  bound: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [TwinPartEffect | null] }>()

const effect = computed(() => props.modelValue)
const MODE_LABELS = { point: '点位控制', always: '始终触发' } as const
const PATTERN_LABELS = {
  steady: '持续高亮',
  pulse: '柔和呼吸',
  blink: '明显闪烁',
} as const
const OPERATOR_LABELS = {
  eq: '等于',
  neq: '不等于',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
} as const
const modes = TWIN_PART_EFFECT_MODES.map((value) => ({
  value,
  label: MODE_LABELS[value],
}))
const patterns = TWIN_PART_EFFECT_PATTERNS.map((value) => ({
  value,
  label: PATTERN_LABELS[value],
}))
const operators = ANIMATION_OPERATORS.map((value) => ({
  value,
  label: OPERATOR_LABELS[value],
}))
const SWATCHES = [
  '--state-success',
  '--state-warning',
  '--state-danger',
  '--accent-primary',
] as const
const BLEND_RANGE = { min: 0, max: 1, step: 0.05 }
const GLOW_RANGE = { min: 0, max: 3, step: 0.1 }
const PERIOD_RANGE = {
  min: MIN_PART_EFFECT_PERIOD_MS / 1000,
  max: MAX_PART_EFFECT_PERIOD_MS / 1000,
  step: 0.1,
}

function write(patch: Partial<TwinPartEffect>): void {
  if (effect.value === null) return
  emit('update:modelValue', { ...effect.value, ...patch })
}

function toggle(enabled: boolean): void {
  if (effect.value === null) {
    if (enabled) emit('update:modelValue', { ...DEFAULT_PART_EFFECT })
    return
  }
  write({ enabled })
}

function writeMode(next: string): void {
  const mode = TWIN_PART_EFFECT_MODES.find((item) => item === next)
  if (mode !== undefined) write({ mode })
}

function writePattern(next: string): void {
  const pattern = TWIN_PART_EFFECT_PATTERNS.find((item) => item === next)
  if (pattern !== undefined) write({ pattern })
}

function writeOperator(next: string): void {
  const operator = ANIMATION_OPERATORS.find((item) => item === next)
  if (operator !== undefined) write({ operator })
}

function writePeriod(seconds: number | undefined): void {
  const periodMs = Math.round(
    (seconds ?? DEFAULT_PART_EFFECT.periodMs / 1000) * 1000,
  )
  write({
    periodMs: Math.min(
      MAX_PART_EFFECT_PERIOD_MS,
      Math.max(MIN_PART_EFFECT_PERIOD_MS, periodMs),
    ),
  })
}

function applyPreset(id: string): void {
  if (effect.value === null) return
  emit('update:modelValue', applyPartEffectPreset(effect.value, id))
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <DtSwitch
      :model-value="effect?.enabled ?? false"
      label="启用状态效果"
      aria-label="启用状态效果"
      size="sm"
      @update:model-value="toggle"
    />

    <template v-if="effect?.enabled">
      <DtSegmented
        :model-value="effect.mode"
        :options="modes"
        aria-label="效果触发方式"
        size="sm"
        @update:model-value="writeMode"
      />

      <template v-if="effect.mode === 'point'">
        <DtNotice v-if="!bound" intent="warning" icon="alert-triangle">
          尚未绑定状态点位：去右栏「绑定」为此部件的「状态效果」选择点位，保存后开始接收实时数据。
        </DtNotice>
        <div class="flex items-start gap-2">
          <DtSelect
            :model-value="effect.operator"
            class="min-w-0 flex-1"
            :options="operators"
            label="触发条件"
            aria-label="效果触发条件"
            size="sm"
            @update:model-value="writeOperator"
          />
          <DtNumberInput
            :model-value="effect.threshold"
            class="min-w-0 flex-1"
            label="触发值"
            aria-label="效果触发值"
            size="sm"
            :steppers="false"
            @update:model-value="write({ threshold: $event ?? 1 })"
          />
        </div>
        <p class="text-xs text-text-disabled">
          开关量开启 = 1，关闭 = 0；条件未命中或无有效数据时恢复正常外观。
        </p>
      </template>
      <p v-else class="text-xs text-text-disabled">
        始终显示效果，无需点位；原点位和触发条件保留，切回后继续使用。
      </p>

      <DtField label="常用效果" size="sm">
        <div class="flex flex-wrap gap-1">
          <DtButton
            v-for="preset in PART_EFFECT_PRESETS"
            :key="preset.id"
            size="sm"
            variant="soft"
            @click="applyPreset(preset.id)"
          >
            {{ preset.label }}
          </DtButton>
        </div>
      </DtField>
      <DtField label="显示方式" size="sm">
        <DtSegmented
          :model-value="effect.pattern"
          :options="patterns"
          aria-label="效果显示方式"
          size="sm"
          @update:model-value="writePattern"
        />
      </DtField>
      <DtColorInput
        :model-value="effect.color"
        label="效果颜色"
        size="sm"
        placeholder="留空 = 沿用当前颜色"
        :swatches="SWATCHES"
        hint="留空也可高亮；常态外观与状态染色保持原配置。"
        @update:model-value="write({ color: $event })"
      />
      <DtSlider
        :model-value="effect.blend"
        :range="BLEND_RANGE"
        label="变色浓度"
        aria-label="效果变色浓度"
        hint="0 = 保留当前颜色，1 = 完全换成效果颜色"
        size="sm"
        @update:model-value="write({ blend: $event })"
      />
      <DtSlider
        :model-value="effect.glow"
        :range="GLOW_RANGE"
        label="高亮强度"
        aria-label="效果高亮强度"
        hint="自发光增强，不改变透明度和显隐"
        size="sm"
        @update:model-value="write({ glow: $event })"
      />
      <DtNumberInput
        v-if="effect.pattern !== 'steady'"
        :model-value="effect.periodMs / 1000"
        :range="PERIOD_RANGE"
        label="变化周期"
        aria-label="效果变化周期"
        hint="一次完整变化的时长；越大越舒缓（0.6–10 秒）"
        unit="秒"
        size="sm"
        @update:model-value="writePeriod"
      />
      <p class="text-xs text-text-disabled">
        常态外观 → 状态染色 →
        状态效果；效果只在触发时叠加，不影响点击和模型动画。
      </p>
    </template>
    <p v-else-if="effect" class="text-xs text-text-disabled">
      已暂停效果，原配置和点位保留；重新开启即可恢复。
    </p>
    <p v-else class="text-xs text-text-disabled">
      关联一个开关量点位，开启时让部件高亮、呼吸或闪烁。
    </p>
  </div>
</template>
