<script setup lang="ts">
/**
 * @fileoverview 公开大屏：拿链接就能看，不需要登录。
 *
 * 实时值与联动都跑（ADR-0021）：
 * - 取数走 WS，凭据是地址里那个公开令牌，订的是它换来的**别名**主题——
 *   真主题（`dashboard:{id}`）一个字都不出门（ADR-0014）。
 * - 联动引擎照装，跨屏跳转的句柄在服务端已经改写成目标屏的公开令牌；
 *   跳不到的规则压根不下发，所以这里不必再判「目标存不存在」。
 *
 * ⚠ 右下角那条状态必须一直在，且必须说实话：通道连着就说「实时」，没连上就
 * 说「静态快照 + 数据截止」。一个看起来在跑、实际停在某一刻的大屏，比一个明说
 * 自己是快照的大屏危险得多（runtime-resilience「返回陈旧数据必须标注为陈旧」）。
 */
import { getModule, listModules } from '@dt/modules'
import type { ModuleManifest } from '@dt/contracts'
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
import { DtPageState, DtSpinner } from '@dt/ui'
import {
  computed,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  watch,
  type CSSProperties,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  installDashboardDataSources,
  installDashboardModules,
} from '@/bootstrap/dashboard'
import RealtimeOfflineNotice from '@/components/RealtimeOfflineNotice.vue'
import { useDashboardValues } from '@/composables/useDashboardValues'
import {
  closeRealtimeChannel,
  usePublicRealtimeChannel,
} from '@/composables/useRealtimeChannel'
import { boundPointKeys } from '@/features/dashboard/editorDoc'
import { parseInteractionRules } from '@/features/dashboard/interactionRules'
import { publicTopic } from '@/runtime/pointFrames'
import { createPointSubscribe } from '@/runtime/pointStream'
import { formatDateTime } from '@/utils/datetime'

import { usePublicDashboardDoc } from './scripts/usePublicDashboardDoc'

const route = useRoute()
const router = useRouter()

function publicToken(): string {
  const raw = route.params.publicToken
  if (Array.isArray(raw)) return raw[0] ?? ''
  return raw ?? ''
}

// 匿名页同样要自己装配模块：直连本路由时没有任何别的页面替它注册过，
// 不装的话每一格都是「未知模块类型」，且没有报错
installDashboardModules()

// ⚠ 必须在装取数之前先把凭据交给通道：`useRealtimeChannel()` 一被调用就去连，
// 而凭据在那一刻定死。晚一步就是一条没有凭据、于是根本没建立的连接
const channel = usePublicRealtimeChannel(publicToken())

// ⚠ 不装历史 provider：公开面没有历史端点，`archive` 绑定如实显示为没有数据。
// 拿实时通道里收到过的那几个点冒充历史，会画出一条从打开页面才开始的假曲线
installDashboardDataSources({
  subscribe: createPointSubscribe(channel, () => {
    const token = publicToken()
    return token === '' ? null : publicTopic(token)
  }),
})

const getManifest: GetModuleManifest = (moduleType: string) =>
  listModules().some((item: ModuleManifest) => item.type === moduleType)
    ? getModule(moduleType)
    : undefined

const doc = usePublicDashboardDoc()
const nodes = computed(() => doc.dashboard.value?.nodes ?? [])

// 地址栏里换一张屏（联动跳转）也要重来一遍：文档要重取，通道也要换票据重连。
// ⚠ 这条 watch 必须排在 `useDashboardValues` **之前**：watch 按创建顺序跑，
// 排在后面的话，取数那一侧会先拿新屏的别名去订**上一条**连接（它的授权是上一
// 枚票据），白挨一次拒绝
watch(
  () => publicToken(),
  (token) => {
    if (token === '') return
    usePublicRealtimeChannel(token)
    void doc.load(token)
  },
  { immediate: true },
)

// 这一页的「哪张屏」就是地址里那个令牌——公开面没有大屏 id（ADR-0014）
const values = useDashboardValues(
  () => nodes.value,
  () => publicToken(),
)
// 这张屏到底有没有实时绑定。⚠ 没有的话不许说「实时」：通道连着与画面上的
// 数字是活的，是两件事
const hasLiveBindings = computed(() => boundPointKeys(nodes.value).length > 0)
const tree = computed(() => buildNodeTree(nodes.value, getManifest))

