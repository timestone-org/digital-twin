/**
 * @fileoverview 守框选几何：反着拖也得正矩形、判包含而不是相交、
 * 看不见的不算、无名网格归到具名祖先、结果去重排序。
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  isRenderable,
  nodeNamesInRect,
  projectedBoxInRect,
  rectFromPoints,
  type ScreenRect,
} from '../src/marqueeSelect'

const VIEWPORT: ScreenRect = { left: 0, top: 0, width: 800, height: 600 }

/** 一台看向原点的相机，模型摆在原点附近都能投影出来。 */
function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 1000)
  cam.position.set(0, 0, 20)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  return cam
}

function boxAt(name: string, x = 0, size = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshBasicMaterial(),
  )
  mesh.name = name
  mesh.position.set(x, 0, 0)
  mesh.updateMatrixWorld(true)
  return mesh
}

/** 铺满整个视口的框：任何投影得出来的对象都该落在里面。 */
const WHOLE: ScreenRect = { left: 0, top: 0, width: 800, height: 600 }

describe('两点定矩形', () => {
  it('正着拖', () => {
    expect(rectFromPoints(10, 20, 110, 220)).toEqual({
      left: 10,
      top: 20,
      width: 100,
      height: 200,
    })
  })

  // 从右下往左上拖是常事，宽高不能是负的
  it('反着拖也得正矩形', () => {
    expect(rectFromPoints(110, 220, 10, 20)).toEqual({
      left: 10,
      top: 20,
      width: 100,
      height: 200,
    })
  })

  it('原地点一下是个零尺寸的框', () => {
    expect(rectFromPoints(5, 5, 5, 5)).toEqual({
      left: 5,
      top: 5,
      width: 0,
      height: 0,
    })
  })
})

describe('投影包含', () => {
  it('整个落在框里才算框中', () => {
    const mesh = boxAt('a')

    expect(projectedBoxInRect(mesh, WHOLE, camera(), VIEWPORT)).toBe(true)
  })

  // ⚠ 判相交的话，框住画面一角会把背后一大片远处的几何一起选中
  it('只压住一半不算', () => {
    const mesh = boxAt('a')
    // 框只占左半屏，而物体在正中间——它的右半边落在框外
    const half: ScreenRect = { left: 0, top: 0, width: 400, height: 600 }

    expect(projectedBoxInRect(mesh, half, camera(), VIEWPORT)).toBe(false)
  })

  it('框在别处时不算', () => {
    const mesh = boxAt('a')
    const away: ScreenRect = { left: 700, top: 500, width: 50, height: 50 }

    expect(projectedBoxInRect(mesh, away, camera(), VIEWPORT)).toBe(false)
  })

  it('空对象没有包围盒，不算框中', () => {
    expect(
      projectedBoxInRect(new THREE.Group(), WHOLE, camera(), VIEWPORT),
    ).toBe(false)
  })

  // 横跨近裁面的对象投影坐标已经翻折，算出来的屏幕包围盒是错的
  it('有角落在视锥外时整体不算', () => {
    const mesh = boxAt('a')
    mesh.position.set(0, 0, 30) // 跑到相机背后
    mesh.updateMatrixWorld(true)

    expect(projectedBoxInRect(mesh, WHOLE, camera(), VIEWPORT)).toBe(false)
  })
})

describe('可见性', () => {
  it('自己隐藏就不可渲染', () => {
    const mesh = boxAt('a')
    mesh.visible = false

    expect(isRenderable(mesh)).toBe(false)
  })

  // ⚠ 只看自己的 visible 不够：父级隐藏时子网格自己的 visible 仍是 true
  it('祖先隐藏也不可渲染', () => {
    const group = new THREE.Group()
    const mesh = boxAt('a')
    group.add(mesh)
    group.visible = false

    expect(isRenderable(mesh)).toBe(false)
  })
})

describe('框中的节点名', () => {
  it('收集框里的具名网格', () => {
    const root = new THREE.Group()
    root.add(boxAt('泵'), boxAt('阀'))
    root.updateMatrixWorld(true)

    expect(nodeNamesInRect(root, WHOLE, camera(), VIEWPORT)).toEqual([
      '泵',
      '阀',
    ])
  })

  it('结果去重且按字典序，选顺序不影响结果', () => {
    const root = new THREE.Group()
    root.add(boxAt('b'), boxAt('a'), boxAt('a'))
    root.updateMatrixWorld(true)

    expect(nodeNamesInRect(root, WHOLE, camera(), VIEWPORT)).toEqual(['a', 'b'])
  })

  // glTF 里一个部件常常是一个具名分组底下挂着一堆无名网格
  it('无名网格归到最近的具名祖先', () => {
    const root = new THREE.Group()
    const group = new THREE.Group()
    group.name = '机组'
    group.add(boxAt(''), boxAt(''))
    root.add(group)
    root.updateMatrixWorld(true)

    expect(nodeNamesInRect(root, WHOLE, camera(), VIEWPORT)).toEqual(['机组'])
  })

  it('一路到根都没名字的就不收', () => {
    const root = new THREE.Group()
    root.add(boxAt(''))
    root.updateMatrixWorld(true)

    expect(nodeNamesInRect(root, WHOLE, camera(), VIEWPORT)).toEqual([])
  })

  // 用户框了一片空白却选出一堆已经隐藏的部件，是最容易让人以为选错了的那种
  it('隐藏的网格不被框中', () => {
    const root = new THREE.Group()
    const hidden = boxAt('藏起来的')
    hidden.visible = false
    root.add(boxAt('看得见的'), hidden)
    root.updateMatrixWorld(true)

    expect(nodeNamesInRect(root, WHOLE, camera(), VIEWPORT)).toEqual([
      '看得见的',
    ])
  })

  it('框在别处时一个都不收', () => {
    const root = new THREE.Group()
    root.add(boxAt('泵'))
    root.updateMatrixWorld(true)
    const away: ScreenRect = { left: 700, top: 500, width: 50, height: 50 }

    expect(nodeNamesInRect(root, away, camera(), VIEWPORT)).toEqual([])
  })
})
