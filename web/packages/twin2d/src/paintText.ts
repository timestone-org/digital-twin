/**
 * @fileoverview txt / ico 两种图元的绘制：字体五键（缺席即跟随主题）、行高、对齐与省略、
 * text-shadow 与描边字，图标四来源的解析与 `ico.color` 的分档生效，以及一格读数按取数
 * 四档出色。口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.2、§5、§9.6、§11.2。
 */
import { twin2dIconUrl } from './assets'
import { sanitizeCssValue } from './cssValue'
import { NO_DATA, formatSlotValue } from './format'
import { TWIN_2D_FIXED_COLOR_SPRITES } from './kinds'
import {
  TWIN_2D_ANIM_CLASSES,
  TWIN_2D_ANIM_DURATION_VAR,
  paintBase,
} from './paintCommon'
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
/** 空档 */
const NO_ICO: Twin2dIcoResolved = Object.freeze({ kind: 'none' })
/** 未配来源与等首帧两档的字色：占位符不是读数，按三级正文压下去 */
const SLOT_MUTED_COLOR = 'var(--text-disabled)'
/** 取不到那一档的字色 */
const SLOT_ERROR_COLOR = 'var(--state-danger)'
/** 等首帧那一档的透明度 */
const SLOT_PENDING_OPACITY = '0.45'
/** 等首帧那一下呼吸的周期 */
const SLOT_PENDING_BREATHE = '1600ms'

/**
 * 一格读数落在取数四档的哪一档（§9.6 那张表）。
 * ⚠ `unbound` 与 `pending` 在墙上是**同一个占位符**，只差颜色与透明度——所以这两档
 * 不是装饰，是它们唯一的区分手段。
 */
export type Twin2dSlotState = 'ok' | 'unbound' | 'pending' | 'error'

/**
 * 一个槽位的口径、它当下的读数，以及这一格的取数档位。
 * ⚠ 档位与读数走**同一条**取数路径（`readSlot` 的返回值），不另开第二条：两条各查各的
 * 时，某一格的文字与它的颜色会来自不同的一帧，而那种错在图上完全看不出来。
 */
