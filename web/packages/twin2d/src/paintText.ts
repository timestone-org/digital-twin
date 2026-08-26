/**
 * @fileoverview txt / ico 两种图元的绘制：字体五键（缺席即跟随主题）、对齐与省略、
 * text-shadow 与描边字，以及图标四来源的解析与 `ico.color` 的分档生效。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.2、§5、§11.2。
 */
import { sanitizeCssValue } from './cssValue'
import { NO_DATA, formatSlotValue } from './format'
import { TWIN_2D_FIXED_COLOR_SPRITES } from './kinds'
import { paintBase } from './paintCommon'
import type { Twin2dSlotFormat } from './format'
import type { Twin2dFixedColorSprite, Twin2dSpriteId } from './kinds'
import type { Twin2dPaintCtx, Twin2dPaintOut } from './paintCommon'
import type { Twin2dNode } from './types'
import type {
  Twin2dDrawPart,
  Twin2dIcoPrim,
  Twin2dIcoSrc,
  Twin2dShadow,
  Twin2dTextOutline,
  Twin2dTxtPrim,
  Twin2dTxtSrc,
} from './typesPrim'
import type { FontValue } from '@dt/contracts'

/** 数字读数字体族的 token 名（§11.2） */
const DIGIT_FAMILY_TOKEN = '--font-digit'
/** 等宽数字类 */
const DIGIT_CLASS = 't2-digit'
/** 继承色 */
const CURRENT_COLOR = 'currentColor'
/** 描边先画、字盖在上面 */
const PAINT_ORDER_STROKE = 'stroke'
/** 溢出打点 */
const ELLIPSIS = 'ellipsis'
/** 不折行 */
const NOWRAP = 'nowrap'
/** 裁掉溢出 */
const OVERFLOW_HIDDEN = 'hidden'
/** 基线跟随父级的那一档 */
const BASELINE_AUTO = 'auto'
/** 素材解析槽未注入时的空地址 */
const NO_ASSET_URL = ''
/** 空档 */
const NO_ICO: Twin2dIcoResolved = Object.freeze({ kind: 'none' })

/** 一个槽位的口径与它当下的读数。 */
export interface Twin2dSlotRead {
  /** 精度、单位、映射表与占位符。 */
  slot: Twin2dSlotFormat
  /** 原始读数，取不到时由调用方喂 null。 */
  value: unknown
}

/**
 * 取文本要知道的上下文。
 * ⚠ 与 `Twin2dPaintCtx` 是两件事：画一段文字只要节点与槽位读数，不需要父级盒尺寸，
 * 而槽位读数只有运行时缝合层拿得到，所以它以函数入参的形式进来，本文件不存任何状态。
 */
export interface Twin2dTextCtx {
  /** 所在节点实例：`label` / `id` 两档读它。 */
  node: Twin2dNode
  /** 按槽键取口径与读数；槽键悬空时给 null。 */
  readSlot: (key: string) => Twin2dSlotRead | null
}

/** 图标四来源解析之后的判定结果，渲染层按 `kind` 分支。 */
export type Twin2dIcoResolved =
  | { kind: 'none' }
  | { kind: 'name'; name: string }
  | { kind: 'sprite'; id: Twin2dSpriteId; fixedColor: boolean }
  | { kind: 'asset'; url: string }
  | {
      kind: 'draw'
      viewBox: readonly [number, number]
      parts: readonly Twin2dDrawPart[]
    }

/** `asset:<uuid>` / URL / `data:` → 可直接进 `src` 的地址；取不到给空串。 */
export type Twin2dIconResolver = (assetRef: string) => string

// ⚠ 未注入素材解析槽时一律回空串：图元落回空档、图标静默消失，说明这件事归诊断
// （issues.ts），不在这里凭空造地址（§11.4）
function noIconResolver(): string {
  return NO_ASSET_URL
}

// 字体族先过消毒；被拒的值回落空串 = 这一项跟随主题
function fontFamilyOf(font: FontValue): string {
  return sanitizeCssValue(font.family, '')
}

// 字体五键：缺席的键一个声明都不产，那一项就跟随主题
function fontCss(font: FontValue, family: string): Record<string, string> {
  const style: Record<string, string> = {}
  if (family !== '') style['font-family'] = family
  if (font.size !== undefined) style['font-size'] = `${font.size}px`
  if (font.weight !== undefined) style['font-weight'] = String(font.weight)
  if (font.letterSpacing !== undefined) {
    style['letter-spacing'] = `${font.letterSpacing}px`
  }
  const color = sanitizeCssValue(font.color, '')
  if (color !== '') style['color'] = color
  return style
}

