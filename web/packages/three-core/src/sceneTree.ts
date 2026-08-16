/**
 * @fileoverview 模型的层级树：给运行态的只读结构树用。
 *
 * ⚠ 按需建，不塞进 `buildNodeIndex`：那是每次装载都跑的路径，而这棵树只有
 * 打开结构树的人才看得到——一趟完整的场景遍历不该让所有人都付。
 */
import * as THREE from 'three'

/** 树上的一个节点。 */
export interface SceneTreeNode {
  /**
   * 路径式稳定 id，形如 `0/2/1`。
   * ⚠ 不用对象名：glTF 允许重名，拿名字当 key 会让两个同名节点的展开与勾选串在一起。
   */
  uid: string
  /** 对象名；没名字的节点给空串，界面上按类型兜底显示。 */
  name: string
  /** 是不是可渲染的网格。 */
  isMesh: boolean
  /** 这一支（含子树）的三角面数，用来判断体量。 */
  triangles: number
  children: SceneTreeNode[]
}

// ⚠ 必须显式标返回类型：`instanceof` 就地收窄出来的是 `Mesh<any, any, any>`，
// 三个 any 会一路漏到调用方，把几何与材质的类型检查全部关掉（同 nodeIndex）
function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh
}

function triangleCount(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry
  const index = geometry.getIndex()
  if (index !== null) return Math.floor(index.count / 3)
  const position = geometry.getAttribute('position')
  return position === undefined ? 0 : Math.floor(position.count / 3)
}

function walk(object: THREE.Object3D, uid: string): SceneTreeNode {
  const mesh = isMesh(object) ? object : null
  const children = object.children.map((child, index) =>
    walk(child, `${uid}/${index}`),
  )
  const own = mesh === null ? 0 : triangleCount(mesh)
  return {
    uid,
    name: object.name.trim(),
    isMesh: mesh !== null,
    triangles: children.reduce((sum, child) => sum + child.triangles, own),
    children,
  }
}

/**
 * 建一棵层级树；模型根自己不入树，它的直接子节点是第一层。
 * @param root 模型根对象
 */
export function buildSceneTree(root: THREE.Object3D): SceneTreeNode[] {
  return root.children.map((child, index) => walk(child, String(index)))
}

/**
 * 按 uid 找回对象；找不到给 null。
 * ⚠ 每次都重走一遍路径而不是缓存一张表：模型换了之后旧表里的对象已经被
 * `dispose` 掉了，拿着它去定位会往一个已释放的几何上飞。
 * @param root 模型根对象
 * @param uid 路径式 id
 */
export function objectAtUid(
  root: THREE.Object3D,
  uid: string,
): THREE.Object3D | null {
  let node: THREE.Object3D | undefined = root
  for (const step of uid.split('/')) {
    const index = Number(step)
    if (!Number.isInteger(index)) return null
    node = node?.children[index]
    if (node === undefined) return null
  }
  return node
}
