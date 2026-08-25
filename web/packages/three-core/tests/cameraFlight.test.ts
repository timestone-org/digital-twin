/**
 * @fileoverview 守相机飞行的口径：中途位姿在两端之间且逐帧不调 controls.update、
 * 到时精确落在终点并补一次 update、取消就停在原地、半路换目标从当前位置续飞、
 * 系统偏好减少动态时直接落位、空盒不动镜头。
 */
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CAMERA_FLIGHT_MS, createCameraFlight } from '../src/cameraFlight'
import { createSceneCore, frameBoxPose, type SceneCore } from '../src/sceneCore'
import { createHeadlessRenderer } from '../src/testing/createHeadlessRenderer'

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  vi.restoreAllMocks()
  container.remove()
})

function mount(): SceneCore {
  return createSceneCore({ container, renderer: createHeadlessRenderer() })
}

const DEST = {
  position: [0, 5, 10] as [number, number, number],
  target: [0, 1, 0] as [number, number, number],
  fov: 45,
}

/** 把 matchMedia 钉成指定的减少动态档位。 */
function mockReducedMotion(matches: boolean): void {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches,
  } as MediaQueryList)
}

describe('相机飞行', () => {
  it('中途位姿在两端之间，且逐帧不调 controls.update', () => {
    const core = mount()
    const start = core.camera.position.clone()
    const update = vi.spyOn(core.controls, 'update')
    const flight = createCameraFlight()

    flight.flyTo(core, DEST, 0)
    flight.advance(CAMERA_FLIGHT_MS / 2)

    const end = new THREE.Vector3(...DEST.position)
    expect(flight.isFlying()).toBe(true)
    expect(core.camera.position.distanceTo(start)).toBeGreaterThan(0.01)
    expect(core.camera.position.distanceTo(end)).toBeGreaterThan(0.01)
    expect(update).not.toHaveBeenCalled()
  })

  it('到时精确落在终点，并像瞬移路径一样补一次 controls.update', () => {
    const core = mount()
    const update = vi.spyOn(core.controls, 'update')
    const flight = createCameraFlight()

    flight.flyTo(core, DEST, 0)
    flight.advance(CAMERA_FLIGHT_MS / 2)
    flight.advance(CAMERA_FLIGHT_MS / 2)

    expect(flight.isFlying()).toBe(false)
    expect(core.camera.position.toArray()).toEqual(DEST.position)
    expect(core.controls.target.toArray()).toEqual(DEST.target)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('取消就停在原地，之后的推进一步都不再动', () => {
    const core = mount()
    const flight = createCameraFlight()

    flight.flyTo(core, DEST, 0)
    flight.advance(CAMERA_FLIGHT_MS / 2)
    const held = core.camera.position.clone()
    flight.cancel()
    flight.advance(CAMERA_FLIGHT_MS)

    expect(flight.isFlying()).toBe(false)
    expect(core.camera.position.distanceTo(held)).toBe(0)
  })

  it('半路换目标从当前位置续飞，衔接处不跳变', () => {
    const core = mount()
    const flight = createCameraFlight()

    flight.flyTo(core, DEST, 0)
    flight.advance(CAMERA_FLIGHT_MS / 2)
    const midway = core.camera.position.clone()
    flight.flyTo(core, { position: [8, 2, -4], target: [0, 0, 0], fov: 45 }, 0)

    // 换目标那一刻镜头不动；下一帧才从这里出发
    expect(core.camera.position.distanceTo(midway)).toBe(0)
    flight.advance(1)
    expect(core.camera.position.distanceTo(midway)).toBeLessThan(0.5)
    expect(flight.isFlying()).toBe(true)
  })

  it('系统偏好减少动态：不飞，直接落位', () => {
    mockReducedMotion(true)
    const core = mount()
    const flight = createCameraFlight()

    flight.flyTo(core, DEST, 0)

    expect(flight.isFlying()).toBe(false)
    expect(core.camera.position.toArray()).toEqual(DEST.position)
  })

  it('空盒不动镜头，也不进入飞行', () => {
    const core = mount()
    const start = core.camera.position.clone()
    const flight = createCameraFlight()

    flight.flyToBox(core, new THREE.Box3())

    expect(flight.isFlying()).toBe(false)
    expect(core.camera.position.distanceTo(start)).toBe(0)
  })

  it('飞向包围盒：终点就是取景几何算出来的那个机位', () => {
    const core = mount()
    const box = new THREE.Box3(
      new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(1, 1, 1),
    )
    const framed = frameBoxPose(core.camera, box)
    const flight = createCameraFlight()

    flight.flyToBox(core, box)
    flight.advance(CAMERA_FLIGHT_MS)

    expect(framed).not.toBeNull()
    // ⚠ 只能约等：落地那一次 `controls.update()` 把机位在球坐标里往返一趟，
    // 末位必然有浮点误差
    const landed = core.camera.position.toArray()
    const target = core.controls.target.toArray()
    for (const axis of [0, 1, 2] as const) {
      expect(landed[axis]).toBeCloseTo(framed?.pose.position[axis] ?? NaN, 6)
      expect(target[axis]).toBeCloseTo(framed?.pose.target[axis] ?? NaN, 6)
    }
  })
})
