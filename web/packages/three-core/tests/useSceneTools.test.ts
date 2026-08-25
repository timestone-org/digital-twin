/**
 * @fileoverview 守场景工具与 three 的绑定：搜索取材含模型节点名、定位到找不到的
 * 几何时不乱飞、剖切改了当场重算、测量截获点击且两点后从头再来。
 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { CAMERA_FLIGHT_MS, createCameraFlight } from '../src/cameraFlight'
import { buildNodeIndex, EMPTY_NODE_INDEX } from '../src/nodeIndex'
import { createSceneCore, type SceneCore } from '../src/sceneCore'
import { createHeadlessRenderer } from '../src/testing/createHeadlessRenderer'
import { useSceneTools } from '../src/useSceneTools'

function modelOf(...names: string[]): THREE.Object3D {
  const root = new THREE.Group()
  for (const name of names) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    )
    mesh.name = name
    root.add(mesh)
  }
  return root
}

function config(): TwinConfig {
  return normalizeTwinConfig({
    parts: [{ id: 'p1', name: '泵', nodes: ['pump'] }],
    hierNodes: [{ id: 'h1', name: '车间', nodes: ['hall'] }],
    flows: [{ id: 'f1', kind: 'water' }],
  })
}

function setup(model: THREE.Object3D | null = modelOf('pump', 'hall')) {
  const container = document.createElement('div')
  document.body.append(container)
  const core: SceneCore = createSceneCore({
    container,
    renderer: createHeadlessRenderer(),
  })
  if (model !== null) core.modelRoot.add(model)
  const index = model === null ? EMPTY_NODE_INDEX : buildNodeIndex(model)
  const flight = createCameraFlight()
  const tools = useSceneTools({
    core: () => core,
    element: () => container,
    config: () => config(),
    nodeIndex: () => index,
    title: () => '一号车间',
    flight,
  })
  return { tools, core, container, flight }
}

describe('搜索', () => {
  it('三类取材都在：部件、钻取层级、模型节点名', () => {
    const { tools } = setup()

    tools.query.value = '泵'
    expect(tools.hits.value.map((hit) => hit.kind)).toContain('part')

    tools.query.value = '车间'
    expect(tools.hits.value.map((hit) => hit.kind)).toContain('hier')

    // 节点名来自模型索引，不是配置——这一路断了的话搜不到任何未登记成部件的几何
    tools.query.value = 'pump'
    expect(tools.hits.value.map((hit) => hit.kind)).toContain('node')
  })

  it('空搜索词时不出结果', () => {
    const { tools } = setup()

    expect(tools.hits.value).toHaveLength(0)
    expect(tools.total.value).toBe(0)
  })
})

describe('定位', () => {
  it('把镜头飞到命中的几何上', () => {
    const { tools, core, flight } = setup()
    const before = core.camera.position.clone()

    tools.locate({
      kind: 'part',
      id: 'p1',
      label: '泵',
      nodes: ['pump'],
      rank: 0,
    })
    flight.advance(CAMERA_FLIGHT_MS)

    expect(core.camera.position.equals(before)).toBe(false)
  })

  // 配置与模型对不上是诊断面板的事，这里乱飞一下只会让人更糊涂
  it('命中的实体在模型里没有几何时不动镜头', () => {
    const { tools, core } = setup()
    const before = core.camera.position.clone()

    tools.locate({
      kind: 'part',
      id: 'ghost',
      label: '幽灵',
      nodes: ['not-here'],
      rank: 0,
    })

    expect(core.camera.position.equals(before)).toBe(true)
  })
})

describe('剖切', () => {
  it('默认不剖切，渲染器上没有平面', () => {
    const { core } = setup()

    expect(core.renderer.clippingPlanes).toEqual([])
  })

  // ⚠ 交给宿主去调的话，漏一处的表现是「拖了滑块没反应」
  it('换了轴当场重算，不用宿主再调一次', async () => {
    const { tools, core } = setup()

    tools.clipAxis.value = 'x'
    await nextTick()

    expect(core.renderer.clippingPlanes).toHaveLength(1)
  })

  it('改位置也重算', async () => {
    const { tools, core } = setup()
    tools.clipAxis.value = 'y'
    await nextTick()
    const before = core.renderer.clippingPlanes[0]?.constant

    tools.clipRatio.value = 0.9
    await nextTick()

    expect(core.renderer.clippingPlanes[0]?.constant).not.toBe(before)
  })

  it('切回不剖切时把平面清掉', async () => {
    const { tools, core } = setup()
    tools.clipAxis.value = 'z'
    await nextTick()

    tools.clipAxis.value = 'none'
    await nextTick()

    expect(core.renderer.clippingPlanes).toEqual([])
  })

  it('模型还没加载时不炸，也不留下平面', async () => {
    const { tools, core } = setup(null)

    tools.clipAxis.value = 'x'
    await nextTick()

    expect(core.renderer.clippingPlanes).toEqual([])
  })
})

describe('两点测量', () => {
  /** 视口正中的一次松手；测量只关心它有没有被截获。 */
  function clickAt(): PointerEvent {
    return new PointerEvent('pointerup', {
      clientX: 0,
      clientY: 0,
      bubbles: true,
    })
  }

  it('没开测量时不截获点击', () => {
    const { tools } = setup()

    expect(tools.interceptClick(clickAt())).toBe(false)
  })

  // ⚠ 测量开着时点空白处不该顺手触发部件联动
  it('开着测量时一律截获，哪怕没打中模型', () => {
    const { tools } = setup()
    tools.toggleMeasure()

    expect(tools.interceptClick(clickAt())).toBe(true)
  })

  it('还没测满两点时距离是 NaN', () => {
    const { tools } = setup()
    tools.toggleMeasure()

    expect(tools.measured.value).toBeNaN()
  })

  // 留着上一次的两点，下次打开会看到一条来历不明的距离
  it('关掉测量把测点清干净', () => {
    const { tools } = setup()
    tools.toggleMeasure()
    tools.interceptClick(clickAt())

    tools.toggleMeasure()

    expect(tools.measuring.value).toBe(false)
    expect(tools.measured.value).toBeNaN()
  })
})

describe('图例', () => {
  it('按配置里的能量流种类出图例', () => {
    const { tools } = setup()

    expect(tools.legend.value.map((item) => item.label)).toEqual(['water'])
  })

  it('默认收着，点开才显示', () => {
    const { tools } = setup()

    expect(tools.legendOpen.value).toBe(false)
  })
})

describe('截图', () => {
  it('先画一帧再取图，否则拿到的多半是一张全黑', () => {
    const { tools, core } = setup()
    const render = vi.spyOn(core.renderer, 'render')
    // happy-dom 的 canvas 没有 toDataURL，取图那步会抛——正好验证它不把异常漏出去
    expect(() => tools.screenshot()).not.toThrow()

    expect(render).toHaveBeenCalled()
  })
})
