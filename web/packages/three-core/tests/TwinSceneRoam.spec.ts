/**
 * @fileoverview 守运行态漫游控件的契约：配了才画、按钮点得动、暂停播放的文案跟着换。
 *
 * ⚠ 控件是浮在画布上的唯一一块要吃指针事件的浮层；它要是铺满画布，
 * OrbitControls 就收不到拖拽了，表现是「模型转不动」而跟控件毫无关系。
 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import { flushPromises, mount } from '@vue/test-utils'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { configureTwinModelHost, resetTwinModelHost } from '../src/host'
import type { TwinModelAsset } from '../src/modelLoader'
import type * as SceneCoreModule from '../src/sceneCore'
import {
  createHeadlessRenderer,
  type HeadlessRenderer,
} from '../src/testing/createHeadlessRenderer'
import TwinScene from '../src/TwinScene.vue'

const seam = vi.hoisted(() => ({
  createWebGLRenderer: vi.fn(),
  loadTwinModel: vi.fn(),
}))

vi.mock('../src/sceneCore', async (importOriginal) => {
  const actual = await importOriginal<typeof SceneCoreModule>()
  return { ...actual, createWebGLRenderer: seam.createWebGLRenderer }
})

vi.mock('../src/modelLoader', () => ({
  createGltfSource: vi.fn(),
  loadTwinModel: seam.loadTwinModel,
}))

const ASSET = 'asset:0192f0aa-0000-7000-8000-000000000001'
const CONTROLS = '[data-test="twin-roam-controls"]'

let renderer: HeadlessRenderer

/**
 * ⚠ 形状必须是 `TwinModelAsset`（`{ root, clips }`），不是裸的 Object3D：
 * 桩比真实现宽的时候装配点拿到的是 `undefined`，模型压根没进场景，而用例
 * 只断言浮层、照样全绿——唯一的痕迹是一行 THREE 的控制台报错。
 */
function fakeAsset(): TwinModelAsset {
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
  return { root, clips: [] }
}

function config(roamTour: Record<string, unknown>): TwinConfig {
  return normalizeTwinConfig({
    model: { asset: ASSET },
    cameras: [
      { id: 'c1', name: '一号', position: [10, 0, 0] },
      { id: 'c2', name: '二号', position: [0, 0, 10] },
    ],
    roamTour: { items: ['c1', 'c2'], ...roamTour },
  })
}

function mountScene(roamTour: Record<string, unknown>) {
  return mount(TwinScene, {
    props: { config: config(roamTour) },
    attachTo: document.body,
  })
}

beforeEach(() => {
  renderer = createHeadlessRenderer()
  seam.createWebGLRenderer.mockReturnValue(renderer)
  seam.loadTwinModel.mockResolvedValue(fakeAsset())
  configureTwinModelHost({ resolveModelUrl: (ref) => `/assets/${ref}.glb` })
})

afterEach(() => {
  vi.restoreAllMocks()
  resetTwinModelHost()
  seam.createWebGLRenderer.mockReset()
  seam.loadTwinModel.mockReset()
})

