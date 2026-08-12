<script setup lang="ts">
/**
 * @fileoverview 开机事件：一个房间从全停到达标的每一次过程，供人工核对与筛选。
 *
 * 房间是页内筛选而不是路径参数，所以它进主导航。
 * ⚠ 换房间会同时触发批次与事件两条取数，各自防竞态：慢的那次后返回会把界面
 * 刷成上一个房间的数据，而且不报任何错。
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { AcDataset, AcUnit, DtSegmentedOption } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtNotice, useConfirm, useToast } from '@dt/ui'

import * as hvac from '@/api/hvac'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useCursorPages } from '@/composables/useCursorPages'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useLocationPicker } from '@/features/hvac/useLocationPicker'
import BatchStatusStrip from './components/BatchStatusStrip.vue'
import CoverageSidebar from './components/CoverageSidebar.vue'
import EpisodeCurveDialog from './components/EpisodeCurveDialog.vue'
import EpisodeTable from './components/EpisodeTable.vue'
import ExclusionDialog from './components/ExclusionDialog.vue'
import StartupFilters from './components/StartupFilters.vue'
import {
  EPISODE_PAGE_SIZE,
  describeRebuild,
  rebuildRangeProblem,
  toEpisodeRows,
  type EpisodeRow,
} from './startupView'
import { useEpisodeCurve } from './useEpisodeCurve'
import { useStartupBatches } from './useStartupBatches'

const toast = useToast()
const confirm = useConfirm()
const picker = useLocationPicker('全部')
const units = useRacedFetch()
const curve = useEpisodeCurve()

const roomUnits = ref<AcUnit[]>([])
const outcome = ref('')
const combination = ref('')
const excluding = ref<EpisodeRow | null>(null)
const inspecting = ref<EpisodeRow | null>(null)
const serial = ref('')
const busy = ref(false)
const actionError = ref<string | null>(null)
// 抽取区间。两端都空即「全部可用历史」，由后端按数据源实际范围算
const rebuildFrom = ref('')
const rebuildTo = ref('')

const batches = useStartupBatches(() => picker.roomId.value)
// ⚠ 翻页是替换不是追加，所以 reload() 同时就是「回到第一页」——游标栈跟着清空
const episodes = useCursorPages(
  (after) =>
    hvac.listStartupEpisodes(picker.roomId.value, {
      limit: EPISODE_PAGE_SIZE,
      outcome: outcome.value || undefined,
      running_set: combination.value || undefined,
      ...(after === null ? {} : { after }),
    }),
  describeError,
)

// 只有装了空调的房间才谈得上开机事件
const roomOptions = computed(() =>
  picker.rooms.value
    .filter((room) => room.ac_unit_count > 0)
    .map((room) => ({ value: room.id, label: room.name })),
)
const rows = computed(() => toEpisodeRows(episodes.items.value))
// 指标目录只为下钻曲线取名字与量纲
const datasets = ref<AcDataset[]>([])
const metrics = computed(() => datasets.value.flatMap((item) => item.metrics))

/** 下钻时能画的那几台：运行组合与台账对得上的部分。 */
const curveOptions = computed<DtSegmentedOption[]>(() => {
  const known = new Set(roomUnits.value.map((unit) => unit.serial))
  return (inspecting.value?.episode.running_set ?? [])
    .filter((item) => known.has(item))
    .map((item) => ({ value: item, label: item }))
})

function reload(): void {
  if (picker.roomId.value === '') return
  void batches.load()
  void episodes.reload()
  void loadUnits()
}

async function loadUnits(): Promise<void> {
  const room = picker.roomId.value
  await units.run(() => hvac.listAcUnits({ room_id: room, size: 200 }), {
    ok: (page) => (roomUnits.value = page.items),
    fail: () => (roomUnits.value = []),
    settled: () => undefined,
  })
}

function loadCurve(): void {
  const row = inspecting.value
  const unit = roomUnits.value.find((item) => item.serial === serial.value)
  if (row === null || unit === undefined) return
  void curve.load(unit.id, row.episode, metrics.value)
}

function onInspect(row: EpisodeRow): void {
  inspecting.value = row
  curve.reset()
  const known = new Set(roomUnits.value.map((item) => item.serial))
  serial.value = row.episode.running_set.find((item) => known.has(item)) ?? ''
  loadCurve()
}

async function submitExclusion(reason: string): Promise<void> {
  const row = excluding.value
  if (row === null) return
  busy.value = true
  actionError.value = null
  try {
    await hvac.putStartupExclusion(picker.roomId.value, row.id, reason)
    excluding.value = null
    toast.success('已排除，这条仍留在列表里')
    // ⚠ refresh 不是 reload：在第三页上排一条，回到第一页就等于说「它不见了」
    await episodes.refresh()
  } catch (caught) {
    actionError.value = describeError(caught)
  } finally {
    busy.value = false
  }
}

