/**
 * @fileoverview 配置控件的统一契约：每个控件收同一组 props、抛同一个事件。
 * ⚠ 名字写错时 typecheck 与 lint 双双放行（Vue 的模板检查够不到 prop 名），
 * 所以名字只在这里定义一次，控件与派发器都从这里取类型，另有契约测试兜底。
 */
import type { ConfigField } from '@dt/contracts'

/** 一个配置控件收到的全部 props。 */
export interface ConfigControlProps {
  /** 这个字段的清单声明。 */
  field: ConfigField
  /** 当前值，可能没配过。 */
  value: unknown
  /** 递归深度，顶层是 0。 */
  depth?: number | undefined
  disabled?: boolean | undefined
}

/**
 * 一个配置控件抛出的事件。
 * `isContinuous` 为真表示这是一次**连续输入**（打字、拖滑杆、拖取色器），
 * 撤销栈据它把同一个字段的连续几笔并成一笔。
 */
export interface ConfigControlEmits {
  update: [value: unknown, isContinuous: boolean]
}
