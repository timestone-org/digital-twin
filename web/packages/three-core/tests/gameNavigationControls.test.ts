/**
 * @fileoverview 守游戏操作的输入契约：Pointer Lock 后鼠标平滑转向、六向平滑移动，
 * 切回轨道或卸载时不留下按键、锁定与全局监听。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GameNavigationControls } from '../src/gameNavigationControls'
import { createSceneCore, disposeScene } from '../src/sceneCore'
import type { SceneCore } from '../src/sceneCore'
import { createHeadlessRenderer } from '../src/testing/createHeadlessRenderer'

interface PointerLockHarness {
  lock: () => void
  unlock: () => void
}

interface GameHarness {
  core: SceneCore
  controls: GameNavigationControls
  pointer: PointerLockHarness
}

const mounted: GameHarness[] = []

function pointerLockFor(surface: HTMLElement): PointerLockHarness {
  let locked: Element | null = null
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => locked,
  })
  Object.defineProperty(surface, 'requestPointerLock', {
    configurable: true,
    value: vi.fn(() => {
      locked = surface
      document.dispatchEvent(new Event('pointerlockchange'))
      return Promise.resolve()
    }),
  })
  Object.defineProperty(document, 'exitPointerLock', {
    configurable: true,
    value: vi.fn(() => {
      locked = null
      document.dispatchEvent(new Event('pointerlockchange'))
    }),
  })
  return {
    lock: () =>
      surface.dispatchEvent(new PointerEvent('pointerdown', { button: 0 })),
    unlock: () => document.exitPointerLock(),
  }
}

function mouseMove(x: number, y: number): void {
  const event = new MouseEvent('mousemove')
  Object.defineProperties(event, {
    movementX: { value: x },
    movementY: { value: y },
  })
  document.dispatchEvent(event)
}

function setup(): GameHarness {
  const container = document.createElement('div')
  const core = createSceneCore({
    container,
    renderer: createHeadlessRenderer(),
  })
  core.camera.position.set(0, 2, 8)
  core.controls.target.set(0, 2, 0)
  core.camera.lookAt(core.controls.target)
  const controls = new GameNavigationControls({
    core,
    surface: core.renderer.domElement,
    span: () => 10,
  })
  const pointer = pointerLockFor(core.renderer.domElement)
  const harness = { core, controls, pointer }
  mounted.push(harness)
  return harness
}

afterEach(() => {
  for (const harness of mounted.splice(0)) {
    harness.controls.dispose()
    disposeScene(harness.core)
  }
  vi.restoreAllMocks()
})

describe('模式与 Pointer Lock', () => {
  it('游戏档关闭轨道控制，点画布后捕获鼠标；切回时释放', () => {
    const { core, controls, pointer } = setup()
    core.controls.autoRotate = true

    pointer.lock()
    expect(document.pointerLockElement).toBeNull()

    controls.setMode('game')
    pointer.lock()

    expect(core.controls.enabled).toBe(false)
    expect(core.controls.autoRotate).toBe(false)
    expect(document.pointerLockElement).toBe(core.renderer.domElement)

    controls.setMode('orbit')

    expect(core.controls.enabled).toBe(true)
    expect(core.controls.autoRotate).toBe(true)
    expect(document.pointerLockElement).toBeNull()
    controls.dispose()
  })
})

describe('平滑移动与转向', () => {
  it('W 沿视线水平前进，并通过加速逐步接近目标速度', () => {
    const { core, controls, pointer } = setup()
    controls.setMode('game')
    pointer.lock()
    const startZ = core.camera.position.z

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))
    controls.advance(0.01)
    const firstStep = startZ - core.camera.position.z
    controls.advance(0.01)
    const secondStep = startZ - core.camera.position.z - firstStep

    expect(firstStep).toBeGreaterThan(0)
    expect(secondStep).toBeGreaterThan(firstStep)
    expect(core.controls.target.z).toBeLessThan(0)
    controls.dispose()
  })

  it.each([
    ['KeyW', 'z', -1],
    ['KeyS', 'z', 1],
    ['KeyA', 'x', -1],
    ['KeyD', 'x', 1],
    ['Space', 'y', 1],
    ['ShiftLeft', 'y', -1],
    ['ShiftRight', 'y', -1],
  ] as const)('%s 沿对应方向平移', (code, axis, sign) => {
    const { core, controls, pointer } = setup()
    controls.setMode('game')
    pointer.lock()
    const start = core.camera.position[axis]

    window.dispatchEvent(new KeyboardEvent('keydown', { code }))
    controls.advance(0.1)

    expect(Math.sign(core.camera.position[axis] - start)).toBe(sign)
  })

  it('鼠标位移先进入目标角，再由帧推进平滑靠近', () => {
    const { core, controls, pointer } = setup()
    controls.setMode('game')
    pointer.lock()
    const before = core.camera.quaternion.clone()

    mouseMove(80, -40)
    expect(core.camera.quaternion.equals(before)).toBe(true)

    controls.advance(0.01)
    expect(core.camera.quaternion.equals(before)).toBe(false)
    controls.dispose()
  })

  it('松开 Pointer Lock 后清掉移动键，速度平滑减到零', () => {
    const { core, controls, pointer } = setup()
    controls.setMode('game')
    pointer.lock()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))
    controls.advance(0.05)
    pointer.unlock()
    const before = core.camera.position.clone()

    controls.advance(0.05)
    const coast = core.camera.position.distanceTo(before)
    for (let step = 0; step < 100; step += 1) controls.advance(0.05)
    const settled = core.camera.position.clone()
    controls.advance(0.1)

    expect(coast).toBeGreaterThan(0)
    expect(core.camera.position.equals(settled)).toBe(true)
    controls.dispose()
  })
})

describe('释放', () => {
  it('卸载后键鼠事件不再改变相机', () => {
    const { core, controls, pointer } = setup()
    controls.setMode('game')
    pointer.lock()
    controls.dispose()
    const before = core.camera.position.clone()

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))
    mouseMove(100, 100)
    controls.advance(1)

    expect(core.camera.position.equals(before)).toBe(true)
    expect(core.controls.enabled).toBe(true)
  })
})
