/**
 * @fileoverview 子类那一层：4 个源子类 × 4 个源类 + 3 个末端子类 × 3 个末端类 = 25 种
 * 视觉组合，落成 7 个预置样式上的 25 条 `tag` 变体数据，而不是 25 个样式。
 * 参考项目的 `SOURCE_CLASS_ICON` / `SOURCE_CLASS_COLOR` / `TERMINAL_KIND_ICON` 三张表
 * 覆盖节点类型自带的 icon 与 accent，这里逐字落成变体的补丁。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §6.3。
 */
import { TWIN_2D_PALETTE } from './palette'
import { TWIN_2D_SOURCE_STYLES } from './nodesSource'
import { TWIN_2D_TERMINAL_STYLES } from './nodesTerminal'
import type { Twin2dSpriteId } from '../kinds'
import type { Twin2dNodeStyle, Twin2dVariant } from '../types'
import type { Twin2dRootPatch } from '../typesPrim'

/**
 * 子类挂在节点 `tags` 的哪个键上。
 * ⚠ 键与值都是**自由字符串不是枚举**：归一化只做 trim 与长度上限，不做白名单
 * （`normalizeTags` / `matchCondition` 各一处）。做了白名单就等于把子类重新钉死成
 * 枚举，这一档就白加了——用户自建的样式也就再拿不到「按任意维度换外观」。
 * 下面两张表是**预置库自己用的取值**，不是取值域。
 */
export const TWIN_2D_SUBTYPE_TAG_KEY = 'subtype'

/** 一个子类：tag 取值、中文名、换上去的图标，以及要不要连强调色一起换。 */
export interface Twin2dSubtypeDef {
  /** 存进 `tags.subtype` 的那个字符串，同时是变体 id 的后缀。 */
  id: string
  label: string
  sprite: Twin2dSpriteId
  /** null = 这一族的子类只换图标，不动强调色（末端三档就是这样）。 */
  accent: string | null
}

/**
 * 4 个源子类，文档序取自参考项目 `SOURCE_CLASS_ICON` 那张表。
 * ⚠ 强调色逐值等于参考项目 `SOURCE_CLASS_COLOR` 的四个 `--chart-series-*`：
 * 余热=series-1、太阳能=series-4、空气能=series-3、蒸汽=series-2。
 * 这四条**不按调色板的字面顺序排**，照「1234」顺手改一格就与参考项目不再同色。
 */
export const TWIN_2D_SOURCE_SUBTYPE_DEFS = [
  {
    id: 'waste-heat',
    label: '余热回收',
    sprite: 'ico-src-waste-heat',
    accent: TWIN_2D_PALETTE.wasteHeat,
  },
  {
    id: 'solar',
    label: '太阳能',
    sprite: 'ico-src-solar',
    accent: TWIN_2D_PALETTE.solar,
  },
  {
    id: 'air-energy',
    label: '空气能',
    sprite: 'ico-src-air-source',
    accent: TWIN_2D_PALETTE.airEnergy,
  },
  {
    id: 'steam',
    label: '蒸汽锅炉',
    sprite: 'ico-src-steam',
    accent: TWIN_2D_PALETTE.steam,
  },
] as const satisfies readonly Twin2dSubtypeDef[]

/** 预置的源子类取值。⚠ 只是这四条数据的联合，不是 `tags.subtype` 的取值域。 */
export type Twin2dSourceSubtypeId =
  (typeof TWIN_2D_SOURCE_SUBTYPE_DEFS)[number]['id']

/**
 * 3 个末端子类，文档序取自参考项目 `TERMINAL_KIND_ICON` 那张表。
 * ⚠ `accent` 全是 null：参考项目**没有** `TERMINAL_KIND_COLOR`，末端的强调色始终由
 * 类型自己的 `colorVar` 决定。给它补一个色就是凭空多出三种配色，而没有一处会报错。
 * ⚠ `hvac` 换上的是 `ico-term-ac`、`heating` 换上的是 `ico-term-radiator`——两处
 * 名字都对不上取值，照字面顺手写成 `ico-term-hvac` 会得到一枚渲染空白的图标。
 */