// 大屏级卡片外观缺省；模块级覆盖由渲染宿主自己读 config.__cardStyle
const cardChrome = computed(() =>
  mergeCardChrome(doc.dashboard.value?.chromeJson.card, null),
)

/**
 * 跨屏跳转：公开态的句柄就是**目标屏的公开令牌**，服务端已经改写好了。
 * ⚠ 自跳挡在这里而不是引擎里：`push` 到同一路由既不重载也不报错，
 * 表现正好是「点了没反应」（`DashboardView` 同口径）。
 */
function goToDashboard(handle: string): void {
  if (handle === '' || handle === publicToken()) return
  void router.push({
    name: 'public-dashboard',
    params: { publicToken: handle },
  })
}

// 联动引擎：规则来自 chromeJson，节点表一换整套易失态清零重放
const interaction = createInteractionRuntime({ navigate: goToDashboard })
provide(INTERACTION_KEY, interaction)
watch(
  () => doc.dashboard.value,
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
  width: doc.dashboard.value?.designWidth ?? 0,
  height: doc.dashboard.value?.designHeight ?? 0,
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

/**
 * 右下角那条状态。⚠ 各档分开说，别合并：合并之后总有一档在说谎。
 * 「实时」= 有实时绑定且通道连着；「已断开」= 收到过实时值但通道断了
 * （数值停在断开前，详情由角标那条讲）；「静态快照」= 画面就是文档里的那份。
 */
function describeStatus(): string {
  if (hasLiveBindings.value) {
    if (channel.isConnected.value) return '实时数据'
    if (values.sampleCount.value > 0) return '实时数据 · 已断开'
  }
  const at = doc.dashboard.value?.updatedAt
  return `静态快照 · 数据截止 ${at === undefined ? '未知' : formatDateTime(at)}`
}

const status = computed(describeStatus)

// ⚠ 被拒绝时去问一句「这张屏还公开吗」：撤回之后 hub 会断掉已经连着的匿名
// 连接，而页面若只闷头重连，看的人会以为只是网断了。重取一次快照，撤回了就
// 落到错误态说出来
watch(
  () => channel.isRejected.value,
  (isRejected) => {
    if (isRejected) void doc.load(publicToken())
  },
)

onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect
    if (box) viewport.value = { width: box.width, height: box.height }
  })
  if (host.value) observer.observe(host.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  doc.dispose()
  // ⚠ 离开公开页必须把通道连同票据一起收掉：留着的话回到登录态之后，
  // 下一次握手仍会报公开那条子协议，而那条连接看什么都被拒
  closeRealtimeChannel()
})
</script>

<template>
  <div
    ref="host"
    class="relative h-screen w-screen overflow-hidden bg-surface-base"
  >
    <!-- ⚠ 整屏的加载/错误态只留给「手上一张都没有」：跳转时把画面整片换掉，
         墙上每跳一次先白一下（`DashboardView` 同口径） -->
    <DtPageState
      v-if="doc.dashboard.value === null"
      :loading="doc.loading.value"
      :error="doc.error.value"
      :empty="false"
      @retry="doc.load(publicToken())"
    />

    <template v-else>
      <div data-test="public-stage" :style="stageStyle">
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
          :card-chrome="cardChrome"
          @close="interaction.closeModal"
        />
      </div>

      <!-- 换屏期间上一屏留在原地，所以必须说出来 -->
      <div
        v-if="doc.loading.value"
        data-test="public-switching"
        class="absolute right-4 top-4 flex items-center gap-2 rounded-md bg-surface-raised/80 px-3 py-1.5 text-xs text-text-secondary"
        role="status"
      >
        <DtSpinner :size="14" label="" />
        正在切换大屏…
      </div>

      <!-- 见文件头：这条不许摘 -->
      <p
        data-test="public-status"
        class="pointer-events-none absolute bottom-3 right-4 m-0 rounded-sm bg-surface-overlay/70 px-2 py-1 text-2xs text-text-disabled backdrop-blur-sm"
      >
        {{ status }}
      </p>
    </template>

    <!-- ⚠ 摆在别的角标之外：这条是故障告知，不是装饰。
         ⚠ 只在这张屏真有实时绑定时才摆：一张纯静态的公开屏上报「通道断了」，
         报的是一件与画面无关的事，看的人下次就不会再信它 -->
    <RealtimeOfflineNotice v-if="hasLiveBindings" />
  </div>
</template>
