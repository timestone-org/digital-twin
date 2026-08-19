/**
 * @fileoverview 节点剪贴板：内存与 localStorage 两个通道，同浏览器里跨大屏、
 * 跨标签页都粘得出来。payload 剥掉后端 id，用局部键 ck/parentCk 保住容器子树结构，
 * 粘贴时全部重发 id；坐标保持原层局部像素，粘贴方按目标层夹取并加 16px 逐次累加的偏移。
 * 选中集内部闭合的联动规则跟着一起走，粘贴时按 ck → 新 id 重映射。
 */
import type {
  BindingPayload,
  DashboardNodePayload,
  InteractionAction,
  InteractionEventName,
  InteractionRule,
} from '@dt/contracts'

import { newClientUuid } from '@/api/idempotency'
import { topMostIds } from './editorDoc'

/** 剪贴板里的一条绑定：id 与归属都在粘贴时重建。 */
export interface ClipboardBinding {
  fieldKey: string
  sourceKind: BindingPayload['sourceKind']
  nodeKey: string | null
  staticValueJson: BindingPayload['staticValueJson']
  computeJson: BindingPayload['computeJson']
  detailJson: BindingPayload['detailJson']
  transformJson: BindingPayload['transformJson']
}

/** 剪贴板里的一个节点；`ck` 是 payload 内局部键，`parentCk: null` 即复制根。 */
export interface ClipboardNode {
  moduleType: string
  x: number
  y: number
  w: number
  h: number
  isVisible: boolean
  configJson: Record<string, unknown>
  bindings: ClipboardBinding[]
  ck: string
  parentCk: string | null
}

/** 剪贴板里的一条联动规则；规则 id 与节点引用都在粘贴时重建。 */
export interface ClipboardRule {
  sourceCk: string
  event: InteractionEventName
  /** ⚠ 动作里的节点引用装的是 ck，不是 id。 */
  action: InteractionAction
}

/** 载荷版本：形状一变就加一，读到别的版本一律当没有。 */
const CLIPBOARD_VERSION = 2

export interface ClipboardPayload {
  version: typeof CLIPBOARD_VERSION
  /** 复制时刻；跨标签页只用来比新旧。 */
  stampMs: number
  nodes: ClipboardNode[]
  rules: ClipboardRule[]
}

/** 一次复制的产物：载荷，加上因目标全在复制范围外而整条丢掉的规则数。 */
export interface ClipboardDraft {
  payload: ClipboardPayload
  droppedRules: number
}

const STORAGE_KEY = 'dt.editor.clipboard'
const PASTE_OFFSET_PX = 16

let memory: ClipboardPayload | null = null
let pasteSeq = 0

/** JSONB 值的深拷贝；JSON 往返顺带丢掉 undefined，与落库形状一致。 */
function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function packBinding(binding: BindingPayload): ClipboardBinding {
  return {
    fieldKey: binding.fieldKey,
    sourceKind: binding.sourceKind,
    nodeKey: binding.nodeKey,
    staticValueJson: jsonClone(binding.staticValueJson),
    computeJson: jsonClone(binding.computeJson),
    detailJson: jsonClone(binding.detailJson),
    transformJson: jsonClone(binding.transformJson),
  }
}

/**
 * 把动作里的节点引用逐个换掉：`map` 给 null 即这个目标出局，目标全出局时整条
 * 动作作废。复制时拿它筛掉范围外的目标，粘贴时拿它把 ck 换成新 id。
 * ⚠ `navigate` / `navigateByValue` 的 target 是**大屏句柄**不是节点 id，不参与
 * 替换——跨屏粘过去仍指向原来那张屏，那正是要的行为。
 */
function remapAction(
  action: InteractionAction,
  map: (nodeId: string) => string | null,
): InteractionAction | null {
  const pick = (ids: readonly string[]): string[] =>
    ids.map(map).filter((id): id is string => id !== null)
  if (
    action.type === 'show' ||
    action.type === 'hide' ||
    action.type === 'toggle'
  ) {
    const targets = pick(action.targets)
    return targets.length === 0 ? null : { type: action.type, targets }
  }
  if (action.type === 'setActive') {
    const groups = action.groups
      .map((group) => ({ value: group.value, targets: pick(group.targets) }))
      .filter((group) => group.targets.length > 0)
    return groups.length === 0 ? null : { type: 'setActive', groups }
  }
  if (action.type === 'openModal') {
    const target = map(action.target)
    return target === null ? null : { ...action, target }
  }
  return action
}

/**
 * 收规则：源节点在复制集内的才算这次复制的规则；动作目标只留集内的，
 * 全落在集外的整条丢弃并计数（部分目标出局的照常裁剪着带走）。
 */
