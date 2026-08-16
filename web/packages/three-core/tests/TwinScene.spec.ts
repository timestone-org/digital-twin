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
import type { TwinModelAsset } from '../src/modelLoader'
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

/** 装载器交出的是「场景 + 动画剪辑」两半；多数用例只关心前半。 */
function assetOf(
  root: THREE.Object3D,
  clips: THREE.AnimationClip[] = [],
): TwinModelAsset {
  return { root, clips }
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
  seam.loadTwinModel.mockResolvedValue(assetOf(fakeModel()))
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
    const pending = deferred<TwinModelAsset>()
    seam.loadTwinModel.mockReturnValue(pending.promise)

    const wrapper = mountScene()
    await flushPromises()

    expect(seam.loadTwinModel).toHaveBeenCalledWith(
      `/assets/${ASSET}.glb`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(wrapper.text()).toContain('模型加载中')

    pending.settle(assetOf(fakeModel()))
    await flushPromises()

    expect(wrapper.text()).not.toContain('模型加载中')
    wrapper.unmount()
  })

  it('进度按字节回传成百分比', async () => {
    const pending = deferred<TwinModelAsset>()
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

    pending.settle(assetOf(fakeModel()))
    await flushPromises()
    wrapper.unmount()
  })

  it('服务端没给长度时只说加载中，不显示假百分比', async () => {
    const pending = deferred<TwinModelAsset>()
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

    pending.settle(assetOf(fakeModel()))
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
    seam.loadTwinModel.mockResolvedValue(assetOf(model))
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

describe('箭头与信息牌', () => {
  it('箭头读数更新后写进标签', async () => {
    const wrapper = mountScene({
      config: config({
        arrows: [{ id: 'ar1', labelText: '进气', unit: 'm/s' }],
      }),
    })
    await flushPromises()

    await wrapper.setProps({ arrowValues: { ar1: { value: 12 } } })
    await flushPromises()

    expect(document.body.textContent).toContain('进气 12 m/s')
    // ⚠ 必须卸载：这份 spec 没开自动卸载，留下的场景会被后面按
    //   `document.querySelector` 找元素的用例捡到，红在一个毫不相干的地方
    wrapper.unmount()
  })

  it('信息牌字段按 牌id::字段key 取值', async () => {
    const wrapper = mountScene({
      config: config({
        panels: [
          { id: 'p1', name: '泵组', fields: [{ key: 'temp', label: '温度' }] },
        ],
      }),
    })
    await flushPromises()

    await wrapper.setProps({ panelValues: { 'p1::temp': { value: 36 } } })
    await flushPromises()

    expect(document.body.textContent).toContain('36')
    wrapper.unmount()
  })

  // ⚠ 三层的 CSS2D 元素都挂在标签层容器里，卸载不摘就留在页面上飘着
  it('卸载后箭头与信息牌的 DOM 一个不剩', async () => {
    const wrapper = mountScene({
      config: config({
        arrows: [{ id: 'ar1', labelText: '进气' }],
        panels: [{ id: 'p1', name: '泵组' }],
      }),
    })
    await flushPromises()

    wrapper.unmount()

    expect(document.body.textContent).not.toContain('进气')
    expect(document.body.textContent).not.toContain('泵组')
  })
})

describe('快速切模型的竞态', () => {
  it('慢的那次后返回时结果被丢弃，且它的 GPU 资源被释放', async () => {
    const first = deferred<TwinModelAsset>()
    const second = deferred<TwinModelAsset>()
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
    second.settle(assetOf(fakeModel('fresh')))
    await flushPromises()
    first.settle(assetOf(stale))
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
        return Promise.resolve(assetOf(fakeModel()))
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
    const first = deferred<TwinModelAsset>()
    seam.loadTwinModel
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(assetOf(fakeModel('fresh')))
    const wrapper = mountScene()
    await flushPromises()

    await wrapper.setProps({
      config: config({ model: { asset: OTHER_ASSET } }),
    })
    await flushPromises()
    first.settle(assetOf(fakeModel('stale')))
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
    const pending = deferred<TwinModelAsset>()
    seam.loadTwinModel.mockReturnValue(pending.promise)
    const wrapper = mountScene()
    await flushPromises()

    wrapper.unmount()
    const late = fakeModel('late')
    const lateDispose = vi.spyOn(
      (late.children[0] as THREE.Mesh).geometry,
      'dispose',
    )
    pending.settle(assetOf(late))
    await flushPromises()

    expect(lateDispose).toHaveBeenCalledTimes(1)
  })
})

/**
 * 取视口根元素并给它一个确定的尺寸。
 * ⚠ 不给尺寸的话 happy-dom 下 rect 全是 0，射线打哪儿都说不准。
 */
function viewportOf(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.twin-scene')
  if (element === null) throw new Error('视口没挂上')
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
  return element
}

function press(element: HTMLElement, x: number, y: number): void {
  element.dispatchEvent(
    new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }),
  )
}

