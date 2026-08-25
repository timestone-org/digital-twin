/**
 * @fileoverview 守结构树的口径：关着不建树、uid 按路径稳定、勾掉显隐只动
 * Object3D 且不写回配置、换模型时先恢复再清记录。
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { CAMERA_FLIGHT_MS, createCameraFlight } from '../src/cameraFlight'
import { buildSceneTree, objectAtUid } from '../src/sceneTree'
import { createSceneCore, type SceneCore } from '../src/sceneCore'
import { createHeadlessRenderer } from '../src/testing/createHeadlessRenderer'
import { useStructureTree } from '../src/useStructureTree'

function meshNamed(name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  )
  mesh.name = name
  return mesh
}

/** 一个两层模型：group 下挂两个网格，外加一个同级网格。 */
function model(): THREE.Object3D {
  const root = new THREE.Group()
  const group = new THREE.Group()
  group.name = '机组'
  group.add(meshNamed('泵体'), meshNamed('电机'))
  root.add(group, meshNamed('底座'))
  return root
}

function setup(enabled = true) {
  const container = document.createElement('div')
  document.body.append(container)
  const core: SceneCore = createSceneCore({
    container,
    renderer: createHeadlessRenderer(),
  })
  core.modelRoot.add(model())
  const flight = createCameraFlight()
  const tree = useStructureTree({
    core: () => core,
    enabled: () => enabled,
    flight,
  })
  return { tree, core, flight }
}

describe('建树', () => {
  it('关着时不建：这是一趟完整的场景遍历', () => {
    const { tree } = setup(false)

    expect(tree.nodes.value).toEqual([])
  })

  it('模型根自己不入树，它的直接子节点是第一层', () => {
    const { tree } = setup()

    // modelRoot 下只挂了一个 model()，所以第一层是那一个
    expect(tree.nodes.value).toHaveLength(1)
    expect(tree.nodes.value[0]?.children.map((node) => node.name)).toEqual([
      '机组',
      '底座',
    ])
  })

  it('网格与分组分得开', () => {
    const nodes = buildSceneTree(model())

    expect(nodes[0]?.isMesh).toBe(false)
    expect(nodes[1]?.isMesh).toBe(true)
  })

  it('三角面数往上累加，看得出这一支的体量', () => {
    const nodes = buildSceneTree(model())

    expect(nodes[0]?.triangles).toBeGreaterThan(0)
    expect(nodes[0]?.triangles).toBe(
      (nodes[0]?.children ?? []).reduce((sum, n) => sum + n.triangles, 0),
    )
  })

  // ⚠ glTF 允许重名，拿名字当 key 会让两个同名节点的展开与勾选串在一起
  it('uid 是路径式的，同名节点也各不相同', () => {
    const root = new THREE.Group()
    root.add(meshNamed('阀'), meshNamed('阀'))

    const uids = buildSceneTree(root).map((node) => node.uid)

    expect(new Set(uids).size).toBe(2)
  })

  it('uid 找得回对象', () => {
    const root = model()

    expect(objectAtUid(root, '0/1')?.name).toBe('电机')
  })

  it('uid 对不上时给 null，不抛也不乱指', () => {
    const root = model()

    expect(objectAtUid(root, '9/9')).toBeNull()
    expect(objectAtUid(root, 'a/b')).toBeNull()
  })
})

describe('勾选显隐', () => {
  it('勾掉之后对象真的隐藏了', () => {
    const { tree, core } = setup()
    const uid = tree.nodes.value[0]?.children[0]?.uid ?? ''

    tree.toggleVisible(uid)

    expect(objectAtUid(core.modelRoot, uid)?.visible).toBe(false)
    expect(tree.hidden.value.has(uid)).toBe(true)
  })

  it('再勾一次又显示出来', () => {
    const { tree, core } = setup()
    const uid = tree.nodes.value[0]?.children[0]?.uid ?? ''
    tree.toggleVisible(uid)

    tree.toggleVisible(uid)

    expect(objectAtUid(core.modelRoot, uid)?.visible).toBe(true)
    expect(tree.hidden.value.has(uid)).toBe(false)
  })

  // ⚠ 不恢复的话那些对象带着 visible=false 留在场景里，而记录已经没了
  it('换模型时先把隐藏的恢复再清记录', () => {
    const { tree, core } = setup()
    const uid = tree.nodes.value[0]?.children[0]?.uid ?? ''
    tree.toggleVisible(uid)
    const object = objectAtUid(core.modelRoot, uid)

    tree.rebuild()

    expect(object?.visible).toBe(true)
    expect(tree.hidden.value.size).toBe(0)
  })

  it('换模型也把展开状态清掉', () => {
    const { tree } = setup()
    tree.toggleExpand('0')

    tree.rebuild()

    expect(tree.expanded.value.size).toBe(0)
  })
})

describe('展开与定位', () => {
  it('展开是开关式的', () => {
    const { tree } = setup()

    tree.toggleExpand('0')
    expect(tree.expanded.value.has('0')).toBe(true)

    tree.toggleExpand('0')
    expect(tree.expanded.value.has('0')).toBe(false)
  })

  it('点一支把镜头飞过去', () => {
    const { tree, core, flight } = setup()
    const before = core.camera.position.clone()

    tree.locate(tree.nodes.value[0]?.children[0]?.uid ?? '')
    flight.advance(CAMERA_FLIGHT_MS)

    expect(core.camera.position.equals(before)).toBe(false)
  })

  it('uid 对不上时不动镜头', () => {
    const { tree, core } = setup()
    const before = core.camera.position.clone()

    tree.locate('9/9/9')

    expect(core.camera.position.equals(before)).toBe(true)
  })
})
