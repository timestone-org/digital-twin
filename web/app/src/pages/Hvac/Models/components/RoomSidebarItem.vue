<script setup lang="ts">
/**
 * @fileoverview 左栏里的一个房间。
 *
 * ⚠ 选中态不能只靠颜色：`aria-current` 管读屏，左侧竖条管色觉障碍。
 * ⚠ 与 CoverageSidebar 不同，点选中的那个**不取消**——主从布局必须始终有一个
 * 选中项，取消了右区就没东西可显示。
 */
import { DtBadge, DtTag } from '@dt/ui'

import type { RoomEntry } from '../scripts/roomGroups'

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
      class="relative flex w-full items-center gap-2 overflow-hidden rounded-md border px-2.5 py-2 text-left transition-colors"
      :class="
        props.isSelected
          ? 'border-accent-primary/50 bg-accent-primary/10'
          : 'border-border-subtle bg-surface-sunken/40 hover:border-border-default hover:bg-accent-primary/5'
      "
      :aria-current="props.isSelected ? 'true' : undefined"
      :title="`${props.room.workshopName} · ${props.room.name}`"
      @click="emit('select')"
    >
      <span
        v-if="props.isSelected"
        class="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent-primary"
        aria-hidden="true"
      />
      <span
        class="min-w-0 flex-1 truncate text-xs"
        :class="
          props.isSelected
            ? 'font-medium text-text-title'
            : props.room.modelCount === 0
              ? 'text-text-secondary'
              : 'text-text-primary'
        "
      >
        {{ props.room.name }}
      </span>
      <!-- 训练中的圆点挂在计数标签的角上：Badge 必须贴着别的元素 -->
      <DtBadge
        :dot="props.room.isTraining"
        intent="info"
        aria-label="有模型正在训练"
      >
        <DtTag size="sm" :intent="props.isSelected ? 'primary' : 'neutral'">
          {{ props.room.modelCount }}
        </DtTag>
      </DtBadge>
    </button>
  </li>
</template>
