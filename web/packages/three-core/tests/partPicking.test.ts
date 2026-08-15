/**
 * @fileoverview 视口点击的两件事：拖拽不算点击，隐藏的东西点不中。
 *
 * ⚠ 两条都是「不做就会出错、做了看不见」的类型：转一圈镜头松手会被当成点了
 * 部件，凭空触发一次联动；而 three 的 `Raycaster` 完全不看 `visible`，
 * 被距离规则藏起来的部件照样能被射线命中。
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { ClickGesture, DRAG_SLOP_PX, pickObject } from '../src/partPicking'

function pointer(x: number, y: number): PointerEvent {
  return { clientX: x, clientY: y } as unknown as PointerEvent
}

/** 一块 100×100 的视口，左上角在原点。 */
function viewport(): HTMLElement {
  const element = document.createElement('div')
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
  return element
}

/** 相机在 +z 上看向原点，正中央那一发射线必然命中原点处的方块。 */
function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  cam.position.set(0, 0, 10)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  return cam
}

function boxAt(name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial(),
  )
  mesh.name = name
  return mesh
}

describe('拖拽不算点击', () => {
  it('原地按下再松手是点击', () => {
    const gesture = new ClickGesture()
    gesture.down(pointer(10, 10))

    expect(gesture.isClick(pointer(10, 10))).toBe(true)
  })

  it('手抖几像素仍算点击', () => {
    const gesture = new ClickGesture()
    gesture.down(pointer(10, 10))

    expect(gesture.isClick(pointer(10 + DRAG_SLOP_PX, 10))).toBe(true)
  })

  // ⚠ 转完镜头松手若算点击，运行态就会凭空触发一次联动
  it('拖出阈值之后松手不算点击', () => {
    const gesture = new ClickGesture()
    gesture.down(pointer(10, 10))

    expect(gesture.isClick(pointer(200, 200))).toBe(false)
  })

  it('没按下就松手不算点击', () => {
    expect(new ClickGesture().isClick(pointer(10, 10))).toBe(false)
  })

  it('同一次按下只兑现一次，松两回不会算两次点击', () => {
    const gesture = new ClickGesture()
    gesture.down(pointer(10, 10))
    gesture.isClick(pointer(10, 10))

    expect(gesture.isClick(pointer(10, 10))).toBe(false)
  })

  // 指针被系统取消后，下一次松手不该借用上一次的起点
  it('取消之后松手不算点击', () => {
    const gesture = new ClickGesture()
    gesture.down(pointer(10, 10))
    gesture.cancel()

    expect(gesture.isClick(pointer(10, 10))).toBe(false)
  })
})

describe('射线拾取', () => {
  it('点在正中央命中那个方块', () => {
    const root = new THREE.Group()
    const box = boxAt('pump')
    root.add(box)
    root.updateMatrixWorld(true)

    expect(pickObject(pointer(50, 50), viewport(), camera(), root)).toBe(box)
  })

  it('点在空处什么都不命中', () => {
    const root = new THREE.Group()
    root.add(boxAt('pump'))
    root.updateMatrixWorld(true)

    expect(pickObject(pointer(0, 0), viewport(), camera(), root)).toBeNull()
  })

  // ⚠ Raycaster 自己不看 visible，滤不掉的话就是「看不见却点得到」
  it('隐藏的对象点不中', () => {
    const root = new THREE.Group()
    const box = boxAt('pump')
    box.visible = false
    root.add(box)
    root.updateMatrixWorld(true)

    expect(pickObject(pointer(50, 50), viewport(), camera(), root)).toBeNull()
  })

  // 部件的显隐落在被命名的**祖先**节点上，子网格自己的 visible 仍是 true
  it('祖先被隐藏时，子网格也点不中', () => {
    const root = new THREE.Group()
    const holder = new THREE.Group()
    holder.name = 'pump'
    holder.visible = false
    holder.add(boxAt('inner'))
    root.add(holder)
    root.updateMatrixWorld(true)

    expect(pickObject(pointer(50, 50), viewport(), camera(), root)).toBeNull()
  })

  it('前面的被藏起来时，命中它后面那一个', () => {
    const root = new THREE.Group()
    const front = boxAt('front')
    front.position.set(0, 0, 3)
    front.visible = false
    const back = boxAt('back')
    root.add(front, back)
    root.updateMatrixWorld(true)

    expect(pickObject(pointer(50, 50), viewport(), camera(), root)).toBe(back)
  })
})