function packRules(
  rules: readonly InteractionRule[],
  inScope: ReadonlySet<string>,
): { rules: ClipboardRule[]; dropped: number } {
  const out: ClipboardRule[] = []
  let dropped = 0
  for (const rule of rules) {
    if (!inScope.has(rule.source.nodeId)) continue
    const action = remapAction(rule.action, (nodeId) =>
      inScope.has(nodeId) ? nodeId : null,
    )
    if (action === null) {
      dropped += 1
      continue
    }
    out.push({
      sourceCk: rule.source.nodeId,
      event: rule.source.event,
      action: jsonClone(action),
    })
  }
  return { rules: out, dropped }
}

/** 由选中集摊平出要复制的节点：整棵容器子树，父先子后。 */
function packNodes(
  nodes: readonly DashboardNodePayload[],
  roots: readonly DashboardNodePayload[],
): ClipboardNode[] {
  const out: ClipboardNode[] = []
  const seen = new Set<string>()
  const queue: { node: DashboardNodePayload; parentCk: string | null }[] =
    roots.map((node) => ({ node, parentCk: null }))
  while (queue.length > 0) {
    const entry = queue.shift()
    if (entry === undefined || seen.has(entry.node.id)) continue
    seen.add(entry.node.id)
    out.push({
      moduleType: entry.node.moduleType,
      x: entry.node.x,
      y: entry.node.y,
      w: entry.node.w,
      h: entry.node.h,
      isVisible: entry.node.isVisible,
      configJson: jsonClone(entry.node.configJson),
      bindings: entry.node.bindings.map(packBinding),
      ck: entry.node.id,
      parentCk: entry.parentCk,
    })
    for (const child of nodes) {
      if (child.parentId === entry.node.id) {
        queue.push({ node: child, parentCk: entry.node.id })
      }
    }
  }
  return out
}

/**
 * 由选中集构建剪贴板载荷：含整棵容器子树，加上选中集内部闭合的联动规则。
 * 没有可复制的根时给 null——头/底钉位节点是单例，复制它只会粘出第二个然后被拒。
 * @param isRegionType 判定某模块是不是钉位单例
 * @param rules 当前大屏的联动规则表
 */
export function buildClipboardPayload(
  nodes: readonly DashboardNodePayload[],
  selectedIds: readonly string[],
  isRegionType: (moduleType: string) => boolean,
  rules: readonly InteractionRule[],
): ClipboardDraft | null {
  const byId = new Map(nodes.map((node) => [node.id, node] as const))
  const roots = topMostIds(nodes, selectedIds)
    .map((id) => byId.get(id))
    .filter(
      (node): node is DashboardNodePayload =>
        node !== undefined && !isRegionType(node.moduleType),
    )
  if (roots.length === 0) return null

  const packed = packNodes(nodes, roots)
  const carried = packRules(rules, new Set(packed.map((item) => item.ck)))
  return {
    payload: {
      version: CLIPBOARD_VERSION,
      stampMs: Date.now(),
      nodes: packed,
      rules: carried.rules,
    },
    droppedRules: carried.dropped,
  }
}

/** 换上新的一份并把粘贴偏移归零：刚复制的东西该从第一格偏移贴起。 */
function adopt(payload: ClipboardPayload): void {
  memory = payload
  pasteSeq = 0
}

/** 写剪贴板；localStorage 是 best-effort，禁用时内存通道仍在。 */
export function writeClipboard(payload: ClipboardPayload): void {
  adopt(payload)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* Safari 无痕或配额满：丢跨屏通道不该把复制整个弄失败 */
  }
}

/** 脏数据防御：只认本版本、节点非空、规则是数组、时刻是数字。 */
function isPayload(value: unknown): value is ClipboardPayload {
  if (typeof value !== 'object' || value === null) return false
  const shape = value as Partial<ClipboardPayload>
  return (
    shape.version === CLIPBOARD_VERSION &&
    typeof shape.stampMs === 'number' &&
    Array.isArray(shape.nodes) &&
    shape.nodes.length > 0 &&
    Array.isArray(shape.rules)
  )
}

/** localStorage 里的那份；取不到、坏形或版本不符一律当没有。 */
function stored(): ClipboardPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return isPayload(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * 读剪贴板：两个通道里按复制时刻取新的那份。
 * ⚠ 不许内存优先——另一个标签页后来复制的那份更新，内存优先会让这个标签页
 * 永远粘出旧货，而且没有任何报错。
 */
export function readClipboard(): ClipboardPayload | null {
  const outside = stored()
  if (
    outside !== null &&
    (memory === null || outside.stampMs > memory.stampMs)
  ) {
    adopt(outside)
  }
  return memory
}

/** 下一次粘贴的偏移像素：16 逐次累加，换上新的一份时归零。 */
export function nextPasteOffset(): number {
  pasteSeq += 1
  return pasteSeq * PASTE_OFFSET_PX
}

/** 清空剪贴板与偏移计数，供测试隔离。 */
export function __resetClipboard(): void {
  memory = null
  pasteSeq = 0
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 同上：拿不到 localStorage 就只清内存 */
  }
}

