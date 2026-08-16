/**
 * @fileoverview 守坐标轴手柄的口径：拖动时锁住轨道控制、拖动中不许重挂、
 * 程序摆位不触发回写、朝向来回换算不失真、松手发一次结束信号。
 */
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSceneCore, type SceneCore } from '../src/sceneCore'
import { createHeadlessRenderer } from '../src/testing/createHeadlessRenderer'
import {
  TransformGizmo,
  type GizmoChange,
  type GizmoTarget,
} from '../src/transformGizmo'

const living: TransformGizmo[] = []

function setup() {
  const container = document.createElement('div')
  document.body.append(container)
  const core: SceneCore = createSceneCore({
    container,
    renderer: createHeadlessRenderer(),
  })
  const changes: GizmoChange[] = []
  const ends = vi.fn()
  const gizmo = new TransformGizmo({
    core,
    onChange: (change) => changes.push(change),
    onDragEnd: ends,
  })
  living.push(gizmo)
  return { gizmo, core, changes, ends }
}

/** 手柄内部靠 three 的事件驱动；测试直接派发它监听的那两个。 */
function emitDragging(gizmo: TransformGizmo, value: boolean): void {
  const controls = Reflect.get(gizmo, 'controls') as THREE.EventDispatcher
  controls.dispatchEvent({ type: 'dragging-changed', value } as never)
}

function emitObjectChange(gizmo: TransformGizmo): void {
  const controls = Reflect.get(gizmo, 'controls') as THREE.EventDispatcher
  controls.dispatchEvent({ type: 'objectChange' } as never)
}

function proxyOf(gizmo: TransformGizmo): THREE.Object3D {
  return Reflect.get(gizmo, 'proxy') as THREE.Object3D
}

const ANCHOR: GizmoTarget = {
  kind: 'anchors',
  id: 'a1',
  position: [1, 2, 3],
  direction: null,
}

const ARROW: GizmoTarget = {
  kind: 'arrows',
  id: 'r1',
  position: [0, 0, 0],
  direction: [1, 0, 0],
}

afterEach(() => {
  for (const gizmo of living.splice(0)) gizmo.dispose()
})

describe('挂与收', () => {
  it('挂上之后手柄画出来，替身摆到实体位置', () => {
    const { gizmo } = setup()

    gizmo.attach(ANCHOR)

    expect(gizmo.isShown).toBe(true)
    expect(proxyOf(gizmo).position.toArray()).toEqual([1, 2, 3])
  })

  it('给 null 就收起', () => {
    const { gizmo } = setup()
    gizmo.attach(ANCHOR)

    gizmo.attach(null)

    expect(gizmo.isShown).toBe(false)
  })

  it('替身自己不可见，只借它的位置给手柄', () => {
    const { gizmo } = setup()

    gizmo.attach(ANCHOR)

    expect(proxyOf(gizmo).visible).toBe(true)
    // 它没有几何，可见与否都画不出东西；这里断言的是它确实被当成活动对象
    expect(proxyOf(gizmo).children).toHaveLength(0)
  })
})

describe('拖动', () => {
  // ⚠ 不关的话拖手柄会同时把镜头转走，手感是「越拖越跑偏」
  it('拖动时关掉轨道控制，松手再打开', () => {
    const { gizmo, core } = setup()
    gizmo.attach(ANCHOR)

    emitDragging(gizmo, true)
    expect(core.controls.enabled).toBe(false)

    emitDragging(gizmo, false)
    expect(core.controls.enabled).toBe(true)
  })

  it('松手时发一次结束信号，供宿主合并撤销', () => {
    const { gizmo, ends } = setup()
    gizmo.attach(ANCHOR)

    emitDragging(gizmo, true)
    emitDragging(gizmo, false)

    expect(ends).toHaveBeenCalledTimes(1)
  })

  it('没拖过就收到 false 时不发结束信号', () => {
    const { gizmo, ends } = setup()
    gizmo.attach(ANCHOR)

    emitDragging(gizmo, false)

    expect(ends).not.toHaveBeenCalled()
  })

  // ⚠ 重挂会把替身摆回拖动前的位置，手感是「拖一下弹回去」
  it('拖动中不许重挂', () => {
    const { gizmo } = setup()
    gizmo.attach(ANCHOR)
    emitDragging(gizmo, true)
    proxyOf(gizmo).position.set(9, 9, 9)

    gizmo.attach(ANCHOR)

    expect(proxyOf(gizmo).position.toArray()).toEqual([9, 9, 9])
  })
})

describe('回写', () => {
  it('用户拖出来的位置原样回传', () => {
    const { gizmo, changes } = setup()
    gizmo.attach(ANCHOR)

    proxyOf(gizmo).position.set(4, 5, 6)
    emitObjectChange(gizmo)

    expect(changes).toEqual([
      { kind: 'anchors', id: 'a1', position: [4, 5, 6], direction: null },
    ])
  })

  // ⚠ 程序摆位也会触发 objectChange，不抑制就是一个写回—重挂—再写回的死循环
  it('程序摆替身那一下不回传', () => {
    const { gizmo, changes } = setup()

    gizmo.attach(ANCHOR)

    expect(changes).toEqual([])
  })

  it('没挂任何东西时的 objectChange 被忽略', () => {
    const { gizmo, changes } = setup()

    emitObjectChange(gizmo)

    expect(changes).toEqual([])
  })

  it('没有朝向的实体回传 direction 为 null', () => {
    const { gizmo, changes } = setup()
    gizmo.attach(ANCHOR)

    emitObjectChange(gizmo)

    expect(changes[0]?.direction).toBeNull()
  })
})

describe('箭头朝向', () => {
  it('挂上时把朝向换成替身的姿态，再读回来不失真', () => {
    const { gizmo, changes } = setup()

    gizmo.attach(ARROW, 'rotate')
    emitObjectChange(gizmo)

    const direction = changes[0]?.direction
    expect(direction?.[0]).toBeCloseTo(1)
    expect(direction?.[1]).toBeCloseTo(0)
    expect(direction?.[2]).toBeCloseTo(0)
  })

  // ⚠ 与 +Y 完全相反时叉积是零向量，不特判会得到一个随机方向
  it('朝向正好是 -Y 时也能稳定换算回来', () => {
    const { gizmo, changes } = setup()

    gizmo.attach({ ...ARROW, direction: [0, -1, 0] }, 'rotate')
    emitObjectChange(gizmo)

    const direction = changes[0]?.direction
    expect(direction?.[1]).toBeCloseTo(-1)
  })

  it('零向量当没配，替身保持单位姿态', () => {
    const { gizmo } = setup()

    gizmo.attach({ ...ARROW, direction: [0, 0, 0] }, 'rotate')

    expect(proxyOf(gizmo).quaternion.equals(new THREE.Quaternion())).toBe(true)
  })
})

describe('释放', () => {
  it('卸载后手柄与替身都从场景里摘走', () => {
    const { gizmo, core } = setup()
    gizmo.attach(ANCHOR)

    gizmo.dispose()

    expect(core.scene.getObjectByName('twin-gizmo')).toBeUndefined()
    expect(core.scene.getObjectByName('twin-gizmo-proxy')).toBeUndefined()
  })
})