export const TWIN_2D_TERMINAL_SUBTYPE_DEFS = [
  { id: 'shower', label: '洗浴', sprite: 'ico-term-shower', accent: null },
  { id: 'hvac', label: '空调', sprite: 'ico-term-ac', accent: null },
  { id: 'heating', label: '采暖', sprite: 'ico-term-radiator', accent: null },
] as const satisfies readonly Twin2dSubtypeDef[]

/** 预置的末端子类取值。⚠ 同上，不是取值域。 */
export type Twin2dTerminalSubtypeId =
  (typeof TWIN_2D_TERMINAL_SUBTYPE_DEFS)[number]['id']

/**
 * 四个源类样式里那枚图标图元的 id。
 * ⚠ 不是 `'icon'`——那是 34×34 的**底板盒**，往盒上打 `src` 补丁是一次静默空转：
 * `patchedBox` 根本不搬 `src` 这个键，于是图标照旧、零报错。
 */
export const TWIN_2D_SOURCE_GLYPH_PRIM_ID = 'glyph'

/** 三个末端样式里那枚图标图元的 id。⚠ 与源类那边**同名**，四族共用一套图元 id 词表。 */
export const TWIN_2D_TERMINAL_GLYPH_PRIM_ID = 'glyph'

/**
 * 按一个子类构一条变体：命中 `tags.subtype` 后换图标，必要时连强调色一起换。
 * @param def 这一档子类的身份
 * @param glyphPrimId 要换 sprite 的那枚 ico 图元的 id
 */
export function twin2dSubtypeVariant(
  def: Twin2dSubtypeDef,
  glyphPrimId: string,
): Twin2dVariant {
  // ⚠ 空对象与 `{ accent: undefined }` 在 exactOptionalPropertyTypes 下不是一回事，
  //   而在浅合并里也不是：后者会把前一条变体给出的强调色覆盖成 undefined
  const rootPatch: Twin2dRootPatch =
    def.accent === null ? {} : { accent: def.accent }
  return {
    id: `subtype-${def.id}`,
    when: { kind: 'tag', key: TWIN_2D_SUBTYPE_TAG_KEY, in: [def.id] },
    patch: { [glyphPrimId]: { src: { kind: 'sprite', id: def.sprite } } },
    rootPatch,
  }
}

/**
 * 把一族子类变体挂到一个样式上。
 * ⚠ 子类变体排在样式原有变体的**前面**：文档序在后的赢，所以 hover / selected /
 * alarm 盖得住子类，反过来则是「报警了但描边还是子类的绿」。子类是底妆，交互态是
 * 后上的那一层。
 * @param style 上一轮产出的预置样式，原样不动
 * @param defs 这一族的子类表
 * @param glyphPrimId 该族样式里那枚 ico 图元的 id
 */
export function twin2dWithSubtypes(
  style: Twin2dNodeStyle,
  defs: readonly Twin2dSubtypeDef[],
  glyphPrimId: string,
): Twin2dNodeStyle {
  const added = defs.map((def) => twin2dSubtypeVariant(def, glyphPrimId))
  return { ...style, variants: [...added, ...style.variants] }
}

/** 四个源类样式，各带 4 条子类变体。 */
export const TWIN_2D_SUBTYPED_SOURCE_STYLES: readonly Twin2dNodeStyle[] =
  TWIN_2D_SOURCE_STYLES.map((style) =>
    twin2dWithSubtypes(
      style,
      TWIN_2D_SOURCE_SUBTYPE_DEFS,
      TWIN_2D_SOURCE_GLYPH_PRIM_ID,
    ),
  )

/** 三个末端样式，各带 3 条子类变体。 */
export const TWIN_2D_SUBTYPED_TERMINAL_STYLES: readonly Twin2dNodeStyle[] =
  TWIN_2D_TERMINAL_STYLES.map((style) =>
    twin2dWithSubtypes(
      style,
      TWIN_2D_TERMINAL_SUBTYPE_DEFS,
      TWIN_2D_TERMINAL_GLYPH_PRIM_ID,
    ),
  )
