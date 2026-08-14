/**
 * @fileoverview 节点剪贴板：内存优先、localStorage 兜底（同浏览器跨大屏可粘贴）。
 * payload 剥掉后端 id，用局部键 ck/parentCk 保住容器子树结构，粘贴时全部重发 id；
 * 坐标保持原层局部像素，粘贴方按目标层夹取并加 16px 逐次累加的偏移。
 */
import type { BindingPayload, DashboardNodePayload } from '@dt/contracts'

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

export interface ClipboardPayload {
  version: 1
  nodes: ClipboardNode[]
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
 * 由选中集构建剪贴板 payload：含整棵容器子树，父先子后。
 * 没有可复制的根时给 null——头/底钉位节点是单例，复制它只会粘出第二个然后被拒。
 * @param isRegionType 判定某模块是不是钉位单例
 */
export function buildClipboardPayload(
  nodes: readonly DashboardNodePayload[],
  selectedIds: readonly string[],
  isRegionType: (moduleType: string) => boolean,
): ClipboardPayload | null {
  const byId = new Map(nodes.map((node) => [node.id, node] as const))
  const roots = topMostIds(nodes, selectedIds)
    .map((id) => byId.get(id))
    .filter(
      (node): node is DashboardNodePayload =>
        node !== undefined && !isRegionType(node.moduleType),
    )
  if (roots.length === 0) return null

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
  return { version: 1, nodes: out }
}

/** 写剪贴板并把粘贴偏移归零；localStorage 是 best-effort，禁用时内存通道仍在。 */
export function writeClipboard(payload: ClipboardPayload): void {
  memory = payload
  pasteSeq = 0
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* Safari 无痕或配额满：丢跨屏通道不该把复制整个弄失败 */
  }
}

/** 读剪贴板：内存优先，localStorage 兜底并防御脏数据。 */
export function readClipboard(): ClipboardPayload | null {
  if (memory !== null) return memory
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== 1 ||
      !Array.isArray((parsed as { nodes?: unknown }).nodes) ||
      (parsed as { nodes: unknown[] }).nodes.length === 0
    ) {
      return null
    }
    return parsed as ClipboardPayload
  } catch {
    return null
  }
}

/** 下一次粘贴的偏移像素：16 逐次累加，复制时归零。 */
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

/** 一次粘贴的产物：新的节点表与新建节点的 id（调用方拿去改选中）。 */
export interface PasteResult {
  nodes: DashboardNodePayload[]
  pastedIds: readonly string[]
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

/**
 * 把剪贴板粘进节点表：全部重发 id、按 ck→新 id 重建父子、根节点加偏移落到目标层。
 * ⚠ 根的 `parentCk` 一律换成 `targetParentId`——跨容器粘贴时坐标是原层局部值，
 * 越界与否由调用方按目标层夹取，这里不吞。
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
  }
}
