/**
 * @fileoverview 诊断面的入口，吃**原始** JSON。两族问题都不让渲染报错，只让配好的
 * 东西安静地不出现——静默降级对人尚可忍受，对 Agent 是致命的：这里是引用完整性那一
 * 族（悬空的样式 / 端口 / 槽 / 图元 id / 变体补丁 id / 渐变、画布外拐点），跑在归一化输出上；
 * 「归一化整条丢掉了什么」那一族在 `issuesDropped.ts`，跑在原始文档上。
 * ⚠ 诊断只在编辑器的诊断面板里跑、不在渲染路径上，所以入口自己再归一化一趟无所谓；
 * 换来的是两族判据都能拿到自己需要的那份文档。
 * ⚠ 引用完整性那一族的 `at` 用的是归一化输出的下标，丢弃那一族用的是原始下标：
 * 同一份文档里若两族都有，先按丢弃那一族把脏条目清掉，下标才会重合。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.2、§7 #45、§9.5。
 */
import { collectTwin2dDroppedIssues } from './issuesDropped'
import { normalizeTwin2dConfig } from './normalize'
import type { Twin2dIssue } from './issueTypes'
import type { Twin2dCondition, Twin2dExpr, Twin2dPrim } from './typesPrim'
import type {
  Twin2dConfig,
  Twin2dNode,
  Twin2dNodeStyle,
  Twin2dWaypoint,
} from './types'

/** 按 id 取一个节点样式；取不到返回 null。 */
type Twin2dStyleLookup = (id: string) => Twin2dNodeStyle | null

/** 图元树上的一个位置：图元本身与它的字段路径。 */
interface Twin2dPrimSite {
  prim: Twin2dPrim
  at: string
}

/** 一处槽引用：引到的键与写着它的字段路径。 */
interface Twin2dSlotRef {
  key: string
  at: string
}

function walkPrims(prims: readonly Twin2dPrim[], at: string): Twin2dPrimSite[] {
  return prims.flatMap((prim, index) => {
    const here = `${at}[${index}]`
    const site: Twin2dPrimSite = { prim, at: here }
    if (prim.kind !== 'box') return [site]
    return [site, ...walkPrims(prim.children, `${here}.children`)]
  })
}

/** 样式里的图元树与节点追加的图元树，摊平成带路径的位置表。 */
function primSites(config: Twin2dConfig): Twin2dPrimSite[] {
  const inStyles = config.styles.flatMap((style, index) =>
    walkPrims(style.prims, `styles[${index}].prims`),
  )
  const inNodes = config.nodes.flatMap((node, index) =>
    walkPrims(node.layers, `nodes[${index}].layers`),
  )
  return [...inStyles, ...inNodes]
}

/** 文档里的样式优先，落不到才问注入的预置库（同 id 以文档为准，§13.4）。 */
function styleResolver(
  config: Twin2dConfig,
  styleOf: Twin2dStyleLookup | null,
): Twin2dStyleLookup {
  const inDoc = new Map(config.styles.map((style) => [style.id, style]))
  return (id) => inDoc.get(id) ?? styleOf?.(id) ?? null
}

/**
 * 节点引的样式既不在文档里也不在预置库里。
 * ⚠ 渲染层对这种节点是「落 `__fallback` 兜底样式」——不报出来的话，用户看到的是
 * 一条 3px 竖条加显示名，而配置里明明选着某个具体样式。
 */
function danglingStyles(
  config: Twin2dConfig,
  known: ReadonlySet<string>,
): Twin2dIssue[] {
  return config.nodes
    .map((node, index) => ({ node, index }))
    .filter((ref) => !known.has(ref.node.styleId))
    .map((ref) => ({
      level: 'error' as const,
      code: 'dangling-style' as const,
      message: `找不到节点样式 ${ref.node.styleId}，这个节点会落到 __fallback 兜底样式`,
      at: `nodes[${ref.index}].styleId`,
    }))
}

function portIdsOf(style: Twin2dNodeStyle, node: Twin2dNode): Set<string> {
  return new Set([...style.ports, ...node.ports].map((port) => port.id))
}

