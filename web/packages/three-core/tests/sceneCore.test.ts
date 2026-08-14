/**
 * @fileoverview 守场景内核的装配与销毁契约：两层画布挂进宿主、宿主高度为 0 时
 * 相机不出 NaN、取景跟着包围盒收紧剪裁面、`disposeScene` 把每一类资源都释放到。
 */
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyModelPlacement,
  boundingDiagonal,
  clampPixelRatio,
  createSceneCore,
  createWebGLRenderer,
  disposeScene,
  disposeSceneGraph,
  frameObject,
  renderScene,
  resizeScene,
  type SceneCore,
} from '../src/sceneCore'
import {
  createHeadlessRenderer,
  type HeadlessRenderer,
} from '../src/testing/createHeadlessRenderer'

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  vi.restoreAllMocks()
  container.remove()
})

function mount(): { core: SceneCore; renderer: HeadlessRenderer } {
  const renderer = createHeadlessRenderer()
  return { core: createSceneCore({ container, renderer }), renderer }
}

function texturedMesh(): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial()
  material.map = new THREE.Texture()
  return new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material)
}

describe('渲染器工厂', () => {
  it('环境没有 WebGL 时返回 null 而不是抛错', () => {
    expect(createWebGLRenderer()).toBeNull()
  })

  it('像素比按上限夹取', () => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(3)

    expect(clampPixelRatio()).toBe(2)
    expect(clampPixelRatio(1)).toBe(1)
  })

  it('像素比拿不到时按 1 算', () => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(0)

    expect(clampPixelRatio()).toBe(1)
  })
})

describe('场景装配', () => {
  it('两层画布都挂进宿主，标签层不吃指针事件', () => {
    const { core } = mount()

    expect(core.renderer.domElement.parentElement).toBe(container)
    expect(core.labelRenderer.domElement.parentElement).toBe(container)
    expect(core.renderer.domElement.style.pointerEvents).toBe('auto')
    expect(core.labelRenderer.domElement.style.pointerEvents).toBe('none')
  })

  it('灯光与模型挂载点都在场景里', () => {
    const { core } = mount()

    expect(core.scene.getObjectByName('twin-lighting')?.children).toHaveLength(
      4,
    )
    expect(core.scene.getObjectByName('twin-model-root')).toBe(core.modelRoot)
  })

  it('控制器绑在 canvas 上并跟着相机', () => {
    const { core } = mount()

    expect(core.controls.domElement).toBe(core.renderer.domElement)
    expect(core.controls.object).toBe(core.camera)
  })
})

describe('尺寸与渲染', () => {
  it('按宿主尺寸重算相机纵横比与两层画布', () => {
    const { core, renderer } = mount()

    resizeScene(core, 800, 400)

    expect(core.camera.aspect).toBe(2)
    expect(renderer.sizes.at(-1)).toEqual({ width: 800, height: 400 })
    expect(core.labelRenderer.getSize()).toEqual({ width: 800, height: 400 })
  })

  it('宿主高度为 0 时按 1 兜底，纵横比不出 Infinity', () => {
    const { core } = mount()

    resizeScene(core, 800, 0)

    expect(core.camera.aspect).toBe(800)
    expect(Number.isFinite(core.camera.projectionMatrix.elements[0])).toBe(true)
  })

  it('渲染一帧把同一份场景与相机交给两层渲染器', () => {
    const { core, renderer } = mount()
    const labelRender = vi.spyOn(core.labelRenderer, 'render')

    renderScene(core)

    expect(renderer.renders).toHaveLength(1)
    expect(renderer.renders[0]?.scene).toBe(core.scene)
    expect(renderer.renders[0]?.camera).toBe(core.camera)
    expect(labelRender).toHaveBeenCalledTimes(1)
  })
})