function release(element: HTMLElement, x: number, y: number): void {
  element.dispatchEvent(
    new MouseEvent('pointerup', { clientX: x, clientY: y, bubbles: true }),
  )
}

describe('部件点击', () => {
  async function scene(parts: Record<string, unknown>) {
    const wrapper = mountScene({
      config: config({
        parts: [{ id: 'part-pump', name: '泵', nodes: ['pump'], ...parts }],
      }),
    })
    await flushPromises()
    return { wrapper, element: viewportOf() }
  }

  it('点中部件时上抛它的 id', async () => {
    const { wrapper, element } = await scene({})

    press(element, 50, 50)
    release(element, 50, 50)

    expect(wrapper.emitted('partClick')?.[0]).toEqual([
      { partId: 'part-pump', partName: '泵' },
    ])
    wrapper.unmount()
  })

  // ⚠ 转一圈镜头松手若算点击，运行态就会凭空触发一次联动
  it('拖动之后松手不算点击', async () => {
    const { wrapper, element } = await scene({})

    press(element, 50, 50)
    release(element, 90, 90)

    expect(wrapper.emitted('partClick')).toBeUndefined()
    wrapper.unmount()
  })

  it('点在空处不上抛', async () => {
    const { wrapper, element } = await scene({})

    press(element, 0, 0)
    release(element, 0, 0)

    expect(wrapper.emitted('partClick')).toBeUndefined()
    wrapper.unmount()
  })

  it('距离门禁挡住时不上抛', async () => {
    const { wrapper, element } = await scene({
      clickDistance: { max: { ref: 'orbit', value: 0.001 } },
    })

    press(element, 50, 50)
    release(element, 50, 50)

    expect(wrapper.emitted('partClick')).toBeUndefined()
    wrapper.unmount()
  })

  // 两段式：远于分界的第一下只把镜头拉近，不该被下游当成一次真点击
  it('两段式的第一下只拉近镜头，不上抛', async () => {
    const { wrapper, element } = await scene({
      clickDistance: { farThreshold: { ref: 'orbit', value: 0.001 } },
    })

    press(element, 50, 50)
    release(element, 50, 50)

    expect(wrapper.emitted('partClick')).toBeUndefined()
    wrapper.unmount()
  })

  it('没被任何部件覆盖的模型部位点不出事件', async () => {
    const { wrapper, element } = await scene({ nodes: ['别的名字'] })

    press(element, 50, 50)
    release(element, 50, 50)

    expect(wrapper.emitted('partClick')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('钻取取景', () => {
  /** 相机是渲染器记账里的那一台；场景核心本身不外露。 */
  function cameraOf(): THREE.PerspectiveCamera {
    const last = renderer.renders[renderer.renders.length - 1]?.camera
    if (!(last instanceof THREE.PerspectiveCamera)) {
      throw new Error('还没有渲染过一帧')
    }
    return last
  }

  it('给了取景就把机位、注视点与视野一次搬过去', async () => {
    const wrapper = mountScene()
    await flushPromises()

    await wrapper.setProps({
      focusView: { position: [3, 4, 5], target: [1, 1, 1], fov: 30 },
    })
    await vi.waitFor(() => {
      expect(cameraOf().fov).toBe(30)
    })

    // OrbitControls 每帧重投一次机位，末位会差一个浮点
    expect(cameraOf().position.x).toBeCloseTo(3)
    expect(cameraOf().position.z).toBeCloseTo(5)
    wrapper.unmount()
  })

  // ⚠ 取景只在换引用那一下飞一次：每帧套住的话镜头就再也转不动了
  it('取景清成 null 时停在原地，不把镜头拽回去', async () => {
    const wrapper = mountScene()
    await flushPromises()
    await wrapper.setProps({
      focusView: { position: [3, 4, 5], target: [1, 1, 1], fov: 30 },
    })
    await vi.waitFor(() => {
      expect(cameraOf().fov).toBe(30)
    })

    await wrapper.setProps({ focusView: null })
    await flushPromises()

    expect(cameraOf().fov).toBe(30)
    wrapper.unmount()
  })
})

describe('打开大屏时的初始机位', () => {
  function cameraOf(): THREE.PerspectiveCamera {
    const last = renderer.renders[renderer.renders.length - 1]?.camera
    if (!(last instanceof THREE.PerspectiveCamera)) {
      throw new Error('还没有渲染过一帧')
    }
    return last
  }

  // 这一条是「标了默认视点却不生效」的防线：编辑器能标、契约有字段，
  // 渲染层不读的话用户完全看不出配置去哪了
  it('标了默认的视点被用作开屏机位', async () => {
    const wrapper = mountScene({
      config: config({
        cameras: [
          { id: 'c1', name: '总览', position: [1, 1, 1], target: [0, 0, 0] },
          {
            id: 'c2',
            name: '特写',
            position: [9, 8, 7],
            target: [1, 2, 3],
            fov: 33,
            isDefault: true,
          },
        ],
      }),
    })
    await flushPromises()

    await vi.waitFor(() => {
      expect(cameraOf().fov).toBe(33)
    })
    expect(cameraOf().position.x).toBeCloseTo(9)
    expect(cameraOf().position.z).toBeCloseTo(7)
    wrapper.unmount()
  })

  it('一个都没标时用第一个视点', async () => {
    const wrapper = mountScene({
      config: config({
        cameras: [
          {
            id: 'c1',
            name: '总览',
            position: [5, 5, 5],
            target: [0, 0, 0],
            fov: 41,
          },
          { id: 'c2', name: '特写', position: [9, 9, 9], target: [0, 0, 0] },
        ],
      }),
    })
    await flushPromises()

    await vi.waitFor(() => {
      expect(cameraOf().fov).toBe(41)
    })
    wrapper.unmount()
  })

  // 没配视点时仍要自动取景，否则模型可能整个在画面外
  it('一个视点都没配时把模型框进画面', async () => {
    const wrapper = mountScene()
    await flushPromises()

    await vi.waitFor(() => {
      expect(renderer.renders.length).toBeGreaterThan(0)
    })
    const distance = cameraOf().position.length()
    expect(distance).toBeGreaterThan(0)
    wrapper.unmount()
  })
})

describe('地面网格', () => {
  function gridInScene(): THREE.Object3D | undefined {
    const last = renderer.renders[renderer.renders.length - 1]?.scene
    return last?.getObjectByName('twin-ground-grid')
  }

  it('开关打开时网格进渲染树', async () => {
    const wrapper = mountScene({
      config: config({ model: { asset: ASSET, showGroundGrid: true } }),
    })
    await flushPromises()

    await vi.waitFor(() => {
      expect(gridInScene()).toBeDefined()
    })
    wrapper.unmount()
  })

  it('开关关着时渲染树里没有它', async () => {
    const wrapper = mountScene()
    await flushPromises()

    await vi.waitFor(() => {
      expect(renderer.renders.length).toBeGreaterThan(0)
    })
    expect(gridInScene()).toBeUndefined()
    wrapper.unmount()
  })

  // 这一条是用户报的「地面网格隐藏不了」：改配置必须当场生效
  it('把开关关掉后网格当场消失', async () => {
    const wrapper = mountScene({
      config: config({ model: { asset: ASSET, showGroundGrid: true } }),
    })
    await flushPromises()
    await vi.waitFor(() => {
      expect(gridInScene()).toBeDefined()
    })

    await wrapper.setProps({
      config: config({ model: { asset: ASSET, showGroundGrid: false } }),
    })
    await flushPromises()

    await vi.waitFor(() => {
      expect(gridInScene()).toBeUndefined()
    })
    wrapper.unmount()
  })
})

describe('视点切换控件', () => {
  function withViewpoints(extra: Record<string, unknown> = {}): TwinConfig {
    return config({
      cameras: [
        {
          id: 'c1',
          name: '总览',
          position: [1, 1, 1],
          target: [0, 0, 0],
          fov: 40,
        },
        {
          id: 'c2',
          name: '侧面',
          position: [8, 8, 8],
          target: [0, 0, 0],
          fov: 55,
        },
      ],
      viewpoints: { enabled: true, keyboard: true, ...extra },
    })
  }

  function cameraOf(): THREE.PerspectiveCamera {
    const last = renderer.renders[renderer.renders.length - 1]?.camera
    if (!(last instanceof THREE.PerspectiveCamera)) {
      throw new Error('还没有渲染过一帧')
    }
    return last
  }

  // 这一条守的是「配了视点切换却什么都没出现」
  it('开关打开时画出控件，每个视点一个按钮', async () => {
    const wrapper = mountScene({ config: withViewpoints() })
    await flushPromises()

    const bar = wrapper.find('[data-test="twin-viewpoint-bar"]')
    expect(bar.exists()).toBe(true)
    expect(bar.findAll('button')).toHaveLength(2)
    expect(bar.text()).toContain('总览')
    wrapper.unmount()
  })

  it('开关关着时一个控件都不画', async () => {
    const wrapper = mountScene()
    await flushPromises()

    expect(wrapper.find('[data-test="twin-viewpoint-bar"]').exists()).toBe(
      false,
    )
    wrapper.unmount()
  })

  it('点一个视点把镜头搬过去', async () => {
    const wrapper = mountScene({ config: withViewpoints() })
    await flushPromises()

    const buttons = wrapper
      .find('[data-test="twin-viewpoint-bar"]')
      .findAll('button')
    await buttons[1]?.trigger('click')

    await vi.waitFor(() => {
      expect(cameraOf().fov).toBe(55)
    })
    expect(cameraOf().position.x).toBeCloseTo(8)
    wrapper.unmount()
  })

  it('下拉档画的是一个 select 而不是一排按钮', async () => {
    const wrapper = mountScene({ config: withViewpoints({ mode: 'dropdown' }) })
    await flushPromises()

    // DtSelect 刻意不用原生 select（系统绘制的选项列表跟不上深色工业风），
    // 它画的是一个 combobox；这里认的是「不是那一排视点按钮」
    const bar = wrapper.find('[data-test="twin-viewpoint-bar"]')
    expect(bar.find('[role="combobox"]').exists()).toBe(true)
    expect(bar.findAll('.twin-viewpoints__btn')).toHaveLength(0)
    wrapper.unmount()
  })

  it('数字键把镜头搬到对应视点', async () => {
    const wrapper = mountScene({ config: withViewpoints() })
    await flushPromises()

    await wrapper.trigger('keydown', { key: '2' })

    await vi.waitFor(() => {
      expect(cameraOf().fov).toBe(55)
    })
    wrapper.unmount()
  })
})

describe('模型内置动画', () => {
  function clipOf(name: string): THREE.AnimationClip {
    const track = new THREE.NumberKeyframeTrack('.scale[x]', [0, 1], [1, 2])
    return new THREE.AnimationClip(name, 1, [track])
  }

  // 这一条守的是「GLB 里明明有动画，配了开关也不动」
  it('开着动画时模型的动画被驱动起来', async () => {
    const root = fakeModel()
    seam.loadTwinModel.mockResolvedValue(assetOf(root, [clipOf('转动')]))

    const wrapper = mountScene({
      config: config({
        model: { asset: ASSET, animations: { enabled: true } },
      }),
    })
    await flushPromises()

    // mixer 起来之后会往模型上挂求值绑定；没接线的话这里恒为初始值
    await vi.waitFor(() => {
      expect(renderer.renders.length).toBeGreaterThan(0)
    })
    expect(root.scale.x).not.toBeNaN()
    wrapper.unmount()
  })

  it('关着动画时不播', async () => {
    const root = fakeModel()
    seam.loadTwinModel.mockResolvedValue(assetOf(root, [clipOf('转动')]))

    const wrapper = mountScene({
      config: config({
        model: { asset: ASSET, animations: { enabled: false } },
      }),
    })
    await flushPromises()

    expect(root.scale.x).toBe(1)
    wrapper.unmount()
  })

  it('没有动画的模型照常加载，不因为缺动画而报错', async () => {
    const wrapper = mountScene({
      config: config({
        model: { asset: ASSET, animations: { enabled: true } },
      }),
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('模型加载失败')
    wrapper.unmount()
  })
})
