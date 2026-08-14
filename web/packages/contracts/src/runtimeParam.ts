/**
 * @fileoverview 运行参数：运行期可在界面上调的行为旋钮。
 *
 * 环境变量是**永久默认值**，库里只存被改过的项作为覆盖值，两者叠加得有效值；
 * 「恢复默认」即删掉覆盖行，此后该项重新跟随环境变量。
 */

/** 有可编辑项的 section，与后端 `apps/runtime_params/catalog.py` 的键逐字一致。 */
export const RUNTIME_PARAM_SECTIONS = ['dashboard'] as const

export type RuntimeParamSection = (typeof RUNTIME_PARAM_SECTIONS)[number]

/** 一个可编辑项的登记信息与当前状态。 */
export interface RuntimeParamItem {
  section: RuntimeParamSection
  /** 配置字段名，不带服务前缀。 */
  key: string
  /** 对应的环境变量全名，供运维对着 .env 找。 */
  envName: string
  label: string
  /** 有效值 = 默认值叠加覆盖值。 */
  value: unknown
  /** 环境变量给的默认值。 */
  defaultValue: unknown
  overridden: boolean
  /** 未被覆盖过时为 null。 */
  updatedBy: string | null
  updatedAt: string | null
  /** 本项此前的有效值，供复盘「从多少改到多少」。 */
  previousValue: unknown
}