/** 一处端点的引脚引用：引到的节点与端口，以及写着它的字段路径。 */
interface Twin2dPortRef {
  nodeId: string
  portId: string
  at: string
}

/** 两端各算一处；空 `portId` 不算——空 = 不钉引脚，由几何层朝对方中心自己选边。 */
function portRefs(config: Twin2dConfig): Twin2dPortRef[] {
  return config.edges
    .flatMap((edge, index) => [
      {
        nodeId: edge.from.nodeId,
        portId: edge.from.portId,
        at: `edges[${index}].from.portId`,
      },
      {
        nodeId: edge.to.nodeId,
        portId: edge.to.portId,
        at: `edges[${index}].to.portId`,
      },
    ])
    .filter((ref) => ref.portId !== '')
}

/**
 * 一端指到目标节点身上不存在的端口。
 * ⚠ 端点解析三级里 `portId` 落空只是退到「朝向对方中心」——不报出来的话，用户看到的
 * 是线还在、只是接错了地方，而这与「引脚位置没调好」长得一模一样。
 * ⚠ 按节点走而不是按连线走：归一化把指向不在册节点的连线整条丢掉了（那一条由
 * `dropped-edge` 报），所以走到这里的每个端点都必然落在某个在册节点上。
 */
function danglingPorts(
  config: Twin2dConfig,
  styleFor: Twin2dStyleLookup,
): Twin2dIssue[] {
  const refs = portRefs(config)
  return config.nodes.flatMap((node) => {
    const style = styleFor(node.styleId)
    if (style === null) return []
    const known = portIdsOf(style, node)
    return refs
      .filter((ref) => ref.nodeId === node.id && !known.has(ref.portId))
      .map((ref) => ({
        level: 'error' as const,
        code: 'dangling-port' as const,
        message: `节点 ${node.id} 上没有端口 ${ref.portId}，这一端会退回朝向对方中心`,
        at: ref.at,
      }))
  })
}

function exprSlotRefs(expr: Twin2dExpr, at: string): Twin2dSlotRef[] {
  switch (expr.kind) {
    case 'slot':
      return [{ key: expr.slot, at: `${at}.slot` }]
    case 'ratio':
      return [
        ...exprSlotRefs(expr.num, `${at}.num`),
        ...exprSlotRefs(expr.den, `${at}.den`),
      ]
    case 'scale':
      return exprSlotRefs(expr.of, `${at}.of`)
    case 'first':
    case 'sum':
    case 'join':
      return expr.of.flatMap((item, index) =>
        exprSlotRefs(item, `${at}.of[${index}]`),
      )
    default:
      return []
  }
}

function conditionSlotRefs(
  condition: Twin2dCondition,
  at: string,
): Twin2dSlotRef[] {
  switch (condition.kind) {
    case 'slot':
      return [{ key: condition.slot, at: `${at}.slot` }]
    case 'has':
      return condition.slots.map((key, index) => ({
        key,
        at: `${at}.slots[${index}]`,
      }))
    case 'not':
      return conditionSlotRefs(condition.of, `${at}.of`)
    default:
      return []
  }
}

function primSlotRefs(sites: readonly Twin2dPrimSite[]): Twin2dSlotRef[] {
  return sites.flatMap((site) =>
    site.prim.kind === 'txt' && site.prim.src.kind === 'slot'
      ? [{ key: site.prim.src.slot, at: `${site.at}.src.slot` }]
      : [],
  )
}

/**
 * 引到的槽键不在可用槽里。
 * ⚠ 空键到不了这里：「这一处还没选槽」在归一化时就退成了别的档（`txt` 退成空
 * 字面量，算式与条件整条丢弃），它与「选了一个不存在的」本就是两件事。
 */
function slotIssues(
  refs: readonly Twin2dSlotRef[],
  keys: ReadonlySet<string>,
): Twin2dIssue[] {
  return refs
    .filter((ref) => !keys.has(ref.key))
    .map((ref) => ({
      level: 'warn' as const,
      code: 'dangling-slot' as const,
      message: `找不到槽位 ${ref.key}，这一格永远只显示占位符`,
      at: ref.at,
    }))
}

