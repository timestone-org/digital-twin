<script setup lang="ts">
/**
 * @fileoverview 空间配置：车间 → 房间 → 空调，把「谁跟谁在同一个空间」画出来。
 *
 * ⚠ 这一页的主张就一句：**框在同一个房间里的空调会互相影响**。所以房间画成
 * 容器而不是一列文字，空房间也照样画框——空房间同样是现场的一个事实。
 * 单台空调的建档与改名在「空调台账」页，这里只管它落在哪个房间。
 */
import { computed, onMounted, ref } from 'vue'
import type { AcUnit, DtSelectOption, Room, Workshop } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtEmpty, DtNotice, useConfirm, useToast } from '@dt/ui'

import * as hvac from '@/api/hvac'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useAuthStore } from '@/stores/auth'
import RelocateBar from './components/RelocateBar.vue'
import RoomBoard from './components/RoomBoard.vue'
import SpaceNameDialog from './components/SpaceNameDialog.vue'
import WorkshopRail from './components/WorkshopRail.vue'
import { copyOf, submitTask, type SpaceTask } from './scripts/spaceTask'
import { useSpaceBoard } from './scripts/useSpaceBoard'

const toast = useToast()
const confirm = useConfirm()
const auth = useAuthStore()
const board = useSpaceBoard()

const selectedIds = ref<string[]>([])
const task = ref<SpaceTask | null>(null)
const isDialogBusy = ref(false)
const dialogError = ref<string | null>(null)
const isRelocating = ref(false)

/** 闸 3：能不能改由后端说了算，这里只决定给不给点。 */
const canManage = computed(() => auth.can([PERMISSION_CODES.acManage]))

const roomOptions = computed<DtSelectOption[]>(() =>
  board.rooms.value.map((room) => ({ value: room.id, label: room.name })),
)

const dialogCopy = computed(() =>
  task.value === null
    ? { title: '', description: '', initial: '', done: '' }
    : copyOf(task.value),
)

function toggleUnit(unit: AcUnit): void {
  selectedIds.value = selectedIds.value.includes(unit.id)
    ? selectedIds.value.filter((id) => id !== unit.id)
    : [...selectedIds.value, unit.id]
}

async function selectWorkshop(workshopId: string): Promise<void> {
  // 换车间即作废选择：留着的话「已选 3 台」指的是另一个车间的机器
  selectedIds.value = []
  await board.select(workshopId)
}

function openTask(next: SpaceTask): void {
  dialogError.value = null
  task.value = next
}

async function submitName(name: string): Promise<void> {
  const current = task.value
  if (current === null) return
  isDialogBusy.value = true
  dialogError.value = null
  try {
    await submitTask(current, name)
    task.value = null
    toast.success(copyOf(current).done)
    await refresh()
  } catch (caught) {
    dialogError.value = describeError(caught)
  } finally {
    isDialogBusy.value = false
  }
}

async function removeWorkshop(workshop: Workshop): Promise<void> {
  // ⚠ 删不成就别问：摆一个红色「删除」去发一个注定被拒的请求，等于教人做一件
  // 做不成的事。这时候该说的是「为什么不行、先做什么」
  if (workshop.room_count > 0) {
    toast.warning(
      `车间「${workshop.name}」下还有 ${workshop.room_count} 个房间，` +
        '先把房间移走或删掉才能删车间。',
    )
    return
  }
  const confirmed = await confirm.ask({
    title: '删除车间',
    message: `将删除车间「${workshop.name}」，且不可恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!confirmed) return
  await runWrite(() => hvac.deleteWorkshop(workshop.id), '车间已删除')
}

async function removeRoom(room: Room): Promise<void> {
  const count = board.unitsByRoom.value.get(room.id)?.length ?? 0
  if (count > 0) {
    toast.warning(
      `房间「${room.name}」里还有 ${count} 台空调，` +
        '先把它们改派到别的房间才能删这个房间。',
    )
    return
  }
  const confirmed = await confirm.ask({
    title: '删除房间',
    message: `将删除房间「${room.name}」，且不可恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!confirmed) return
  await runWrite(() => hvac.deleteRoom(room.id), '房间已删除')
}

async function relocate(roomId: string): Promise<void> {
  isRelocating.value = true
  try {
    const result = await hvac.relocateAcUnits(selectedIds.value, roomId)
    selectedIds.value = []
    toast.success(`已把 ${result.moved_count} 台改派到「${result.room.name}」`)
    await refresh()
  } catch (caught) {
    toast.error(describeError(caught))
  } finally {
    isRelocating.value = false
  }
}

async function runWrite(
  action: () => Promise<void>,
  message: string,
): Promise<void> {
  try {
    await action()
    toast.success(message)
    await refresh()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

/** 车间栏上的两个计数来自后端，任何写操作之后两边都要重取。 */
async function refresh(): Promise<void> {
  await board.loadWorkshops()
  await board.loadBoard()
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <AppShell
    title="空间配置"
    subtitle="车间 → 房间 → 空调；同一房间内的空调会互相影响"
  >
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.acManage]" explain>
        <DtButton
          size="sm"
          icon="plus"
          :disabled="board.workshopId.value === ''"
          @click="
            openTask({
              kind: 'room-create',
              workshopId: board.workshopId.value,
            })
          "
        >
          新建房间
        </DtButton>
      </PermGuard>
    </template>

    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 gap-4">
      <WorkshopRail
        :workshops="board.workshops.value"
        :active-id="board.workshopId.value"
        @select="selectWorkshop($event)"
        @create="openTask({ kind: 'workshop-create' })"
        @rename="openTask({ kind: 'workshop-rename', workshop: $event })"
        @remove="removeWorkshop($event)"
      />

      <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <DtNotice v-if="board.partialHint.value" intent="warning">
          {{ board.partialHint.value }}
        </DtNotice>

        <RelocateBar
          v-if="selectedIds.length > 0"
          :count="selectedIds.length"
          :room-options="roomOptions"
          :is-busy="isRelocating"
          @relocate="relocate($event)"
          @clear="selectedIds = []"
        />

        <RoomBoard
          :rooms="board.rooms.value"
          :units-by-room="board.unitsByRoom.value"
          :selected-ids="selectedIds"
          :is-selectable="canManage"
          :is-loading="board.loading.value"
          :error="board.error.value"
          @toggle="toggleUnit($event)"
          @rename="openTask({ kind: 'room-rename', room: $event })"
          @remove="removeRoom($event)"
          @retry="refresh()"
        />

        <DtEmpty
          v-if="board.workshopId.value === '' && !board.loading.value"
          icon="building"
          title="先选一个车间"
          hint="左侧还没有车间时，先建一个。"
        />
      </div>
    </div>

    <SpaceNameDialog
      :model-value="task !== null"
      :title="dialogCopy.title"
      :description="dialogCopy.description"
      :initial="dialogCopy.initial"
      :is-busy="isDialogBusy"
      :error="dialogError"
      @update:model-value="task = null"
      @submit="submitName($event)"
    />
  </AppShell>
</template>
