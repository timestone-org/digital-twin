/**
 * @fileoverview 样式包的导出与导入（JSON），用于把一张图上的样式搬到另一张大屏。
 * 格式定死为 `{ version, styles[], edgeStyles[] }`——**就是文档里那两张表的原样子集
 * 加一个版本号**。这么定的理由是与落库同源：导入时直接过 `normalizeNodeStyles` /
 * `normalizeEdgeStyles` 就够了，不必写第二套解析；而第二套解析就是第二份口径，
 * 两份口径迟早对同一份 JSON 解出两个样子的样式，且哪一处都不报错。
 *
 * ⚠ id 撞了要能选：覆盖 / 改名并存 / 跳过，**默认改名并存**——静默覆盖会把用户正在
 *   用的那份样式换掉，而这一步没有确认框也没有撤销提示。
 * ⚠ 版本号比本版新的包一律**拒绝并说明**，不「尽力解析」：半懂的解析会产出一份看着
 *   对、细节全错的样式，而用户以为自己导进来了。
 * ⚠ 只搬样式，不搬节点与连线：包里没有实例，所以改名不牵连任何东西。
 */
import {
  TWIN_2D_CONFIG_VERSION,
  isRecord,
  normalizeEdgeStyles,
  normalizeNodeStyles,
  toArray,
  toFiniteNumber,
} from '@dt/twin2d'
import type { Twin2dConfig, Twin2dEdgeStyle, Twin2dNodeStyle } from '@dt/twin2d'

import { freshTwin2dId, newTwin2dId } from './nodeOps'
import type { Twin2dIdFactory } from './nodeOps'

/**
 * 样式包的版本号。
 * ⚠ 与文档版本钉在一起：包里装的就是文档那两张表，两者的形状只会一起变，
 * 各记一个号会让「这份包配不配得上这个编辑器」变成两个问题。
 */
export const TWIN_2D_STYLE_PACKAGE_VERSION = TWIN_2D_CONFIG_VERSION

/** 一份样式包。 */
export interface Twin2dStylePackage {
  version: number
  styles: readonly Twin2dNodeStyle[]
  edgeStyles: readonly Twin2dEdgeStyle[]
}

/** id 撞了怎么办的三档。 */
export const TWIN_2D_IMPORT_MODES = ['rename', 'overwrite', 'skip'] as const

/** id 撞了怎么办：改名并存（缺省）/ 覆盖现有的 / 跳过这一条。 */
export type Twin2dImportMode = (typeof TWIN_2D_IMPORT_MODES)[number]

/** 一次改名：原 id → 落地的新 id。 */
export interface Twin2dIdRename {
  from: string
  to: string
}

/** 一类样式导进来之后的账。 */
export interface Twin2dImportReport {
  /** 新落地的 id；改名的那些记的是**新** id。 */
  added: readonly string[]
  /** 撞了改名的那些。 */
  renamed: readonly Twin2dIdRename[]
  /** 撞了覆盖掉的那些。 */
  overwritten: readonly string[]
  /** 撞了跳过的那些。 */
  skipped: readonly string[]
}

/** 一次导入的结果：新配置，加两类样式各自的账。 */
export interface Twin2dImportResult {
  config: Twin2dConfig
  styles: Twin2dImportReport
  edgeStyles: Twin2dImportReport
}

/** 读一份样式包的结果：读得出就给包，读不出就给一句能照着改的话。 */
export type Twin2dPackageRead =
  | {
      ok: true
      pkg: Twin2dStylePackage
      /** 归一化没收下的条目数（缺 id、同 id 重复）；两类合计。 */
      dropped: number
    }
  | { ok: false; reason: string }

/** 最早的包版本。 */
const FIRST_VERSION = 1

