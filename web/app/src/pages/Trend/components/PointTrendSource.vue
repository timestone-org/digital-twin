<script setup lang="ts">
/**
 * @fileoverview 趋势分析页的「点位历史」源：搜点位、勾几个、画一段读数。
 *
 * ⚠ 已勾的点位一直留在清单最前面，不随搜索结果消失：它掉出清单时图上那条线
 * 还在，用户会以为自己已经取消了勾选。
 * ⚠ 点位历史触顶时留下的是**最早**那一批（取数从窗口起点往后翻页），与台账
 * 序列正好相反，故这一面的截断提示说的是「更晚的那一段没画」。
 */
import { onMounted, onUnmounted } from 'vue'

import { DtButton, DtIcon, DtInput, DtNotice } from '@dt/ui'

import TrendSurface from '@/components/trend/TrendSurface.vue'
import { usePointTrend } from '../scripts/usePointTrend'

const trend = usePointTrend()

onMounted(() => {
  void trend.picker.search()
})

onUnmounted(trend.dispose)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <div class="flex flex-wrap items-end gap-2">
      <div class="w-72">
        <DtInput
          v-model="trend.picker.keyword.value"
          size="sm"
          label="找点位"
          placeholder="按名称或编码搜索"
          @enter="trend.picker.search()"
        >
          <template #leading><DtIcon name="search" :size="14" /></template>
        </DtInput>
      </div>
      <DtButton
        variant="outline"
        intent="neutral"
        size="sm"
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

    <TrendSurface
      :items="trend.items.value"
      :selected="trend.selected.value"
      :series="trend.series.value"
      :loading="trend.loading.value"
      :dirty="trend.dirty.value"
      :truncation="trend.truncation.value"
      :failure="trend.failure.value"
      :range="trend.range.value"
      blank-hint="换个关键字搜搜看；只有开了「记录历史」的点位才画得出曲线。"
      @toggle="trend.toggle($event)"
      @query="trend.query()"
      @update:range="trend.range.value = $event"
    />
  </div>
</template>
