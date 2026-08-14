<script setup lang="ts">
/**
 * @fileoverview 多选态的右栏：报出已选数量，给对齐 / 分布 / 批量删除三组动作。
 * ⚠ 对齐与分布只在**同一层级**的选中集上成立（跨容器坐标系不同），
 * 能不能用由页面算好后经 alignReady / distributeReady 传进来。
 */
import { DtButton } from '@dt/ui'

import type { AlignKind } from '@/features/dashboard/canvasAlign'

defineProps<{
  count: number
  alignReady: boolean
  distributeReady: boolean
}>()

const emit = defineEmits<{
  align: [kind: AlignKind]
  distribute: [axis: 'x' | 'y']
  'remove-all': []
}>()

const ALIGN_ACTIONS: readonly { kind: AlignKind; label: string }[] = [
  { kind: 'left', label: '左对齐' },
  { kind: 'hcenter', label: '水平居中' },
  { kind: 'right', label: '右对齐' },
  { kind: 'top', label: '顶对齐' },
  { kind: 'vcenter', label: '垂直居中' },
  { kind: 'bottom', label: '底对齐' },
]

const DISTRIBUTE_ACTIONS: readonly { axis: 'x' | 'y'; label: string }[] = [
  { axis: 'x', label: '水平等间距' },
  { axis: 'y', label: '垂直等间距' },
]
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
    <p class="m-0 text-sm text-text-primary" data-test="multi-count">
      已选 {{ count }} 个节点
    </p>

    <section>
      <h3 class="m-0 mb-2 text-2xs tracking-wide text-text-disabled">对齐</h3>
      <div class="grid grid-cols-3 gap-1">
        <DtButton
          v-for="item in ALIGN_ACTIONS"
          :key="item.kind"
          size="sm"
          variant="outline"
          :aria-label="item.label"
          :title="alignReady ? item.label : `${item.label}：需同层级 ≥2 个节点`"
          :data-test="`multi-align-${item.kind}`"
          :disabled="!alignReady"
          @click="emit('align', item.kind)"
        >
          {{ item.label }}
        </DtButton>
      </div>
    </section>

    <section>
      <h3 class="m-0 mb-2 text-2xs tracking-wide text-text-disabled">分布</h3>
      <div class="grid grid-cols-2 gap-1">
        <DtButton
          v-for="item in DISTRIBUTE_ACTIONS"
          :key="item.axis"
          size="sm"
          variant="outline"
          :aria-label="item.label"
          :title="
            distributeReady ? item.label : `${item.label}：需同层级 ≥3 个节点`
          "
          :data-test="`multi-distribute-${item.axis}`"
          :disabled="!distributeReady"
          @click="emit('distribute', item.axis)"
        >
          {{ item.label }}
        </DtButton>
      </div>
    </section>

    <DtButton
      size="sm"
      variant="soft"
      intent="danger"
      icon="trash"
      block
      data-test="multi-remove"
      @click="emit('remove-all')"
    >
      删除所选
    </DtButton>
  </div>
</template>
