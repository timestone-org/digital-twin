/**
 * @fileoverview 卡片外观风格：把一整套旋钮取值压成一次整批写入，「平台默认」则按同一批键
 * 清空（不写值 = 渲染走平台默认）。键的词汇表出自 `@dt/contracts` 的 `CHROME_KEYS`。
 *
 * ⚠ 这里只有**内置**的两档。用户自己存下来的那些是「卡片样式」，住在后端表里，
 * 由 `api/cardStyles.ts` 取（docs/CARD_STYLE_LIBRARY_DESIGN.md）。
 */
import type { CardChrome, ChromeKey } from '@dt/contracts'

import { chromeEntries } from './cardStyleFields'

/**
 * 「极简描边」：淡描边缓慢呼吸 + 无角标 + 小圆角 + 底对齐标题条。
 * 描边色用 `color-mix` 掺主题强调色而不是写死色值，换肤时才跟着走。
 */
export const MINIMAL_OUTLINE_STYLE: Readonly<CardChrome> = Object.freeze({
  /* 描边 */
  border: 'color-mix(in srgb, var(--accent-primary) 8%, transparent)',
  borderHover: 'color-mix(in srgb, var(--accent-primary) 40%, transparent)',
  radius: 4,
  corners: false, // 淡描边配发光角标会显得脏，四角一律关掉
  borderStyle: 'breathe',
  borderPulseDuration: 6,

  /* 标题条 */
  titleAlign: 'bottom', // 竖条 / 文字 / 装饰带贴同一条底线
  titlePadding: [10, 12, 8],
  // 竖条是独立的 flex 子元素、文字自身没有内边距，这个间距是两者唯一的分隔机制，
  // 写 0 的后果是竖条紧贴首字、装饰带第一道笔画顶在末字上
  titleGap: 10,
  titleFontSize: 16,
  titleFontWeight: '400', // 靠辉光而非加粗取重量感
  titleLetterSpacing: 0,
  titleBarWidth: 3,
  titleBarFull: true,
  titleBarRadius: 0, // 方角实心条，不是胶囊
  titleBarGlow: 0,
  titlePulse: true,
  titlePulseDuration: 3,
  titleRule: 'hatch',
  titleRuleOpacity: 0.3,
})

/** 风格涉及的全部键，顺序即上方书写顺序，「平台默认」按它逐键删除。 */
export const CARD_STYLE_KEYS = Object.keys(MINIMAL_OUTLINE_STYLE) as ChromeKey[]

/** 「平台默认」：把风格写过的键全部置 undefined，交给字段组删键。 */
export function resetStylePatch(): CardChrome {
  return Object.fromEntries(CARD_STYLE_KEYS.map((key) => [key, undefined]))
}

export interface CardStyleVariant {
  id: string
  label: string
  hint: string
  patch: () => CardChrome
}

/** 「自定义」不是可选项：只在当前取值既不等于任一风格、又非全空时用于回填显示。 */
export const CUSTOM_STYLE_ID = 'custom'

export const CARD_STYLE_VARIANTS: readonly CardStyleVariant[] = [
  {
    id: 'default',
    label: '平台默认',
    hint: '8px 圆角 · L 形角标 · 13px/600 标题 · 无动效',
    patch: resetStylePatch,
  },
  {
    id: 'minimal',
    label: '极简描边',
    hint: '4px 圆角 · 淡描边呼吸 · 无角标 · 底对齐标题 + 贯穿竖条 + 斜纹装饰带',
    patch: () => ({ ...MINIMAL_OUTLINE_STYLE }),
  },
]

/** id → 风格取值表；平台默认没有取值表，它就是「这批键一个都不设」。 */
const STYLE_VALUES: Record<string, Readonly<CardChrome>> = {
  minimal: MINIMAL_OUTLINE_STYLE,
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((cell, index) => cell === right[index])
    )
  }
  return left === right
}

/**
 * 当前取值命中哪个风格（下拉回填用）。只看风格涉及的那批键：一个都没设 = 平台默认；
 * 逐键等值 = 该风格；其余 = 自定义。
 * ⚠ 少了「自定义」这一档，动过一个旋钮的卡片会被回填成「平台默认」，等于在面板上说谎。
 * @param chrome 当前 chrome 袋子
 */
export function matchCardStyle(chrome: CardChrome): string {
  const isSet = (key: ChromeKey): boolean => {
    const value = chrome[key]
    return value !== undefined && value !== null && value !== ''
  }
  if (!CARD_STYLE_KEYS.some(isSet)) return 'default'
  for (const [id, values] of Object.entries(STYLE_VALUES)) {
    const hit = chromeEntries(values).every(([key, value]) =>
      sameValue(chrome[key], value),
    )
    if (hit) return id
  }
  return CUSTOM_STYLE_ID
}
