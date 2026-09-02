<script setup lang="ts">
/**
 * @fileoverview 逐台核对区：回看窗内每台机组的最后一行读数，可就地微调。
 *
 * ⚠ `is_running` 是三态：窗内没有这台的任何一行时是「未知」，不代表它停着。
 * ⚠ 微调默认收起：读数是自动来的，默认展开就把一个「读当前」的弹窗变成一张
 * 5×N 的表单，喧宾夺主。
 */
import { computed } from 'vue'
import type {
  AcUnitLiveReading,
  AcUnitReadingValues,
  DtDataColumn,
  DtIntent,
} from '@dt/contracts'
import { DtDataView, DtHelpTip, DtNumberInput, DtTag } from '@dt/ui'

import { formatDateTime, formatSince } from '@/utils/datetime'
import {
  hasAnyReading,
  isStaleReading,
  type ReadingDraft,
} from '@/features/hvac/liveTest'

const RUNNING_HELP =
  '窗内没有这台的任何一行数据时是「未知」，不代表它一定停着。' +
  '运行状态只供你判断读数可不可信，不参与推荐计算。'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'serial', label: '机组', width: '6rem', card: 'title' },
  { key: 'sampled', label: '采样', width: '7rem' },
  { key: 'running', label: '运行', width: '5rem' },
  { key: 'room', label: '房间温/湿', width: '9rem', align: 'right' },
  { key: 'fresh', label: '新风温/湿', width: '9rem', align: 'right' },
  { key: 'chilled', label: '冷冻水供水', width: '8rem', align: 'right' },
]

/** ⚠ 三态：null 是「未知」，不许折成「停机」。 */
function runningView(state: boolean | null): {
  label: string
  intent: DtIntent
} {
  if (state === null) return { label: '未知', intent: 'warning' }
  return { label: state ? '运行' : '停机', intent: 'neutral' }
}

const props = defineProps<{
  units: readonly AcUnitLiveReading[]
  /** 服务端取数时刻，用来判断每台的读数有多旧。 */
  asOf: string
  /** 参照「现在」，由弹窗每 30 秒推一次。 */
  now: Date
  draft: Readonly<ReadingDraft>
  isTuning: boolean
}>()

const emit = defineEmits<{
  edit: [serial: string, key: keyof AcUnitReadingValues, value: number | null]
}>()

const rows = computed(() =>
  props.units.map((unit) => {
    const values = props.draft[unit.serial] ?? unit.readings
    return {
      id: unit.serial,
      serial: unit.serial,
      sampled:
        unit.sampled_at === null
          ? '—'
          : formatSince(unit.sampled_at, props.now),
      sampledTitle: formatDateTime(unit.sampled_at),
      isStale: isStaleReading(props.asOf, unit.sampled_at),
      running: runningView(unit.is_running),
      isBlank: !hasAnyReading(values),
      values,
    }
  }),
)

/** 读数的显示：一位小数去掉多余的零；null = 缺测，给占位符不给 0。 */
function show(value: number | null): string {
  return value === null ? '—' : String(Number(value.toFixed(1)))
}

/** DtNumberInput 清空给的是 undefined，草稿里一律记成 null（= 缺测）。 */
function onEdit(
  serial: string,
  key: keyof AcUnitReadingValues,
  value: number | undefined,
): void {
  emit('edit', serial, key, value ?? null)
}
</script>

<template>
  <DtDataView
    view="table"
    :columns="COLUMNS"
    :rows="rows"
    :loading="false"
    :error="null"
    :layout="{ toggle: false, minWidth: '40rem', fill: false }"
    :empty="{ title: '这个房间没有绑定数据的机组' }"
  >
    <template #toolbar>
      <span class="inline-flex items-center gap-1 text-2xs text-text-secondary">
        运行状态
        <DtHelpTip label="运行状态" :text="RUNNING_HELP" />
      </span>
    </template>

    <template #cell-serial="{ row }">
      <span class="font-mono text-xs" :class="{ 'opacity-60': row.isBlank }">
        {{ row.serial }}
      </span>
    </template>
    <template #cell-sampled="{ row }">
      <span
        class="whitespace-nowrap"
        :class="row.isStale ? 'text-state-warning' : ''"
        :title="row.sampledTitle"
      >
        {{ row.sampled }}
      </span>
    </template>
    <template #cell-running="{ row }">
      <DtTag size="sm" :intent="row.running.intent">
        {{ row.running.label }}
      </DtTag>
    </template>
    <template #cell-room="{ row }">
      <div v-if="props.isTuning" class="flex items-center gap-1">
        <DtNumberInput
          :model-value="row.values.workshop_temp_avg ?? undefined"
          size="sm"
          :steppers="false"
          aria-label="房间温度"
          @update:model-value="onEdit(row.serial, 'workshop_temp_avg', $event)"
        />
        <DtNumberInput
          :model-value="row.values.workshop_humidity_avg ?? undefined"
          size="sm"
          :steppers="false"
          aria-label="房间湿度"
          @update:model-value="
            onEdit(row.serial, 'workshop_humidity_avg', $event)
          "
        />
      </div>
      <span v-else-if="row.isBlank" class="text-text-disabled">无数据</span>
      <span v-else>
        {{ show(row.values.workshop_temp_avg) }} /
        {{ show(row.values.workshop_humidity_avg) }}
      </span>
    </template>
    <template #cell-fresh="{ row }">
      <div v-if="props.isTuning" class="flex items-center gap-1">
        <DtNumberInput
          :model-value="row.values.fresh_air_temp ?? undefined"
          size="sm"
          :steppers="false"
          aria-label="新风温度"
          @update:model-value="onEdit(row.serial, 'fresh_air_temp', $event)"
        />
        <DtNumberInput
          :model-value="row.values.fresh_air_humidity ?? undefined"
          size="sm"
          :steppers="false"
          aria-label="新风湿度"
          @update:model-value="onEdit(row.serial, 'fresh_air_humidity', $event)"
        />
      </div>
      <span v-else-if="row.isBlank" class="text-text-disabled">无数据</span>
      <span v-else>
        {{ show(row.values.fresh_air_temp) }} /
        {{ show(row.values.fresh_air_humidity) }}
      </span>
    </template>
    <template #cell-chilled="{ row }">
      <DtNumberInput
        v-if="props.isTuning"
        :model-value="row.values.chilled_water_supply_temp ?? undefined"
        size="sm"
        :steppers="false"
        aria-label="冷冻水供水温度"
        @update:model-value="
          onEdit(row.serial, 'chilled_water_supply_temp', $event)
        "
      />
      <span v-else-if="row.isBlank" class="text-text-disabled">无数据</span>
      <span v-else>{{ show(row.values.chilled_water_supply_temp) }}</span>
    </template>
  </DtDataView>
</template>
