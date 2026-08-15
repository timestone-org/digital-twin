<script setup lang="ts">
/**
 * @fileoverview 显隐与淡出规则，部件/锚点/信息牌/箭头/能量流五种检查器共用。
 *
 * ⚠ 这里配的距离规则**在编辑视口里不生效**（`TwinVisibilityRule` 的注释）：
 * 编辑时镜头到处飞，套上规则会让人「刚配好的东西一转镜头就不见了」。
 * 所以面板上要写明这一点，否则用户会以为自己配错了。
 */
import {
  TWIN_FADE_DIRECTIONS,
  type TwinDistanceRule,
  type TwinFadeDirection,
  type TwinVisibilityFade,
  type TwinVisibilityRule,
} from '@dt/twin-config'
import { DtField, DtSegmented, DtSlider, DtSwitch } from '@dt/ui'
import { computed } from 'vue'

import DistanceField from './DistanceField.vue'

const props = defineProps<{ modelValue: TwinVisibilityRule }>()

const emit = defineEmits<{ 'update:modelValue': [TwinVisibilityRule] }>()

const FADE_LABELS: Readonly<Record<TwinFadeDirection, string>> = {
  below: '近处淡出',
  above: '远处淡出',
}

const fadeOptions = TWIN_FADE_DIRECTIONS.map((value) => ({
  value,
  label: FADE_LABELS[value],
}))

const fade = computed(() => props.modelValue.fade)

function write(patch: Partial<TwinVisibilityRule>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function toggleFade(on: boolean): void {
  write({
    fade: on
      ? { at: { ref: 'orbit', value: 10 }, direction: 'below', opacity: 0.2 }
      : null,
  })
}

function writeFade(patch: Partial<TwinVisibilityFade>): void {
  if (fade.value === null) return
  write({ fade: { ...fade.value, ...patch } })
}

function writeFadeAt(next: TwinDistanceRule | null): void {
  // 淡出必须有阈值，关不掉；开关整条淡出用上面的 toggleFade
  if (next !== null) writeFade({ at: next })
}

function writeFadeDirection(next: string): void {
  const direction = TWIN_FADE_DIRECTIONS.find((item) => item === next)
  if (direction !== undefined) writeFade({ direction })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-text-secondary">初始可见</span>
      <DtSwitch
        :model-value="modelValue.visible"
        aria-label="初始可见"
        size="sm"
        @update:model-value="write({ visible: $event })"
      />
    </div>

    <DistanceField
      :model-value="modelValue.hideBelow"
      label="近于此距离隐藏"
      :fallback="5"
      @update:model-value="write({ hideBelow: $event })"
    />
    <DistanceField
      :model-value="modelValue.hideAbove"
      label="远于此距离隐藏"
      :fallback="50"
      @update:model-value="write({ hideAbove: $event })"
    />

    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-text-secondary">距离淡出</span>
        <DtSwitch
          :model-value="fade !== null"
          aria-label="距离淡出"
          size="sm"
          @update:model-value="toggleFade"
        />
      </div>
      <template v-if="fade !== null">
        <DtSegmented
          :model-value="fade.direction"
          :options="fadeOptions"
          aria-label="淡出方向"
          size="sm"
          @update:model-value="writeFadeDirection"
        />
        <DistanceField
          :model-value="fade.at"
          label="淡出阈值"
          @update:model-value="writeFadeAt"
        />
        <DtField label="淡出后不透明度" size="sm">
          <DtSlider
            :model-value="fade.opacity"
            :range="{ min: 0, max: 1, step: 0.05 }"
            show-value
            @update:model-value="writeFade({ opacity: $event })"
          />
        </DtField>
      </template>
    </div>

    <p class="text-xs text-text-disabled">
      距离规则只在大屏运行时生效；编辑视口里始终按「初始可见」显示。
    </p>
  </div>
</template>
