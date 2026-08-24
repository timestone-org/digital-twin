<script setup lang="ts">
/**
 * @fileoverview 一个位置输入框：落库的是世界坐标，显示的是当前坐标基准下的读数。
 *
 * ⚠ 换基准只换这里的读数，落库的坐标一个都不动——反过来做的话，切一下基准
 * 整场的锚点集体偏移，而配置里一个字段都没改。
 * ⚠ 基准原点不落在世界原点上时必须把它写在下面：不写的话，这三个数与视口里
 * 那三条参考轴各说各话，用户只会觉得「填进去的坐标跑到了别的地方」。
 */
import type { Vec3 } from '@dt/twin-config'
import { toFrameCoords, toWorldCoords } from '@dt/twin-config'
import { computed } from 'vue'

import {
  coordFrameZeroLabel,
  coordText,
  type TwinFrameView,
} from '../../scripts/coordFrame'
import Vec3Field from './Vec3Field.vue'

const props = defineProps<{
  /** 世界坐标（落库的那一份）。 */
  modelValue: Vec3
  frame: TwinFrameView
}>()

const emit = defineEmits<{ 'update:modelValue': [Vec3] }>()

const shown = computed(() =>
  toFrameCoords(props.modelValue, props.frame.origin),
)

/** 基准原点就在世界原点上时不提示：那时读数即世界坐标，多一行只是噪声。 */
const note = computed(() => {
  const origin = props.frame.origin
  if (origin[0] === 0 && origin[1] === 0 && origin[2] === 0) return ''
  return `${coordFrameZeroLabel(props.frame.mode)}；原点世界坐标 ${coordText(origin)}`
})

function write(next: Vec3): void {
  emit('update:modelValue', toWorldCoords(next, props.frame.origin))
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <Vec3Field :model-value="shown" @update:model-value="write" />
    <p v-if="note !== ''" class="text-xs text-text-disabled">{{ note }}</p>
  </div>
</template>