describe('模型摆放与取景', () => {
  it('旋转角从度换成弧度，缩放与位移原样落到模型根上', () => {
    const root = new THREE.Group()

    applyModelPlacement(root, {
      asset: 'asset:a',
      scale: 2,
      position: [1, 2, 3],
      rotation: [90, 0, 180],
      autoRotate: false,
      background: '',
    })

    expect(root.scale.x).toBe(2)
    expect(root.position.toArray()).toEqual([1, 2, 3])
    expect(root.rotation.x).toBeCloseTo(1.5708, 4)
    expect(root.rotation.y).toBe(0)
    expect(root.rotation.z).toBeCloseTo(3.1416, 4)
  })

  it('空对象的包围盒对角线是 0', () => {
    expect(boundingDiagonal(new THREE.Group())).toBe(0)
  })

  it('边长 2 的立方体对角线是 2√3', () => {
    expect(boundingDiagonal(texturedMesh())).toBeCloseTo(3.4641, 3)
  })

  it('取景把相机拉到包围球之外并收紧剪裁面', () => {
    const { core } = mount()

    frameObject(core, texturedMesh())

    expect(core.camera.position.length()).toBeCloseTo(5.657, 2)
    expect(core.controls.target.toArray()).toEqual([0, 0, 0])
    expect(core.camera.near).toBeCloseTo(0.01, 6)
    expect(core.camera.far).toBeCloseTo(113.14, 1)
  })

  it('空包围盒不动相机', () => {
    const { core } = mount()
    const before = core.camera.position.toArray()

    frameObject(core, new THREE.Group())

    expect(core.camera.position.toArray()).toEqual(before)
  })
})

describe('对象图释放', () => {
  it('逐个调到几何、材质与贴图，并清空子节点', () => {
    const root = new THREE.Group()
    const mesh = texturedMesh()
    root.add(mesh)
    const material = mesh.material as THREE.MeshStandardMaterial
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
    const materialDispose = vi.spyOn(material, 'dispose')
    const textureDispose = vi.spyOn(material.map as THREE.Texture, 'dispose')

    disposeSceneGraph(root)

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(textureDispose).toHaveBeenCalledTimes(1)
    expect(root.children).toHaveLength(0)
  })

  it('多个网格共用同一份几何与材质时各只释放一次', () => {
    const root = new THREE.Group()
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshBasicMaterial()
    root.add(new THREE.Mesh(geometry, material))
    root.add(new THREE.Mesh(geometry, material))
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const materialDispose = vi.spyOn(material, 'dispose')

    disposeSceneGraph(root)

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
  })

  it('材质数组的每一项都释放到', () => {
    const root = new THREE.Group()
    const first = new THREE.MeshBasicMaterial()
    const second = new THREE.MeshBasicMaterial()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [first, second]))
    const firstDispose = vi.spyOn(first, 'dispose')
    const secondDispose = vi.spyOn(second, 'dispose')

    disposeSceneGraph(root)

    expect(firstDispose).toHaveBeenCalledTimes(1)
    expect(secondDispose).toHaveBeenCalledTimes(1)
  })

  it('线段类对象的几何也释放到', () => {
    const root = new THREE.Group()
    const grid = new THREE.GridHelper(4, 4)
    root.add(grid)
    const geometryDispose = vi.spyOn(grid.geometry, 'dispose')

    disposeSceneGraph(root)

    expect(geometryDispose).toHaveBeenCalledTimes(1)
  })
})

describe('卸载收口', () => {
  it('控制器、灯光、贴图、模型资源与渲染上下文一并释放', () => {
    const { core, renderer } = mount()
    const mesh = texturedMesh()
    core.modelRoot.add(mesh)
    const environment = new THREE.Texture()
    core.scene.environment = environment
    const light = core.scene.getObjectByName('twin-lighting')?.children[0]
    const controlsDispose = vi.spyOn(core.controls, 'dispose')
    const lightDispose = vi.spyOn(light as THREE.Light, 'dispose')
    const environmentDispose = vi.spyOn(environment, 'dispose')
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')

    disposeScene(core)

    expect(controlsDispose).toHaveBeenCalledTimes(1)
    expect(lightDispose).toHaveBeenCalledTimes(1)
    expect(environmentDispose).toHaveBeenCalledTimes(1)
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(core.scene.environment).toBeNull()
    expect(renderer.disposeCount).toBe(1)
    expect(renderer.forceContextLossCount).toBe(1)
  })

  it('两层画布都从宿主摘走', () => {
    const { core } = mount()

    disposeScene(core)

    expect(container.children).toHaveLength(0)
  })

  it('背景是贴图时一并释放', () => {
    const { core } = mount()
    const background = new THREE.Texture()
    core.scene.background = background
    const backgroundDispose = vi.spyOn(background, 'dispose')

    disposeScene(core)

    expect(backgroundDispose).toHaveBeenCalledTimes(1)
    expect(core.scene.background).toBeNull()
  })

  it('背景是纯色时不当成贴图去释放', () => {
    const { core } = mount()
    core.scene.background = new THREE.Color('#112233')

    disposeScene(core)

    expect(core.scene.background).toBeNull()
  })
})
