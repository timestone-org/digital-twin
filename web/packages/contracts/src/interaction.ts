/**
 * @fileoverview 节点联动契约：控件事件 → 显隐/互斥切换/弹窗/跨屏跳转。
 * 运行态与持久态严格分离——联动只改易失的运行时显隐，绝不写回节点配置；
 * 规则存大屏级 `chromeJson.interactions`。
 *
 * ⚠ 节点引用一律用 `nodeId`（画布节点 id，前端创建时生成、永不再变，ADR-0012）。
 * 不引入第二套编辑期键：id 稳定是这套契约的地基，再造一个键只会多一处能错位的地方。
 * 也别与 `nodeKey` 混淆——那是采集点位的身份，不是画布节点。
 */

/** 控件能上抛的事件名。 */
export const INTERACTION_EVENTS = ['click', 'change', 'select'] as const
export type InteractionEventName = (typeof INTERACTION_EVENTS)[number]

/** 控件上抛的一次交互事件。 */
export interface InteractionEvent {
  event: InteractionEventName
  /** 携带值，如分段切换选中的 `item.key`。 */
  value?: unknown
}

/** show/hide/toggle：对一组目标节点改运行时显隐。 */
export interface InteractionShowAction {
  type: 'show' | 'hide' | 'toggle'
  /** 目标节点 id。 */
  targets: string[]
}

/** setActive：互斥切换组——选中值命中的组显示、其余组隐藏。 */
export interface InteractionSetActiveAction {
  type: 'setActive'
  groups: { value: string; targets: string[] }[]
}

/**
 * openModal：把某个节点连同整棵子树浮起为弹窗。
 * 不带任何内容字段——弹窗内容的单一真源永远是画布上那个节点，
 * 不会出现「联动面板里配了一套、画布上摆了另一套」的分裂。
 * 目标节点通常设为初始不可见，否则屏上与弹窗里各画一份。
 */
export interface InteractionOpenModalAction {
  type: 'openModal'
  /** 弹窗内容根节点 id。 */
  target: string
  /** 留空 = 不渲染标题栏，只留关闭按钮。 */
  title?: string
}

/** closeModal：关闭当前弹窗。弹窗自带关闭键/Esc/点遮罩，不配这条也关得掉。 */
export interface InteractionCloseModalAction {
  type: 'closeModal'
}

/**
 * 跳到哪张大屏。**登录态是大屏 id，公开态是目标屏的公开令牌**——
 * 含义由渲染这棵树的宿主决定，联动引擎只搬运不解释。
 *
 * ⚠ 它**不是 URL**：能配任意地址的大屏等于一个站内跳板（开放重定向），
 * 与路由守卫 `safeReturnTarget` 只放行站内相对路径是同一个理由。
 * ⚠ 也不许拿它跟当前大屏 id 比对——那样公开态那条路（句柄是令牌）就再也接不上。
 */
export type DashboardHandle = string

/**
 * navigate：离开本屏，跳到另一张大屏。
 * ⚠ 这是唯一一档**跨文档**的动作：同一条事件上再配显隐类动作没有意义，页面都换了。
 */
export interface InteractionNavigateAction {
  type: 'navigate'
  target: DashboardHandle
}

/**
 * navigateByValue：按控件上抛的值分流跳转（一块卡片六个指标，各进各的明细屏）。
 *
 * 形状照 `setActive` 的 `groups` 抄：那是本仓已有的「按值分派」口径，
 * 再造一套只会让两处的空值语义各漂各的。
 * ⚠ **没带值的事件一律不跳**：整块可点的模块（`hostClickable`）上抛的 click
 * 是没有 value 的，不挡的话它会命中「值留空」的那条路由，表现成随手点一下就换屏。
 * ⚠ 同一个 value 出现两次时取**第一条**命中，后面那条永远不生效——编辑面要能看出重复。
 */
export interface InteractionNavigateByValueAction {
  type: 'navigateByValue'
  routes: { value: string; target: DashboardHandle }[]
}

export type InteractionAction =
  | InteractionShowAction
  | InteractionSetActiveAction
  | InteractionOpenModalAction
  | InteractionCloseModalAction
  | InteractionNavigateAction
  | InteractionNavigateByValueAction

/** 一条联动规则。 */
export interface InteractionRule {
  id: string
  source: {
    /** 事件源节点 id。 */
    nodeId: string
    event: InteractionEventName
  }
  action: InteractionAction
}