function styleSlotRefs(
  style: Twin2dNodeStyle,
  at: string,
  sites: readonly Twin2dPrimSite[],
): Twin2dSlotRef[] {
  const fromExprs = style.slots.flatMap((slot, index) =>
    slot.expr === null
      ? []
      : exprSlotRefs(slot.expr, `${at}.slots[${index}].expr`),
  )
  const fromVariants = style.variants.flatMap((variant, index) =>
    conditionSlotRefs(variant.when, `${at}.variants[${index}].when`),
  )
  return [...primSlotRefs(sites), ...fromExprs, ...fromVariants]
}

/** 样式内三处槽引用：`txt` 图元、变体条件、派生槽算式。 */
function styleSlotIssues(config: Twin2dConfig): Twin2dIssue[] {
  return config.styles.flatMap((style, index) => {
    const at = `styles[${index}]`
    const sites = walkPrims(style.prims, `${at}.prims`)
    const keys = new Set(style.slots.map((slot) => slot.key))
    return slotIssues(styleSlotRefs(style, at, sites), keys)
  })
}

/** 节点追加的图元与追加的派生槽；可用槽 = 样式槽 ∪ 节点追加槽。 */
function nodeSlotIssues(
  config: Twin2dConfig,
  styleFor: Twin2dStyleLookup,
): Twin2dIssue[] {
  return config.nodes.flatMap((node, index) => {
    const style = styleFor(node.styleId)
    if (style === null) return []
    const at = `nodes[${index}]`
    const sites = walkPrims(node.layers, `${at}.layers`)
    const keys = new Set([...style.slots, ...node.slots].map((s) => s.key))
    const fromExprs = node.slots.flatMap((slot, slotIndex) =>
      slot.expr === null
        ? []
        : exprSlotRefs(slot.expr, `${at}.slots[${slotIndex}].expr`),
    )
    return slotIssues([...primSlotRefs(sites), ...fromExprs], keys)
  })
}

/**
 * 节点级覆盖补丁的键在图元树里找不到。
 * ⚠ 浅合并对这种键是「一句也不生效」——不报出来的话，用户看到的是「改了配置画面没动」。
 */
function danglingPatchKeys(
  config: Twin2dConfig,
  styleFor: Twin2dStyleLookup,
): Twin2dIssue[] {
  return config.nodes.flatMap((node, index) => {
    const style = styleFor(node.styleId)
    if (style === null) return []
    const sites = [...walkPrims(style.prims, ''), ...walkPrims(node.layers, '')]
    const ids = new Set(sites.map((site) => site.prim.id))
    return Object.keys(node.patch)
      .filter((key) => !ids.has(key))
      .map((key) => ({
        level: 'warn' as const,
        code: 'dangling-prim' as const,
        message: `图元树里没有 ${key}，这条覆盖补丁一句也不会生效`,
        at: `nodes[${index}].patch.${key}`,
      }))
  })
}

/** 用这个样式的节点各自追加的图元 id：变体补丁按 id 寻址，追加层也在寻址范围内。 */
function layerIdsOf(config: Twin2dConfig, styleId: string): Set<string> {
  const ids = new Set<string>()
  for (const node of config.nodes) {
    if (node.styleId !== styleId) continue
    for (const site of walkPrims(node.layers, '')) ids.add(site.prim.id)
  }
  return ids
}

/**
 * 变体补丁的键在图元树里找不到。
 * ⚠ 与 `dangling-prim` 是两条不同的问题：那一条是节点级覆盖补丁，这一条是变体补丁，
 * 同一个错字在两处的字段路径完全不同，合成一条就没法照着找过去。
 * ⚠ 用这个样式的节点追加的图元也算数：变体是并过 `layers` 之后才应用的，所以只在
 * 某个节点上存在的图元 id 是一条真能生效的补丁（§9.2）。
 */
