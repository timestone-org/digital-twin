/**
 * @fileoverview 守编辑视口内核的契约：降级路径不白屏、快速换模型时慢的那次被丢弃且资源释放、
 * 编辑态四条与运行态刻意不同的行为（只认 visible / 网格恒显 / 自动旋转恒关 / 实时值恒空）、
 * 拖动过视口不算点击，以及卸载后 rAF、Observer、监听与渲染上下文都停掉。
 */
import type { GltfSource } from '../src/modelLoader'
import { configureTwinModelHost, resetTwinModelHost } from '../src/host'
import { WEBGL_UNAVAILABLE_MESSAGE } from '../src/sceneCore'
import {
  createHeadlessRenderer,
  type HeadlessRenderer,
} from '../src/testing/createHeadlessRenderer'
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import { flushPromises } from '@vue/test-utils'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EditorScene } from '../src/editorScene'

const ASSET = 'asset:0192f0aa-0000-7000-8000-000000000001'
const OTHER_ASSET = 'asset:0192f0aa-0000-7000-8000-000000000002'
/** 画布在客户端坐标下的矩形；happy-dom 量不出布局，只能钉死 */
const CANVAS_RECT = new DOMRect(0, 0, 400, 300)
const CENTER_X = 200
const CENTER_Y = 150

interface Events {
  select: ReturnType<typeof vi.fn>
  pickNode: ReturnType<typeof vi.fn>
  pickPosition: ReturnType<typeof vi.fn>
  modelNodes: ReturnType<typeof vi.fn>
  cameraChange: ReturnType<typeof vi.fn>
  status: ReturnType<typeof vi.fn>
  roamPreview: ReturnType<typeof vi.fn>
  entityTransform: ReturnType<typeof vi.fn>
  entityTransformEnd: ReturnType<typeof vi.fn>
  marqueeNodes: ReturnType<typeof vi.fn>
}

interface Harness {
  container: HTMLDivElement
  renderer: HeadlessRenderer
  canvas: HTMLCanvasElement
  events: Events
  scene: EditorScene
}

interface Deferred {
  promise: Promise<{ scene: THREE.Object3D }>
  settle: (root: THREE.Object3D) => void
}

const mounted: Harness[] = []

function createEvents(): Events {
  return {
    select: vi.fn(),
    pickNode: vi.fn(),
    pickPosition: vi.fn(),
    modelNodes: vi.fn(),
    cameraChange: vi.fn(),
    status: vi.fn(),
    roamPreview: vi.fn(),
    entityTransform: vi.fn(),
    entityTransformEnd: vi.fn(),
    marqueeNodes: vi.fn(),
  }
}

function deferred(): Deferred {
  let settle: (root: THREE.Object3D) => void = () => undefined
  const promise = new Promise<{ scene: THREE.Object3D }>((resolve) => {
    settle = (root) => resolve({ scene: root })
  })
  return { promise, settle }
}

function twinConfig(overrides: Record<string, unknown> = {}): TwinConfig {
  return normalizeTwinConfig({
    model: { asset: ASSET },
    parts: [{ id: 'part-pump', name: '泵', nodes: ['pump'] }],
    ...overrides,
  })
}

function fakeModel(
  nodeName = 'pump',
  position: THREE.Vector3Like = new THREE.Vector3(),
): THREE.Object3D {
  const root = new THREE.Group()
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial(),
  )
  mesh.name = nodeName
  mesh.position.set(position.x, position.y, position.z)
  root.add(mesh)
  return root
}

function fixedSource(root: THREE.Object3D): GltfSource {
  return { loadAsync: () => Promise.resolve({ scene: root }) }
}

function createScene(config: TwinConfig, source: GltfSource): Harness {
  const container = document.createElement('div')
  document.body.append(container)
  const renderer = createHeadlessRenderer()
  const events = createEvents()
  vi.spyOn(renderer.domElement, 'getBoundingClientRect').mockReturnValue(
    CANVAS_RECT,
  )
  const scene = new EditorScene({
    container,
    config,
    on: events,
    createRenderer: () => renderer,
    gltfSource: source,
  })
  const harness: Harness = {
    container,
    renderer,
    canvas: renderer.domElement,
    events,
    scene,
  }
  mounted.push(harness)
  return harness
}

