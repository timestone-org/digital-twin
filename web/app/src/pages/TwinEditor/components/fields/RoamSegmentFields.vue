<script setup lang="ts">
/**
 * @fileoverview 漫游的逐段覆盖：某一段单独配飞行时长与到站停留，留空就用全局值。
 *
 * ⚠ 停留算在**刚飞完那一段**的尾巴上：想让镜头「到 B 之后多停 5 秒」，配的是
 * A → B 这一行，不是 B → C 那一行。行上直接把两站写出来就是为了不让人配错行。
 */
import {
  buildRoamSegments,
  type TwinCamera,
  type TwinRoamTour,
  type TwinRoamTourSegment,
} from '@dt/twin-config'
import { DtEmpty, DtNumberInput } from '@dt/ui'
import { computed } from 'vue'

import {
  ROAM_SECONDS_STEP,
  roamMsOrNull,
  roamSeconds,
  roamSecondsOrUndefined,
} from '../../scripts/roamTiming'

const props = defineProps<{
  tour: TwinRoamTour
  cameras: readonly TwinCamera[]
  /** 秒的上限，与全局时长同一套区间。 */
  maxFlySeconds: number
  maxHoldSeconds: number
}>()

const emit = defineEmits<{ 'update:tour': [TwinRoamTour] }>()

const flyRange = computed(() => ({
  min: 0,
  max: props.maxFlySeconds,
  step: ROAM_SECONDS_STEP,
}))
const holdRange = computed(() => ({
  min: 0,
  max: props.maxHoldSeconds,
  step: ROAM_SECONDS_STEP,
}))

function nameOf(id: string): string {
  const camera = props.cameras.find((item) => item.id === id)
  if (camera === undefined) return id
  return camera.name === '' ? '未命名视点' : camera.name
}

/** 一行一段，循环时最后一行是「末站飞回首站」。 */
const rows = computed(() =>
  buildRoamSegments(props.cameras, props.tour).map((segment, index) => {
    const override = props.tour.segmentSettings[segment.fromId] ?? null
    return {
      key: `${index}:${segment.fromId}`,
      id: segment.fromId,
      title: `${nameOf(segment.fromId)} → ${nameOf(segment.toId)}`,
      flySeconds: roamSecondsOrUndefined(override?.segmentMs ?? null),
      holdSeconds: roamSecondsOrUndefined(override?.pauseMs ?? null),
    }
  }),
)

const flyHint = computed(() => `${roamSeconds(props.tour.segmentMs)} 秒`)
const holdHint = computed(() => `${roamSeconds(props.tour.pauseMs)} 秒`)

/** 写一段的覆盖；两项都空了就把这条覆盖整个删掉，免得留一堆空壳。 */
function writeOverride(id: string, patch: Partial<TwinRoamTourSegment>): void {
  const current = props.tour.segmentSettings[id] ?? {
    segmentMs: null,
    pauseMs: null,
  }
  const next = { ...current, ...patch }
  const segmentSettings = { ...props.tour.segmentSettings }
  if (next.segmentMs === null && next.pauseMs === null)
    delete segmentSettings[id]
  else segmentSettings[id] = next
  emit('update:tour', { ...props.tour, segmentSettings })
}

function writeFly(id: string, seconds: number | undefined): void {
  writeOverride(id, { segmentMs: roamMsOrNull(seconds) })
}

function writeHold(id: string, seconds: number | undefined): void {
  writeOverride(id, { pauseMs: roamMsOrNull(seconds) })
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <DtEmpty
      v-if="rows.length === 0"
      size="inline"
      title="轨迹上还没有可飞的段，先把站点凑够两个。"
    />
    <div
      v-for="row in rows"
      :key="row.key"
      class="flex flex-col gap-1.5 rounded-sm border border-border-subtle px-2 py-1.5"
    >
      <span class="truncate text-xs text-text-secondary">{{ row.title }}</span>
      <div class="flex gap-1.5">
        <DtNumberInput
          :model-value="row.flySeconds"
          :range="flyRange"
          :hint="`飞行，留空用 ${flyHint}`"
          label="飞行（秒）"
          size="sm"
          :steppers="false"
          @update:model-value="writeFly(row.id, $event)"
        />
        <DtNumberInput
          :model-value="row.holdSeconds"
          :range="holdRange"
          :hint="`停留，留空用 ${holdHint}`"
          label="到站停留（秒）"
          size="sm"
          :steppers="false"
          @update:model-value="writeHold(row.id, $event)"
        />
      </div>
    </div>
  </div>
</template>