function danglingVariantKeys(config: Twin2dConfig): Twin2dIssue[] {
  return config.styles.flatMap((style, index) => {
    const own = walkPrims(style.prims, '').map((site) => site.prim.id)
    const ids = new Set([...own, ...layerIdsOf(config, style.id)])
    return style.variants.flatMap((variant, slot) =>
      Object.keys(variant.patch)
        .filter((key) => !ids.has(key))
        .map((key) => ({
          level: 'warn' as const,
          code: 'dangling-variant-prim' as const,
          message: `图元树里没有 ${key}，变体 ${variant.id} 的这条补丁一句也不会生效`,
          at: `styles[${index}].variants[${slot}].patch.${key}`,
        })),
    )
  })
}

/**
 * `vec` 的填充引了一个本图元里没有的渐变 id。
 * ⚠ SVG 对这种 `fill="url(#缺)"` 是整个不上色——只剩描边，看着像「填充色配错了」。
 */
function danglingGradients(sites: readonly Twin2dPrimSite[]): Twin2dIssue[] {
  return sites.flatMap((site) => {
    const prim = site.prim
    if (prim.kind !== 'vec' || prim.fill.kind !== 'gradient') return []
    const known = new Set(prim.gradients.map((item) => item.id))
    if (known.has(prim.fill.id)) return []
    return [
      {
        level: 'error' as const,
        code: 'dangling-gradient' as const,
        message: `本图元里没有渐变 ${prim.fill.id}，这一笔会整个不上色`,
        at: `${site.at}.fill.id`,
      },
    ]
  })
}

function isOutsideCanvas(
  point: Twin2dWaypoint,
  width: number,
  height: number,
): boolean {
  return point.x < 0 || point.y < 0 || point.x > width || point.y > height
}

/** 拐点落在画布外：线会绕出可视区，两端却都还接得好好的。 */
function outOfCanvasWaypoints(config: Twin2dConfig): Twin2dIssue[] {
  const { width, height } = config.canvas
  return config.edges.flatMap((edge, index) =>
    edge.waypoints
      .map((point, slot) => ({ point, slot }))
      .filter((ref) => isOutsideCanvas(ref.point, width, height))
      .map((ref) => ({
        level: 'warn' as const,
        code: 'waypoint-out-of-canvas' as const,
        message: `拐点 (${ref.point.x}, ${ref.point.y}) 在 ${width}×${height} 的画布外，这条线会绕出可视区`,
        at: `edges[${index}].waypoints[${ref.slot}]`,
      })),
  )
}

/** 诊断入口的可选注入。 */
export interface Twin2dIssueOptions {
  /** 预置库里的样式 id，与文档里的样式合起来算「认识」。 */
  knownStyleIds?: ReadonlySet<string>
  /** 按 id 取预置样式，用于查端口 / 槽 / 图元 id。 */
  styleOf?: (id: string) => Twin2dNodeStyle | null
}

/**
 * 收齐一份文档的全部诊断，按引用完整性 → 越界 → 丢弃的顺序；没有问题返回空数组。
 * ⚠ 吃的是**原始** JSON，归一化在这里面做：丢弃那一族只有拿原始文档才查得到，
 * 拿归一化输出跑它永远是空的（§4.2）。
 * @param raw 落库的 `configJson.twin2d` 配置块
 * @param options 预置样式库的注入；不给则只认文档里的样式
 */
export function collectTwin2dIssues(
  raw: unknown,
  options: Twin2dIssueOptions = {},
): Twin2dIssue[] {
  const config = normalizeTwin2dConfig(raw)
  const styleFor = styleResolver(config, options.styleOf ?? null)
  const known = new Set([
    ...config.styles.map((style) => style.id),
    ...(options.knownStyleIds ?? []),
  ])
  const sites = primSites(config)
  return [
    ...danglingStyles(config, known),
    ...danglingPorts(config, styleFor),
    ...styleSlotIssues(config),
    ...nodeSlotIssues(config, styleFor),
    ...danglingPatchKeys(config, styleFor),
    ...danglingVariantKeys(config),
    ...danglingGradients(sites),
    ...outOfCanvasWaypoints(config),
    ...collectTwin2dDroppedIssues(raw, config),
  ]
}
