<script setup lang="ts">
/**
 * @fileoverview 部件的常态外观：透明度、常态色、染色浓度与自发光。
 *
 * ⚠ 常态色留空 = 保留模型自带的材质，不是「染成黑色」。浓度与自发光只在
 * **有色**时才起作用——常态留空、只配状态染色，是「平时原色、异常才变色」的配法。
 * ⚠ 这里配的透明度**会**在编辑视口里生效（与显隐的距离规则不同）：调它就是为了
 * 当场看到里面的设备，等到运行态才生效等于没法配。
 */
import { DEFAULT_PART_LOOK, type TwinPartLook } from '@dt/twin-config'
import { DtColorInput, DtSlider } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{ modelValue: TwinPartLook }>()

const emit = defineEmits<{ 'update:modelValue': [TwinPartLook] }>()

/** 常用的几个语义色，省得每次去翻 token 名。 */
const SWATCHES = [
  '--accent-primary',
  '--state-success',
  '--state-warning',
  '--state-danger',
] as const

const UNIT_RANGE = { min: 0, max: 1, step: 0.05 }
const GLOW_RANGE = { min: 0, max: 3, step: 0.1 }

const hasColor = computed(() => props.modelValue.color !== '')

function write(patch: Partial<TwinPartLook>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

/**
 * 清掉常态色，回到模型原色。
 * ⚠ 浓度与自发光一并复位：留着一个 0 浓度的旧值，下次配色时会「配了色却看不出来」。
 */
function clearColor(): void {
  write({
    color: '',
    blend: DEFAULT_PART_LOOK.blend,
    glow: DEFAULT_PART_LOOK.glow,
  })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <DtSlider
      :model-value="modelValue.opacity"
      :range="UNIT_RANGE"
      label="不透明度"
      hint="乘在模型自带的透明度上；1 = 不动它"
      size="sm"
      show-value
      @update:model-value="write({ opacity: $event })"
    />

    <DtColorInput
      :model-value="modelValue.color"
      label="常态色"
      size="sm"
      placeholder="留空 = 保留模型原色"
      :swatches="SWATCHES"
      hint="状态染色没命中任何一档时也用它。"
      @update:model-value="write({ color: $event })"
    />

    <template v-if="hasColor">
      <DtSlider
        :model-value="modelValue.blend"
        :range="UNIT_RANGE"
        label="染色浓度"
        hint="0 = 完全原色，1 = 完全换成染色"
        size="sm"
        show-value
        @update:model-value="write({ blend: $event })"
      />

      <DtSlider
        :model-value="modelValue.glow"
        :range="GLOW_RANGE"
        label="自发光"
        hint="发光色就是当前染色；暗场里才看得出"
        size="sm"
        show-value
        @update:model-value="write({ glow: $event })"
      />

      <button
        type="button"
        class="self-start text-xs text-text-disabled underline"
        @click="clearColor"
      >
        清除常态色，回到模型原色
      </button>
    </template>

    <p v-else class="text-xs text-text-disabled">
      常态色留空时不染色；浓度与自发光要配了颜色才有意义，故先不显示。
    </p>
  </div>
</template>
