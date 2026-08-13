<script setup lang="ts">
/**
 * @fileoverview 左栏里的一个房间。
 *
 * ⚠ 选中态不能只靠颜色：`aria-pressed` 管读屏，左侧竖条管色觉障碍。
 * ⚠ 与 CoverageSidebar 不同，点选中的那个**不取消**——主从布局必须始终有一个
 * 选中项，取消了右区就没东西可显示。
 */
import { DtBadge, DtTag } from '@dt/ui'

import type { RoomEntry } from '../roomGroups'

const props = defineProps<{
  room: RoomEntry
  isSelected: boolean
}>()

const emit = defineEmits<{ select: [] }>()
</script>

<template>
  <li>
    <button
      type="button"
      class="flex w-full items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-left"
      :class="
        props.isSelected
          ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
          : 'border-transparent text-text-primary hover:bg-surface-raised'
      "
      :aria-pressed="props.isSelected"
      :title="`${props.room.workshopName} · ${props.room.name}`"
      @click="emit('select')"
    >
      <span
        class="min-w-0 flex-1 truncate text-xs"
        :class="{
          'text-text-secondary':
            props.room.modelCount === 0 && !props.isSelected,
        }"
      >
        {{ props.room.name }}
      </span>
      <!-- 训练中的圆点挂在计数标签的角上：Badge 必须贴着别的元素 -->
      <DtBadge
        :dot="props.room.isTraining"
        intent="info"
        aria-label="有模型正在训练"
      >
        <DtTag size="sm" intent="neutral">{{ props.room.modelCount }}</DtTag>
      </DtBadge>
    </button>
  </li>
</template>
