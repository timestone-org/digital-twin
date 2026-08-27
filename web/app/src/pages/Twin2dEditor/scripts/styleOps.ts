/**
 * @fileoverview 样式面的纯变更：节点样式与连线样式的增删改与复制，加一个样式内部的
 * 端口、槽位、变体三张小表。id 工厂借 `nodeOps` 那一份，三支实体 ops 与这里只有一套口径。
 *
 * ⚠ 一律纯函数：收一份 `Twin2dConfig` 出一份新的，不碰文档态、不碰选中态；什么都没改
 *   时**原样返回入参那个引用**（`twin2dDoc.commit` 按引用判要不要压一帧撤销）。
 * ⚠ 每一支写样式的都收「当下生效的那一份样式」而不是一个 id：内置样式默认**不在**
 *   文档里（渲染时 `styles = 预置库 ∪ config.styles`，同 id 以文档为准，§13.4），
 *   只收 id 的话，改一个还没被覆盖过的内置样式会静默什么都不做。取当下那一份走
 *   `twin2dNodeStyleOf` / `twin2dEdgeStyleOf`。
 * ⚠ 「恢复内置」= 从 `config.styles` 里**删掉那条同 id 的覆盖**，让它落回预置库；
 *   **不是**把预置数据写进文档。写死的话预置库将来升级就再也修不到这张图，而用户
 *   以为自己已经恢复了。
 * ⚠ 只有「引入新条目」那几支过归一化（`normalizeNodeStyles` / `normalizePorts` …）；
 *   改值那几支**刻意不过**——输入框是逐键写回的，归一化会把用户刚敲下的那个空格
 *   trim 掉再写回 DOM，于是空格永远打不出来，而这一处零报错。
 */
import {
  TWIN_2D_BUILTIN_NODE_STYLES,
  TWIN_2D_BUILTIN_NODE_STYLE_MAP,
  TWIN_2D_EDGE_PRESETS,
  normalizeEdgeStyles,
  normalizeNodeStyles,
  normalizePorts,
  normalizeSlots,
  normalizeVariants,
  twin2dStyleResolver,
} from '@dt/twin2d'
import type {
  Twin2dConfig,
  Twin2dEdgeStyle,
  Twin2dNodeStyle,
  Twin2dPort,
  Twin2dSlot,
  Twin2dVariant,
} from '@dt/twin2d'

import { freshTwin2dId, newTwin2dId, orderList } from './nodeOps'
import type { Twin2dAdded, Twin2dIdFactory, Twin2dOrderMove } from './nodeOps'

/** 新建节点样式的 id 前缀。 */
export const TWIN_2D_STYLE_ID_PREFIX = 'style'

/** 新建连线样式的 id 前缀。 */
export const TWIN_2D_EDGE_STYLE_ID_PREFIX = 'edge-style'

/** 新建端口的 id 前缀。 */
export const TWIN_2D_PORT_ID_PREFIX = 'port'

/** 新建槽位的键前缀。 */
export const TWIN_2D_SLOT_KEY_PREFIX = 'slot'

/** 新建变体的 id 前缀。 */
export const TWIN_2D_VARIANT_ID_PREFIX = 'variant'

/** 一个样式 id 的来路四档。 */
export const TWIN_2D_STYLE_ORIGINS = [
  'builtin',
  'override',
  'custom',
  'missing',
] as const

/**
 * 一个样式 id 的来路：只在预置库里 / 预置库里有而文档改过 / 用户自建 / 哪儿都没有。
 * ⚠ 只有 `override` 那一档才该给「恢复内置」；`custom` 那一档删掉就没了，
 * 两档摆同一个按钮会让用户以为自建样式也能恢复。
 */
export type Twin2dStyleOrigin = (typeof TWIN_2D_STYLE_ORIGINS)[number]

/** 删样式的结果：新配置，加删完之后会悬空的那些实体。 */
export interface Twin2dStyleRemoval {
  config: Twin2dConfig
  /**
   * 删完之后**仍指着这个 id 却再也解析不出样式**的节点 / 连线。
   * ⚠ 同 id 有预置样式兜底时它是空的——那种删除删掉的只是覆盖，一个实体都不受伤。
   */
  dangling: readonly string[]
}

/** 端口 / 槽位 / 变体三张小表的种子：可指定身份，空着就现造一个。 */
interface Seeded {
  id?: string
}

