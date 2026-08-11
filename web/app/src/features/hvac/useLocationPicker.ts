/**
 * @fileoverview 「选车间 → 选房间」这对级联选择的共用取数与状态。
 *
 * ⚠ 换车间必须清掉已选房间：留着上一个车间的房间 id，筛出来是个空列表，
 * 而界面上两个选择器看起来都填好了——用户只会以为「这个车间没有空调」。
 * ⚠ 房间列表要防竞态：连着换两次车间时，慢的那次后返回会盖掉快的那次。
 */

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { DtSelectOption, Room, Workshop } from '@dt/contracts'

import * as hvac from '@/api/hvac'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'

/** 一次取满的上限，与后端分页上限同值。 */
const PAGE_SIZE = 200

/** 「全部」在选择器里的取值。空串而不是 undefined：DtSelect 的 v-model 是 string。 */
export const ANY_LOCATION = ''

interface PickerState {
  workshops: Ref<Workshop[]>
  rooms: Ref<Room[]>
  error: Ref<string | null>
  isWorkshopListPartial: Ref<boolean>
  raced: RacedFetch
}

export interface LocationPicker {
  workshops: Ref<Workshop[]>
  rooms: Ref<Room[]>
  workshopId: Ref<string>
  roomId: Ref<string>
  workshopOptions: ComputedRef<DtSelectOption[]>
  roomOptions: ComputedRef<DtSelectOption[]>
  error: Ref<string | null>
  /** 车间数超出单次取回上限时为真，界面要说出来而不是静默少列几个。 */
  isWorkshopListPartial: Ref<boolean>
  loadWorkshops: () => Promise<void>
  /** 把两级选择重置到给定取值。 */
  select: (workshopId: string, roomId?: string) => void
}

/**
 * @param placeholder 「全部」这一项的文案；不给就不出这一项（表单用）
 */
export function useLocationPicker(placeholder?: string): LocationPicker {
  const state: PickerState = {
    workshops: ref<Workshop[]>([]),
    rooms: ref<Room[]>([]),
    error: ref<string | null>(null),
    isWorkshopListPartial: ref(false),
    raced: useRacedFetch(),
  }
  const workshopId = ref(ANY_LOCATION)
  const roomId = ref(ANY_LOCATION)

  // ⚠ 不在这里直接清掉 roomId：`select(车间, 房间)` 铺表单时两个值是一起给的，
  // 而 watch 在 flush 时才跑，先清就把刚铺进去的房间清掉了。改为等房间列表回来
  // 再验一次「选中的房间属不属于这个车间」，两种场景都对。
  watch(workshopId, (next) => {
    void loadRooms(state, next, roomId)
  })

  return {
    workshops: state.workshops,
    rooms: state.rooms,
    workshopId,
    roomId,
    error: state.error,
    isWorkshopListPartial: state.isWorkshopListPartial,
    workshopOptions: computed(() =>
      toOptions(state.workshops.value, placeholder),
    ),
    roomOptions: computed(() => toOptions(state.rooms.value, placeholder)),
    loadWorkshops: () => loadWorkshops(state),
    select: (nextWorkshopId, nextRoomId = ANY_LOCATION) => {
      workshopId.value = nextWorkshopId
      roomId.value = nextRoomId
    },
  }
}

async function loadWorkshops(state: PickerState): Promise<void> {
  try {
    const page = await hvac.listWorkshops({ size: PAGE_SIZE })
    state.workshops.value = page.items
    state.isWorkshopListPartial.value = page.total > page.items.length
    state.error.value = null
  } catch (caught) {
    state.error.value = describeError(caught)
    state.workshops.value = []
  }
}

async function loadRooms(
  state: PickerState,
  target: string,
  roomId: Ref<string>,
): Promise<void> {
  if (target === ANY_LOCATION) {
    state.rooms.value = []
    roomId.value = ANY_LOCATION
    return
  }
  await state.raced.run(
    () => hvac.listRooms({ workshop_id: target, size: PAGE_SIZE }),
    {
      ok: (page) => {
        state.rooms.value = page.items
        state.error.value = null
        // 不变式：选中的房间必须属于当前车间。不属于就作废，否则筛出来是空的
        if (!page.items.some((room) => room.id === roomId.value)) {
          roomId.value = ANY_LOCATION
        }
      },
      fail: (caught) => {
        state.error.value = describeError(caught)
        state.rooms.value = []
        roomId.value = ANY_LOCATION
      },
      settled: () => undefined,
    },
  )
}

function toOptions(
  items: readonly { id: string; name: string }[],
  placeholder?: string,
): DtSelectOption[] {
  const options = items.map((item) => ({ value: item.id, label: item.name }))
  if (placeholder === undefined) return options
  return [{ value: ANY_LOCATION, label: placeholder }, ...options]
}
