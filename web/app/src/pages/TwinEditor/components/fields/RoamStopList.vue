<script setup lang="ts">
/**
 * @fileoverview 漫游轨迹的站点清单：从已存的视点里挑着加进来，再上下调序或移出。
 *
 * ⚠ 只许从 `cameras` 里挑、不给手填 id：填错的 id 在运行态是「这一站被跳过」，
 * 界面上什么都不会说。
 * ⚠ 挪位只交换两个**现存**站点占的下标，指向已删视点的悬空 id 原地不动——
 * 按可见清单整份重写会把它连同下面那句警告一起抹掉，用户只是点了一下上移，
 * 却在毫无提示的情况下丢掉一条待处理的记录（与视点切换同一个口径）。
 */
import type { TwinCamera, TwinRoamTour } from '@dt/twin-config'
import { DtButton } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{
  tour: TwinRoamTour
  cameras: readonly TwinCamera[]
}>()

const emit = defineEmits<{ 'update:tour': [TwinRoamTour] }>()

function nameOf(camera: TwinCamera): string {
  return camera.name === '' ? '未命名视点' : camera.name
}

/** 轨迹上的站点，按飞行顺序；指向已删视点的那些在这里被滤掉。 */
const stops = computed(() =>
  props.tour.items
    .map((id) => props.cameras.find((camera) => camera.id === id))
    .filter((camera): camera is TwinCamera => camera !== undefined)
    .map((camera, order) => ({ camera, order, label: nameOf(camera) })),
)

/** 还没加进轨迹的视点。 */
const rest = computed(() => {
  const picked = new Set(props.tour.items)
  return props.cameras.filter((camera) => !picked.has(camera.id))
})

/** 指向已删视点的 id 个数；运行态会跳过它们，得说出来。 */
const dangling = computed(() => props.tour.items.length - stops.value.length)

function write(items: string[]): void {
  emit('update:tour', { ...props.tour, items })
}

function add(id: string): void {
  if (props.tour.items.includes(id)) return
  write([...props.tour.items, id])
}

function remove(id: string): void {
  write(props.tour.items.filter((item) => item !== id))
}

function move(order: number, delta: number): void {
  const items = [...props.tour.items]
  const live = items
    .map((id, index) => ({ id, index }))
    .filter((entry) => props.cameras.some((camera) => camera.id === entry.id))
  const from = live[order]
  const to = live[order + delta]
  if (from === undefined || to === undefined) return
  items[from.index] = to.id
  items[to.index] = from.id
  write(items)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <ol v-if="stops.length > 0" class="flex flex-col gap-1">
      <li
        v-for="stop in stops"
        :key="stop.camera.id"
        class="flex min-w-0 items-center gap-1.5 rounded-sm border border-border-subtle px-2 py-1"
      >
        <span class="text-3xs text-text-disabled">{{ stop.order + 1 }}</span>
        <span class="min-w-0 flex-1 truncate text-xs">{{ stop.label }}</span>
        <DtButton
          variant="ghost"
          size="sm"
          icon="chevron-up"
          :disabled="stop.order <= 0"
          :aria-label="`上移 ${stop.label}`"
          @click="move(stop.order, -1)"
        />
        <DtButton
          variant="ghost"
          size="sm"
          icon="chevron-down"
          :disabled="stop.order >= stops.length - 1"
          :aria-label="`下移 ${stop.label}`"
          @click="move(stop.order, 1)"
        />
        <DtButton
          variant="ghost"
          size="sm"
          icon="close"
          :aria-label="`移出 ${stop.label}`"
          @click="remove(stop.camera.id)"
        />
      </li>
    </ol>

    <p v-else class="text-xs text-text-disabled">
      轨迹还是空的。从下面挑几个视点加进来，镜头就会按这个顺序一站站飞过去。
    </p>

    <div v-if="rest.length > 0" class="flex flex-wrap gap-1">
      <DtButton
        v-for="camera in rest"
        :key="camera.id"
        variant="soft"
        size="sm"
        icon="plus"
        @click="add(camera.id)"
      >
        {{ nameOf(camera) }}
      </DtButton>
    </div>

    <p v-if="dangling > 0" class="text-xs text-state-warning">
      轨迹里有 {{ dangling }} 个视点已经被删掉了，飞的时候会跳过它们。
    </p>
  </div>
</template>
