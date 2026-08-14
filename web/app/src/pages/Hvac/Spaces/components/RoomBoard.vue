<script setup lang="ts">
/**
 * @fileoverview 选中车间的房间总览：每个房间一个容器，容器里是它的空调。
 * ⚠ 空房间也画框：房间是空调互相影响的边界，一个还没装机的房间同样是现场的
 * 一个事实，只列有空调的房间会让人以为它不存在。
 */
import type { AcUnit, Room } from '@dt/contracts'
import { DtPageState } from '@dt/ui'

import RoomGroup from './RoomGroup.vue'

const props = defineProps<{
  rooms: readonly Room[]
  unitsByRoom: ReadonlyMap<string, AcUnit[]>
  selectedIds: readonly string[]
  isSelectable: boolean
  isLoading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  toggle: [unit: AcUnit]
  rename: [room: Room]
  remove: [room: Room]
  retry: []
}>()

function unitsOf(room: Room): readonly AcUnit[] {
  return props.unitsByRoom.get(room.id) ?? []
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-auto">
    <DtPageState
      :loading="props.isLoading"
      :error="props.error"
      :empty="props.rooms.length === 0"
      empty-title="这个车间还没有房间"
      empty-hint="房间是空调互相影响的边界，先把它分出来。"
      @retry="emit('retry')"
    >
      <div class="grid gap-3 xl:grid-cols-2">
        <RoomGroup
          v-for="room in props.rooms"
          :key="room.id"
          :room="room"
          :units="unitsOf(room)"
          :selected-ids="props.selectedIds"
          :is-selectable="props.isSelectable"
          @toggle="emit('toggle', $event)"
          @rename="emit('rename', $event)"
          @remove="emit('remove', $event)"
        />
      </div>
    </DtPageState>
  </div>
</template>