/**
 * 排版四项。
 * ⚠ `baseline` 三档落到 `align-self` 而不是 `vertical-align`：图元都是 flex 子项，
 * `vertical-align` 在 flex 子项上不生效，写了看起来像「基线这一档配了没反应」。
 * ⚠ `ellipsis` 还要父级盒的 `min-width: 0`（`TWIN_2D_BOX_CONSTANTS` 恒定给），
 * 少了它文字不省略而是把父级撑破（§9.4）。
 */
function layoutCss(prim: Twin2dTxtPrim): Record<string, string> {
  const style: Record<string, string> = { 'text-align': prim.align }
  if (prim.baseline !== BASELINE_AUTO) style['align-self'] = prim.baseline
  if (prim.nowrap) style['white-space'] = NOWRAP
  if (prim.ellipsis) {
    style['overflow'] = OVERFLOW_HIDDEN
    style['text-overflow'] = ELLIPSIS
  }
  return style
}

/**
 * 多条阴影拼成一条 `text-shadow`；一条都没有时不产声明。
 * ⚠ 逐条只取 x / y / blur / color：`text-shadow` 没有 `spread` 也没有 `inset`，
 * 多写一个值会让**整条**声明报废——不是那一条阴影失效，是所有阴影一起消失。
 */
function textShadowCss(shadows: readonly Twin2dShadow[]): string | null {
  if (shadows.length === 0) return null
  return shadows
    .map((shadow) => {
      const color = sanitizeCssValue(shadow.color, CURRENT_COLOR)
      return `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${color}`
    })
    .join(', ')
}

/**
 * 描边字。
 * ⚠ `paint-order: stroke` 不能省：少了它描边盖在字面上，字会整体变虚（§7 #72）。
 * ⚠ 描边宽度走 `-webkit-text-stroke-*` 而不是 SVG 的 `stroke`：txt 渲成 HTML（§13.1），
 * `stroke` 在 HTML 元素上毫无作用，配了完全看不出所以然。
 */
function outlineCss(outline: Twin2dTextOutline | null): Record<string, string> {
  if (outline === null) return {}
  return {
    '-webkit-text-stroke-width': `${outline.width}px`,
    '-webkit-text-stroke-color': sanitizeCssValue(outline.color, CURRENT_COLOR),
    'paint-order': PAINT_ORDER_STROKE,
  }
}

/**
 * 一个 `txt` 图元画出来是什么：基类那几项 + 字体 + 排版 + 阴影 + 描边。
 * ⚠ `font.family` 里含 `--font-digit` 时挂 `.t2-digit`：token 只给字体族，
 * `font-variant-numeric: tabular-nums` 要消费处自己配，它不是字体族的一部分，
 * 塞进 font 简写会被丢掉（§11.2）。
 * @param prim 已归一化的文本图元
 * @param ctx 节点实例、父级盒尺寸与实例前缀
 */
export function paintText(
  prim: Twin2dTxtPrim,
  ctx: Twin2dPaintCtx,
): Twin2dPaintOut {
  const base = paintBase(prim, ctx)
  if (prim.hidden) return base
  const family = fontFamilyOf(prim.font)
  const style: Record<string, string> = {
    ...base.style,
    ...fontCss(prim.font, family),
    ...layoutCss(prim),
    ...outlineCss(prim.outline),
  }
  const shadow = textShadowCss(prim.shadows)
  if (shadow !== null) style['text-shadow'] = shadow
  const classes = family.includes(DIGIT_FAMILY_TOKEN)
    ? [...base.classes, DIGIT_CLASS]
    : base.classes
  return { style, classes, attrs: {} }
}

/**
 * 溢出时挂在元素上的 `title`。
 * ⚠ 不并进 `paintText` 的 `attrs`：完整文本要先由 `resolveTxtContent` 取出来，
 * 而那要槽位读数，`Twin2dPaintCtx` 里没有。空文本不挂，否则 hover 出一个空气泡。
 * @param prim 已归一化的文本图元
 * @param content `resolveTxtContent` 取出的完整文本
 */