export interface Twin2dSlotRead {
  /** 精度、单位、映射表与占位符。 */
  slot: Twin2dSlotFormat
  /** 原始读数，取不到时由调用方喂 null。 */
  value: unknown
  /**
   * 这一格的取数档位。
   * ⚠ 没有逐槽数据线时（设计态、独立挂载、缝合层自己产的那一份）一律 `'ok'`：
   * 那一档一条样式都不改，于是预览与运行态有值时长得一模一样。
   */
  state: Twin2dSlotState
  /** `error` 档挂到 `title` 上的原因；说不出原因给空串（空 `title` 会弹一个空气泡）。 */
  reason: string
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
 * 行高：只在显式给了正数时产声明。
 * ⚠ 不产 `line-height: normal` 兜底：写了它就把外层继承下来的行高一起顶掉，
 * 而这一档的语义是「不说」而不是「按浏览器缺省」（§7.7 #51）。
 */
function lineHeightCss(lineHeight: number | null): Record<string, string> {
  return lineHeight === null ? {} : { 'line-height': String(lineHeight) }
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
 * 一格读数按取数四档出的那一层样式：`ok` 与没有档位时一条都不产，其余三档接管占位符
 * 的观感（§9.6）。
 *
 * ⚠ 三档一律**盖掉**样式数据里的字色与透明度：这三档画出来的是占位符而不是读数，
 * 让「这一格坏了」按读数本身的配色去画，等于把坏掉的点位藏进正常的版面里。
 * ⚠ `pending` 与 `unbound` 显示的是**同一个占位符**，只差这一层颜色与透明度。
 * ⚠ 呼吸那一档必须连 `--t2-anim-dur` 一起给：`animation` 简写解析不到它会整条报废，
 * 表现是「类挂上了却一动不动」。
 *
 * @param read 这一格的口径、读数与档位；不是槽位来源的文字喂 null
 */
export function paintSlotState(read: Twin2dSlotRead | null): Twin2dPaintOut {
  if (read === null || read.state === 'ok') {
    return { style: {}, classes: [], attrs: {} }
  }
  switch (read.state) {
    case 'unbound':
      return { style: { color: SLOT_MUTED_COLOR }, classes: [], attrs: {} }
    case 'pending':
      return {
        style: {
          color: SLOT_MUTED_COLOR,
          opacity: SLOT_PENDING_OPACITY,
          [TWIN_2D_ANIM_DURATION_VAR]: SLOT_PENDING_BREATHE,
        },
        classes: [TWIN_2D_ANIM_CLASSES.breathe],
        attrs: {},
      }
    case 'error':
      return {
        style: { color: SLOT_ERROR_COLOR },
        classes: [],
        attrs: read.reason === '' ? {} : { title: read.reason },
      }
  }
}

/**
 * 一个 `txt` 图元画出来是什么：基类那几项 + 字体 + 排版 + 阴影 + 描边，最后叠一层取数档位。
 * ⚠ `font.family` 里含 `--font-digit` 时挂 `.t2-digit`：token 只给字体族，
 * `font-variant-numeric: tabular-nums` 要消费处自己配，它不是字体族的一部分，
 * 塞进 font 简写会被丢掉（§11.2）。
 * ⚠ 档位那一层排在**最后**：排在字体前面会被样式数据里的 `font.color` 顶掉，
 * 于是配了字色的那些读数坏了也照旧是原色（§9.6）。
 * @param prim 已归一化的文本图元
 * @param ctx 节点实例、父级盒尺寸与实例前缀
 * @param read 这一格的口径、读数与档位；`slot` 之外的四档来源喂 null
 */
export function paintText(
  prim: Twin2dTxtPrim,
  ctx: Twin2dPaintCtx,
  read: Twin2dSlotRead | null = null,
): Twin2dPaintOut {
  const base = paintBase(prim, ctx)
  if (prim.hidden) return base
  const family = fontFamilyOf(prim.font)
  const state = paintSlotState(read)
  const style: Record<string, string> = {
    ...base.style,
    ...fontCss(prim.font, family),
    ...lineHeightCss(prim.lineHeight),
    ...layoutCss(prim),
    ...outlineCss(prim.outline),
    ...state.style,
  }
  const shadow = textShadowCss(prim.shadows)
  if (shadow !== null) style['text-shadow'] = shadow
  const digit = family.includes(DIGIT_FAMILY_TOKEN) ? [DIGIT_CLASS] : []
  return {
    style,
    classes: [...base.classes, ...digit, ...state.classes],
    attrs: state.attrs,
  }
}

/**
 * 溢出时挂在元素上的 `title`。
 * ⚠ 不并进 `paintText` 的 `attrs`：完整文本要先由 `resolveTxtContent` 取出来，
 * 而那要槽位读数，`Twin2dPaintCtx` 里没有。空文本不挂，否则 hover 出一个空气泡。
 * ⚠ 与 `paintSlotState` 的 `error` 档抢同一个 `title`，由渲染层让**档位那一份赢**：
 * 这一格坏了的原因比「这里的字被省略了」要紧得多（§9.6）。
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
 * 文本五档来源 → 显示串。
 * ⚠ `slot` 一档一律走 `formatSlotValue`：精度、单位与映射表是槽位的口径，
 * 在这里另格式化一遍就是第二个真源（§11.3）。
 * ⚠ 非 `ok` 三档按**无值**格式化，于是显示这个槽位自己的占位符：把上一帧的读数留在
 * 墙上比显示占位符危险得多——谁也看不出那个数停在什么时候。这一步与 `paintSlotState`
 * 的出色读的是**同一个** `state`，文字与颜色因此不可能各说各的（§9.6）。
 * ⚠ 槽键悬空时回「—」而不是空串：空串看起来是「这一格没配」，而实际是「槽键拼错了」，
 * 说清楚这件事归诊断（issues.ts）。
 * ⚠ `label` 空就是空，不回落 `id`：回落会让「清掉显示名」变成「冒出一串 uuid」，
 * 既不像配置生效也不像出错。要显示 id 是 `id` 那一档的事。
 * ⚠ `badge` 空也是空：角标画不画由图元的 `when` 判（`field` 一档的 `present`），
 * 在这里回落成别的字会让「没配角标」的节点身上凭空长出一个圆点。
 * @param src 文本五档来源
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
      if (read === null) return NO_DATA
      return formatSlotValue(read.state === 'ok' ? read.value : null, read.slot)
    }
    case 'label':
      return ctx.node.label
    case 'id':
      return ctx.node.id
    case 'badge':
      return ctx.node.badge
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
 * @param resolveIcon 素材地址解析槽，缺省走应用壳注入的那一条；未注入即回空档
 */
export function resolveIcoSrc(
  src: Twin2dIcoSrc,
  resolveIcon: Twin2dIconResolver = twin2dIconUrl,
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
