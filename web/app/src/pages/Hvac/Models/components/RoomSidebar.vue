<script setup lang="ts">
/**
 * @fileoverview 左栏「房间」：按车间分组列房间与各自的模型数，点一个筛右区。
 *
 * ⚠ 过滤只影响显示、不动选中：当前选中的房间被筛掉时它仍然是选中的，右区照常
 * 显示它的模型，栏里补一句说明。
 * ⚠ 2xl 以下这一栏是横躺在表格上方的，排成一列会让房间名与它的模型数隔着整屏
 * 宽——所以窄档按网格铺，只有真立成侧栏（2xl）时才收回一列。
 */
import { computed, ref } from 'vue'
import { DtCard, DtEmpty, DtIcon, DtInput, DtTag } from '@dt/ui'

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
  <DtCard
    icon="building"
    title="房间"
    padding="sm"
    class="flex min-h-0 flex-col"
  >
    <template #actions>
      <DtTag size="sm">{{ props.entries.length }}</DtTag>
    </template>

    <DtInput
      v-if="showFilter"
      v-model="keyword"
      class="mb-2 shrink-0"
      type="search"
      size="sm"
      placeholder="筛房间"
      aria-label="筛房间"
    >
      <template #leading><DtIcon name="search" :size="14" /></template>
    </DtInput>

    <!-- ⚠ 出路那句话只写在右区那条空态上：两边同时铺开一模一样的一段，
         2xl 以下它们是上下叠着的，读起来像同一句话说了两遍 -->
    <DtEmpty
      v-if="props.entries.length === 0"
      icon="building"
      title="还没有配置房间"
    />

    <nav
      v-else
      class="min-h-0 flex-1 space-y-2.5 overflow-y-auto"
      aria-label="房间"
    >
      <section v-for="group in groups" :key="group.id">
        <h3
          v-if="showGroupHeads"
          class="mb-1 text-2xs font-medium tracking-widest text-text-disabled"
        >
          {{ group.name }}
        </h3>
        <ul
          class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-1.5 p-0 2xl:grid-cols-1"
        >
          <RoomSidebarItem
            v-for="room in group.rooms"
            :key="room.id"
            :room="room"
            :is-selected="room.id === props.selected"
            @select="emit('select', room.id)"
          />
        </ul>
      </section>

      <p v-if="visible.length === 0" class="text-2xs text-text-disabled">
        没有匹配「{{ keyword }}」的房间。
      </p>
    </nav>

    <p
      v-if="isSelectedHidden"
      class="mt-2 shrink-0 text-2xs leading-relaxed text-text-disabled"
    >
      当前选中的房间不在筛选结果里
    </p>
    <p
      v-if="props.hiddenCount > 0"
      class="mt-2 shrink-0 text-2xs leading-relaxed text-text-disabled"
    >
      另有 {{ props.hiddenCount }} 个房间没有空调，不能建模
    </p>
  </DtCard>
</template>
