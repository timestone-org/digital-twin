<script setup lang="ts">
/**
 * @fileoverview 公开大屏：拿链接就能看，不需要登录。
 *
 * ⚠ 这一页渲染的是**静态快照**，不接实时推送（ADR-0014 四）。右下角那条
 * 「数据截止」必须一直在：一个看起来在跑、实际停在某一刻的大屏，比一个明说
 * 自己是快照的大屏危险得多。要摘它请先把匿名订阅通道做出来。
 */
import { getModule, listModules } from '@dt/modules'
import type { ModuleManifest } from '@dt/contracts'
import {
  NodeTree,
  buildNodeTree,
  mergeCardChrome,
  computeStageGeometry,
  type GetModuleManifest,
} from '@dt/runtime'
import { DtPageState } from '@dt/ui'
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  type CSSProperties,
} from 'vue'
import { useRoute } from 'vue-router'

import { getPublicDashboard } from '@/api/dashboardShare'
import type { PublicDashboardPayload } from '@dt/contracts'
import {
  installDashboardDataSources,
  installDashboardModules,
} from '@/bootstrap/dashboard'
import { describeError } from '@/composables/useAsyncList'
import { useDashboardValues } from '@/composables/useDashboardValues'
import { formatDateTime } from '@/utils/datetime'

const route = useRoute()

// 匿名快照页同样要自己装配模块；取数只装 static/computed——公开页不接实时
// 也不接历史（ADR-0014），`opcua` 绑定如实显示为无数据
installDashboardModules()
installDashboardDataSources({})

const getManifest: GetModuleManifest = (moduleType: string) =>
  listModules().some((item: ModuleManifest) => item.type === moduleType)
    ? getModule(moduleType)
    : undefined

const dashboard = ref<PublicDashboardPayload | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const nodes = computed(() => dashboard.value?.nodes ?? [])
// 没装实时 provider 时它只注入读取器不订阅，static 绑定照常出值
useDashboardValues(() => nodes.value)
const tree = computed(() => buildNodeTree(nodes.value, getManifest))

// 大屏级卡片外观缺省；模块级覆盖由渲染宿主自己读 config.__cardStyle
const cardChrome = computed(() =>
  mergeCardChrome(dashboard.value?.chromeJson.card, null),
)

const design = computed(() => ({
  width: dashboard.value?.designWidth ?? 0,
  height: dashboard.value?.designHeight ?? 0,
}))

const viewport = ref({ width: 0, height: 0 })
const stage = computed(() => computeStageGeometry(viewport.value, design.value))

const stageStyle = computed<CSSProperties>(() => ({
  width: `${design.value.width}px`,
  height: `${design.value.height}px`,
  transform: `translate(${stage.value.offsetX}px, ${stage.value.offsetY}px) scale(${stage.value.scale})`,
  transformOrigin: 'top left',
}))

const host = ref<HTMLElement | null>(null)
let observer: ResizeObserver | null = null
let inflight: AbortController | null = null

function publicToken(): string {
  const raw = route.params.publicToken
  if (Array.isArray(raw)) return raw[0] ?? ''
  return raw ?? ''
}

async function load(): Promise<void> {
  const token = publicToken()
  if (token === '') return
  inflight?.abort()
  const controller = new AbortController()
  inflight = controller
  loading.value = true
  error.value = null
  try {
    dashboard.value = await getPublicDashboard(token, controller.signal)
  } catch (caught) {
    if (controller.signal.aborted) return
    // 令牌查不到与已撤回是同一个 404，文案不区分——区分等于告诉持链接的人
    // 「这张屏确实存在过」
    error.value = describeError(caught)
  } finally {
    if (!controller.signal.aborted) loading.value = false
  }
}

onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect
    if (box) viewport.value = { width: box.width, height: box.height }
  })
  if (host.value) observer.observe(host.value)
  void load()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  inflight?.abort()
})
</script>

<template>
  <div
    ref="host"
    class="relative h-screen w-screen overflow-hidden bg-surface-base"
  >
    <DtPageState
      v-if="loading || error"
      :loading="loading"
      :error="error"
      :empty="false"
      @retry="load"
    />

    <template v-else-if="dashboard">
      <div :style="stageStyle">
        <NodeTree
          :nodes="tree.roots"
          :design="design"
          :get-manifest="getManifest"
          :card-chrome="cardChrome"
        />
      </div>

      <!-- 见文件头：这条不许摘 -->
      <p
        class="pointer-events-none absolute bottom-3 right-4 m-0 rounded-sm bg-surface-overlay/70 px-2 py-1 text-2xs text-text-disabled backdrop-blur-sm"
      >
        静态快照 · 数据截止 {{ formatDateTime(dashboard.updatedAt) }}
      </p>
    </template>
  </div>
</template>
