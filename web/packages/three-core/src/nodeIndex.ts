/**
 * @fileoverview 模型部件索引：节点名 → 对象、部件 → 网格与显隐。
 * ⚠ 部件按**模型文件里的对象名**寻址，模型里改了名字这个部件就什么都不再命中；
 * `unmatchedNodeNames` 把这件事说出来，不静默留空（DASHBOARD_DESIGN §4.3）。
 */
import type { TwinPart } from '@dt/twin-config'
import * as THREE from 'three'

export interface NodeIndex {
  /** 模型里出现过的命名节点，去重后按字典序。 */
  readonly namedNodes: readonly string[]
  /** 节点名 → 同名对象；glTF 允许重名，故是一对多。 */
  readonly byName: ReadonlyMap<string, readonly THREE.Object3D[]>
}

/** 模型未加载时的稳定空索引，避免下游到处判 null。 */
export const EMPTY_NODE_INDEX: NodeIndex = Object.freeze({
  namedNodes: Object.freeze([]),
  byName: new Map<string, readonly THREE.Object3D[]>(),
})

/**
 * 遍历模型建索引。
 * @param root 模型根对象
 */
export function buildNodeIndex(root: THREE.Object3D): NodeIndex {
  const byName = new Map<string, THREE.Object3D[]>()
  root.traverse((object) => {
    const name = object.name.trim()
    if (name === '') return
    const bucket = byName.get(name)
    if (bucket === undefined) byName.set(name, [object])
    else bucket.push(object)
  })
  return { namedNodes: [...byName.keys()].sort(), byName }
}

/**
 * 一组节点名命中的对象，同名节点全取。
 * @param index 节点索引
 * @param names 节点名
 */
export function objectsOfNames(
  index: NodeIndex,
  names: readonly string[],
): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  for (const name of names) {
    for (const object of index.byName.get(name) ?? []) found.push(object)
  }
  return found
}

// ⚠ 必须显式标返回类型：`instanceof` 就地收窄出来的是 `Mesh<any, any, any>`，
// 三个 any 会一路漏到调用方，把材质与几何的类型检查全部关掉
function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh
}

/**
 * 一组节点名子树下的全部网格，按对象去重。
 * @param index 节点索引
 * @param names 节点名
 */
export function meshesOfNames(
  index: NodeIndex,
  names: readonly string[],
): THREE.Mesh[] {
  const seen = new Set<THREE.Mesh>()
  for (const object of objectsOfNames(index, names)) {
    object.traverse((child) => {
      if (isMesh(child)) seen.add(child)
    })
  }
  return [...seen]
}

/**
 * 按部件的 `visible` 设置模型显隐；未命中的部件不影响任何对象。
 * @param index 节点索引
 * @param parts 归一化后的部件
 */
export function applyPartVisibility(
  index: NodeIndex,
  parts: readonly TwinPart[],
): void {
  for (const part of parts) {
    for (const object of objectsOfNames(index, part.nodes)) {
      object.visible = part.visible
    }
  }
}

/**
 * 配置里引用了、模型里却没有的节点名，去重后按字典序。
 * @param index 节点索引
 * @param parts 归一化后的部件
 */
export function unmatchedNodeNames(
  index: NodeIndex,
  parts: readonly TwinPart[],
): string[] {
  const missing = new Set<string>()
  for (const part of parts) {
    for (const name of part.nodes) {
      if (!index.byName.has(name)) missing.add(name)
    }
  }
  return [...missing].sort()
}