/** 合并时的一批入参；摊成参数会超过五个。 */
interface Twin2dMerge<T extends { id: string }> {
  existing: readonly T[]
  incoming: readonly T[]
  mode: Twin2dImportMode
  /** 换 id 生一份新的；泛型里直接 `{ ...item, id }` 收窄不回 `T`。 */
  rename: (item: T, id: string) => T
  makeId: Twin2dIdFactory
}

/** 合并过程中攒的那几笔账。 */
interface Twin2dMergeState<T> {
  list: readonly T[]
  taken: Set<string>
  added: string[]
  renamed: Twin2dIdRename[]
  overwritten: string[]
  skipped: string[]
}

/**
 * 收下一条：没撞就追加，撞了按三档之一处理。
 * @param state 攒到这一条为止的账
 * @param item 这一条
 * @param input 这一批的入参
 */
function takeOne<T extends { id: string }>(
  state: Twin2dMergeState<T>,
  item: T,
  input: Twin2dMerge<T>,
): void {
  if (!state.taken.has(item.id)) {
    state.taken.add(item.id)
    state.list = [...state.list, item]
    state.added.push(item.id)
    return
  }
  if (input.mode === 'skip') {
    state.skipped.push(item.id)
    return
  }
  if (input.mode === 'overwrite') {
    state.list = state.list.map((row) => (row.id === item.id ? item : row))
    state.overwritten.push(item.id)
    return
  }
  // ⚠ 新 id 以原 id 打头（`boiler` → `boiler-3f2a1c`）：换成一串纯随机的，
  //   用户在样式库里再也认不出这条是从哪儿来的
  const id = freshTwin2dId(item.id, state.taken, input.makeId)
  state.taken.add(id)
  state.list = [...state.list, input.rename(item, id)]
  state.added.push(id)
  state.renamed.push({ from: item.id, to: id })
}

/**
 * 把一批样式并进现有的那一批。
 * @param input 这一批的入参
 */
function mergeInto<T extends { id: string }>(
  input: Twin2dMerge<T>,
): { list: readonly T[]; report: Twin2dImportReport } {
  const state: Twin2dMergeState<T> = {
    list: input.existing,
    taken: new Set(input.existing.map((item) => item.id)),
    added: [],
    renamed: [],
    overwritten: [],
    skipped: [],
  }
  for (const item of input.incoming) takeOne(state, item, input)
  return {
    list: state.list,
    report: {
      added: state.added,
      renamed: state.renamed,
      overwritten: state.overwritten,
      skipped: state.skipped,
    },
  }
}

/**
 * 攒一份样式包。
 * ⚠ 这里**不归一化**：交出去的就是文档里那两张表的原样子集，所以「导出再导入」得到
 * 的与原样式逐字相同。要清洗留给导入那一侧，两边都洗会让「往返一致」这条断在导出这
 * 一步——而断在导出这一步是看不出来的，包看着一切正常。
 * @param styles 要带走的节点样式（文档 ∪ 预置库，调用方挑好）
 * @param edgeStyles 要带走的连线样式
 */
export function exportTwin2dStylePackage(
  styles: readonly Twin2dNodeStyle[],
  edgeStyles: readonly Twin2dEdgeStyle[],
): Twin2dStylePackage {
  return {
    version: TWIN_2D_STYLE_PACKAGE_VERSION,
    styles: [...styles],
    edgeStyles: [...edgeStyles],
  }
}

/**
 * 样式包 → 落盘的 JSON 文本。
 * @param pkg 一份样式包
 */
export function twin2dStylePackageText(pkg: Twin2dStylePackage): string {
  return JSON.stringify(pkg, null, 2)
}

// ⚠ 不直接用 `Array.isArray`：它会把 unknown 收窄成 any[]，取出来的元素绕过全部类型检查
function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

/** 一份 JSON 文本解出来的顶层对象；解不出给 null。 */
function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    // JSON.parse 只会因为语法错误抛，错在文本里、不在这里，所以不往上抛
    return null
  }
}

/**
 * 版本号读得出且认得下时给 null，否则给一句能照着改的话。
 * @param raw 原始 version
 */
