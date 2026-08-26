/**
 * @fileoverview 预置节点样式的汇总面：五族样式接成一张有序清单，外加一张 id → 样式。
 * 这里只做拼接与查表——「内置库只是预置数据，与用户自建的样式走同一条渲染路径」
 * （docs/MODULE_TWIN_2D_DESIGN.md §13.4）正是靠汇总面里一行判断都没有守住的。
 */
import { TWIN_2D_CIRCUIT_STYLES } from './circuit'
import { TWIN_2D_MISC_STYLES } from './nodesMisc'
import { TWIN_2D_VESSEL_STYLES } from './nodesVessel'
import {
  TWIN_2D_SUBTYPED_SOURCE_STYLES,
  TWIN_2D_SUBTYPED_TERMINAL_STYLES,
} from './subtypes'
import type { Twin2dNodeStyle } from '../types'

/**
 * 19 个预置节点样式：11 种节点类型（源 4 / 容器 2 / 末端 3 / 换热与标注 2）加 8 枚电路符号。
 * 前 11 条的文档序与参考项目 `BUILTIN_NODE_TYPES` 逐位一致，电路符号接在其后。
 * ⚠ 源与末端两族取的是**带子类变体**的那一份（§6.3）：换成 `TWIN_2D_SOURCE_STYLES` /
 * `TWIN_2D_TERMINAL_STYLES` 会让 25 种子类组合一条都不生效，而这一步零报错——
 * 节点照样渲染，只是 `tags.subtype` 从此谁也不看。
 */
export const TWIN_2D_BUILTIN_NODE_STYLES: readonly Twin2dNodeStyle[] = [
  ...TWIN_2D_SUBTYPED_SOURCE_STYLES,
  ...TWIN_2D_VESSEL_STYLES,
  ...TWIN_2D_SUBTYPED_TERMINAL_STYLES,
  ...TWIN_2D_MISC_STYLES,
  ...TWIN_2D_CIRCUIT_STYLES,
]

/**
 * id → 预置样式。
 * ⚠ 这只是兜底的那一层：渲染时同 id 以文档里的 `styles[]` 为准（§13.4），
 * 反过来拿这张表盖掉文档，会把用户整库替换写进去的改动静默还原。
 */
export const TWIN_2D_BUILTIN_NODE_STYLE_MAP: ReadonlyMap<
  string,
  Twin2dNodeStyle
> = new Map(
  TWIN_2D_BUILTIN_NODE_STYLES.map((style): [string, Twin2dNodeStyle] => [
    style.id,
    style,
  ]),
)
