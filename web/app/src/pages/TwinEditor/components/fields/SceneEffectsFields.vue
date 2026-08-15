<script setup lang="ts">
/**
 * @fileoverview 场景特效三段（星空 / 底座 / 光柱），模型检查器用。
 *
 * ⚠ 三段各自独立开关、可叠加；关掉的那一段把字段整段收起来，而不是留一排
 * 灰控件——灰着的控件看上去像「配得上但没生效」，收起来才说得清是没开。
 * ⚠ 三档取值（反射 / 光柱模式 / 上升方式）一律从常量联合生成选项：手抄一份
 * 字符串，改契约时抄的那份不会跟着变，界面上会多出一个存不进去的档。
 */
import {
  TWIN_LIGHT_COLUMN_MODES,
  TWIN_LIGHT_COLUMN_RISES,
  TWIN_PEDESTAL_REFLECTIONS,
  type TwinLightColumn,
  type TwinLightColumnMode,
  type TwinLightColumnRise,
  type TwinPedestal,
  type TwinPedestalReflection,
  type TwinSceneEffects,
  type TwinStarfield,
} from '@dt/twin-config'
import { DtColorInput, DtSegmented, DtSelect, DtSlider, DtSwitch } from '@dt/ui'

import InspectorSection from './InspectorSection.vue'

const props = defineProps<{ modelValue: TwinSceneEffects }>()

const emit = defineEmits<{ 'update:modelValue': [TwinSceneEffects] }>()

/** 强度类倍率的区间，与归一化的钳制一致（超过 2 只会糊成一片白）。 */
const SCALE_RANGE = { min: 0, max: 2, step: 0.05 } as const
const RADIUS_RANGE = { min: 0.5, max: 8, step: 0.05 } as const
const HEIGHT_RANGE = { min: 0.2, max: 4, step: 0.05 } as const

const REFLECTION_LABELS: Readonly<Record<TwinPedestalReflection, string>> = {
  none: '不反射',
  soft: '柔和',
  mirror: '镜面',
}
const MODE_LABELS: Readonly<Record<TwinLightColumnMode, string>> = {
  beam: '细光柱',
  dome: '能量罩',
}
const RISE_LABELS: Readonly<Record<TwinLightColumnRise, string>> = {
  loop: '循环扫描',
  once: '入场一次',
}

const reflectionOptions = TWIN_PEDESTAL_REFLECTIONS.map((value) => ({
  value,
  label: REFLECTION_LABELS[value],
}))
const modeOptions = TWIN_LIGHT_COLUMN_MODES.map((value) => ({
  value,
  label: MODE_LABELS[value],
}))
const riseOptions = TWIN_LIGHT_COLUMN_RISES.map((value) => ({
  value,
  label: RISE_LABELS[value],
}))

function writeStarfield(patch: Partial<TwinStarfield>): void {
  const starfield = { ...props.modelValue.starfield, ...patch }
  emit('update:modelValue', { ...props.modelValue, starfield })
}

function writePedestal(patch: Partial<TwinPedestal>): void {
  const pedestal = { ...props.modelValue.pedestal, ...patch }
  emit('update:modelValue', { ...props.modelValue, pedestal })
}

function writeLightColumn(patch: Partial<TwinLightColumn>): void {
  const lightColumn = { ...props.modelValue.lightColumn, ...patch }
  emit('update:modelValue', { ...props.modelValue, lightColumn })
}

function writeReflection(next: string): void {
  const reflection = TWIN_PEDESTAL_REFLECTIONS.find((item) => item === next)
  if (reflection !== undefined) writePedestal({ reflection })
}

function writeMode(next: string): void {
  const mode = TWIN_LIGHT_COLUMN_MODES.find((item) => item === next)
  if (mode !== undefined) writeLightColumn({ mode })
}

function writeRise(next: string): void {
  const rise = TWIN_LIGHT_COLUMN_RISES.find((item) => item === next)
  if (rise !== undefined) writeLightColumn({ rise })
}
</script>

