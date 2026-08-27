/**
 * @fileoverview 画布底两层（底图与图案）的求值：吃一份画布配置与素材解析槽，出两份
 * 内联样式对象。运行态舞台与编辑画布都调它。口径见 docs/MODULE_TWIN_2D_DESIGN.md §7 #76。
 *
 * ⚠ 出的是自定义属性而不是 `background` 本身，接过去的规则在 `twin2d.scss` 的
 * `.t2-backdrop` 两条上：值里带 `var()` 的标准属性会被 happy-dom 的 CSSOM 整条丢掉，
 * 浏览器上没事、用例里却断言不到（连线层的边色同一个原因）。
 * ⚠ 两个宿主共用这一份求值：谁再算一份的表现是底图偏一点、图案疏一格，而两边单看都对。
 */
import { sanitizeCssValue } from './cssValue'
import type { Twin2dBackgroundFit } from './kinds'
import type { Twin2dIconResolver } from './paintText'
import type { Twin2dCanvas } from './types'

/** 素材引用前缀 */
const ASSET_PREFIX = 'asset:'
/** 素材解析槽未注入时的空地址 */
const NO_ASSET_URL = ''
/** 会把 `url()` 提前闭合的字符 */
const URL_UNSAFE_RE = /["'()\\\s]/
/** 底图地址允许的前缀 */
const IMAGE_PREFIXES = ['https://', 'http://', 'data:', '/'] as const
/** 图案色缺省：参考项目那三个变量全仓无定义、只活在 `var()` 的兜底位上（§7 #76） */
const PATTERN_FALLBACK =
  'color-mix(in srgb, var(--accent-primary) 5%, transparent)'
/** 斜织两层的角度 */
const WEAVE_ANGLES = [45, -45] as const
/** 平行线那一档的角度 */
const LINES_ANGLE = 0

/**
 * 底图四档铺法。
 * ⚠ 与 `paintBox` 里图元底图那一份是同一张表的两处落点（那边服务图元的 `fills`、
 * 这边服务画布底图），改了要两处一起改。
 */
const IMAGE_FIT: Readonly<Record<Twin2dBackgroundFit, string>> = Object.freeze({
  cover: 'center center / cover no-repeat',
  contain: 'center center / contain no-repeat',
  stretch: 'center center / 100% 100% no-repeat',
  tile: 'left top / auto repeat',
})

/** 底两层各自的内联样式；空对象 = 这一层一条声明都不产。 */
export interface Twin2dBackdropStyles {
  background: Record<string, string>
  pattern: Record<string, string>
}

/**
 * 底图那一层的取值：未解析的素材引用 → 不画；图片地址 → `url()` 加铺法；其余 → 当
 * CSS `background` 简写用。
 * ⚠ 素材引用解析不出来（或没注入解析槽）时整层不画，**不能**顺着落到简写那一档：
 * `asset:7f3a` 本身是一个「安全」的 CSS 值，注进去只会得到一条谁也解释不了的声明。
 * ⚠ 引号、括号与空白一律拒，它们能把 `url()` 提前闭合。
 * @param canvas 画布的底图两项
 * @param resolveImage 素材解析槽
 */
function backgroundValue(
  canvas: Twin2dCanvas,
  resolveImage: Twin2dIconResolver,
): string | null {
  const raw = canvas.background
  if (raw === '') return null
  const asset = raw.startsWith(ASSET_PREFIX)
  const ref = asset ? resolveImage(raw) : raw
  if (asset || IMAGE_PREFIXES.some((prefix) => ref.startsWith(prefix))) {
    if (ref === NO_ASSET_URL || URL_UNSAFE_RE.test(ref)) return null
    return `url("${ref}") ${IMAGE_FIT[canvas.backgroundFit]}`
  }
  const value = sanitizeCssValue(raw, '')
  return value === '' ? null : value
}

/**
 * 一层等距斜线。
 * @param angle 线的法向角度
 * @param color 线色
 * @param gap 线间距
 * @param width 线宽
 */
function stripes(
  angle: number,
  color: string,
  gap: number,
  width: number,
): string {
  const line = `${color} ${gap}px ${gap + width}px`
  return `repeating-linear-gradient(${angle}deg, transparent 0 ${gap}px, ${line})`
}

/** 图案层：斜织是两层角度对称的等距斜线，点阵靠一层径向渐变按格铺（§7 #76）。 */
function patternValue(canvas: Twin2dCanvas): Record<string, string> {
  if (canvas.pattern === 'none') return {}
  const color = sanitizeCssValue(canvas.patternColor, PATTERN_FALLBACK)
  const { patternGap: gap, patternWidth: width } = canvas
  if (canvas.pattern === 'dots') {
    const dot = `${color} 0 ${width}px, transparent ${width}px`
    return {
      '--t2-pattern': `radial-gradient(circle at 50% 50%, ${dot})`,
      'background-size': `${gap}px ${gap}px`,
    }
  }
  const angles: readonly number[] =
    canvas.pattern === 'weave' ? WEAVE_ANGLES : [LINES_ANGLE]
  const layers = angles.map((angle) => stripes(angle, color, gap, width))
  return { '--t2-pattern': layers.join(', ') }
}

/**
 * 画布底两层的内联样式。
 * @param canvas 画布配置
 * @param resolveImage 素材引用 → 可直接用的地址；未注入时给回空串的那一份
 */
export function canvasBackdropStyles(
  canvas: Twin2dCanvas,
  resolveImage: Twin2dIconResolver,
): Twin2dBackdropStyles {
  const background = backgroundValue(canvas, resolveImage)
  return {
    background: background === null ? {} : { '--t2-bg': background },
    pattern: patternValue(canvas),
  }
}
