/**
 * @fileoverview 内置部件清单。
 *
 * ⚠ 显式数组而不是 `import.meta.glob`：**顺序就是「加部件」菜单里的顺序**，
 * 而 glob 的顺序是文件名排出来的，加一个部件会让菜单悄悄重排。
 * ⚠ 摆卡片的模块把这一份**静态**并进自己的 `configSchema`——运行期登记的第三方部件
 * 画得出来，但进不了构建期导出的目录，属性面板与模型看不见它的字段
 * （与第三方模块不进 `module_types.json` 是同一条边界）。
 */
import { registerCardPart } from '../../../cardParts/registry'
import type { CardPartDefinition } from '../../../cardParts/types'

import badge from './badge'
import divider from './divider'
import extra from './extra'
import icon from './icon'
import label from './label'
import meter from './meter'
import tag from './tag'
import value from './value'

// 顺序即菜单顺序：先「这一格是什么」（名称/图标/标签/徽标），再「值是多少」
// （读数/附加字段/进度条），最后是纯排版的分隔线
export const BUILTIN_CARD_PARTS: readonly CardPartDefinition[] = [
  label,
  icon,
  tag,
  badge,
  value,
  extra,
  meter,
  divider,
]

/** 把内置部件装进分发表。同档重复登记按后来者生效，故重复调用无害。 */
export function registerBuiltinCardParts(): void {
  for (const part of BUILTIN_CARD_PARTS) registerCardPart(part)
}
