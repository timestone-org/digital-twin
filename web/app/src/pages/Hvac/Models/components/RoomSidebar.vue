<script setup lang="ts">
/**
 * @fileoverview 左栏「房间」：按车间分组列房间与各自的模型数，点一个筛右区。
 *
 * ⚠ 过滤只影响显示、不动选中：当前选中的房间被筛掉时它仍然是选中的，右区照常
 * 显示它的模型，栏里补一句说明。
 */
import { computed, ref } from 'vue'
import { DtEmpty, DtIcon, DtInput } from '@dt/ui'

import {
  ROOM_FILTER_MIN,
  filterRooms,
  groupByWorkshop,
  type RoomEntry,
} from '../scripts/roomGroups'
import RoomSidebarItem from './RoomSidebarItem.vue'

const props = defineProps<{
  entries: readonly RoomEntry[]
  /** 因为没有空调、也没有历史模型而被挡掉的房间数。 */
  hiddenCount: number
  selected: string
}>()

const emit = defineEmits<{ select: [value: string] }>()

const keyword = ref('')

const visible = computed(() => filterRooms(props.entries, keyword.value))
const groups = computed(() => groupByWorkshop(visible.value))
// 只有一个车间时不渲染分组头，省掉一行噪声
const showGroupHeads = computed(() => groups.value.length > 1)
const showFilter = computed(() => props.entries.length > ROOM_FILTER_MIN)
/** 选中的房间被筛掉了：它仍然选中，右区照常显示，但栏里要说一句。 */
const isSelectedHidden = computed(
  () =>
    props.selected !== '' &&
    !visible.value.some((entry) => entry.id === props.selected),
)
</script>

<template>
  <nav
    class="flex min-h-0 flex-col gap-2 rounded-lg border border-border-subtle bg-surface-panel p-3"
    aria-label="房间"
  >
    <div class="flex shrink-0 items-baseline justify-between gap-2">
      <span class="text-xs tracking-widest text-text-secondary">房间</span>
      <span class="text-2xs text-text-disabled">
        {{ props.entries.length }} 个
      </span>
    </div>

    <DtInput
      v-if="showFilter"
      v-model="keyword"
      class="shrink-0"
      type="search"
      size="sm"
      placeholder="筛房间"
      aria-label="筛房间"
    >
      <template #leading><DtIcon name="search" :size="14" /></template>
    </DtInput>

    <DtEmpty
      v-if="props.entries.length === 0"
      icon="building"
      title="还没有配置房间"
      hint="先在空间配置页建车间与房间，并把空调挂到房间上。"
    />

    <div v-else class="min-h-0 flex-1 space-y-2 overflow-y-auto">
      <section v-for="group in groups" :key="group.id">
        <h3 v-if="showGroupHeads" class="px-2 py-1 text-2xs text-text-disabled">
          {{ group.name }}
        </h3>
        <ul class="m-0 list-none space-y-0.5 p-0">
          <RoomSidebarItem
            v-for="room in group.rooms"
            :key="room.id"
            :room="room"
            :is-selected="room.id === props.selected"
            @select="emit('select', room.id)"
          />
        </ul>
      </section>

      <p v-if="visible.length === 0" class="px-2 text-2xs text-text-disabled">
        没有匹配「{{ keyword }}」的房间。
      </p>
    </div>

    <p v-if="isSelectedHidden" class="shrink-0 text-2xs text-text-disabled">
      当前选中的房间不在筛选结果里
    </p>
    <p
      v-if="props.hiddenCount > 0"
      class="shrink-0 text-2xs text-text-disabled"
    >
      另有 {{ props.hiddenCount }} 个房间没有空调，不能建模
    </p>
  </nav>
</template>
