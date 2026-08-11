/**
 * @fileoverview 空间配置页的取数：车间列表，以及选中车间下的房间与空调。
 *
 * ⚠ 房间与空调必须**一起换**：选中车间变了却还留着上一个车间的数据，界面会
 * 把别的车间的机器画进这个车间的房间里，而看上去毫无异样。
 * ⚠ 取不全要明说：空间配置页上少画一台空调，人是看不出来的。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { AcUnit, Room, Workshop } from '@dt/contracts'

import * as hvac from '@/api/hvac'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'

import { describePartial, groupByRoom, type BoardPages } from './boardData'

/** 一次取满的上限，与后端分页上限同值。 */
const PAGE_SIZE = 200

interface BoardState {
  workshops: Ref<Workshop[]>
  rooms: Ref<Room[]>
  units: Ref<AcUnit[]>
  workshopId: Ref<string>
  loading: Ref<boolean>
  error: Ref<string | null>
  partialHint: Ref<string | null>
  raced: RacedFetch
}

export interface SpaceBoard {
  workshops: Ref<Workshop[]>
  rooms: Ref<Room[]>
  units: Ref<AcUnit[]>
  workshopId: Ref<string>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** 有一类没取全时的说明，`null` 表示都取全了。 */
  partialHint: Ref<string | null>
  unitsByRoom: ComputedRef<Map<string, AcUnit[]>>
  loadWorkshops: () => Promise<void>
  loadBoard: () => Promise<void>
  select: (nextWorkshopId: string) => Promise<void>
}

export function useSpaceBoard(): SpaceBoard {
  const state: BoardState = {
    workshops: ref<Workshop[]>([]),
    rooms: ref<Room[]>([]),
    units: ref<AcUnit[]>([]),
    workshopId: ref(''),
    loading: ref(false),
    error: ref<string | null>(null),
    partialHint: ref<string | null>(null),
    raced: useRacedFetch(),
  }

  return {
    workshops: state.workshops,
    rooms: state.rooms,
    units: state.units,
    workshopId: state.workshopId,
    loading: state.loading,
    error: state.error,
    partialHint: state.partialHint,
    unitsByRoom: computed(() => groupByRoom(state.units.value)),
    loadWorkshops: () => loadWorkshops(state),
    loadBoard: () => loadBoard(state),
    select: (nextWorkshopId) => select(state, nextWorkshopId),
  }
}

async function loadWorkshops(state: BoardState): Promise<void> {
  try {
    const page = await hvac.listWorkshops({ size: PAGE_SIZE })
    state.workshops.value = page.items
    state.error.value = null
    // 选中的车间被别人删掉后落回第一个，而不是留着一个空白右栏
    if (!page.items.some((item) => item.id === state.workshopId.value)) {
      state.workshopId.value = page.items[0]?.id ?? ''
    }
  } catch (caught) {
    state.error.value = describeError(caught)
    state.workshops.value = []
  }
}

async function loadBoard(state: BoardState): Promise<void> {
  const target = state.workshopId.value
  if (target === '') {
    state.rooms.value = []
    state.units.value = []
    return
  }
  state.loading.value = true
  state.error.value = null
  await state.raced.run(() => fetchBoard(target), {
    ok: (pages) => {
      state.rooms.value = pages.rooms.items
      state.units.value = pages.units.items
      state.partialHint.value = describePartial(pages)
    },
    fail: (caught) => {
      state.error.value = describeError(caught)
      state.rooms.value = []
      state.units.value = []
    },
    settled: () => {
      state.loading.value = false
    },
  })
}

async function select(state: BoardState, next: string): Promise<void> {
  if (next === state.workshopId.value) return
  state.workshopId.value = next
  // 先清空再取：慢网络下留着旧数据，人会以为新车间里就是这些机器
  state.rooms.value = []
  state.units.value = []
  await loadBoard(state)
}

async function fetchBoard(workshopId: string): Promise<BoardPages> {
  const [rooms, units] = await Promise.all([
    hvac.listRooms({ workshop_id: workshopId, size: PAGE_SIZE }),
    hvac.listAcUnits({ workshop_id: workshopId, size: PAGE_SIZE }),
  ])
  return { rooms, units }
}