export function txtTitleAttrs(
  prim: Twin2dTxtPrim,
  content: string,
): Record<string, string> {
  if (!prim.titleAttr || content === '') return {}
  return { title: content }
}

/**
 * 文本四档来源 → 显示串。
 * ⚠ `slot` 一档一律走 `formatSlotValue`：精度、单位与映射表是槽位的口径，
 * 在这里另格式化一遍就是第二个真源（§11.3）。
 * ⚠ 槽键悬空时回「—」而不是空串：空串看起来是「这一格没配」，而实际是「槽键拼错了」，
 * 说清楚这件事归诊断（issues.ts）。
 * ⚠ `label` 空就是空，不回落 `id`：回落会让「清掉显示名」变成「冒出一串 uuid」，
 * 既不像配置生效也不像出错。要显示 id 是 `id` 那一档的事。
 * @param src 文本四档来源
 * @param ctx 节点实例与槽位读数
 */
export function resolveTxtContent(
  src: Twin2dTxtSrc,
  ctx: Twin2dTextCtx,
): string {
  switch (src.kind) {
    case 'lit':
      return src.text
    case 'slot': {
      const read = ctx.readSlot(src.slot)
      return read === null ? NO_DATA : formatSlotValue(read.value, read.slot)
    }
    case 'label':
      return ctx.node.label
    case 'id':
      return ctx.node.id
  }
}

/**
 * 这枚内置图标的颜色是不是写死在 sprite 里。
 * ⚠ 名单少一个 → 那枚多色图标的颜色控件可点、点了没反应；多一个 → 一枚本可染色的
 * 图标被白白禁掉。两头都零报错（§5）。
 * @param id 内置图标 id
 */
export function isFixedColorSprite(
  id: Twin2dSpriteId,
): id is Twin2dFixedColorSprite {
  return TWIN_2D_FIXED_COLOR_SPRITES.some((item) => item === id)
}

/**
 * 图标来源 → 渲染层的判定结果；`asset` 一档解析不出地址就落回空档。
 * ⚠ 地址的取法归注入的 `resolveIcon`：`assetUrl` 的 `kind` 对图标是 `'icon'`、
 * 对画布底图是 `'image'`，一个函数服务两种 kind 时装错的表现是**图标 404**（§11.4）。
 * @param src 图标四来源（外加一个空档）
 * @param resolveIcon 素材地址解析槽，缺省是「未注入」——一律回空档
 */
export function resolveIcoSrc(
  src: Twin2dIcoSrc,
  resolveIcon: Twin2dIconResolver = noIconResolver,
): Twin2dIcoResolved {
  switch (src.kind) {
    case 'none':
      return NO_ICO
    case 'name':
      return { kind: 'name', name: src.name }
    case 'sprite':
      return {
        kind: 'sprite',
        id: src.id,
        fixedColor: isFixedColorSprite(src.id),
      }
    case 'asset': {
      const url = resolveIcon(src.ref).trim()
      return url === '' ? NO_ICO : { kind: 'asset', url }
    }
    case 'draw':
      return { kind: 'draw', viewBox: src.viewBox, parts: src.parts }
  }
}

// ⚠ ico.color 只在吃 currentColor 的那几档生效：4 枚能源源图标的颜色是插画的一部分
// （§5），而 asset 一档渲成 <img>，图片里的颜色同样拿不到 currentColor
function icoColorApplies(src: Twin2dIcoSrc): boolean {
  if (src.kind === 'sprite') return !isFixedColorSprite(src.id)
  return src.kind === 'name' || src.kind === 'draw'
}

/**
 * 一个 `ico` 图元画出来是什么：基类那几项，外加能生效时的 `color`。
 * ⚠ 颜色不生效的那几档**一个声明都不产**，而不是产一个被忽略的 `color`：
 * 产了之后检查器与渲染面对「这里能不能染色」的答案就有两份（§5）。
 * @param prim 已归一化的图标图元
 * @param ctx 节点实例、父级盒尺寸与实例前缀
 */
export function paintIco(
  prim: Twin2dIcoPrim,
  ctx: Twin2dPaintCtx,
): Twin2dPaintOut {
  const base = paintBase(prim, ctx)
  if (prim.hidden || !icoColorApplies(prim.src)) return base
  return {
    style: {
      ...base.style,
      color: sanitizeCssValue(prim.color, CURRENT_COLOR),
    },
    classes: base.classes,
    attrs: {},
  }
}
