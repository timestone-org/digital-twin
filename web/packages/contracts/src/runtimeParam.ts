/**
 * @fileoverview 运行参数：运行期可在界面上调的行为旋钮。
 *
 * 环境变量是**永久默认值**，库里只存被改过的项作为覆盖值，两者叠加得有效值；
 * 「恢复默认」即删掉覆盖行，此后该项重新跟随环境变量。
 *
 * ⚠ 分组按写权限码拆在两条路由上：`dashboard` 走 `/runtime-params`，
 * `collect` / `archive` 走 `/collect-runtime-params`——采集/归档两组的消费者
 * 是采集器，覆盖值随采集计划下发，最迟一个计划刷新周期（默认 30 秒）生效。
 */

/** 有可编辑项的 section，与后端 `apps/runtime_params/catalog.py` 的键逐字一致。 */
export const RUNTIME_PARAM_SECTIONS = [
  'dashboard',
  'collect',
  'archive',
] as const

export type RuntimeParamSection = (typeof RUNTIME_PARAM_SECTIONS)[number]

/** 走 `/collect-runtime-params` 路由的分组（读 collect:view、写 collect:manage）。 */
export const COLLECT_RUNTIME_PARAM_SECTIONS = ['collect', 'archive'] as const

/** 控件类型：数字两种 + 开关。 */
export const RUNTIME_PARAM_KINDS = ['int', 'float', 'switch'] as const
export type RuntimeParamKind = (typeof RUNTIME_PARAM_KINDS)[number]

/**
 * 生效档位。非即时档要在界面上如实说「保存了但还没生效」——
 * 保存成功却什么都没变，用户只会以为自己改错了地方。
 */
export const RUNTIME_PARAM_TIERS = ['instant', 'reconnect', 'restart'] as const
export type RuntimeParamTier = (typeof RUNTIME_PARAM_TIERS)[number]

/**
 * 危险方向：`off` = 由开改关危险，`decrease` = 调小危险；null = 任何方向
 * 都不需要二次确认。危险性挂在**变更方向**上而不是字段上——安全方向也弹，
 * 用户会训练出无脑点确认的肌肉记忆。
 */
export const RUNTIME_PARAM_DANGERS = ['off', 'decrease'] as const
export type RuntimeParamDanger = (typeof RUNTIME_PARAM_DANGERS)[number]

/** 一个可编辑项的登记信息与当前状态。 */
export interface RuntimeParamItem {
  section: RuntimeParamSection
  /** 配置字段名，不带服务前缀。 */
  key: string
  /** 对应的环境变量全名，供运维对着 .env 找。 */
  envName: string
  /** 改这一项要的权限码。 */
  writeCode: string
  label: string
  /** 为什么要调它、调错会怎样。 */
  hint: string
  kind: RuntimeParamKind
  /** 单位后缀（ms / s / 行…），只做展示；开关项是空串。 */
  unit: string
  step: number
  minimum: number
  maximum: number
  tier: RuntimeParamTier
  danger: RuntimeParamDanger | null
  /** 有效值 = 默认值叠加覆盖值。 */
  value: number | boolean
  /** 环境变量给的默认值。 */
  defaultValue: number | boolean
  overridden: boolean
  /** 未被覆盖过时为 null。 */
  updatedBy: string | null
  updatedAt: string | null
  /** 本项此前的有效值，供复盘「从多少改到多少」。 */
  previousValue: number | boolean | null
}
