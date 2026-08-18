<script setup lang="ts">
/**
 * @fileoverview 大屏运行态：整屏铺满、等比缩放、订阅实时值，不带任何编辑手柄。
 *
 * ⚠ 这一页刻意不套 AppShell：大屏是拿去投到墙上的，左边挂一条导航就废掉了
 * 设计尺寸的等比关系。返回入口做成悬浮的，鼠标不动时淡出。
 */
import type { ModuleManifest } from '@dt/contracts'
import { getModule, listModules } from '@dt/modules'
import {
  INTERACTION_KEY,
  NodeModal,
  NodeTree,
  buildNodeTree,
  mergeCardChrome,
  computeStageGeometry,
  createInteractionRuntime,
  type GetModuleManifest,
} from '@dt/runtime'
import { DtButton, DtPageState, DtSpinner } from '@dt/ui'
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type CSSProperties,
  provide,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { fetchPointHistory } from '@/api/pointHistories'
import {
  installDashboardDataSources,
  installDashboardModules,
} from '@/bootstrap/dashboard'
import { useDashboardDoc } from '@/composables/useDashboardDoc'
import { parseInteractionRules } from '@/features/dashboard/interactionRules'
import RealtimeOfflineNotice from '@/components/RealtimeOfflineNotice.vue'
import { useDashboardValues } from '@/composables/useDashboardValues'
import { useRealtimeChannel } from '@/composables/useRealtimeChannel'
import { dashboardTopic } from '@/runtime/pointFrames'
import { createPointSubscribe } from '@/runtime/pointStream'

// 鼠标停下多久之后把返回入口淡掉
const CHROME_IDLE_MS = 2400

const route = useRoute()
const router = useRouter()

// ⚠ 运行态页面必须自己装配：直连本路由时没有任何别的页面替它注册过模块，
// 不装的话每一格都是「未知模块类型」，且没有报错
installDashboardModules()

const getManifest: GetModuleManifest = (moduleType: string) =>
  listModules().some((item: ModuleManifest) => item.type === moduleType)
    ? getModule(moduleType)
    : undefined

const file = useDashboardDoc()

installDashboardDataSources({
  subscribe: createPointSubscribe(useRealtimeChannel(), () => {
    const current = file.dashboard.value
    return current === null ? null : dashboardTopic(current.id)
  }),
  fetchHistory: fetchPointHistory,
})

const nodes = computed(() => file.dashboard.value?.nodes ?? [])
// ⚠ 取当前**已加载**的那张屏而不是地址栏里的 id：切屏期间地址已经换了、文档还没到，
// 按地址走会让上一屏的画面配上新屏的订阅
useDashboardValues(
  () => nodes.value,
  () => file.dashboard.value?.id ?? '',
)

const tree = computed(() => buildNodeTree(nodes.value, getManifest))

// 大屏级卡片外观缺省；模块级覆盖由渲染宿主自己读 config.__cardStyle
const cardChrome = computed(() =>
  mergeCardChrome(file.dashboard.value?.chromeJson.card, null),
)

/**
 * 跨屏跳转：全仓只有这一处知道「怎么跳」——引擎只算出目标句柄。
 * ⚠ 自跳挡在这里而不是引擎里：`push` 到同一路由既不重载也不报错，
 * 表现正好是「点了没反应」，而引擎不该认识「当前是哪张屏」这件事。
 */
function goToDashboard(handle: string): void {
  if (handle === '' || handle === file.dashboard.value?.id) return
  void router.push({
    name: 'dashboard-view',
    params: { dashboardId: handle },
  })
}

// 联动引擎：规则来自 chromeJson，节点表一换整套易失态清零重放
const interaction = createInteractionRuntime({ navigate: goToDashboard })
provide(INTERACTION_KEY, interaction)
watch(
  () => file.dashboard.value,
  (current) => {
    interaction.init(
      current === null ? [] : parseInteractionRules(current.chromeJson),
      nodes.value.map((node) => ({
        nodeId: node.id,
        isVisible: node.isVisible,
      })),
    )
  },
  { immediate: true },
)

const design = computed(() => ({
  width: file.dashboard.value?.designWidth ?? 0,
  height: file.dashboard.value?.designHeight ?? 0,
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

const chromeVisible = ref(true)
let idleTimer: ReturnType<typeof setTimeout> | null = null

function keepChromeAwake(): void {
  chromeVisible.value = true
  if (idleTimer !== null) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    chromeVisible.value = false
  }, CHROME_IDLE_MS)
}

function dashboardId(): string {
  const raw = route.params.dashboardId
  if (Array.isArray(raw)) return raw[0] ?? ''
  return raw ?? ''
}

function back(): void {
  void router.push('/')
}

// 地址栏里换一张屏（联动的跨屏跳转）也要重新加载，不能只在挂载时取一次
watch(
  () => dashboardId(),
  (id) => {
    if (id !== '') void file.load(id)
  },
  { immediate: true },
)

onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect
    if (box) viewport.value = { width: box.width, height: box.height }
  })
  if (host.value) observer.observe(host.value)
  keepChromeAwake()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  if (idleTimer !== null) clearTimeout(idleTimer)
  file.dispose()
})
</script>

<template>
  <div
    ref="host"
    class="relative h-screen w-screen overflow-hidden bg-surface-base"
    @mousemove="keepChromeAwake"
  >
    <!-- ⚠ 整屏的加载/错误态只留给「手上一张都没有」：跨屏跳转时把画面整片换掉，
         墙上每跳一次先白一下。取数失败时 docIo 会把文档置空，于是照样落到这里 -->
    <DtPageState
      v-if="file.dashboard.value === null"
      :loading="file.loading.value"
      :error="file.error.value"
      :empty="false"
      @retry="file.load(dashboardId())"
    />

    <div v-else data-test="dashboard-stage" :style="stageStyle">
      <NodeTree
        :nodes="tree.roots"
        :design="design"
        :get-manifest="getManifest"
        :card-chrome="cardChrome"
      />
      <NodeModal
        v-if="interaction.activeModal.value"
        :nodes="nodes"
        :root-id="interaction.activeModal.value.nodeId"
        :title="interaction.activeModal.value.title"
        :design="design"
        :get-manifest="getManifest"
        @close="interaction.closeModal"
      />
    </div>

    <!-- 换屏期间上一屏留在原地，所以必须说出来：不声不响地留着，就成了
         「看起来在跑、实际停在上一张」。同样摆在 chrome 的淡出之外 -->
    <div
      v-if="file.loading.value && file.dashboard.value !== null"
      data-test="dashboard-switching"
      class="absolute right-4 top-4 flex items-center gap-2 rounded-md bg-surface-raised/80 px-3 py-1.5 text-xs text-text-secondary"
      role="status"
    >
      <DtSpinner :size="14" label="" />
      正在切换大屏…
    </div>

    <!-- ⚠ 摆在 chrome 的淡出之外：这条是故障告知，不是装饰 -->
    <RealtimeOfflineNotice />

    <div
      class="absolute left-4 top-4 transition-opacity duration-300"
      :class="chromeVisible ? 'opacity-100' : 'opacity-0'"
    >
      <DtButton size="sm" variant="soft" icon="chevron-left" @click="back">
        返回工作台
      </DtButton>
    </div>
  </div>
</template>
