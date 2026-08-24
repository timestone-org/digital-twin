/**
 * @fileoverview 守部件索引的契约：同名节点一个不落、部件显隐按名字生效、
 * 配置引用了模型里没有的节点名要报得出来（不静默留空）。
 */
import { DEFAULT_PART_LOOK, type TwinPart } from '@dt/twin-config'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  EMPTY_NODE_INDEX,
  applyPartVisibility,
  buildNodeIndex,
  meshesOfNames,
  objectsOfNames,
  unmatchedNodeNames,
} from '../src/nodeIndex'

function part(id: string, nodes: string[], visible = true): TwinPart {
  return {
    id,
    name: id,
    nodes,
    visibility: { visible, hideBelow: null, hideAbove: null, fade: null },
    look: DEFAULT_PART_LOOK,
    tint: null,
    clickDistance: { min: null, max: null, farThreshold: null },
    clickHierNode: '',
  }
}

/** 根 → 泵体（含两个同名网格 shell）→ 阀门 */
function buildModel(): THREE.Object3D {
  const root = new THREE.Group()
  root.name = 'root'
  const pump = new THREE.Group()
  pump.name = 'pump'
  const shellA = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  shellA.name = 'shell'
  const shellB = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  shellB.name = 'shell'
  pump.add(shellA, shellB)
  const valve = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  valve.name = 'valve'
  const unnamed = new THREE.Group()
  root.add(pump, valve, unnamed)
  return root
}

describe('建索引', () => {
  it('命名节点去重后按字典序，无名节点不入索引', () => {
    const index = buildNodeIndex(buildModel())

    expect(index.namedNodes).toEqual(['pump', 'root', 'shell', 'valve'])
  })

  it('同名节点全部收进同一个桶', () => {
    const index = buildNodeIndex(buildModel())

    expect(index.byName.get('shell')).toHaveLength(2)
  })

  it('空索引查什么都是空，不抛错', () => {
    expect(objectsOfNames(EMPTY_NODE_INDEX, ['pump'])).toEqual([])
    expect(meshesOfNames(EMPTY_NODE_INDEX, ['pump'])).toEqual([])
  })
})

describe('按名字取对象', () => {
  it('取不到的名字被跳过，不占位也不抛错', () => {
    const index = buildNodeIndex(buildModel())

    expect(objectsOfNames(index, ['valve', 'ghost'])).toHaveLength(1)
  })

  it('取网格时连子树一起收，并按对象去重', () => {
    const index = buildNodeIndex(buildModel())

    expect(meshesOfNames(index, ['pump'])).toHaveLength(2)
    expect(meshesOfNames(index, ['pump', 'shell'])).toHaveLength(2)
  })

  it('只挂了组、组下没有网格时取到空数组', () => {
    const root = new THREE.Group()
    const empty = new THREE.Group()
    empty.name = 'empty'
    root.add(empty)

    expect(meshesOfNames(buildNodeIndex(root), ['empty'])).toEqual([])
  })
})

describe('部件显隐', () => {
  it('按部件的基线显隐设置命中的每个对象', () => {
    const model = buildModel()
    const index = buildNodeIndex(model)

    applyPartVisibility(index, [
      part('p1', ['shell'], false),
      part('p2', ['valve']),
    ])

    expect(index.byName.get('shell')?.every((node) => !node.visible)).toBe(true)
    expect(index.byName.get('valve')?.[0]?.visible).toBe(true)
  })

  it('引用不到的部件不影响任何对象', () => {
    const index = buildNodeIndex(buildModel())

    applyPartVisibility(index, [part('p1', ['ghost'], false)])

    expect(index.byName.get('valve')?.[0]?.visible).toBe(true)
  })
})

describe('悬空节点名', () => {
  it('模型里没有的名字去重后按字典序报出来', () => {
    const index = buildNodeIndex(buildModel())

    expect(
      unmatchedNodeNames(index, [
        part('p1', ['zed', 'shell']),
        part('p2', ['zed', 'alpha']),
      ]),
    ).toEqual(['alpha', 'zed'])
  })

  it('全都对得上时是空数组', () => {
    const index = buildNodeIndex(buildModel())

    expect(unmatchedNodeNames(index, [part('p1', ['shell', 'valve'])])).toEqual(
      [],
    )
  })
})
