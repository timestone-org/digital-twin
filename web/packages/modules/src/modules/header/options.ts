/**
 * @fileoverview 页头的两组枚举取值：背景风格与标题两侧装饰。
 * ⚠ 清单与渲染组件**共用这一份**。各抄一份的话，新加一档必然有一边漏，
 * 表现是面板能选、渲染静默回落到默认档——「选了没反应」最常见的来源。
 */
import type { ConfigOption } from '@dt/contracts'

/** 背景花纹风格。`plain` 之外的档都画花纹层、扫描线、扫光与底部辉光线。 */
export const HEADER_VARIANTS = [
  { value: 'default', label: '默认（斜纹）' },
  { value: 'winged', label: '翼形' },
  { value: 'glass', label: '玻璃（点阵）' },
  { value: 'minimal', label: '极简' },
  { value: 'ribbon', label: '飘带（人字纹）' },
  { value: 'plain', label: '素净（无花纹）' },
  // 翼台：整宽横带 + 中央下凸梯形舞台 + 两侧三点翼片，纯 CSS 画，不依赖位图
  { value: 'podium', label: '翼台' },
] as const satisfies readonly ConfigOption[]

export type HeaderVariant = (typeof HEADER_VARIANTS)[number]['value']

/** 标题两侧的对称装饰。 */
export const HEADER_DECOS = [
  { value: 'none', label: '无' },
  { value: 'bars', label: '横线' },
  { value: 'slash', label: '斜切条' },
  { value: 'chevron', label: '箭头' },
  { value: 'diamond', label: '菱标' },
  { value: 'dashed', label: '分段线' },
] as const satisfies readonly ConfigOption[]

export type HeaderDeco = (typeof HEADER_DECOS)[number]['value']

const VARIANT_VALUES = HEADER_VARIANTS.map((item) => item.value)
const DECO_VALUES = HEADER_DECOS.map((item) => item.value)

/** 白名单外的脏值回落默认档。 */
export function normalizeVariant(value: string): HeaderVariant {
  const found = VARIANT_VALUES.find((item) => item === value)
  return found ?? 'default'
}

/** 白名单外的脏值回落默认档。 */
export function normalizeDeco(value: string): HeaderDeco {
  const found = DECO_VALUES.find((item) => item === value)
  return found ?? 'bars'
}
