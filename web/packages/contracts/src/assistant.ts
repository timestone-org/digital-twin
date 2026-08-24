/**
 * @fileoverview AI 助手的对外类型，与 ai-assistant 的 openapi.json 逐字段对齐。
 *
 * ⚠ 字段名保持后端的 snake_case（与采集那组同源）：这一层是线形，
 * 换成驼峰就要多一份映射，而映射写错时 typecheck 与 lint 双双放行。
 */

/** 助手所处的页面。与后端的闭合集合逐字一致，未登记的值后端一律 400。 */
export const ASSISTANT_SURFACE_KINDS = [
  'dashboard-editor',
  'twin-editor',
  'dataset-table',
  'collect-source',
  'dashboard-view',
] as const

export type AssistantSurfaceKind = (typeof ASSISTANT_SURFACE_KINDS)[number]

/** 一个技能在清单上的样子。指令正文不出后端那道门，所以这里没有它。 */
export interface AssistantSkill {
  name: string
  title: string
  /** 一句话简介。它同时是模型选技能时看到的那一句。 */
  summary: string
  surface_kinds: string[]
  /** 用它需要的权限码。前端据它决定摆不摆入口。 */
  required_codes: string[]
}

/**
 * 助手能力。
 *
 * ⚠ **取不到这份 = 助手不存在**，不是「暂时故障」：某些现场根本不部署
 * ai-assistant，那时边缘直接 502，入口就该干净地不出现，而不是弹一条红色告警。
 */
export interface AssistantCapability {
  /** 模型端点是否配好并开着。关着时会话仍可读，但发不出新回合。 */
  is_model_enabled: boolean
  /** 视觉输入是否可用。看截图提建议那类技能据它决定摆不摆。 */
  is_vision_enabled: boolean
  skills: AssistantSkill[]
}
