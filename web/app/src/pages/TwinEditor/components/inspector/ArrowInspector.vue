<script setup lang="ts">
/**
 * @fileoverview 立体方向箭头检查器：位置 / 朝向 / 尺寸 / 标签 / 颜色 / 显隐。
 *
 * ⚠ `direction` 渲染前会 normalize，零向量当没配（归一化会替成 +Y）。面板上得当场
 * 说出来，否则用户改成 0,0,0 之后只会看到箭头朝上，以为是别处配错了。
 */
import type { GizmoMode } from '@dt/three-core'
import type { TwinArrow } from '@dt/twin-config'
import {
  DtButton,
  DtColorInput,
  DtField,
  DtInput,
  DtNotice,
  DtNumberInput,
  DtSegmented,
  DtSwitch,
} from '@dt/ui'
import { computed } from 'vue'

import InspectorSection from '../fields/InspectorSection.vue'
import Vec3Field from '../fields/Vec3Field.vue'
import VisibilityFields from '../fields/VisibilityFields.vue'

const props = defineProps<{
  modelValue: TwinArrow
  /** 视口正在等用户点一个位置。 */
  picking: boolean
  /** 视口里坐标轴手柄当前的模式。 */
  gizmoMode: GizmoMode
}>()

const emit = defineEmits<{
  'update:modelValue': [TwinArrow]
  requestPickPosition: []
  cancelPick: []
  'update:gizmoMode': [GizmoMode]
}>()

const GIZMO_OPTIONS = [
  { value: 'translate', label: '拖位置' },
  { value: 'rotate', label: '拖朝向' },
] as const

/** 分段控件给回来的是裸字符串，对不上就当没改。 */
function writeGizmoMode(next: string): void {
  const found = GIZMO_OPTIONS.find((item) => item.value === next)
  if (found !== undefined) emit('update:gizmoMode', found.value)
}

// 归一化把长宽夹在 [0.01, 100]：负数与零都画不出东西
const SIZE_RANGE = { min: 0.01, max: 100, step: 0.1 }
const DECIMALS_RANGE = { min: 0, max: 10, step: 1 }

const isZeroDirection = computed(() =>
  props.modelValue.direction.every((axis) => axis === 0),
)

function write(patch: Partial<TwinArrow>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

/** 小数位有「不定位数」这一档：null ≠ 0，0 是「取整」。 */
function toggleDecimals(on: boolean): void {
  write({ decimals: on ? 0 : null })
}

function togglePick(): void {
  if (props.picking) emit('cancelPick')
  else emit('requestPickPosition')
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

      <DtField label="位置" size="sm">
        <Vec3Field
          :model-value="modelValue.position"
          @update:model-value="write({ position: $event })"
        />
      </DtField>
      <DtButton
        variant="soft"
        size="sm"
        :icon="picking ? 'close' : 'magnet'"
        block
        @click="togglePick"
      >
        {{ picking ? '取消拾取' : '从视口拾取位置' }}
      </DtButton>
      <p v-if="picking" class="text-xs text-text-secondary">
        在视口里点一下，把那个点作为箭头位置。
      </p>

      <DtField
        label="方向向量"
        hint="渲染前会归一化，只看方向不看长短"
        size="sm"
      >
        <Vec3Field
          :model-value="modelValue.direction"
          @update:model-value="write({ direction: $event })"
        />
      </DtField>
      <DtNotice v-if="isZeroDirection" intent="warning" icon="alert-triangle">
        零向量不是一个方向：这样保存后会被当成没配，箭头回退成朝上（+Y）。
      </DtNotice>
      <DtField label="视口里怎么拖" hint="在 3D 里直接拖坐标轴手柄" size="sm">
        <DtSegmented
          :model-value="gizmoMode"
          :options="GIZMO_OPTIONS"
          aria-label="视口里怎么拖"
          size="sm"
          block
          @update:model-value="writeGizmoMode"
        />
      </DtField>
    </InspectorSection>

    <InspectorSection title="尺寸与颜色">
      <DtNumberInput
        :model-value="modelValue.length"
        :range="SIZE_RANGE"
        label="长度"
        aria-label="长度"
        size="sm"
        :steppers="false"
        @update:model-value="write({ length: $event ?? 1 })"
      />
      <DtNumberInput
        :model-value="modelValue.width"
        :range="SIZE_RANGE"
        label="粗细"
        aria-label="粗细"
        size="sm"
        :steppers="false"
        @update:model-value="write({ width: $event ?? 1 })"
      />
      <DtColorInput
        :model-value="modelValue.color"
        label="颜色"
        hint="箭头与标签共用"
        size="sm"
        @update:model-value="write({ color: $event })"
      />
    </InspectorSection>

    <InspectorSection title="标签">
      <DtField label="标签固定文本" hint="与实时值拼在一起" size="sm">
        <DtInput
          :model-value="modelValue.labelText"
          aria-label="标签固定文本"
          size="sm"
          @update:model-value="write({ labelText: $event })"
        />
      </DtField>

      <div class="grid grid-cols-2 gap-1.5">
        <DtInput
          :model-value="modelValue.prefix"
          aria-label="数值前缀"
          placeholder="前缀"
          size="sm"
          @update:model-value="write({ prefix: $event })"
        />
        <DtInput
          :model-value="modelValue.unit"
          aria-label="单位"
          placeholder="单位"
          size="sm"
          @update:model-value="write({ unit: $event })"
        />
      </div>

      <div class="flex items-center gap-1.5">
        <DtSwitch
          :model-value="modelValue.decimals !== null"
          aria-label="指定小数位"
          size="sm"
          @update:model-value="toggleDecimals"
        />
        <span class="shrink-0 text-xs text-text-secondary">小数位</span>
        <DtNumberInput
          v-if="modelValue.decimals !== null"
          class="min-w-0 flex-1"
          :model-value="modelValue.decimals"
          :range="DECIMALS_RANGE"
          aria-label="小数位"
          size="sm"
          :steppers="false"
          @update:model-value="write({ decimals: $event ?? 0 })"
        />
        <span v-else class="min-w-0 flex-1 text-xs text-text-disabled">
          不定位数，按原值上屏
        </span>
      </div>
    </InspectorSection>

    <InspectorSection title="显隐">
      <VisibilityFields
        :model-value="modelValue.visibility"
        @update:model-value="write({ visibility: $event })"
      />
    </InspectorSection>
  </div>
</template>
