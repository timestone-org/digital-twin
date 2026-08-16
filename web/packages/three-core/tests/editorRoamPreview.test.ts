/**
 * @fileoverview 守编辑视口的漫游预览：只有点了预览才飞、用户一碰视口就停、
 * 站点不够时如实回 false。
 *
 * ⚠ 编辑态**绝不**跟着 `autoplay` 自己开播：配置的时候镜头一直在飘，
 * 锚点根本摆不准——这是编辑器与运行态刻意不同的那几处之一。
 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import { flushPromises } from '@vue/test-utils'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditorScene, type EditorSceneCallbacks } from '../src/editorScene'
import type { GltfSource } from '../src/modelLoader'
import { createHeadlessRenderer } from '../src/testing/createHeadlessRenderer'

const ASSET = 'asset:0192f0aa-0000-7000-8000-000000000001'

interface Harness {
  container: HTMLDivElement
  scene: EditorScene
  roamPreview: ReturnType<typeof vi.fn>
}

const mounted: Harness[] = []

function callbacks(
  roamPreview: ReturnType<typeof vi.fn>,
): EditorSceneCallbacks {
  return {
    select: vi.fn(),
    pickNode: vi.fn(),
    pickPosition: vi.fn(),
    modelNodes: vi.fn(),
    cameraChange: vi.fn(),
    status: vi.fn(),
    roamPreview,
    entityTransform: vi.fn(),
    entityTransformEnd: vi.fn(),
  }
}

function twinConfig(roamTour: Record<string, unknown>): TwinConfig {
  return normalizeTwinConfig({
    model: { asset: ASSET },
    cameras: [
      { id: 'c1', position: [10, 0, 0], target: [0, 0, 0], fov: 40 },
      { id: 'c2', position: [0, 0, 10], target: [0, 0, 0], fov: 40 },
    ],
    roamTour: { items: ['c1', 'c2'], segmentMs: 1000, ...roamTour },
  })
}

function fakeSource(): GltfSource {
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)))
  return { loadAsync: () => Promise.resolve({ scene: root }) }
}

async function ready(roamTour: Record<string, unknown> = {}): Promise<Harness> {
  const container = document.createElement('div')
  document.body.append(container)
  const roamPreview = vi.fn()
  const scene = new EditorScene({
    container,
    config: twinConfig(roamTour),
    on: callbacks(roamPreview),
    createRenderer: () => createHeadlessRenderer(),
    gltfSource: fakeSource(),
  })
  const harness: Harness = { container, scene, roamPreview }
  mounted.push(harness)
  await flushPromises()
  return harness
}

/** 等渲染循环真的跑过一帧：预览的位姿是在 tick 里落下去的。 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

afterEach(() => {
  for (const harness of mounted.splice(0)) {
    harness.scene.dispose()
    harness.container.remove()
  }
  vi.restoreAllMocks()
})

describe('编辑态不自动开播', () => {
  // ⚠ 这条是编辑器与运行态刻意不同的那一处：配置时镜头飘着就没法摆锚点
  it('autoplay 开着也不会自己飞', async () => {
    const harness = await ready({ enabled: true, autoplay: true })
    await nextFrame()
    await nextFrame()

    expect(harness.roamPreview).not.toHaveBeenCalled()
  })
})

describe('预览这条轨迹', () => {
  it('开得起来时回 true 并报出开播', async () => {
    const harness = await ready({ enabled: true })

    expect(harness.scene.playRoamPreview()).toBe(true)
    expect(harness.roamPreview).toHaveBeenCalledWith(true)
  })

  it('轨迹不成立时回 false，也不报开播', async () => {
    const harness = await ready({ enabled: true, items: ['c1'] })

    expect(harness.scene.playRoamPreview()).toBe(false)
    expect(harness.roamPreview).not.toHaveBeenCalled()
  })

  it('没启用漫游也能预览：预览的是配好的轨迹，不是运行态开关', async () => {
    const harness = await ready({ enabled: false })

    expect(harness.scene.playRoamPreview()).toBe(true)
  })

  it('停下预览会报出停播，再停一次不重复报', async () => {
    const harness = await ready({ enabled: true })
    harness.scene.playRoamPreview()

    harness.scene.stopRoamPreview()
    harness.scene.stopRoamPreview()

    expect(harness.roamPreview).toHaveBeenCalledTimes(2)
    expect(harness.roamPreview).toHaveBeenLastCalledWith(false)
  })

  // ⚠ 镜头还自己往前飞会变成两个人抢方向盘
  it('用户一按下视口就停', async () => {
    const harness = await ready({ enabled: true })
    harness.scene.playRoamPreview()

    harness.container
      .querySelector('canvas')
      ?.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }))

    expect(harness.roamPreview).toHaveBeenLastCalledWith(false)
  })

  // 段时长置 0 = 一步切到落点，断言就不依赖「跑了几帧、每帧多少毫秒」
  it('预览会把时间线算出的位姿落到相机上', async () => {
    const harness = await ready({ enabled: true, segmentMs: 0, pauseMs: 5000 })
    harness.scene.playRoamPreview()
    await nextFrame()
    await nextFrame()

    const pose = harness.scene.snapshot()
    expect(pose.position[2]).toBeCloseTo(10, 6)
  })
})