async function ready(
  config: TwinConfig = twinConfig(),
  model: THREE.Object3D = fakeModel(),
): Promise<Harness> {
  const harness = createScene(config, fixedSource(model))
  await flushPromises()
  return harness
}

/** 等渲染循环真的跑过一帧；渲染器记下的那份场景就是断言入口。 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

async function renderedScene(harness: Harness): Promise<THREE.Object3D> {
  await nextFrame()
  const last = harness.renderer.renders.at(-1)
  if (last === undefined) throw new Error('渲染循环没有跑过任何一帧')
  return last.scene
}

function press(
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointerup',
  x: number,
  y: number,
  button = 0,
): void {
  canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button }))
}

function click(harness: Harness, x: number, y: number): void {
  press(harness.canvas, 'pointerdown', x, y)
  press(harness.canvas, 'pointerup', x, y)
}

beforeEach(() => {
  configureTwinModelHost({ resolveModelUrl: (ref) => `/assets/${ref}.glb` })
})

afterEach(() => {
  for (const harness of mounted.splice(0)) {
    harness.scene.dispose()
    harness.container.remove()
  }
  resetTwinModelHost()
  vi.restoreAllMocks()
})

describe('降级与空态', () => {
  it('WebGL 不可用时给出提示，且不去装载模型', () => {
    const events = createEvents()
    const source = { loadAsync: vi.fn() }
    const container = document.createElement('div')

    const scene = new EditorScene({
      container,
      config: twinConfig(),
      on: events,
      createRenderer: () => null,
      gltfSource: source,
    })

    expect(events.status).toHaveBeenCalledWith(
      'error',
      WEBGL_UNAVAILABLE_MESSAGE,
    )
    expect(source.loadAsync).not.toHaveBeenCalled()
    scene.dispose()
  })

  it('还没挑模型时是空态，节点名给一份空清单', async () => {
    const source = { loadAsync: vi.fn() }
    const harness = createScene(twinConfig({ model: { asset: '' } }), source)
    await flushPromises()

    expect(harness.events.status).toHaveBeenLastCalledWith('empty', '')
    expect(harness.events.modelNodes).toHaveBeenCalledWith([])
    expect(source.loadAsync).not.toHaveBeenCalled()
  })

  it('宿主解析不出地址时说解析失败，不发请求', async () => {
    configureTwinModelHost({ resolveModelUrl: () => '' })
    const source = { loadAsync: vi.fn() }
    const harness = createScene(twinConfig(), source)
    await flushPromises()

    expect(harness.events.status).toHaveBeenLastCalledWith(
      'error',
      expect.stringContaining('模型地址解析失败'),
    )
    expect(source.loadAsync).not.toHaveBeenCalled()
  })

  it('装载抛错时状态转 error 并带上原因', async () => {
    const harness = createScene(twinConfig(), {
      loadAsync: () => Promise.reject(new Error('GLB 解析失败')),
    })
    await flushPromises()

    expect(harness.events.status).toHaveBeenLastCalledWith(
      'error',
      'GLB 解析失败',
    )
  })
})

describe('模型装载', () => {
  it('装载完成后状态转 ready，并把全部命名节点交出去', async () => {
    const harness = await ready()

    expect(harness.events.status).toHaveBeenLastCalledWith('ready', '')
    expect(harness.events.modelNodes).toHaveBeenLastCalledWith(['pump'])
    expect(harness.events.cameraChange).toHaveBeenCalled()
  })

  it('慢的那次装载后返回时结果被丢弃，它的 GPU 资源一并释放', async () => {
    const slow = deferred()
    const fast = deferred()
    let call = 0
    const harness = createScene(twinConfig(), {
      loadAsync: () => (call++ === 0 ? slow.promise : fast.promise),
    })
    const slowModel = fakeModel('slow')
    const slowMesh = slowModel.children[0] as THREE.Mesh
    const geometryDispose = vi.spyOn(slowMesh.geometry, 'dispose')

    harness.scene.setConfig(twinConfig({ model: { asset: OTHER_ASSET } }))
    fast.settle(fakeModel('fast'))
    await flushPromises()
    slow.settle(slowModel)
    await flushPromises()

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(harness.events.modelNodes).toHaveBeenLastCalledWith(['fast'])
  })

  it('换模型那一下配置立刻生效，不必等装载有结果', async () => {
    const pending = deferred()
    let call = 0
    const harness = createScene(twinConfig(), {
      loadAsync: () =>
        call++ === 0
          ? Promise.resolve({ scene: fakeModel() })
          : pending.promise,
    })
    await flushPromises()

    harness.scene.setConfig(
      twinConfig({
        model: { asset: OTHER_ASSET },
        anchors: [{ id: 'a1' }, { id: 'a2' }],
      }),
    )
    const scene = await renderedScene(harness)

    expect(scene.getObjectByName('twin-pick-targets')?.children).toHaveLength(2)
  })

  it('装载失败时节点清单也清空，不留上一个模型的节点名', async () => {
    const harness = createScene(twinConfig(), {
      loadAsync: () => Promise.reject(new Error('GLB 解析失败')),
    })
    await flushPromises()

    expect(harness.events.modelNodes).toHaveBeenLastCalledWith([])
  })

  it('卸载后才回来的装载不再往已释放的场景里挂模型', async () => {
    const pending = deferred()
    const harness = createScene(twinConfig(), {
      loadAsync: () => pending.promise,
    })
    const model = fakeModel('late')
    const mesh = model.children[0] as THREE.Mesh
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')

    harness.scene.dispose()
    pending.settle(model)
    await flushPromises()

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(harness.events.modelNodes).not.toHaveBeenCalled()
  })
})

describe('编辑态刻意与运行态不同的地方', () => {
  it('配了自动旋转也不转，镜头停在原地', async () => {
    const harness = await ready(
      twinConfig({ model: { asset: ASSET, autoRotate: true } }),
    )
    const before = harness.scene.snapshot()

    await nextFrame()
    await nextFrame()

    expect(harness.scene.snapshot().position).toEqual(before.position)
  })

  it('关掉地面网格的配置也照样画网格与坐标轴', async () => {
    const harness = await ready(
      twinConfig({ model: { asset: ASSET, showGroundGrid: false } }),
    )
    const scene = await renderedScene(harness)

    expect(scene.getObjectByName('twin-editor-helpers')?.children).toHaveLength(
      2,
    )
  })

  it('部件只认 visible：置假的隐藏，配了距离规则的仍然可见', async () => {
    const model = fakeModel()
    await ready(
      twinConfig({
        parts: [
          {
            id: 'part-pump',
            nodes: ['pump'],
            visibility: {
              visible: true,
              hideAbove: { ref: 'orbit', value: 0.001 },
            },
          },
        ],
      }),
      model,
    )

    expect(model.getObjectByName('pump')?.visible).toBe(true)
  })

  it('置为不可见的部件在视口里也是隐藏的', async () => {
    const model = fakeModel()
    await ready(
      twinConfig({
        parts: [{ id: 'part-pump', nodes: ['pump'], visible: false }],
      }),
      model,
    )

    expect(model.getObjectByName('pump')?.visible).toBe(false)
  })
})

describe('视口拾取', () => {
  it('拖过视口不算点击，松手不改选中', async () => {
    const harness = await ready()

    press(harness.canvas, 'pointerdown', CENTER_X, CENTER_Y)
    press(harness.canvas, 'pointerup', CENTER_X + 40, CENTER_Y + 40)

    expect(harness.events.select).not.toHaveBeenCalled()
  })

  it('点空白处给 null', async () => {
    const harness = await ready()

    click(harness, 4, 4)

    expect(harness.events.select).toHaveBeenCalledWith(null)
  })

  it('点中模型上属于某个部件的网格时选中那个部件', async () => {
    const harness = await ready()

    click(harness, CENTER_X, CENTER_Y)

    expect(harness.events.select).toHaveBeenCalledWith({
      kind: 'parts',
      id: 'part-pump',
    })
  })

  it('点中锚点标记时选中那个锚点，模型挡不住它', async () => {
    const harness = await ready(
      twinConfig({ anchors: [{ id: 'a1', position: [0, 0, 0] }] }),
    )

    click(harness, CENTER_X, CENTER_Y)

    expect(harness.events.select).toHaveBeenCalledWith({
      kind: 'anchors',
      id: 'a1',
    })
  })

  it('右键不触发点击', async () => {
    const harness = await ready()

    press(harness.canvas, 'pointerdown', CENTER_X, CENTER_Y, 2)
    press(harness.canvas, 'pointerup', CENTER_X, CENTER_Y, 2)

    expect(harness.events.select).not.toHaveBeenCalled()
  })

  it('节点拾取模式下点模型给出节点名，且不改选中', async () => {
    const harness = await ready()
    harness.scene.setPickMode('node')

    click(harness, CENTER_X, CENTER_Y)

    expect(harness.events.pickNode).toHaveBeenCalledWith('pump')
    expect(harness.events.select).not.toHaveBeenCalled()
  })

  it('位置拾取模式下没命中模型也落到地面上', async () => {
    const harness = await ready(twinConfig({ model: { asset: '' } }))
    harness.scene.setPickMode('position')

    click(harness, CENTER_X, CENTER_Y)

    const point = harness.events.pickPosition.mock.calls[0]?.[0] as number[]
    expect(point?.[1]).toBeCloseTo(0, 6)
    expect(harness.events.select).not.toHaveBeenCalled()
  })

  it('位置拾取模式下点模型表面取表面点', async () => {
    const harness = await ready()
    harness.scene.setPickMode('position')

    click(harness, CENTER_X, CENTER_Y)

    expect(harness.events.pickPosition).toHaveBeenCalledTimes(1)
  })

  it('画布塌成零尺寸时点击不触发任何回调', async () => {
    const harness = await ready()
    vi.spyOn(harness.canvas, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 0, 0),
    )

    click(harness, CENTER_X, CENTER_Y)

    expect(harness.events.select).not.toHaveBeenCalled()
  })

  it('宿主被折叠时不换算标记尺寸，标记不会大到把相机包进去', async () => {
    const harness = await ready(
      twinConfig({ anchors: [{ id: 'a1', position: [0, 0, 0] }] }),
    )
    const scene = await renderedScene(harness)
    const marker = scene.getObjectByName('twin-pick-targets')?.children[0]
    const collapsed = marker?.scale.x ?? 0

    vi.spyOn(harness.container, 'clientHeight', 'get').mockReturnValue(600)
    await nextFrame()

    expect(collapsed).toBeLessThan(1)
    expect(marker?.scale.x).not.toBe(collapsed)
  })

  it('拾取模式把光标换成十字，回到浏览态再换回去', async () => {
    const harness = await ready()

    harness.scene.setPickMode('position')
    expect(harness.container.style.cursor).toBe('crosshair')

    harness.scene.setPickMode(null)
    expect(harness.container.style.cursor).toBe('')
  })
})

describe('选中高亮', () => {
  it('选中部件时画出描边框', async () => {
    const harness = await ready()
    harness.scene.setSelection({ kind: 'parts', id: 'part-pump' })
    const scene = await renderedScene(harness)

    expect(scene.getObjectByName('twin-selection-box')?.visible).toBe(true)
  })

  it('选中换成锚点时部件描边框收起', async () => {
    const harness = await ready(
      twinConfig({ anchors: [{ id: 'a1', position: [0, 0, 0] }] }),
    )
    harness.scene.setSelection({ kind: 'parts', id: 'part-pump' })
    harness.scene.setSelection({ kind: 'anchors', id: 'a1' })
    const scene = await renderedScene(harness)

    expect(scene.getObjectByName('twin-selection-box')?.visible).toBe(false)
  })

  it('部件在模型里一个节点都没命中时不画框', async () => {
    const harness = await ready(
      twinConfig({ parts: [{ id: 'part-ghost', nodes: ['nowhere'] }] }),
    )
    harness.scene.setSelection({ kind: 'parts', id: 'part-ghost' })
    const scene = await renderedScene(harness)

    expect(scene.getObjectByName('twin-selection-box')?.visible).toBe(false)
  })
})

describe('取景与机位', () => {
  it('对焦到部件时镜头看向那个部件，并回传机位', async () => {
    const harness = await ready(
      twinConfig(),
      fakeModel('pump', new THREE.Vector3(10, 0, 0)),
    )
    harness.events.cameraChange.mockClear()

    harness.scene.focus({ kind: 'parts', id: 'part-pump' })

    expect(harness.scene.snapshot().target[0]).toBeCloseTo(10, 6)
    expect(harness.events.cameraChange).toHaveBeenCalledTimes(1)
  })

  it('对焦到实体时镜头看向它的落点', async () => {
    const harness = await ready(
      twinConfig({ anchors: [{ id: 'a1', position: [0, 4, 0] }] }),
    )

    harness.scene.focus({ kind: 'anchors', id: 'a1' })

    expect(harness.scene.snapshot().target[1]).toBeCloseTo(4, 6)
  })

  it('对焦到视点时套用它存下的机位', async () => {
    const harness = await ready(
      twinConfig({
        cameras: [
          {
            id: 'cam-1',
            position: [1, 2, 3],
            target: [4, 5, 6],
            fov: 60,
          },
        ],
      }),
    )

    harness.scene.focus({ kind: 'cameras', id: 'cam-1' })

    // ⚠ 只能约等：`controls.update()` 把机位在球坐标里往返一趟，末位必然有浮点误差
    const pose = harness.scene.snapshot()
    expect(pose.position[0]).toBeCloseTo(1, 6)
    expect(pose.position[1]).toBeCloseTo(2, 6)
    expect(pose.position[2]).toBeCloseTo(3, 6)
    expect(pose.target[0]).toBeCloseTo(4, 6)
    expect(pose.target[1]).toBeCloseTo(5, 6)
    expect(pose.target[2]).toBeCloseTo(6, 6)
    expect(pose.fov).toBe(60)
  })

  it('对焦到不存在的视点时不动镜头', async () => {
    const harness = await ready()
    const before = harness.scene.snapshot()

    harness.scene.focus({ kind: 'cameras', id: 'gone' })

    expect(harness.scene.snapshot()).toEqual(before)
  })

  it('场景没装配起来时机位快照给一份中性缺省值', () => {
    const scene = new EditorScene({
      container: document.createElement('div'),
      config: twinConfig(),
      on: createEvents(),
      createRenderer: () => null,
      gltfSource: { loadAsync: vi.fn() },
    })

    expect(scene.snapshot()).toEqual({
      position: [0, 0, 0],
      target: [0, 0, 0],
      fov: 45,
    })
    scene.dispose()
  })
})

describe('卸载收口', () => {
  it('渲染上下文丢掉、Observer 断开、两层画布都从宿主摘走', async () => {
    const harness = await ready()
    const disconnect = vi.spyOn(ResizeObserver.prototype, 'disconnect')
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame')

    harness.scene.dispose()

    expect(harness.renderer.disposeCount).toBe(1)
    expect(harness.renderer.forceContextLossCount).toBe(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(harness.container.children).toHaveLength(0)
  })

  it('卸载后点视口不再触发任何回调', async () => {
    const harness = await ready()

    harness.scene.dispose()
    click(harness, CENTER_X, CENTER_Y)

    expect(harness.events.select).not.toHaveBeenCalled()
  })
})
