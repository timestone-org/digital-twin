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

function fakeModel(): THREE.Object3D {
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
  return root
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
  seam.loadTwinModel.mockResolvedValue(fakeModel())
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