/** 新端口的种子；`id` 空着就现造，撞了就加不进去。 */
export type Twin2dPortSeed = Partial<Omit<Twin2dPort, 'id'>> & Seeded

/** 新槽位的种子；`key` 空着就现造，撞了就加不进去。 */
export type Twin2dSlotSeed = Partial<Omit<Twin2dSlot, 'key'>> & { key?: string }

/** 新变体的种子；至少要给一条认得出的 `when`，否则加不进去。 */
export type Twin2dVariantSeed = Partial<Omit<Twin2dVariant, 'id'>>

/** 预置连线样式的 id；判「这个 id 有没有兜底」用它。 */
const EDGE_PRESET_MAP: ReadonlyMap<string, Twin2dEdgeStyle> = new Map(
  TWIN_2D_EDGE_PRESETS.map((style): [string, Twin2dEdgeStyle] => [
    style.id,
    style,
  ]),
)

/** 一张表里现有的全部 id。 */
function idsOf(list: readonly { id: string }[]): Set<string> {
  return new Set(list.map((item) => item.id))
}

/**
 * 定一条新条目的身份：点名了就用点名的那个，空着就现造一个。
 * ⚠ 点名的那个已经被占用时交出空串（= 加不进去），不悄悄换一个：用户在对话框里
 * 敲了 `GND`，落地却成了 `port-3f2a1c`，而这一步没有任何提示。
 * @param wanted 点名的身份；空串 = 没点名
 * @param prefix 现造时的前缀
 * @param taken 已经占用的身份
 * @param makeId id 工厂
 */
function wantedOrFresh(
  wanted: string,
  prefix: string,
  taken: ReadonlySet<string>,
  makeId: Twin2dIdFactory,
): string {
  const asked = wanted.trim()
  if (asked === '') return freshTwin2dId(prefix, taken, makeId)
  return taken.has(asked) ? '' : asked
}

/**
 * 按 id 取当下生效的节点样式：文档里的优先，落不到才回预置库。
 * ⚠ 转手给 `@dt/twin2d` 的 `twin2dStyleResolver`，不在这里另写一遍查表：两边对同一个
 * id 解出不同的样式时，编辑器改的与画面上画的就是两份东西，而这一步零报错（§13.4）。
 * @param config 当前配置
 * @param id 样式 id
 */
export function twin2dNodeStyleOf(
  config: Twin2dConfig,
  id: string,
): Twin2dNodeStyle | null {
  return twin2dStyleResolver(config)(id)
}

/**
 * 按 id 取当下生效的连线样式：文档里的优先，落不到才回预置库。
 * @param config 当前配置
 * @param id 样式 id
 */
export function twin2dEdgeStyleOf(
  config: Twin2dConfig,
  id: string,
): Twin2dEdgeStyle | null {
  const inDoc = config.edgeStyles.find((style) => style.id === id)
  return inDoc ?? EDGE_PRESET_MAP.get(id) ?? null
}

/**
 * 一个 id 落在四档来路的哪一档。
 * @param inDoc 文档里有没有这一条
 * @param inBuiltin 预置库里有没有这一条
 */
function originOf(inDoc: boolean, inBuiltin: boolean): Twin2dStyleOrigin {
  if (inDoc) return inBuiltin ? 'override' : 'custom'
  return inBuiltin ? 'builtin' : 'missing'
}

/**
 * 这个节点样式 id 的来路。
 * @param config 当前配置
 * @param id 样式 id
 */
export function twin2dNodeStyleOrigin(
  config: Twin2dConfig,
  id: string,
): Twin2dStyleOrigin {
  return originOf(
    config.styles.some((style) => style.id === id),
    TWIN_2D_BUILTIN_NODE_STYLE_MAP.has(id),
  )
}

/**
 * 这个连线样式 id 的来路。
 * @param config 当前配置
 * @param id 样式 id
 */
export function twin2dEdgeStyleOrigin(
  config: Twin2dConfig,
  id: string,
): Twin2dStyleOrigin {
  return originOf(
    config.edgeStyles.some((style) => style.id === id),
    EDGE_PRESET_MAP.has(id),
  )
}

/**
 * 还在引用这个节点样式的节点 id。
 * @param config 当前配置
 * @param id 样式 id
 */