<template>
  <InspectorSection title="星空">
    <DtSwitch
      :model-value="modelValue.starfield.enabled"
      label="启用星空"
      size="sm"
      @update:model-value="writeStarfield({ enabled: $event })"
    />
    <template v-if="modelValue.starfield.enabled">
      <DtSlider
        :model-value="modelValue.starfield.density"
        :range="SCALE_RANGE"
        label="星点密度"
        size="sm"
        show-value
        @update:model-value="writeStarfield({ density: $event })"
      />
      <DtSlider
        :model-value="modelValue.starfield.speed"
        :range="SCALE_RANGE"
        label="旋转速度"
        hint="0 = 不转"
        size="sm"
        show-value
        @update:model-value="writeStarfield({ speed: $event })"
      />
      <DtSwitch
        :model-value="modelValue.starfield.nebula"
        label="星云辉光背景"
        size="sm"
        @update:model-value="writeStarfield({ nebula: $event })"
      />
    </template>
  </InspectorSection>

  <InspectorSection title="底座">
    <DtSwitch
      :model-value="modelValue.pedestal.enabled"
      label="启用底座"
      size="sm"
      @update:model-value="writePedestal({ enabled: $event })"
    />
    <template v-if="modelValue.pedestal.enabled">
      <DtColorInput
        :model-value="modelValue.pedestal.color"
        label="主题色"
        size="sm"
        @update:model-value="writePedestal({ color: $event })"
      />
      <DtSwitch
        :model-value="modelValue.pedestal.ring"
        label="发光圆环"
        size="sm"
        @update:model-value="writePedestal({ ring: $event })"
      />
      <DtSwitch
        :model-value="modelValue.pedestal.grid"
        label="网格地平线"
        size="sm"
        @update:model-value="writePedestal({ grid: $event })"
      />
      <DtSwitch
        :model-value="modelValue.pedestal.gradientGround"
        label="径向渐变地面"
        size="sm"
        @update:model-value="writePedestal({ gradientGround: $event })"
      />
      <DtSwitch
        :model-value="modelValue.pedestal.contactShadow"
        label="柔和接触阴影"
        size="sm"
        @update:model-value="writePedestal({ contactShadow: $event })"
      />
      <DtSelect
        :model-value="modelValue.pedestal.reflection"
        :options="reflectionOptions"
        label="反射"
        hint="柔和与镜面更费，低配机器上关掉"
        size="sm"
        @update:model-value="writeReflection"
      />
      <DtSlider
        :model-value="modelValue.pedestal.radius"
        :range="RADIUS_RANGE"
        label="占地半径"
        hint="相对模型底面的倍数"
        size="sm"
        show-value
        @update:model-value="writePedestal({ radius: $event })"
      />
    </template>
  </InspectorSection>

  <InspectorSection title="光柱">
    <DtSwitch
      :model-value="modelValue.lightColumn.enabled"
      label="启用光柱"
      size="sm"
      @update:model-value="writeLightColumn({ enabled: $event })"
    />
    <template v-if="modelValue.lightColumn.enabled">
      <DtSegmented
        :model-value="modelValue.lightColumn.mode"
        :options="modeOptions"
        aria-label="光柱模式"
        size="sm"
        block
        @update:model-value="writeMode"
      />
      <DtColorInput
        :model-value="modelValue.lightColumn.color"
        label="颜色"
        size="sm"
        @update:model-value="writeLightColumn({ color: $event })"
      />
      <DtSlider
        :model-value="modelValue.lightColumn.intensity"
        :range="SCALE_RANGE"
        label="强度"
        size="sm"
        show-value
        @update:model-value="writeLightColumn({ intensity: $event })"
      />
      <DtSlider
        :model-value="modelValue.lightColumn.speed"
        :range="SCALE_RANGE"
        label="速度"
        size="sm"
        show-value
        @update:model-value="writeLightColumn({ speed: $event })"
      />
      <DtSlider
        :model-value="modelValue.lightColumn.height"
        :range="HEIGHT_RANGE"
        label="高度"
        hint="相对模型高度的倍数"
        size="sm"
        show-value
        @update:model-value="writeLightColumn({ height: $event })"
      />
      <DtSegmented
        :model-value="modelValue.lightColumn.rise"
        :options="riseOptions"
        aria-label="上升扫描"
        size="sm"
        block
        @update:model-value="writeRise"
      />
    </template>
  </InspectorSection>
</template>
