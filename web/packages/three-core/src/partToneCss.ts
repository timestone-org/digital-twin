/**
 * @fileoverview 部件这一刻的状态色 → 一段能写进 style 的 CSS 颜色。
 * 装配栏的连接轨用它上色。
 *
 * ⚠ 没配状态染色的部件给**空串**，由调用方退回发丝色：给一个「正常绿」等于替一个
 * 从来没取过数的部件宣布它一切正常。
 * ⚠ 渐变档在 CSS 里混而不是在这里算出 hex：两端都可能是 `--token`，而 token 的
 * 取值只有在有 CSS 级联的宿主里才解析得出来（本文件无 DOM）。
 */
import { partTintColor } from '@dt/twin-config'
import type { TwinPart, TwinPartValues } from '@dt/twin-config'

/** 颜色规格 → 能写进 style 的字符串；token 要包一层 `var()`。 */
function cssColor(spec: string): string {
  return spec.startsWith('--') ? `var(${spec})` : spec
}

/**
 * 一个部件此刻该显示成什么颜色；不取数或一档都没命中时给空串。
 * @param part 归一化后的部件
 * @param values 部件状态染色那一路实时值，按部件 id 索引
 */
export function partToneCss(part: TwinPart, values: TwinPartValues): string {
  if (part.tint === null) return ''
  const color = partTintColor(part.tint, values[part.id]?.value)
  if (color.kind === 'none') return ''
  if (color.kind === 'solid') return cssColor(color.spec)
  const percent = Math.round(color.t * 100)
  return `color-mix(in srgb, ${cssColor(color.to)} ${percent}%, ${cssColor(color.from)})`
}