export function twin2dNodeStyleUsage(
  config: Twin2dConfig,
  id: string,
): readonly string[] {
  return config.nodes
    .filter((node) => node.styleId === id)
    .map((node) => node.id)
}

/**
 * 还在引用这个连线样式的连线 id。
 * @param config 当前配置
 * @param id 样式 id
 */
export function twin2dEdgeStyleUsage(
  config: Twin2dConfig,
  id: string,
): readonly string[] {
  return config.edges
    .filter((edge) => edge.styleId === id)
    .map((edge) => edge.id)
}

/**
 * 合并后的整份节点样式库：预置库的位置与次序不动，文档里同 id 的那份顶上去，
 * 用户自建的接在最后。
 * ⚠ 调色板与样式库抽屉共用这一支：两处各合一遍的话，同一份样式在一处站在预置库的
 * 位置上、在另一处排到了末尾，而两处单看都对。
 * ⚠ 改过的那一份仍站在预置库的位置上：另起一栏放「我改过的」会让同一个符号在库里
 * 出现两次，而两处点下去得到的是同一个 styleId。
 * @param styles 文档里的节点样式
 */
export function twin2dMergedNodeStyles(
  styles: readonly Twin2dNodeStyle[],
): readonly Twin2dNodeStyle[] {
  const inDoc = new Map(styles.map((style) => [style.id, style]))
  const builtin = TWIN_2D_BUILTIN_NODE_STYLES.map(
    (style) => inDoc.get(style.id) ?? style,
  )
  const own = styles.filter(
    (style) => !TWIN_2D_BUILTIN_NODE_STYLE_MAP.has(style.id),
  )
  return [...builtin, ...own]
}

/**
 * 合并后的整份连线样式库；口径与节点那一支逐字相同。
 * @param edgeStyles 文档里的连线样式
 */
export function twin2dMergedEdgeStyles(
  edgeStyles: readonly Twin2dEdgeStyle[],
): readonly Twin2dEdgeStyle[] {
  const inDoc = new Map(edgeStyles.map((style) => [style.id, style]))
  const preset = TWIN_2D_EDGE_PRESETS.map(
    (style) => inDoc.get(style.id) ?? style,
  )
  const own = edgeStyles.filter((style) => !EDGE_PRESET_MAP.has(style.id))
  return [...preset, ...own]
}

/**
 * 把一份节点样式写进文档：同 id 的换掉，没有就追加。
 * ⚠ 这是「改内置样式 = 在文档里落一份同 id 的覆盖」的唯一入口（§13.4），
 * 样式内部那几张小表与图元树（`primOps`）都从这里出去，另写一份就会漂出第二套
 * 「什么时候 materialize」的判断。
 * @param config 当前配置
 * @param style 整份新样式
 */
export function writeNodeStyle(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
): Twin2dConfig {
  const hit = config.styles.some((item) => item.id === style.id)
  const styles = hit
    ? config.styles.map((item) => (item.id === style.id ? style : item))
    : [...config.styles, style]
  return { ...config, styles }
}

/**
 * 把一份连线样式写进文档：同 id 的换掉，没有就追加。
 * @param config 当前配置
 * @param style 整份新样式
 */
export function writeEdgeStyle(
  config: Twin2dConfig,
  style: Twin2dEdgeStyle,
): Twin2dConfig {
  const hit = config.edgeStyles.some((item) => item.id === style.id)
  const edgeStyles = hit
    ? config.edgeStyles.map((item) => (item.id === style.id ? style : item))
    : [...config.edgeStyles, style]
  return { ...config, edgeStyles }
}

/**
 * 新建一个节点样式，追加在样式库末尾。
 * ⚠ 种子只给要紧的几项，其余交给归一化补缺省：在这里抄一份缺省值，抄的那份一旦与
 * 归一化不一致，新建的样式会在「存一次再读回来」之后悄悄变样。
 * ⚠ 现造的 id 恒非空，而归一化只在 id 为空时丢条目，所以这一支不会落空。
 * @param config 当前配置
 * @param seed 新样式的种子
 * @param makeId id 工厂，缺省随机
 */
