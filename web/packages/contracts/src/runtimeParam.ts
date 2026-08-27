/**
 * @fileoverview 运行参数：运行期可在界面上调的行为旋钮。
 *
 * 环境变量是**永久默认值**，库里只存被改过的项作为覆盖值，两者叠加得有效值；
 * 「恢复默认」即删掉覆盖行，此后该项重新跟随环境变量。
 *
 * ⚠ 分组按**写权限码**拆在三条路由上：`dashboard` 走 `/runtime-params`（写
 * `dashboard:edit`）、`collect` / `archive` 走 `/collect-runtime-params`（写
 * `collect:manage`）、`dataset` 走 `/dataset-tables/runtime-params`（写
 * `dataset:manage`）。闸 2 的声明是挂在路由上的静态属性，一条路由声明不出两个码。
 * 采集/归档两组的消费者是采集器，覆盖值随采集计划下发，最迟一个计划刷新周期
 * （默认 30 秒）生效；台账那一组由 worker 的两条循环每一拍现读。
 */

/** 有可编辑项的 section，与后端 `apps/runtime_params/catalog.py` 的键逐字一致。 */
export const RUNTIME_PARAM_SECTIONS = [
  'dashboard',
  'collect',
  'archive',
  'dataset',
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
 * 危险方向：`off` = 由开改关危险，`on` = 由关改开危险，`decrease` = 调小危险；
 * null = 任何方向都不需要二次确认。危险性挂在**变更方向**上而不是字段上——
 * 安全方向也弹，用户会训练出无脑点确认的肌肉记忆。
 *
 * ⚠ `on` 与 `off` 同时存在且互为反面：采集类开关关掉才危险，清理类开关打开
 * 才危险（它会真实删行）。少列一种时线形转换会整包抛「未知的危险方向」。
 */
export const RUNTIME_PARAM_DANGERS = ['off', 'on', 'decrease'] as const
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