function versionReason(raw: unknown): string | null {
  const version = toFiniteNumber(raw)
  if (
    version === null ||
    !Number.isInteger(version) ||
    version < FIRST_VERSION
  ) {
    return '这份 JSON 没写版本号（version），不像是从这里导出的样式包。'
  }
  if (version > TWIN_2D_STYLE_PACKAGE_VERSION) {
    return `这份样式包是第 ${version} 版，本编辑器只认到第 ${TWIN_2D_STYLE_PACKAGE_VERSION} 版，请升级后再导入。`
  }
  return null
}

/**
 * 读一份样式包。
 * ⚠ 比本版新的一律拒绝：半懂的解析会产出一份看着对、细节全错的样式（§4 的版本口径）。
 * ⚠ 两张表都不是数组时也拒绝：那多半是拿错了文件（比如整份大屏的导出），
 * 当成「空样式包」收下的话，界面上只会显示「导入了 0 个」，而用户以为是包坏了。
 * @param text JSON 文本
 */
export function readTwin2dStylePackage(text: string): Twin2dPackageRead {
  const source = parseObject(text)
  if (source === null) {
    return { ok: false, reason: '这不是一份能解析的 JSON 对象。' }
  }
  const reason = versionReason(source['version'])
  if (reason !== null) return { ok: false, reason }
  const rawStyles = source['styles']
  const rawEdgeStyles = source['edgeStyles']
  if (!isList(rawStyles) && !isList(rawEdgeStyles)) {
    return {
      ok: false,
      reason: '这份 JSON 里没有 styles 或 edgeStyles，不是一份样式包。',
    }
  }
  const styles = normalizeNodeStyles(rawStyles)
  const edgeStyles = normalizeEdgeStyles(rawEdgeStyles)
  const seen = toArray(rawStyles).length + toArray(rawEdgeStyles).length
  return {
    ok: true,
    // ⚠ 读出来的包一律标本版：内容已经过本版归一化，标着旧号会让下一手再导出时
    //   产出一份自称旧版、内容却是新版的包
    pkg: { version: TWIN_2D_STYLE_PACKAGE_VERSION, styles, edgeStyles },
    dropped: seen - styles.length - edgeStyles.length,
  }
}

/**
 * 把一份样式包并进当前配置。
 * ⚠ 缺省是**改名并存**：静默覆盖会把用户正在用的那份样式换掉，而这一步没有确认框，
 * 撤销栈上也只表现为「导入」一格。
 * ⚠ 只动两张样式表，节点与连线一根都不碰：包里没有实例，改名因此不牵连任何东西。
 * @param config 当前配置
 * @param pkg 已经读出来的样式包
 * @param mode id 撞了怎么办，缺省改名并存
 * @param makeId id 工厂，缺省随机
 */
export function importTwin2dStyles(
  config: Twin2dConfig,
  pkg: Twin2dStylePackage,
  mode: Twin2dImportMode = 'rename',
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dImportResult {
  const nodes = mergeInto<Twin2dNodeStyle>({
    existing: config.styles,
    incoming: pkg.styles,
    mode,
    rename: (style, id) => ({ ...style, id }),
    makeId,
  })
  const edges = mergeInto<Twin2dEdgeStyle>({
    existing: config.edgeStyles,
    incoming: pkg.edgeStyles,
    mode,
    rename: (style, id) => ({ ...style, id }),
    makeId,
  })
  // 一条都没落地时原样返回入参那份配置：换了新引用却什么都没改，撤销键上就多出一格
  // 按了没反应的空步（`mergeInto` 没收下任何一条时交回的就是入参那张表）
  const still = nodes.list === config.styles && edges.list === config.edgeStyles
  return {
    config: still
      ? config
      : { ...config, styles: nodes.list, edgeStyles: edges.list },
    styles: nodes.report,
    edgeStyles: edges.report,
  }
}