export function addNodeStyle(
  config: Twin2dConfig,
  seed: Partial<Omit<Twin2dNodeStyle, 'id'>>,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dAdded {
  const id = freshTwin2dId(
    TWIN_2D_STYLE_ID_PREFIX,
    idsOf(config.styles),
    makeId,
  )
  const styles = [...config.styles, ...normalizeNodeStyles([{ ...seed, id }])]
  return { config: { ...config, styles }, id }
}

/**
 * 复制一份节点样式，追加在样式库末尾。
 * ⚠ 收的是**整份样式**而不是一个 id：预置样式默认不在文档里，只收 id 的话
 * 「把内置样式另存为自定义」这一支就永远复制不出东西来。
 * ⚠ 副本沿用原名，改名交给调用方：在这里拼一个「副本」出来，导出样式包再导进另一
 * 张图时名字会一次比一次长。
 * @param config 当前配置
 * @param source 要复制的那一份（文档 ∪ 预置库）
 * @param makeId id 工厂，缺省随机
 */
export function duplicateNodeStyle(
  config: Twin2dConfig,
  source: Twin2dNodeStyle,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dAdded {
  const id = freshTwin2dId(source.id, idsOf(config.styles), makeId)
  const styles = [...config.styles, ...normalizeNodeStyles([{ ...source, id }])]
  return { config: { ...config, styles }, id }
}

/**
 * 改一份节点样式的若干字段；文档里没有这一条就落一份同 id 的覆盖（§13.4）。
 * ⚠ `base` 必须是**当下生效**的那一份（走 `twin2dNodeStyleOf`）：喂预置库那一份会把
 * 用户已有的覆盖整个抹掉，而界面上只表现为「刚才改的几项一起没了」。
 * ⚠ `id` 不在可改之列：改 id 等于把这个样式换成另一个，而引用它的节点还指着旧的
 * 那一个，于是整批节点一起退化成兜底。
 * @param config 当前配置
 * @param base 当下生效的那一份样式
 * @param patch 要覆盖的字段
 */
export function updateNodeStyle(
  config: Twin2dConfig,
  base: Twin2dNodeStyle,
  patch: Partial<Omit<Twin2dNodeStyle, 'id'>>,
): Twin2dConfig {
  return writeNodeStyle(config, { ...base, ...patch })
}

/**
 * 删掉一份节点样式；同 id 有预置样式时删的只是那条覆盖（= 恢复内置）。
 * ⚠ 引用它的节点**不跟着删**：一张图上二十个节点共用一份样式，删样式连节点一起删
 * 会让用户在样式库里点一下就丢掉半张图。悬空的那几个由 `dangling` 报出来，
 * 调用方要提示，不能默默让它们退化成兜底。
 * @param config 当前配置
 * @param id 要删的样式 id
 */
export function removeNodeStyle(
  config: Twin2dConfig,
  id: string,
): Twin2dStyleRemoval {
  const styles = config.styles.filter((style) => style.id !== id)
  if (styles.length === config.styles.length) {
    return { config, dangling: [] }
  }
  const covered = TWIN_2D_BUILTIN_NODE_STYLE_MAP.has(id)
  return {
    config: { ...config, styles },
    dangling: covered ? [] : twin2dNodeStyleUsage(config, id),
  }
}

/**
 * 恢复内置：删掉文档里那条同 id 的覆盖，让它落回预置库。
 * ⚠ **不是**把预置数据写进文档——写死之后预置库将来升级就再也修不到这张图，
 * 而用户以为自己已经恢复了（§13.4）。
 * ⚠ 预置库里没有这个 id 时一步都不动：那是用户自建的样式，「恢复」它等于无声删除。
 * @param config 当前配置
 * @param id 要恢复的样式 id
 */
export function restoreBuiltinNodeStyle(
  config: Twin2dConfig,
  id: string,
): Twin2dConfig {
  if (!TWIN_2D_BUILTIN_NODE_STYLE_MAP.has(id)) return config
  const styles = config.styles.filter((style) => style.id !== id)
  return styles.length === config.styles.length ? config : { ...config, styles }
}

/**
 * 新建一个连线样式，追加在样式库末尾。
 * @param config 当前配置
 * @param seed 新样式的种子
 * @param makeId id 工厂，缺省随机
 */
export function addEdgeStyle(
  config: Twin2dConfig,
  seed: Partial<Omit<Twin2dEdgeStyle, 'id'>>,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dAdded {
  const id = freshTwin2dId(
    TWIN_2D_EDGE_STYLE_ID_PREFIX,
    idsOf(config.edgeStyles),
    makeId,
  )
  const edgeStyles = [
    ...config.edgeStyles,
    ...normalizeEdgeStyles([{ ...seed, id }]),
  ]
  return { config: { ...config, edgeStyles }, id }
}

/**
 * 复制一份连线样式，追加在样式库末尾。
 * @param config 当前配置
 * @param source 要复制的那一份（文档 ∪ 预置库）
 * @param makeId id 工厂，缺省随机
 */
export function duplicateEdgeStyle(
  config: Twin2dConfig,
  source: Twin2dEdgeStyle,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dAdded {
  const id = freshTwin2dId(source.id, idsOf(config.edgeStyles), makeId)
  const edgeStyles = [
    ...config.edgeStyles,
    ...normalizeEdgeStyles([{ ...source, id }]),
  ]
  return { config: { ...config, edgeStyles }, id }
}

/**
 * 改一份连线样式的若干字段；文档里没有这一条就落一份同 id 的覆盖。
 * @param config 当前配置
 * @param base 当下生效的那一份样式
 * @param patch 要覆盖的字段
 */
export function updateEdgeStyle(
  config: Twin2dConfig,
  base: Twin2dEdgeStyle,
  patch: Partial<Omit<Twin2dEdgeStyle, 'id'>>,
): Twin2dConfig {
  return writeEdgeStyle(config, { ...base, ...patch })
}

/**
 * 删掉一份连线样式；同 id 有预置样式时删的只是那条覆盖。
 * @param config 当前配置
 * @param id 要删的样式 id
 */
export function removeEdgeStyle(
  config: Twin2dConfig,
  id: string,
): Twin2dStyleRemoval {
  const edgeStyles = config.edgeStyles.filter((style) => style.id !== id)
  if (edgeStyles.length === config.edgeStyles.length) {
    return { config, dangling: [] }
  }
  const covered = EDGE_PRESET_MAP.has(id)
  return {
    config: { ...config, edgeStyles },
    dangling: covered ? [] : twin2dEdgeStyleUsage(config, id),
  }
}

/**
 * 恢复内置：删掉文档里那条同 id 的连线样式覆盖，让它落回预置库。
 * @param config 当前配置
 * @param id 要恢复的样式 id
 */
export function restoreBuiltinEdgeStyle(
  config: Twin2dConfig,
  id: string,
): Twin2dConfig {
  if (!EDGE_PRESET_MAP.has(id)) return config
  const edgeStyles = config.edgeStyles.filter((style) => style.id !== id)
  return edgeStyles.length === config.edgeStyles.length
    ? config
    : { ...config, edgeStyles }
}

/**
 * 给一份样式加一个端口。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param seed 新端口的种子；`id` 空着就现造，撞了就加不进去
 * @param makeId id 工厂，缺省随机
 */
export function addPort(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  seed: Twin2dPortSeed,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dAdded {
  const id = wantedOrFresh(
    seed.id ?? '',
    TWIN_2D_PORT_ID_PREFIX,
    idsOf(style.ports),
    makeId,
  )
  if (id === '') return { config, id: null }
  const ports = [...style.ports, ...normalizePorts([{ ...seed, id }])]
  return { config: writeNodeStyle(config, { ...style, ports }), id }
}

/**
 * 换掉一份样式里的一个端口，按 `next.id` 寻址；端口不在就原样返回入参那份配置。
 * ⚠ 改 id 得走「删 + 加」：连线端点按 id 挂，在这里顺手换掉 id 会让挂在它上头的线
 * 悄悄改挂到「朝向对方中心」那一档去，而线还在、图还画得出来。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param next 整个新端口
 */
export function updatePort(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  next: Twin2dPort,
): Twin2dConfig {
  if (!style.ports.some((port) => port.id === next.id)) return config
  const ports = style.ports.map((port) => (port.id === next.id ? next : port))
  return writeNodeStyle(config, { ...style, ports })
}

/**
 * 删掉一份样式里的一个端口。
 * ⚠ 挂在它上头的连线**不跟着删**：端点解析的第三档是「朝向对方中心」，所以线还在，
 * 只是从节点正中出去。诊断面按 `edge-port-missing` 报它。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param portId 要删的端口 id
 */
export function removePort(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  portId: string,
): Twin2dConfig {
  const ports = style.ports.filter((port) => port.id !== portId)
  if (ports.length === style.ports.length) return config
  return writeNodeStyle(config, { ...style, ports })
}

/**
 * 给一份样式加一个槽位；交出的 `id` 就是落地的**槽键**（槽位没有 id，键即身份）。
 * ⚠ 槽位的文档序就是绑定行的行序（§14.2），所以新槽一律**追加在末尾**：插在中间
 * 会让它之后每一行都改喂别的槽位，而这一步要靠 `commit` 重派绑定才不出错。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param seed 新槽位的种子；`key` 空着就现造，撞了就加不进去
 * @param makeId 键工厂，缺省随机
 */
export function addSlot(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  seed: Twin2dSlotSeed,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dAdded {
  const key = wantedOrFresh(
    seed.key ?? '',
    TWIN_2D_SLOT_KEY_PREFIX,
    new Set(style.slots.map((slot) => slot.key)),
    makeId,
  )
  if (key === '') return { config, id: null }
  const slots = [...style.slots, ...normalizeSlots([{ ...seed, key }])]
  return { config: writeNodeStyle(config, { ...style, slots }), id: key }
}

/**
 * 换掉一份样式里的一个槽位，按 `next.key` 寻址；槽位不在就原样返回入参那份配置。
 * ⚠ 改槽键得走「删 + 加」：`txt` 图元的 slot 来源、图元与变体的条件、派生槽算式
 * 四处都按键寻址，在这里顺手换掉键，那四处会一起指空——表现是那一格永远显示占位符。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param next 整个新槽位
 */
export function updateSlot(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  next: Twin2dSlot,
): Twin2dConfig {
  if (!style.slots.some((slot) => slot.key === next.key)) return config
  const slots = style.slots.map((slot) => (slot.key === next.key ? next : slot))
  return writeNodeStyle(config, { ...style, slots })
}

/**
 * 删掉一份样式里的一个槽位。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param key 要删的槽键
 */
export function removeSlot(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  key: string,
): Twin2dConfig {
  const slots = style.slots.filter((slot) => slot.key !== key)
  if (slots.length === style.slots.length) return config
  return writeNodeStyle(config, { ...style, slots })
}

/**
 * 给一份样式加一条变体，追加在末尾（= 最后求值、覆盖前面几条）。
 * ⚠ 条件认不出时交出的是原样的配置与 `id: null`：留一条 `when` 为空的变体，
 * 归一化会在下一次落库时把它整条丢掉，而用户以为自己配好了。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param seed 新变体的种子（至少给一条认得出的 `when`）
 * @param makeId id 工厂，缺省随机
 */
export function addVariant(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  seed: Twin2dVariantSeed,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dAdded {
  const id = freshTwin2dId(
    TWIN_2D_VARIANT_ID_PREFIX,
    idsOf(style.variants),
    makeId,
  )
  const variants = [...style.variants, ...normalizeVariants([{ ...seed, id }])]
  if (variants.length === style.variants.length) return { config, id: null }
  return { config: writeNodeStyle(config, { ...style, variants }), id }
}

/**
 * 换掉一份样式里的一条变体，按 `next.id` 寻址；变体不在就原样返回入参那份配置。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param next 整条新变体
 */
export function updateVariant(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  next: Twin2dVariant,
): Twin2dConfig {
  if (!style.variants.some((variant) => variant.id === next.id)) return config
  const variants = style.variants.map((variant) =>
    variant.id === next.id ? next : variant,
  )
  return writeNodeStyle(config, { ...style, variants })
}

/**
 * 删掉一份样式里的一条变体。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param variantId 要删的变体 id
 */
export function removeVariant(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  variantId: string,
): Twin2dConfig {
  const variants = style.variants.filter((variant) => variant.id !== variantId)
  if (variants.length === style.variants.length) return config
  return writeNodeStyle(config, { ...style, variants })
}

/**
 * 调一条变体在表里的次序。
 * ⚠ 变体按**文档序**求值、后者覆盖前者（§4.5），所以这张表的次序就是渲染结果的一
 * 部分——端口与槽位没有这一支正是因为它们的次序不参与覆盖（槽位那张表的次序只是
 * 绑定行序，动它由 `commit` 重派兜住）。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param variantId 要动的那一条
 * @param move 四档层序
 */
export function orderVariants(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  variantId: string,
  move: Twin2dOrderMove,
): Twin2dConfig {
  const variants = orderList(style.variants, [variantId], move)
  if (variants === style.variants) return config
  return writeNodeStyle(config, { ...style, variants })
}
