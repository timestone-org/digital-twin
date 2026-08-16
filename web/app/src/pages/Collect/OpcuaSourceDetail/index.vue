<script setup lang="ts">
/**
 * @fileoverview 一个采集数据源的详情：点位表与地址空间两个分区。
 *
 * ⚠ 页顶要同时说清「配置说它该采」与「它此刻真在采」：只显示一个状态灯，
 * 停用的源与连不上的源在界面上就分不开，而两者的处置完全不同。
 *
 * ⚠ 运行态按周期重取：它来自采集侧写的另一张表，没有推送通道。周期到了才刷，
 * 所以这一页上的状态最迟落后一个周期——够用，且不给库添无谓的压力。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import type { CollectSource } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtPageState, DtTag, useToast } from '@dt/ui'

import * as collect from '@/api/collect'
import PermGuard from '@/components/PermGuard.vue'
import type { AppTabItem } from '@/components/layout'
import { AppShell, AppTabNav } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import SourceStateTag from '../OpcuaSources/components/SourceStateTag.vue'
import { errorSummary } from '../OpcuaSources/sourceState'

/** 运行态重取周期。 */
const REFRESH_MS = 10_000

const route = useRoute()
const toast = useToast()
const raced = useRacedFetch()

const sourceId = computed(() => String(route.params.sourceId ?? ''))
const source = ref<CollectSource | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const testing = ref(false)

/** 两个分区是子路由，页签因此是真链接：可收藏、可中键新开、后退可用。 */
const tabs = computed<AppTabItem[]>(() => {
  const base = `/collect/opcua/${sourceId.value}`
  return [
    { key: 'points', label: '点位', icon: 'table', to: `${base}/points` },
    {
      key: 'browse',
      label: '地址空间',
      icon: 'layout-grid',
      to: `${base}/browse`,
    },
  ]
})

const reason = computed(() =>
  source.value === null ? null : errorSummary(source.value.runtime),
)

async function load(): Promise<void> {
  loading.value = true
  await raced.run(() => collect.getSource(sourceId.value), {
    ok: (result) => {
      source.value = result
      error.value = null
    },
    fail: (caught) => {
      error.value = describeError(caught)
      source.value = null
    },
    settled: () => (loading.value = false),
  })
}

/** 连通性测试。⚠ 连不上也是成功返回，结论在 `is_reachable` 里。 */
async function test(): Promise<void> {
  const target = source.value
  if (target === null) return
  testing.value = true
  try {
    const result = await collect.testSource(target.id)
    if (result.is_reachable) toast.success('连得上')
    else toast.error(result.detail ?? '连不上')
    await load()
  } catch (caught) {
    toast.error(describeError(caught))
  } finally {
    testing.value = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void load()
  // ⚠ 卸载时必须清掉：不清的话切走的页面还在打接口并更新已经不在的状态
  timer = setInterval(() => void load(), REFRESH_MS)
})

onUnmounted(() => {
  if (timer !== null) clearInterval(timer)
  timer = null
})
</script>

<template>
  <AppShell
    :title="source?.name ?? '采集数据源'"
    subtitle="OPC UA 采集"
    back-to="/collect/opcua"
    back-label="返回数据源列表"
  >
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.collectOperate]">
        <DtButton
          v-if="source"
          size="sm"
          variant="outline"
          :loading="testing"
          @click="test"
        >
          连通性测试
        </DtButton>
      </PermGuard>
    </template>

    <DtPageState
      :loading="loading && source === null"
      :error="error"
      :empty="source === null && !loading && error === null"
      empty-title="数据源不存在"
      @retry="load"
    >
      <div v-if="source" class="flex h-full min-h-0 flex-col gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <SourceStateTag
            :runtime="source.runtime"
            :is-enabled="source.is_enabled"
          />
          <DtTag mono size="sm">{{ source.code }}</DtTag>
          <DtTag mono size="sm">{{ source.endpoint }}</DtTag>
          <DtTag size="sm">
            {{ source.read_mode === 'poll' ? '轮询' : '订阅' }}
            {{ source.poll_interval_ms }}ms
          </DtTag>
          <DtTag size="sm">
            配置 {{ source.point_count }} 个点位 · 采集侧挂着
            {{ source.runtime.point_count }} 个
          </DtTag>
          <DtTag v-if="reason" intent="danger" size="sm">{{ reason }}</DtTag>
        </div>

        <AppTabNav :items="tabs" label="数据源分区" />

        <div class="min-h-0 flex-1 overflow-hidden">
          <!-- ⚠ 两个分区组件都收 `source` 这一个 prop。写错 prop 名时
               typecheck 与 lint 双双放行，靠契约测试兜 -->
          <RouterView v-slot="{ Component }">
            <component :is="Component" :source="source" />
          </RouterView>
        </div>
      </div>
    </DtPageState>
  </AppShell>
</template>
