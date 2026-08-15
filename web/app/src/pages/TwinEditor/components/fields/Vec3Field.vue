<script setup lang="ts">
/**
 * @fileoverview 三元组输入：坐标、欧拉角、方向向量共用。
 * ⚠ 三个数改一个也要整份换新数组：`Vec3` 是元组，就地改下标不换引用的话，
 * 上层按引用比对的 `commit` 会当成「没变」直接丢弃这次修改。
 */
import type { Vec3 } from '@dt/twin-config'
import { DtNumberInput } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{
  modelValue: Vec3
  /** 每格步长；角度用 1、坐标用 0.1（缺省）。 */
  step?: number
  /** 三个格子的角标，缺省 X/Y/Z。 */
  axes?: readonly [string, string, string]
}>()

const emit = defineEmits<{ 'update:modelValue': [Vec3] }>()

// ⚠ 缺省值走 computed 不走 withDefaults：exactOptionalPropertyTypes 下
//   withDefaults 出来的仍是 `number | undefined`，往下传会在每个调用点报错
const range = computed(() => ({ step: props.step ?? 0.1 }))
const axisLabels = computed<readonly [string, string, string]>(
  () => props.axes ?? ['X', 'Y', 'Z'],
)

function writeAxis(axis: number, next: number | undefined): void {
  const value: Vec3 = [...props.modelValue]
  // 清空输入框时 DtNumberInput 给 undefined；坐标没有「空」这一档，按 0 落
  value[axis] = next ?? 0
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="grid grid-cols-3 gap-1.5">
    <DtNumberInput
      v-for="(axis, index) in axisLabels"
      :key="axis"
      :model-value="modelValue[index]"
      :range="range"
      :unit="axis"
      :aria-label="axis"
      size="sm"
      :steppers="false"
      @update:model-value="writeAxis(index, $event)"
    />
  </div>
</template>