/** 一次粘贴的产物：新的节点表、新建节点的 id，与要追加的联动规则。 */
export interface PasteResult {
  nodes: DashboardNodePayload[]
  pastedIds: readonly string[]
  rules: InteractionRule[]
}

/** 本地草稿节点的时刻，保存后由服务端的值取代。 */
function draftMoment(): string {
  return new Date().toISOString()
}

/** 一条绑定的克隆：id 与归属重发，JSONB 值一律深拷贝。 */
function cloneBinding(
  binding: ClipboardBinding,
  nodeId: string,
  moment: string,
): BindingPayload {
  return {
    id: newClientUuid(),
    nodeId,
    fieldKey: binding.fieldKey,
    sourceKind: binding.sourceKind,
    nodeKey: binding.nodeKey,
    staticValueJson: jsonClone(binding.staticValueJson),
    computeJson: jsonClone(binding.computeJson),
    detailJson: jsonClone(binding.detailJson),
    transformJson: jsonClone(binding.transformJson),
    createdAt: moment,
    updatedAt: moment,
  }
}

/** 子按 ck→新 id 认父；根一律落到目标层。 */
function parentIdOf(
  item: ClipboardNode,
  idOf: ReadonlyMap<string, string>,
  targetParentId: string | null,
): string | null {
  if (item.parentCk === null) return targetParentId
  return idOf.get(item.parentCk) ?? targetParentId
}

/** 单个节点的重建：id / 父 / 层序由调用方定，根另加粘贴偏移。 */
function rebuildNode(input: {
  item: ClipboardNode
  id: string
  dashboardId: string
  parentId: string | null
  isRoot: boolean
  offset: number
  zIndex: number
  moment: string
}): DashboardNodePayload {
  const { item, id, isRoot, moment } = input
  return {
    id,
    dashboardId: input.dashboardId,
    parentId: input.parentId,
    clientKey: null,
    moduleType: item.moduleType,
    x: isRoot ? item.x + input.offset : item.x,
    y: isRoot ? item.y + input.offset : item.y,
    w: item.w,
    h: item.h,
    zIndex: input.zIndex,
    isVisible: item.isVisible,
    configJson: jsonClone(item.configJson),
    bindings: item.bindings.map((binding) => cloneBinding(binding, id, moment)),
    createdAt: moment,
    updatedAt: moment,
  }
}

/** 规则的重建：源与目标按 ck → 新 id 换过来，规则 id 重发。 */
function rebuildRules(
  packed: readonly ClipboardRule[],
  idOf: ReadonlyMap<string, string>,
): InteractionRule[] {
  const out: InteractionRule[] = []
  for (const rule of packed) {
    const nodeId = idOf.get(rule.sourceCk)
    if (nodeId === undefined) continue
    const action = remapAction(rule.action, (ck) => idOf.get(ck) ?? null)
    if (action === null) continue
    out.push({
      id: newClientUuid(),
      source: { nodeId, event: rule.event },
      action,
    })
  }
  return out
}

/**
 * 把剪贴板粘进节点表：全部重发 id、按 ck→新 id 重建父子、根节点加偏移落到目标层。
 * ⚠ 根的 `parentCk` 一律换成 `targetParentId`——跨容器粘贴时坐标是原层局部值，
 * 越界与否由调用方按目标层夹取，这里不吞。
 * ⚠ 规则只是回给调用方，不落在节点上：它住在大屏级 chromeJson，是另一条轴。
 */
export function pasteNodes(input: {
  nodes: readonly DashboardNodePayload[]
  payload: ClipboardPayload
  dashboardId: string
  targetParentId: string | null
  offset: number
  zIndexStart: number
}): PasteResult {
  const idOf = new Map<string, string>()
  for (const item of input.payload.nodes) {
    idOf.set(item.ck, newClientUuid())
  }
  const moment = draftMoment()
  // 根从目标层顶端排起；子树内兄弟按 payload 里的先后（即原 z 序）从 0 重排
  let rootZ = input.zIndexStart
  const childZ = new Map<string, number>()
  const nextChildZ = (parentId: string): number => {
    const z = childZ.get(parentId) ?? 0
    childZ.set(parentId, z + 1)
    return z
  }
  const created: DashboardNodePayload[] = []
  for (const item of input.payload.nodes) {
    const id = idOf.get(item.ck)
    if (id === undefined) continue
    const isRoot = item.parentCk === null
    const parentId = parentIdOf(item, idOf, input.targetParentId)
    created.push(
      rebuildNode({
        item,
        id,
        dashboardId: input.dashboardId,
        parentId,
        isRoot,
        offset: input.offset,
        zIndex: isRoot ? rootZ++ : nextChildZ(parentId ?? ''),
        moment,
      }),
    )
  }
  return {
    nodes: [...input.nodes, ...created],
    pastedIds: created
      .filter((node) => node.parentId === input.targetParentId)
      .map((node) => node.id),
    rules: rebuildRules(input.payload.rules, idOf),
  }
}
