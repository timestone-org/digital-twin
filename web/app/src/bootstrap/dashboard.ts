/**
 * @fileoverview 大屏子系统的启动装配：注册内置模块、登记配置控件、把三类素材引用（图片 /
 * 模型 / 图标）各自接到取回地址上、装配取数 provider。
 *
 * ⚠ WS 客户端留在应用壳（它要读登录态），provider 只收一个**注入的订阅函数**——
 * 这正是 `@dt/datasources` 不自己建连接、也因此能在测试里跑假件的那条缝
 * （docs/DASHBOARD_DESIGN.md §7）。
 * ⚠ 模块注册只做一次：`registerBuiltinModules` 里的 glob 是 eager 的，
 * 重复调用不会出错但会把同一份清单反复覆盖，告警槽里就多出一串噪音。
 * ⚠ 模型地址解析必须走深路径 `@dt/three-core/host`：桶文件第一行就静态依赖
 * 整个 three，从桶进来会把 three 拖进首屏 chunk（startup-graph 契约测试守着）。
 */
import type { HistoryQuery, HistoryResult } from '@dt/contracts'
import {
  createComputedProvider,
  createDatasetProvider,
  createHistoryProvider,
  createRealtimeProvider,
  createStaticProvider,
  registerProvider,
} from '@dt/datasources'
import { configureAssetImages, registerBuiltinModules } from '@dt/modules'
import { configureTwinModelHost } from '@dt/three-core/host'
import { configureTwin2dAssets } from '@dt/twin2d'
import { assetUrl, modelVariantUrl } from '@dt/contracts'

import { ASSET_BASE_URL } from '@/config/app'

import { installConfigControls } from '@/features/dashboard/configControls'
import type { SubscribePoints } from '@/runtime/pointStream'

/** 应用壳注入给大屏子系统的口子。 */
export interface DashboardRuntimePorts {
  /**
   * 订阅当前大屏主题上的点位推送。
   * ⚠ 不注入时不装实时 provider：`opcua` 绑定如实显示为无实时数据，而不是
   * 假装订阅成功。公开页**注入**它（凭据是公开令牌，ADR-0021），只有独立
   * 渲染与用例走「不注入」这条。
   */
  subscribe?: SubscribePoints
  /**
   * 读一段历史序列。
   * ⚠ 不注入时 `archive` 绑定一律拒绝取数：拿实时通道里收到过的那几个点
   * 冒充历史，会画出一条从打开页面才开始的假曲线。
   */
  fetchHistory?: (query: HistoryQuery) => Promise<HistoryResult>
  /**
   * 读一段台账序列。
   * ⚠ 与 `fetchHistory` 分开注入而不是共用一个：两者打的是不同的端点，
   * 身份串的形状也不同（点位是 `{sourceId}:{pointCode}`，台账是
   * `ds:{code}:{列key}`）。合成一个就得在里面按前缀分派，那是把路由塞进
   * 取数函数里。
   */
  fetchDatasetSeries?: (query: HistoryQuery) => Promise<HistoryResult>
}

let modulesInstalled = false

/** 注册内置模块与配置控件；重复调用只做第一次。 */
export function installDashboardModules(): void {
  if (modulesInstalled) return
  modulesInstalled = true
  registerBuiltinModules()
  installConfigControls()
  installTwinModelHost()
  installAssetImages()
  installTwin2dAssets()
}

/**
 * 告诉模块怎么把 `asset:<uuid>` 变成一张能取回的图。
 * ⚠ 三张大屏页（编辑 / 查看 / 公开）都从这里进，漏装一处的表现是那一页上图片模块
 * 全空、而配置与另外两页一字不差。
 */
function installAssetImages(): void {
  configureAssetImages((ref) => assetUrl(ASSET_BASE_URL, 'image', ref))
}

/**
 * 告诉 2D 孪生怎么把两处素材引用变成能取回的地址。
 * ⚠ 两条分开而不是共用一条：`assetUrl` 的 `kind` 决定对象键前缀（图标是
 * `icons/<id>`、画布底图是 `images/<id>`），一条服务两种时装错的表现是**图标 404**
 * ——碎图或空白，零报错，而图上其余部分一切照常（ADR-0015 四、§11.4）。
 * ⚠ 编辑器页也从这里进（子编辑器自己调 `installDashboardModules`）：漏装的表现是
 * 那一页上图标与底图全空，而配置与另外几页一字不差。
 */
function installTwin2dAssets(): void {
  configureTwin2dAssets({
    resolveIcon: (ref) => assetUrl(ASSET_BASE_URL, 'icon', ref),
    resolveImage: (ref) => assetUrl(ASSET_BASE_URL, 'image', ref),
  })
}

/**
 * 告诉 3D 宿主怎么把 `asset:<uuid>` 变成一个能 fetch 的地址。
 * ⚠ 不装它的话 `resolveModelUrl` 恒回空串——孪生模块**永远加载不出模型**，
 * 而画布上显示的是一句「模型地址解析失败」，看着像素材坏了。
 */
function installTwinModelHost(): void {
  configureTwinModelHost({
    resolveModelUrl: (ref, variant) =>
      modelVariantUrl(ASSET_BASE_URL, ref, variant),
  })
}

/**
 * 装配五种取数来源。
 * ⚠ 每次打开一张大屏都要重装：`subscribe` 闭包里绑着当前那张屏的主题，
 * 沿用上一张的会让新屏订到旧主题上——连接是通的、数据永远不来。
 * @param ports 应用壳注入的订阅与历史取数
 */
export function installDashboardDataSources(
  ports: DashboardRuntimePorts,
): void {
  const { subscribe } = ports
  if (subscribe !== undefined) {
    registerProvider(createRealtimeProvider({ subscribe }))
  }
  registerProvider(createStaticProvider())
  registerProvider(createComputedProvider())
  if (ports.fetchHistory !== undefined) {
    registerProvider(
      createHistoryProvider({ fetchHistory: ports.fetchHistory }),
    )
  }
  if (ports.fetchDatasetSeries !== undefined) {
    registerProvider(
      createDatasetProvider({ fetchSeries: ports.fetchDatasetSeries }),
    )
  }
}

/** 只给测试用：让「模块只注册一次」这条判定回到初始状态。 */
export function __resetDashboardBootstrap(): void {
  modulesInstalled = false
}
