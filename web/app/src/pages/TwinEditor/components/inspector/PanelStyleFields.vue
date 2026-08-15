<script setup lang="ts">
/**
 * @fileoverview 信息牌的外观组：整套预设 + 风格/朝向/配色/宽度/字号/动效。
 * ⚠ 预设只覆盖它列出的键，用户手调过的其余项原样留着。
 */
import {
  TWIN_PANEL_ORIENTS,
  TWIN_PANEL_VARIANTS,
  type TwinPanelOrient,
  type TwinPanelStyle,
  type TwinPanelVariant,
} from '@dt/twin-config'
import {
  DtButton,
  DtColorInput,
  DtField,
  DtSelect,
  DtSlider,
  DtSwitch,
} from '@dt/ui'
import { computed } from 'vue'

import {
  TWIN_PANEL_PRESETS,
  matchedPanelPreset,
  type TwinPanelPreset,
} from '../../panelPresets'
import InspectorSection from '../fields/InspectorSection.vue'

const props = defineProps<{
  modelValue: TwinPanelStyle
  variantOptions: readonly { value: string; label: string }[]
  orientOptions: readonly { value: string; label: string }[]
  /** 关掉自适应时给的固定宽度。 */
  fixedWidth: number
}>()

const emit = defineEmits<{ 'update:modelValue': [style: TwinPanelStyle] }>()

const WIDTH_RANGE = { min: 1, max: 1200, step: 10 }
const FONT_RANGE = { min: 0.5, max: 3, step: 0.05 }

const autoWidth = computed(() => props.modelValue.width === 0)

/** 当前样式命中的预设 id；手调过就是 null。 */
const activePreset = computed(() => matchedPanelPreset(props.modelValue))

function writeStyle(patch: Partial<TwinPanelStyle>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function applyPreset(preset: TwinPanelPreset): void {
  writeStyle(preset.patch)
}

/** 下拉给回来的是裸字符串，在这里收窄回联合类型；对不上就当没改。 */
function pickOf<T extends string>(list: readonly T[], value: string): T | null {
  return list.find((item) => item === value) ?? null
}

function writeVariant(next: string): void {
  const variant: TwinPanelVariant | null = pickOf(TWIN_PANEL_VARIANTS, next)
  if (variant !== null) writeStyle({ variant })
}

function writeOrient(next: string): void {
  const orient: TwinPanelOrient | null = pickOf(TWIN_PANEL_ORIENTS, next)
  if (orient !== null) writeStyle({ orient })
}

/** 宽度 0 是「按内容自适应」，不是「宽度为零」——用开关表达这一档。 */
function toggleAutoWidth(auto: boolean): void {
  writeStyle({ width: auto ? 0 : props.fixedWidth })
}
</script>

<template>
  <InspectorSection title="外观">
    <!-- 一整套观感是八个开关的组合，逐个试很难自己看出漏了哪条 -->
    <div class="panel-presets">
      <DtButton
        v-for="preset in TWIN_PANEL_PRESETS"
        :key="preset.id"
        size="sm"
        :variant="activePreset === preset.id ? 'soft' : 'ghost'"
        intent="neutral"
        :title="preset.hint"
        :data-test="`panel-preset-${preset.id}`"
        @click="applyPreset(preset)"
      >
        {{ preset.label }}
      </DtButton>
    </div>
    <DtField label="风格" size="sm">
      <DtSelect
        :model-value="modelValue.variant"
        :options="variantOptions"
        aria-label="风格"
        size="sm"
        @update:model-value="writeVariant"
      />
    </DtField>
    <DtField label="卡片相对锚点" size="sm">
      <DtSelect
        :model-value="modelValue.orient"
        :options="orientOptions"
        aria-label="卡片相对锚点"
        size="sm"
        @update:model-value="writeOrient"
      />
    </DtField>

    <DtColorInput
      :model-value="modelValue.accent"
      label="主题色"
      size="sm"
      @update:model-value="writeStyle({ accent: $event })"
    />
    <DtColorInput
      :model-value="modelValue.background"
      label="背景色"
      hint="留空 = 跟随变体自带的底"
      size="sm"
      @update:model-value="writeStyle({ background: $event })"
    />
    <DtButton
      v-if="modelValue.background !== ''"
      variant="soft"
      size="sm"
      @click="writeStyle({ background: '' })"
    >
      背景跟随变体
    </DtButton>

    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-text-secondary">宽度按内容自适应</span>
      <DtSwitch
        :model-value="autoWidth"
        aria-label="宽度按内容自适应"
        size="sm"
        @update:model-value="toggleAutoWidth"
      />
    </div>
    <DtNumberInput
      v-if="!autoWidth"
      :model-value="modelValue.width"
      :range="WIDTH_RANGE"
      label="卡片宽度 px"
      aria-label="卡片宽度"
      size="sm"
      :steppers="false"
      @update:model-value="writeStyle({ width: $event ?? 0 })"
    />

    <DtField label="字号缩放" size="sm">
      <DtSlider
        :model-value="modelValue.fontScale"
        :range="FONT_RANGE"
        show-value
        @update:model-value="writeStyle({ fontScale: $event })"
      />
    </DtField>

    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-text-secondary">入场动画</span>
      <DtSwitch
        :model-value="modelValue.animate"
        aria-label="入场动画"
        size="sm"
        @update:model-value="writeStyle({ animate: $event })"
      />
    </div>
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-text-secondary">锚点光环脉冲</span>
      <DtSwitch
        :model-value="modelValue.pulse"
        aria-label="锚点光环脉冲"
        size="sm"
        @update:model-value="writeStyle({ pulse: $event })"
      />
    </div>
  </InspectorSection>
</template>

<style scoped lang="scss">
.panel-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-bottom: 4px;
}
</style>