describe('播放控件画不画', () => {
  it('启用漫游且要控件时画出来', async () => {
    const wrapper = mountScene({ enabled: true, showControls: true })
    await flushPromises()

    expect(wrapper.find(CONTROLS).exists()).toBe(true)
    wrapper.unmount()
  })

  it('关掉控件开关时不画', async () => {
    const wrapper = mountScene({ enabled: true, showControls: false })
    await flushPromises()

    expect(wrapper.find(CONTROLS).exists()).toBe(false)
    wrapper.unmount()
  })

  it('没启用漫游时不画', async () => {
    const wrapper = mountScene({ enabled: false, showControls: true })
    await flushPromises()

    expect(wrapper.find(CONTROLS).exists()).toBe(false)
    wrapper.unmount()
  })

  // ⚠ 站点不够两站时轨迹根本不成立，给一排点了没反应的按钮更糟
  it('轨迹凑不够两站时不画', async () => {
    const wrapper = mountScene({ enabled: true, items: ['c1'] })
    await flushPromises()

    expect(wrapper.find(CONTROLS).exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('按钮', () => {
  it('播放与暂停共用一个键，文案跟着状态换', async () => {
    const wrapper = mountScene({ enabled: true, showControls: true })
    await flushPromises()

    const toggle = wrapper
      .findAll('button')
      .find((item) => item.text() === '播放漫游')
    expect(toggle).toBeDefined()
    await toggle?.trigger('click')
    expect(wrapper.find(CONTROLS).text()).toContain('暂停漫游')
  })

  it('上一段与下一段各有可读名称', async () => {
    const wrapper = mountScene({ enabled: true, showControls: true })
    await flushPromises()

    expect(wrapper.find('button[aria-label="上一段漫游"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="下一段漫游"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('自动播放开着时进来就是「暂停」那一档', async () => {
    const wrapper = mountScene({
      enabled: true,
      showControls: true,
      autoplay: true,
    })
    await flushPromises()

    expect(wrapper.find(CONTROLS).text()).toContain('暂停漫游')
    wrapper.unmount()
  })
})
it('退出漫游配置后停止播放，镜头交还配置预览', async () => {
  const wrapper = mountScene({ enabled: true, showControls: true })
  await flushPromises()
  await wrapper.setProps({
    previewAction: { sequence: 1, partId: '', kind: 'roam-play' },
  })
  expect(wrapper.emitted('roamProgress')?.at(-1)).toEqual([
    { segmentIndex: 0, percent: 0, playing: true },
  ])
  await wrapper.setProps({
    config: config({ enabled: false, showControls: false }),
  })
  expect(wrapper.emitted('roamProgress')?.at(-1)).toEqual([
    { segmentIndex: 0, percent: 0, playing: false },
  ])
  wrapper.unmount()
})

describe('逐帧开销', () => {
  // ⚠ 漫游每帧都要模型体量：每帧重量包围盒等于每帧遍历整棵模型树
  it('漫游播放中不逐帧重量模型包围盒', async () => {
    let nextFrame: FrameRequestCallback = () => undefined
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
      (callback) => {
        nextFrame = callback
        return 1
      },
    )
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(
      () => undefined,
    )
    const wrapper = mountScene({ enabled: true, showControls: true })
    await flushPromises()
    const toggle = wrapper
      .findAll('button')
      .find((item) => item.text() === '播放漫游')
    await toggle?.trigger('click')
    nextFrame(16)
    const measure = vi.spyOn(THREE.Box3.prototype, 'setFromObject')

    for (let timeMs = 32; timeMs <= 200; timeMs += 16) nextFrame(timeMs)

    expect(wrapper.find(CONTROLS).text()).toContain('暂停漫游')
    expect(measure).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('闲置自动开播', () => {
  // ⚠ 视点条是用户在操作：只停播不重新计闲置的话，装上时的那个计时器照旧到点开播
  it('点视点条之后闲置计时从这一下重新算', async () => {
    const IDLE_MS = 5000
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const wrapper = mount(TwinScene, {
        props: {
          config: normalizeTwinConfig({
            model: { asset: ASSET },
            cameras: [
              { id: 'c1', name: '一号', position: [10, 0, 0] },
              { id: 'c2', name: '二号', position: [0, 0, 10] },
            ],
            viewpoints: { enabled: true },
            roamTour: {
              items: ['c1', 'c2'],
              enabled: true,
              showControls: true,
              idleAutoplay: true,
              idleAutoplayDelayMs: IDLE_MS,
            },
          }),
        },
        attachTo: document.body,
      })
      await flushPromises()
      vi.advanceTimersByTime(IDLE_MS - 100)
      await wrapper.find('.twin-viewpoints button').trigger('click')
      vi.advanceTimersByTime(200)
      await flushPromises()

      expect(wrapper.find(CONTROLS).text()).toContain('播放漫游')
      vi.advanceTimersByTime(IDLE_MS)
      await flushPromises()
      expect(wrapper.find(CONTROLS).text()).toContain('暂停漫游')
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
