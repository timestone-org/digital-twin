<script setup lang="ts">
/**
 * @fileoverview 趋势分析：点位历史与数据台账的曲线在同一页里看。
 *
 * ⚠ 两个源的读码互不蕴含——点位历史读的是采集面（`collect:view`），台账读的是
 * `dataset:view`。路由按两者的**下界**放行（任一即可），只有一个码的账号在这里
 * 看得到自己那一半，而不是被整页挡在门外。
 * ⚠ 地址里的预选只在这里读一次，且走 `readTrendDeepLink()`：键名的字面量归
 * `features/trend/trendLink.ts` 独占，两端各写一份时写歪了不报错，只是跳过来
 * 什么都没预选中（features/trend/trendLink.ts）。
 */
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { PERMISSION_CODES } from '@dt/contracts'
import type { DtSegmentedOption } from '@dt/contracts'
import { DtEmpty, DtSegmented } from '@dt/ui'

import { AppShell } from '@/components/layout'
import { readTrendDeepLink } from '@/features/trend/trendLink'
import { useAuthStore } from '@/stores/auth'
import DatasetTrendSource from './components/DatasetTrendSource.vue'
import PointTrendSource from './components/PointTrendSource.vue'

const route = useRoute()
const auth = useAuthStore()

const deepLink = readTrendDeepLink(route.query)

const canReadPoints = computed(() => auth.can([PERMISSION_CODES.collectView]))
const canReadDatasets = computed(() => auth.can([PERMISSION_CODES.datasetView]))

const options = computed<DtSegmentedOption[]>(() => [
  ...(canReadPoints.value
    ? [{ value: 'point', label: '点位历史', icon: 'activity' }]
    : []),
  ...(canReadDatasets.value
    ? [{ value: 'dataset', label: '数据台账', icon: 'table' }]
    : []),
])

/**
 * 一进来看哪一面：深链说了算，深链要的那一面没权限就落到看得见的那一面。
 * ⚠ 类型是 string 不是联合：DtSegmented 发出来的是 string，收窄了过不了类型闸。
 */
const source = ref<string>(
  deepLink.source === 'dataset' && canReadDatasets.value
    ? 'dataset'
    : (options.value[0]?.value ?? 'dataset'),
)
</script>

<template>
  <AppShell title="趋势分析" subtitle="点位历史 · 数据台账">
    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtSegmented
        v-if="options.length > 1"
        :model-value="source"
        :options="options"
        variant="tabs"
        aria-label="数据源"
        @update:model-value="source = $event"
      />

      <PointTrendSource v-if="source === 'point' && canReadPoints" />
      <DatasetTrendSource
        v-else-if="source === 'dataset' && canReadDatasets"
        :initial-table-id="deepLink.tableId"
      />
      <DtEmpty
        v-else
        icon="chart-line"
        title="没有可看的数据源"
        hint="要看点位历史需要采集的查看权限，要看台账需要数据台账的查看权限。"
      />
    </div>
  </AppShell>
</template>