async function restore(row: EpisodeRow): Promise<void> {
  const confirmed = await confirm.ask({
    title: '撤销排除',
    message: `「${row.started}」这次开机将重新计入训练数据，排除原因一并删除。`,
    confirmText: '撤销排除',
    danger: true,
  })
  if (!confirmed) return
  try {
    await hvac.deleteStartupExclusion(picker.roomId.value, row.id)
    toast.success('已撤销排除')
    await episodes.refresh()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

/**
 * 抽取前先说清这次要跑多大。
 * ⚠ 不是 danger：它不删东西，上一批次会一直服务到新的一批跑成。
 */
async function onRebuild(): Promise<void> {
  const range = { from: rebuildFrom.value, to: rebuildTo.value }
  if (rebuildRangeProblem(range) !== null) return
  const confirmed = await confirm.ask({
    title: '开始抽取',
    message: describeRebuild(range, batches.sourceRange.value),
    confirmText: '开始抽取',
  })
  if (!confirmed) return
  // ⚠ 留空的那端整个不发：省掉它才是「全部可用历史」，
  // 塞一个前端自己编的日期进去就把范围写死了
  const started = await batches.rebuild({
    ...(range.from === '' ? {} : { window_start: range.from }),
    ...(range.to === '' ? {} : { window_end: range.to }),
  })
  if (started === null) return
  // ⚠ 被夹过要说：用户填的那段比数据源实际有的宽时，真正跑的是收窄后的一段，
  // 不说的话他会以为自己要的范围抽全了
  toast.success(
    started.is_clamped
      ? '已排队抽取，区间已按数据源实际范围收窄'
      : '已排队抽取，完成前仍看上一批数据',
  )
}

watch(() => picker.roomId.value, reload)
watch([outcome, combination], () => void episodes.reload())
watch(serial, loadCurve)

onMounted(() => {
  void picker.loadWorkshops()
  void hvac.listAcDatasets().then((found) => (datasets.value = found))
})
</script>

<template>
  <AppShell title="开机事件" subtitle="每一次从全停到达标的过程，供人工核对">
    <div class="flex h-full min-h-0 flex-col gap-4">
      <StartupFilters
        :workshop-id="picker.workshopId.value"
        :workshop-options="picker.workshopOptions.value"
        :room-id="picker.roomId.value"
        :room-options="roomOptions"
        :outcome="outcome"
        :combination="combination"
        :coverage="batches.coverage.value"
        @update:workshop-id="picker.workshopId.value = $event"
        @update:room-id="picker.roomId.value = $event"
        @update:outcome="outcome = $event"
        @update:combination="combination = $event"
      />

      <DtNotice v-if="picker.error.value" intent="danger">
        {{ picker.error.value }}
      </DtNotice>
      <DtNotice v-else-if="picker.roomId.value === ''" intent="info">
        先选一个房间——开机事件是房间级的，不是某一台空调的。
      </DtNotice>

      <template v-else>
        <BatchStatusStrip
          :batch="batches.current.value"
          :is-stale="batches.isStale.value"
          :rebuilding="batches.rebuilding.value"
          :from="rebuildFrom"
          :to="rebuildTo"
          :source-range="batches.sourceRange.value"
          @rebuild="onRebuild"
          @update:from="rebuildFrom = $event"
          @update:to="rebuildTo = $event"
        />
        <DtNotice v-if="batches.error.value" intent="danger">
          {{ batches.error.value }}
        </DtNotice>

        <!-- 左右分栏：组合列表在左、事件在右，各自在自己那栏里滚。
             ⚠ 两边都要 min-h-0，少一个就不是滚动而是把整页撑长，
             而 AppShell 的 main 是 overflow-hidden，撑出去的部分够不着。 -->
        <div class="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <CoverageSidebar
            class="max-h-64 shrink-0 lg:max-h-none lg:w-72"
            :items="batches.coverage.value"
            :selected="combination"
            @select="combination = $event"
          />

          <EpisodeTable
            :rows="rows"
            :loading="episodes.loading.value"
            :page="episodes.pageNumber.value"
            :has-prev="episodes.hasPrev.value"
            :has-next="episodes.hasNext.value"
            :error="episodes.problem.value"
            @prev="episodes.prev"
            @next="episodes.next"
            @retry="episodes.reload"
            @inspect="onInspect"
            @exclude="excluding = $event"
            @restore="restore"
          />
        </div>
      </template>
    </div>

    <!-- 填原因的弹窗同样是写操作那一档 -->
    <PermGuard :codes="[PERMISSION_CODES.acManage]">
      <ExclusionDialog
        :model-value="excluding !== null"
        :started-at="excluding?.started ?? ''"
        :busy="busy"
        :error="actionError"
        @update:model-value="excluding = null"
        @submit="submitExclusion"
      />
    </PermGuard>

    <EpisodeCurveDialog
      :model-value="inspecting !== null"
      :row="inspecting"
      :units="roomUnits"
      :serial="serial"
      :options="curveOptions"
      :series="curve.series.value"
      :loading="curve.loading.value"
      :error="curve.error.value"
      @update:model-value="inspecting = null"
      @update:serial="serial = $event"
    />
  </AppShell>
</template>
