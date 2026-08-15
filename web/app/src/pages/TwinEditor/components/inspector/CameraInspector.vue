<script setup lang="ts">
/**
 * @fileoverview 视点检查器：名字、机位与注视点、视野，以及「打开大屏时用它」。
 *
 * ⚠ `position` 与 `target` 都是**世界坐标**，与「方位角 / 俯仰角」那套不通用：
 * 两套混着填不会报错，只会让镜头飞到一个谁也没想到的地方。所以界面上要写死这句话。
 * ⚠ 视野取到 0 或 180 时取景距离的公式会除零或塌缩，表现是「切到这个视点画面
 * 整个消失」而不报错——区间由 `MIN_CAMERA_FOV` / `MAX_CAMERA_FOV` 给，不自己抄。
 */
import {
  MAX_CAMERA_FOV,
  MIN_CAMERA_FOV,
  type TwinCamera,
} from '@dt/twin-config'
import { DtButton, DtInput, DtSlider, DtSwitch } from '@dt/ui'

import InspectorSection from '../fields/InspectorSection.vue'
import Vec3Field from '../fields/Vec3Field.vue'

const props = defineProps<{ modelValue: TwinCamera }>()

const emit = defineEmits<{
  'update:modelValue': [TwinCamera]
  captureCurrent: []
}>()

const FOV_RANGE = {
  min: MIN_CAMERA_FOV,
  max: MAX_CAMERA_FOV,
  step: 1,
} as const

function write(patch: Partial<TwinCamera>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}
</script>

<template>
  <div class="flex flex-col">
    <InspectorSection title="视点">
      <DtInput
        :model-value="modelValue.name"
        label="名字"
        size="sm"
        @update:model-value="write({ name: $event })"
      />
    </InspectorSection>

    <InspectorSection title="机位">
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-text-secondary">相机位置（世界坐标）</span>
        <Vec3Field
          :model-value="modelValue.position"
          @update:model-value="write({ position: $event })"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-text-secondary">注视点（世界坐标）</span>
        <Vec3Field
          :model-value="modelValue.target"
          @update:model-value="write({ target: $event })"
        />
      </div>
      <p class="text-xs text-text-disabled">
        两组都是世界坐标，不是方位角 /
        俯仰角。填错不会报错，只会让镜头飞到一个谁也没想到的地方。
      </p>
      <DtButton
        variant="soft"
        size="sm"
        icon="refresh-cw"
        block
        @click="emit('captureCurrent')"
      >
        取当前机位
      </DtButton>
      <DtSlider
        :model-value="modelValue.fov"
        :range="FOV_RANGE"
        label="视野（度）"
        size="sm"
        show-value
        @update:model-value="write({ fov: $event })"
      />
    </InspectorSection>

    <InspectorSection title="初始视点">
      <DtSwitch
        :model-value="modelValue.isDefault"
        label="打开大屏时用它"
        size="sm"
        @update:model-value="write({ isDefault: $event })"
      />
      <p class="text-xs text-text-disabled">
        多个视点都标了初始时只认列表里的第一个；其余的标记不会生效。
      </p>
    </InspectorSection>
  </div>
</template>
