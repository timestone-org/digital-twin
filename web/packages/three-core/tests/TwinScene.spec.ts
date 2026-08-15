/**
 * @fileoverview 守孪生场景宿主的契约：WebGL 不可用时降级成提示而不是白屏、
 * 取不到模型地址就说取不到、快速切模型时慢的那次结果被丢弃且资源被释放、
 * 卸载后 RAF 与 ResizeObserver 都停掉、渲染上下文被丢。
 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import { flushPromises, mount } from '@vue/test-utils'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { configureTwinModelHost, resetTwinModelHost } from '../src/host'
import type * as SceneCoreModule from '../src/sceneCore'
import { WEBGL_UNAVAILABLE_MESSAGE } from '../src/sceneCore'
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
const OTHER_ASSET = 'asset:0192f0aa-0000-7000-8000-000000000002'

let renderer: HeadlessRenderer

interface Deferred<T> {
  promise: Promise<T>
  settle: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let settle: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

function fakeModel(nodeName = 'pump'): THREE.Object3D {
  const root = new THREE.Group()
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial({ color: '#ff0000' }),
  )
  mesh.name = nodeName
  root.add(mesh)
  return root
}

function config(overrides: Record<string, unknown> = {}): TwinConfig {
  return normalizeTwinConfig({
    model: { asset: ASSET },
    parts: [{ id: 'part-pump', name: '泵', nodes: ['pump'] }],
    ...overrides,
  })
}

function mountScene(props: Record<string, unknown> = {}) {
  return mount(TwinScene, {
    props: { config: config(), ...props },
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

describe('降级路径', () => {
  it('WebGL 不可用时给出提示，而不是留一块白屏', async () => {
    seam.createWebGLRenderer.mockReturnValue(null)

    const wrapper = mountScene()
    await flushPromises()

    expect(wrapper.text()).toContain(WEBGL_UNAVAILABLE_MESSAGE)
    expect(seam.loadTwinModel).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('还没挑模型时是空态，不去装载', async () => {
    const wrapper = mountScene({ config: config({ model: { asset: '' } }) })
    await flushPromises()

    expect(wrapper.text()).toContain('未选择模型')
    expect(seam.loadTwinModel).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('宿主解析不出地址时说解析失败，不发请求', async () => {
    configureTwinModelHost({ resolveModelUrl: () => '' })

    const wrapper = mountScene()
    await flushPromises()

    expect(wrapper.text()).toContain('模型地址解析失败')
    expect(seam.loadTwinModel).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('装载失败时把原因照实说出来', async () => {
    seam.loadTwinModel.mockRejectedValue(new Error('HTTP 404'))

    const wrapper = mountScene()
    await flushPromises()

    expect(wrapper.text()).toContain('HTTP 404')
    wrapper.unmount()
  })

  it('抛出来的不是 Error 时给统一文案', async () => {
    seam.loadTwinModel.mockRejectedValue('boom')

    const wrapper = mountScene()
    await flushPromises()

    expect(wrapper.text()).toContain('模型加载失败')
    wrapper.unmount()
  })
})

describe('装载', () => {
  it('把宿主解析出的地址交给装载器，并先进加载态', async () => {
    const pending = deferred<THREE.Object3D>()
    seam.loadTwinModel.mockReturnValue(pending.promise)

    const wrapper = mountScene()
    await flushPromises()

    expect(seam.loadTwinModel).toHaveBeenCalledWith(
      `/assets/${ASSET}.glb`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(wrapper.text()).toContain('模型加载中')

    pending.settle(fakeModel())
    await flushPromises()

    expect(wrapper.text()).not.toContain('模型加载中')
    wrapper.unmount()
  })

  it('进度按字节回传成百分比', async () => {
    const pending = deferred<THREE.Object3D>()
    seam.loadTwinModel.mockImplementation(
      (
        _url: string,
        options: { onProgress?: (a: number, b: number) => void },
      ) => {
        options.onProgress?.(30, 120)
        return pending.promise
      },
    )

    const wrapper = mountScene()
    await flushPromises()

    expect(wrapper.text()).toContain('模型加载中 25%')

    pending.settle(fakeModel())
    await flushPromises()
    wrapper.unmount()
  })

  it('服务端没给长度时只说加载中，不显示假百分比', async () => {
    const pending = deferred<THREE.Object3D>()
    seam.loadTwinModel.mockImplementation(
      (
        _url: string,
        options: { onProgress?: (a: number, b: number) => void },
      ) => {
        options.onProgress?.(30, 0)
        return pending.promise
      },
    )

    const wrapper = mountScene()
    await flushPromises()

    expect(wrapper.text()).toContain('模型加载中')
    expect(wrapper.text()).not.toContain('%')

    pending.settle(fakeModel())
    await flushPromises()
    wrapper.unmount()
  })

  it('配置引用了模型里没有的节点名时响亮报出来', async () => {
    const wrapper = mountScene({
      config: config({
        parts: [{ id: 'part-ghost', name: '幽灵', nodes: ['ghost'] }],
      }),
    })
    await flushPromises()

    expect(wrapper.text()).toContain('模型里没有这些部件节点：ghost')
    wrapper.unmount()
  })

  it('节点名全都对得上时不报警告', async () => {
    const wrapper = mountScene()
    await flushPromises()

    expect(wrapper.text()).not.toContain('模型里没有这些部件节点')
    wrapper.unmount()
  })

  it('挂载时按宿主尺寸量一次，高度为 0 也不出 NaN', async () => {
    const wrapper = mountScene()
    await flushPromises()

    expect(renderer.sizes).toHaveLength(1)
    expect(renderer.sizes[0]?.height).toBe(1)
    wrapper.unmount()
  })

  it('背景色规格是 token 时包成 var() 落到根元素上', async () => {
    const wrapper = mountScene({
      config: config({ model: { asset: ASSET, background: '--surface-base' } }),
    })
    await flushPromises()

    expect(wrapper.attributes('style')).toContain('var(--surface-base)')
    wrapper.unmount()
  })
})

describe('实时值', () => {
  it('锚点读数更新后写进标签文本', async () => {
    const wrapper = mountScene({
      config: config({
        anchors: [
          {
            id: 'a1',
            name: '出口温度',
            position: [0, 1, 0],
            unit: '℃',
            decimals: 1,
          },
        ],
      }),
    })
    await flushPromises()

    await wrapper.setProps({ anchorValues: { a1: { value: 36.456 } } })
    await flushPromises()

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('36.5 ℃')
    })
    wrapper.unmount()
  })

  // ⚠ 摆放只在装载时应用过一次的话，编辑器里拖缩放/位移/旋转会一直到换模型才生效
  it('改摆放不换模型时，模型按新的缩放位移旋转就位', async () => {
    const model = fakeModel()
    seam.loadTwinModel.mockResolvedValue(model)
    const wrapper = mountScene()
    await flushPromises()

    await wrapper.setProps({
      config: config({
        model: {
          asset: ASSET,
          scale: 3,
          position: [1, 2, 3],
          rotation: [90, 0, 0],
        },
      }),
    })
    await flushPromises()

    expect(model.scale.x).toBe(3)
    expect(model.position.toArray()).toEqual([1, 2, 3])
    expect(model.rotation.x).toBeCloseTo(Math.PI / 2, 4)
    wrapper.unmount()
  })
})

describe('快速切模型的竞态', () => {
  it('慢的那次后返回时结果被丢弃，且它的 GPU 资源被释放', async () => {
    const first = deferred<THREE.Object3D>()
    const second = deferred<THREE.Object3D>()
    seam.loadTwinModel
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const wrapper = mountScene()
    await flushPromises()

    await wrapper.setProps({
      config: config({ model: { asset: OTHER_ASSET } }),
    })
    await flushPromises()

    const stale = fakeModel('stale')
    const staleMesh = stale.children[0] as THREE.Mesh
    const staleDispose = vi.spyOn(staleMesh.geometry, 'dispose')
    second.settle(fakeModel('fresh'))
    await flushPromises()
    first.settle(stale)
    await flushPromises()

    expect(staleDispose).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('模型加载中')
    wrapper.unmount()
  })

  it('切模型时上一次的取消信号被拉响', async () => {
    const signals: AbortSignal[] = []
    seam.loadTwinModel.mockImplementation(
      (_url: string, options: { signal: AbortSignal }) => {
        signals.push(options.signal)
        return Promise.resolve(fakeModel())
      },
    )
    const wrapper = mountScene()
    await flushPromises()

    await wrapper.setProps({
      config: config({ model: { asset: OTHER_ASSET } }),
    })
    await flushPromises()

    expect(signals).toHaveLength(2)
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
    wrapper.unmount()
  })

  it('晚到的失败不会盖掉新一次的成功', async () => {
    const first = deferred<THREE.Object3D>()
    seam.loadTwinModel
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(fakeModel('fresh'))
    const wrapper = mountScene()
    await flushPromises()

    await wrapper.setProps({
      config: config({ model: { asset: OTHER_ASSET } }),
    })
    await flushPromises()
    first.settle(fakeModel('stale'))
    await flushPromises()

    expect(wrapper.text()).not.toContain('模型地址解析失败')
    expect(wrapper.text()).not.toContain('模型加载中')
    wrapper.unmount()
  })
})

describe('卸载清理', () => {
  it('渲染上下文被丢，两层画布从宿主摘走', async () => {
    const wrapper = mountScene()
    await flushPromises()
    const container = document.querySelector('.twin-scene')

    wrapper.unmount()

    expect(renderer.disposeCount).toBe(1)
    expect(renderer.forceContextLossCount).toBe(1)
    expect(container?.children).toHaveLength(0)
  })

  it('RAF 与 ResizeObserver 都停掉', async () => {
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame')
    const disconnect = vi.spyOn(ResizeObserver.prototype, 'disconnect')
    const wrapper = mountScene()
    await flushPromises()

    wrapper.unmount()

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('卸载后在途装载回来时不再往已释放的场景里挂东西', async () => {
    const pending = deferred<THREE.Object3D>()
    seam.loadTwinModel.mockReturnValue(pending.promise)
    const wrapper = mountScene()
    await flushPromises()

    wrapper.unmount()
    const late = fakeModel('late')
    const lateDispose = vi.spyOn(
      (late.children[0] as THREE.Mesh).geometry,
      'dispose',
    )
    pending.settle(late)
    await flushPromises()

    expect(lateDispose).toHaveBeenCalledTimes(1)
  })
})
