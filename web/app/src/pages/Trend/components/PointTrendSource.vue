<script setup lang="ts">
/**
 * @fileoverview 趋势分析页的「点位历史」源：搜点位、筛点位、勾几个、画一段读数。
 *
 * ⚠ 已勾的点位一直留在清单最前面，不随搜索结果消失：它掉出清单时图上那条线
 * 还在，用户会以为自己已经取消了勾选。
 * ⚠ 清单只列一页，列不下的必须**说出来**：现场一个数据源上百个点位，不说的话
 * 用户会以为看到的就是全部，然后在清单里找一个明明存在的点位怎么也找不到。
 * ⚠ 点位历史触顶时留下的是**最早**那一批（取数从窗口起点往后翻页），与台账
 * 序列正好相反，故这一面的截断提示说的是「更晚的那一段没画」。
 */
import { computed, onMounted, onUnmounted } from 'vue'

import { DtButton, DtIcon, DtInput, DtNotice, DtSwitch } from '@dt/ui'

import TrendSurface from '@/components/trend/TrendSurface.vue'
import { POINT_PICKER_PAGE_SIZE } from '@/composables/usePointPicker'
import { usePointTrend } from '../scripts/usePointTrend'

const trend = usePointTrend()

/** 清单底下那一句：一共几个、这一页列了几个。 */
const listNote = computed(() => {
  if (trend.picker.error.value !== null) return ''
  const total = trend.picker.total.value
  if (total === 0) return ''
  if (!trend.picker.hasMore.value) return `共 ${total} 个点位。`
  return `共 ${total} 个点位，这里只列了前 ${POINT_PICKER_PAGE_SIZE} 个，用关键字缩小范围。`
})

const footnote = computed(() =>
  trend.pointCount.value > 0 ? `共 ${trend.pointCount.value} 个数据点。` : '',
)

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
