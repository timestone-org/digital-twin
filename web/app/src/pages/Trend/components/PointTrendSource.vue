<script setup lang="ts">
/**
 * @fileoverview 趋势分析页的「点位历史」源：搜点位、筛点位、勾几个、画一段读数。
 *
 * ⚠ 已勾的点位一直留在清单最前面，不随搜索结果消失：它掉出清单时图上那条线
 * 还在，用户会以为自己已经取消了勾选。
 * ⚠ 清单只列一页，列不下的必须**说出来**：现场一个数据源上百个点位，不说的话
 * 用户会以为看到的就是全部，然后在清单里找一个明明存在的点位怎么也找不到。
 */
import { computed, onMounted, onUnmounted } from 'vue'

import { COLLECT_AGGREGATES } from '@dt/contracts'
import type { DtSelectOption } from '@dt/contracts'
import { DtButton, DtIcon, DtInput, DtNotice, DtSelect, DtSwitch } from '@dt/ui'

import TrendSurface from '@/components/trend/TrendSurface.vue'
import { POINT_PICKER_PAGE_SIZE } from '@/composables/usePointPicker'
import { trendBucketChoices } from '@/features/trend/trendBucket'
import { resolveTrendRange } from '@/features/trend/trendRange'
import { usePointTrend } from '../scripts/usePointTrend'

/** 各档折算的说法。⚠ 与 `COLLECT_AGGREGATES` 一一对应，少一条就是下拉里少一项。 */
const AGGREGATE_LABELS: Record<string, string> = {
  avg: '平均值',
  max: '最大值',
  min: '最小值',
  sum: '求和',
  count: '样本数',
}

const trend = usePointTrend()

const aggregateOptions: readonly DtSelectOption[] = COLLECT_AGGREGATES.map(
  (value) => ({ value, label: AGGREGATE_LABELS[value] ?? value }),
)

/**
 * 当前时间范围下选得动的取点间隔。
 * 太细的那几档禁掉而不是藏掉：藏掉会让人以为这个软件就只看得到这么细，而
 * 实际上把时间范围缩小一点就选得上了。
 */
const intervalOptions = computed<DtSelectOption[]>(() => {
  const window = resolveTrendRange(trend.range.value).window
  const span = window === null ? 0 : window.toMs - window.fromMs
  return trendBucketChoices(span).map((one) => ({
    value: one.value,
    label: one.label,
    disabled: one.isTooFine,
  }))
})

/** 清单底下那一句：一共几个、这一页列了几个。 */
const listNote = computed(() => {
  if (trend.picker.error.value !== null) return ''
  const total = trend.picker.total.value
  if (total === 0) return ''
  if (!trend.picker.hasMore.value) return `共 ${total} 个点位。`
  return `共 ${total} 个点位，这里只列了前 ${POINT_PICKER_PAGE_SIZE} 个，用关键字缩小范围。`
})

/** 图底下那一句：这次按多粗的格子画的，以及空格是怎么补的。 */
const footnote = computed(() => {
  const bucket = trend.bucket.value
  if (bucket === null) return ''
  return (
    `曲线按 ${bucket.label} 一格折算过，画的不是逐条原始读数。` +
    '没有新读数的格子保持上一个值（订阅模式下那就是「值没变」）；' +
    '超过该点位的归档心跳还没有读数，才画成断档。'
  )
})

onMounted(() => {
  void trend.picker.search()
})

onUnmounted(trend.dispose)
</script>

<template>
  <TrendSurface
    :items="trend.items.value"
    :selected="trend.selected.value"
    :series="trend.series.value"
    :loading="trend.loading.value"
    :dirty="trend.dirty.value"
    :truncation="trend.truncation.value"
    :failure="trend.failure.value"
    :range="trend.range.value"
    :footnote="footnote"
    blank-hint="换个关键字搜搜看；只有开了「记录历史」的点位才画得出曲线。"
    @toggle="trend.toggle($event)"
    @clear="trend.clear()"
    @query="trend.query()"
    @update:range="trend.range.value = $event"
  >
    <template #options>
      <div class="w-36">
        <DtSelect
          :model-value="trend.interval.value"
          :options="intervalOptions"
          label="取点间隔"
          size="sm"
          @update:model-value="trend.interval.value = $event"
        />
      </div>
      <div class="w-28">
        <DtSelect
          :model-value="trend.aggregate.value"
          :options="aggregateOptions"
          label="折算"
          size="sm"
          @update:model-value="trend.aggregate.value = $event"
        />
      </div>
    </template>

    <template #filters>
      <DtInput
        v-model="trend.picker.keyword.value"
        size="sm"
        label="找点位"
        placeholder="按名称或编码搜索，回车"
        @enter="trend.picker.search()"
      >
        <template #leading><DtIcon name="search" :size="14" /></template>
      </DtInput>

      <div class="flex items-center justify-between gap-2">
        <DtSwitch
          :model-value="trend.drawableOnly.value"
          size="sm"
          label="只看记录历史的"
          @update:model-value="trend.drawableOnly.value = $event"
        />
        <DtButton
          variant="ghost"
          intent="neutral"
          size="xs"
          icon="search"
          :loading="trend.picker.loading.value"
          @click="trend.picker.search()"
        >
          搜索
        </DtButton>
      </div>

      <DtNotice
        v-if="trend.picker.error.value"
        intent="danger"
        icon="alert-circle"
      >
        {{ trend.picker.error.value }}
      </DtNotice>
      <p v-else-if="listNote" class="text-xs text-text-disabled">
        {{ listNote }}
      </p>
    </template>
  </TrendSurface>
</template>
