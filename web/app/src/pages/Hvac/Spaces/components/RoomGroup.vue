<script setup lang="ts">
/**
 * @fileoverview 一个房间连同它里面的空调，画成一个容器。
 *
 * ⚠ 房间不是标签而是**边界**：框在同一个容器里的这几台共处一个热力空间、
 * 会互相影响，这正是这一页要一眼看出来的东西。所以房间即使空着也要画出框，
 * 而不是只列有空调的房间——空房间同样是现场的一个事实。
 */
import type { AcUnit, Room } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCard, DtHelpTip, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'

import AcUnitChip from './AcUnitChip.vue'

/** 只有一台时没有「互相影响」可言，热耦合提示只在两台以上出现。 */
const COUPLED_FROM = 2

const props = defineProps<{
  room: Room
  units: readonly AcUnit[]
  selectedIds: readonly string[]
  isSelectable: boolean
}>()

const emit = defineEmits<{
  toggle: [unit: AcUnit]
  rename: [room: Room]
  remove: [room: Room]
}>()
</script>

<template>
  <DtCard padding="sm" class="room-group">
    <template #header>
      <div class="room-group__title">
        <span class="room-group__name">{{ props.room.name }}</span>
        <DtTag
          size="sm"
          :intent="props.units.length >= COUPLED_FROM ? 'warning' : 'neutral'"
        >
          {{ props.units.length }} 台
        </DtTag>
        <DtHelpTip
          v-if="props.units.length >= COUPLED_FROM"
          label="热耦合"
          text="这几台空调共处一个房间，开停会互相影响，后续预测按房间整体算。"
        />
      </div>
    </template>

    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.acManage]">
        <DtButton
          variant="ghost"
          intent="neutral"
          size="sm"
          icon="pencil"
          aria-label="重命名房间"
          title="重命名房间"
          @click="emit('rename', props.room)"
        />
        <DtButton
          variant="ghost"
          intent="danger"
          size="sm"
          icon="trash"
          aria-label="删除房间"
          title="删除房间"
          @click="emit('remove', props.room)"
        />
      </PermGuard>
    </template>

    <div v-if="props.units.length > 0" class="room-group__grid">
      <AcUnitChip
        v-for="unit in props.units"
        :key="unit.id"
        :unit="unit"
        :is-selected="props.selectedIds.includes(unit.id)"
        :is-selectable="props.isSelectable"
        @toggle="emit('toggle', $event)"
      />
    </div>
    <p v-else class="room-group__empty">
      这个房间还没有空调。到「空调台账」建档时选这个房间，或把别处的空调改派过来。
    </p>
  </DtCard>
</template>

<style scoped lang="scss">
.room-group {
  &__title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 24px;
  }

  &__name {
    color: var(--text-title);
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__grid {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  }

  // 空房间的那句话画成一格虚线占位：它与上面那些实线小卡占同一条格线，
  // 「这里本该有空调」才看得出来，而不是一段悬空的灰字
  &__empty {
    display: flex;
    align-items: center;
    margin: 0;
    min-height: 3.25rem;
    padding: 8px 12px;
    border: 1px dashed var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-disabled);
    font-size: 12px;
    line-height: 1.6;
  }
}
</style>
