<script setup lang="ts">
/**
 * @fileoverview 信息牌的外观组：整套预设 + 风格/朝向/配色/尺寸/版式/装饰/动效。
 * ⚠ 预设只覆盖它列出的键，用户手调过的其余项原样留着。
 */
import {
  TWIN_PANEL_DENSITIES,
  TWIN_PANEL_ORIENTS,
  TWIN_PANEL_VARIANTS,
  type TwinPanelDensity,
  type TwinPanelOrient,
  type TwinPanelStyle,
  type TwinPanelVariant,
} from '@dt/twin-config'
import {
  DtButton,
  DtColorInput,
  DtField,
  DtNumberInput,
  DtSegmented,
  DtSelect,
  DtSlider,
  DtSwitch,
} from '@dt/ui'
import { computed } from 'vue'

import {
  TWIN_PANEL_PRESETS,
  matchedPanelPreset,
  type TwinPanelPreset,
} from '../../scripts/panelPresets'
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
const HEIGHT_RANGE = { min: 1, max: 1200, step: 10 }
const COLUMN_RANGE = { min: 1, max: 4, step: 1 }
const FONT_RANGE = { min: 0.5, max: 3, step: 0.05 }
// 牌在 3D 里的整体大小；1 = 按模型体量自动定的那个大小
const SCALE_RANGE = { min: 0.2, max: 5, step: 0.1 }

/** 关掉自适应时给的最小高度，够放下页眉加两行读数。 */
const FIXED_HEIGHT = 150

const DENSITY_LABELS: Readonly<Record<TwinPanelDensity, string>> = {
  compact: '紧凑',
  normal: '标准',
  loose: '宽松',
}
const densityOptions = TWIN_PANEL_DENSITIES.map((value) => ({
  value,
  label: DENSITY_LABELS[value],
}))

const autoWidth = computed(() => props.modelValue.width === 0)
const autoHeight = computed(() => props.modelValue.height === 0)

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

function writeDensity(next: string): void {
  const density: TwinPanelDensity | null = pickOf(TWIN_PANEL_DENSITIES, next)
  if (density !== null) writeStyle({ density })
}

/** 宽度 0 是「按内容自适应」，不是「宽度为零」——用开关表达这一档。 */
function toggleAutoWidth(auto: boolean): void {
  writeStyle({ width: auto ? 0 : props.fixedWidth })
}

/** 高度同理；给的是**最小**高度，字段多了照样往下长。 */
function toggleAutoHeight(auto: boolean): void {
  writeStyle({ height: auto ? 0 : FIXED_HEIGHT })
}
</script>

<template>
  <InspectorSection title="外观">
    <!-- 一整套观感是十几个开关的组合，逐个试很难自己看出漏了哪条 -->
    <div class="panel-presets">
      <DtButton
        v-for="preset in TWIN_PANEL_PRESETS"
        :key="preset.id"
        size="sm"
        :pressed="activePreset === preset.id"
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
    <DtField
      label="卡片相对锚点"
      hint="非居中时会画一条引线与锚点标记"
      size="sm"
    >
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
  </InspectorSection>

  <InspectorSection title="尺寸与版式">
    <DtSwitch
      :model-value="autoWidth"
      label="宽度按内容自适应"
      size="sm"
      @update:model-value="toggleAutoWidth"
    />
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

    <DtSwitch
      :model-value="autoHeight"
      label="高度按内容自适应"
      size="sm"
      @update:model-value="toggleAutoHeight"
    />
    <!-- ⚠ 是最小高度不是固定高度：定死高度会让加一个字段就溢出裁切，
         而 CSS3D 的牌没有滚动条，被裁掉的那几行不留任何痕迹 -->
    <DtNumberInput
      v-if="!autoHeight"
      :model-value="modelValue.height"
      :range="HEIGHT_RANGE"
      label="卡片最小高度 px"
      hint="字段放不下时照样往下长"
      aria-label="卡片最小高度"
      size="sm"
      :steppers="false"
      @update:model-value="writeStyle({ height: $event ?? 0 })"
    />

    <DtField label="版式密度" size="sm">
      <DtSegmented
        :model-value="modelValue.density"
        :options="densityOptions"
        aria-label="版式密度"
        size="sm"
        block
        @update:model-value="writeDensity"
      />
    </DtField>

    <DtSlider
      :model-value="modelValue.columns"
      :range="COLUMN_RANGE"
      label="字段列数"
      hint="大字、趋势线与柱群三档始终占满一整行"
      size="sm"
      show-value
      @update:model-value="writeStyle({ columns: $event })"
    />

    <DtSlider
      :model-value="modelValue.fontScale"
      :range="FONT_RANGE"
      label="字号缩放"
      size="sm"
      show-value
      @update:model-value="writeStyle({ fontScale: $event })"
    />

    <DtSlider
      :model-value="modelValue.scale"
      :range="SCALE_RANGE"
      label="整体大小"
      hint="1 = 按模型体量自动定；换模型时不用重调"
      size="sm"
      show-value
      @update:model-value="writeStyle({ scale: $event })"
    />
  </InspectorSection>

  <InspectorSection title="装饰与动效">
    <DtSwitch
      :model-value="modelValue.grid"
      label="底纹网格"
      size="sm"
      @update:model-value="writeStyle({ grid: $event })"
    />
    <DtSwitch
      :model-value="modelValue.scan"
      label="横扫光带"
      size="sm"
      @update:model-value="writeStyle({ scan: $event })"
    />
    <DtSwitch
      :model-value="modelValue.corners"
      label="四角括号"
      size="sm"
      @update:model-value="writeStyle({ corners: $event })"
    />
    <DtSwitch
      :model-value="modelValue.animate"
      label="入场动画"
      size="sm"
      @update:model-value="writeStyle({ animate: $event })"
    />
    <DtSwitch
      :model-value="modelValue.pulse"
      label="锚点光环脉冲"
      size="sm"
      @update:model-value="writeStyle({ pulse: $event })"
    />
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
