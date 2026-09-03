<script setup lang="ts">
/**
 * @fileoverview 右区的房间抬头：选中房间的名字、所在车间与两个计数，外加建模入口。
 *
 * ⚠ 建模永远是针对某个房间的，入口贴着房间上下文最不容易选错——所以「新建模型」
 * 留在这里而不是顶栏。
 */
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCard, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import type { RoomEntry } from '../scripts/roomGroups'

const props = defineProps<{ room: RoomEntry }>()

defineEmits<{ create: [] }>()
</script>

<template>
  <DtCard padding="sm" class="shrink-0">
    <template #header>
      <div class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        <h2
          class="m-0 truncate font-display text-base font-semibold text-text-title"
        >
          {{ props.room.name }}
        </h2>
        <DtTag size="sm">{{ props.room.workshopName }}</DtTag>
        <span class="text-xs text-text-secondary">
          {{ props.room.acUnitCount }} 台空调 · {{ props.room.modelCount }}
          个模型
        </span>
      </div>
    </template>

    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.acManage]">
        <DtButton
          intent="primary"
          size="sm"
          icon="plus"
          @click="$emit('create')"
        >
          新建模型
        </DtButton>
      </PermGuard>
    </template>
  </DtCard>
</template>
