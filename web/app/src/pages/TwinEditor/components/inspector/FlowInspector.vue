<script setup lang="ts">
/**
 * @fileoverview 能量流检查器：能源种类 / 路径锚点 / 线宽 / 反向 / 显隐。
 *
 * ⚠ 种类只决定配色 token（渲染层认 `--flow-<kind>`，认不出就用内置色），
 * 它不是枚举——落库里的自定义种类要原样留着，不能被下拉「归一」成缺省色。
 */
import type { TwinAnchor, TwinFlowLink } from '@dt/twin-config'
import { DtField, DtInput, DtSelect, DtSlider, DtSwitch } from '@dt/ui'
import { computed } from 'vue'

import AnchorPathField from '../fields/AnchorPathField.vue'
import InspectorSection from '../fields/InspectorSection.vue'
import VisibilityFields from '../fields/VisibilityFields.vue'

const props = defineProps<{
  modelValue: TwinFlowLink
  anchors: readonly TwinAnchor[]
}>()

const emit = defineEmits<{ 'update:modelValue': [TwinFlowLink] }>()

/** 渲染层内置了配色的种类；主题里配了 `--flow-<kind>` 时以主题为准。 */
const KIND_OPTIONS = [
  { value: '', label: '（不指定，用缺省色）' },
  { value: 'water', label: '水' },
  { value: 'steam', label: '蒸汽' },
  { value: 'electricity', label: '电' },
  { value: 'gas', label: '燃气' },
  { value: 'oil', label: '油' },
  { value: 'heat', label: '热' },
  { value: 'cold', label: '冷' },
  { value: 'air', label: '空气' },
] as const

// 归一化把线宽夹在 [0.01, 100]；面板给到 20 就够粗，再宽只是遮挡模型
const WIDTH_RANGE = { min: 0.1, max: 20, step: 0.1 }

const kindOptions = computed(() => {
  const current = props.modelValue.kind
  const known = KIND_OPTIONS.some((option) => option.value === current)
  // 认不出的种类原样列出来，否则下拉会显示成「缺省色」，一改别的就把它抹了
  return known
    ? [...KIND_OPTIONS]
    : [...KIND_OPTIONS, { value: current, label: `自定义：${current}` }]
})

function write(patch: Partial<TwinFlowLink>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}
</script>

<template>
  <div class="flex flex-col">
    <InspectorSection title="基本">
      <DtField label="名称" size="sm">
        <DtInput
          :model-value="modelValue.name"
          aria-label="名称"
          size="sm"
          @update:model-value="write({ name: $event })"
        />
      </DtField>

      <DtField label="能源种类" hint="只决定配色；不指定就用缺省色" size="sm">
        <DtSelect
          :model-value="modelValue.kind"
          :options="kindOptions"
          aria-label="能源种类"
          size="sm"
          @update:model-value="write({ kind: $event })"
        />
      </DtField>

      <DtField label="线宽倍率" hint="也影响粒子大小" size="sm">
        <DtSlider
          :model-value="modelValue.width"
          :range="WIDTH_RANGE"
          show-value
          @update:model-value="write({ width: $event })"
        />
      </DtField>

      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-text-secondary">允许负强度反向流动</span>
        <DtSwitch
          :model-value="modelValue.reversible"
          aria-label="允许负强度反向流动"
          size="sm"
          @update:model-value="write({ reversible: $event })"
        />
      </div>
    </InspectorSection>

    <InspectorSection title="路径锚点">
      <AnchorPathField
        :model-value="modelValue.pathAnchors"
        :anchors="anchors"
        @update:model-value="write({ pathAnchors: $event })"
      />
    </InspectorSection>

    <InspectorSection title="显隐">
      <VisibilityFields
        :model-value="modelValue.visibility"
        @update:model-value="write({ visibility: $event })"
      />
    </InspectorSection>
  </div>
</template>
