/** @fileoverview 原生样式深度合成只绘制一次模型，并保留编辑手柄和渲染器状态。 */
import * as THREE from 'three'
import { afterEach, expect, it, vi } from 'vitest'
import { PanelCompositor } from '../src/panelCompositor'
import { createHeadlessRenderer } from '../src/testing/createHeadlessRenderer'
import { nativeSurface } from '../src/testing/nativePanelFixture'

function fixture() {
  const renderer = createHeadlessRenderer()
  const context = { drawImage: vi.fn(), clearRect: vi.fn() }
  const compositor = new PanelCompositor(renderer, context)
  document.body.append(compositor.element)
  compositor.resize(200, 100)
  const scene = new THREE.Scene()
  const labels = new THREE.Group()
  const model = new THREE.Group()
  scene.add(labels, model)
  const { surface } = nativeSurface()
  labels.add(surface)
  const camera = new THREE.PerspectiveCamera(45, 2, 0.1, 100)
  camera.position.z = 5
  const render = () => compositor.render(scene, labels, camera, model)
  const dispose = () => {
    surface.dispose()
    compositor.dispose()
  }
  return {
    renderer,
    context,
    compositor,
    scene,
    labels,
    model,
    surface,
    camera,
    render,
    dispose,
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

it('模型只渲染一遍，复制场景缓冲后单独绘制透明深度代理', () => {
  const f = fixture()
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
  const fetch = vi.spyOn(globalThis, 'fetch')
  const image = vi.spyOn(globalThis, 'Image')
  f.render()
  expect(f.renderer.renders).toHaveLength(2)
  expect(f.renderer.renders[0]?.scene).toBe(f.scene)
  expect(f.renderer.renders[1]?.scene.children).toEqual([f.surface.proxy])
  expect(f.context.drawImage).toHaveBeenCalledExactlyOnceWith(
    f.renderer.domElement,
    0,
    0,
  )
  expect(f.compositor.element.style.display).toBe('')
  expect(f.renderer.autoClear).toBe(true)
  expect(encode).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(image).not.toHaveBeenCalled()
  f.dispose()
})

it('静态牌面复用 SVG 范围，隐藏后移除深度代理', () => {
  const f = fixture()
  f.render()
  const parent = f.surface.clipPolygon.parentElement
  const replace = parent === null ? null : vi.spyOn(parent, 'replaceChildren')
  f.render()
  expect(replace).not.toHaveBeenCalled()
  f.labels.visible = false
  f.render()
  expect(f.compositor.element.style.display).toBe('none')
  expect(f.surface.proxy.parent).toBeNull()
  f.dispose()
})

it('剖切面和自动清屏状态在代理绘制失败后恢复', () => {
  const f = fixture()
  const clipping = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)]
  f.renderer.clippingPlanes = clipping
  vi.spyOn(f.renderer, 'render')
    .mockImplementationOnce(() => {})
    .mockImplementationOnce(() => {
      throw new Error('render failed')
    })
  expect(f.render).toThrow('render failed')
  expect(f.renderer.autoClear).toBe(true)
  expect(f.renderer.clippingPlanes).toBe(clipping)
  f.dispose()
})

it('编辑手柄等前景单独绘制，不被卡片覆盖，也不重复叠加透明度', () => {
  const f = fixture()
  const material = new THREE.MeshBasicMaterial({
    depthTest: false,
    transparent: true,
    opacity: 0.5,
  })
  const helper = new THREE.Mesh(new THREE.BoxGeometry(), material)
  f.scene.add(helper)
  const baseVisibility: boolean[] = []
  const render = f.renderer.render.bind(f.renderer)
  vi.spyOn(f.renderer, 'render').mockImplementation((scene, camera) => {
    if (scene === f.scene) baseVisibility.push(helper.visible)
    render(scene, camera)
  })
  f.render()
  expect(baseVisibility).toEqual([false])
  expect(helper.visible).toBe(true)
  expect(f.renderer.renders).toHaveLength(3)
  const foreground = f.renderer.renders[2]?.scene.children[0]
  expect(foreground).toBeInstanceOf(THREE.Mesh)
  if (foreground instanceof THREE.Mesh)
    expect(foreground.material).toBe(material)
  const release = vi.spyOn(material, 'dispose')
  f.dispose()
  expect(release).not.toHaveBeenCalled()
  helper.geometry.dispose()
  material.dispose()
})

it('场景渲染失败也恢复手柄显隐', () => {
  const f = fixture()
  const helper = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial({ depthTest: false }),
  )
  f.scene.add(helper)
  vi.spyOn(f.renderer, 'render').mockImplementation(() => {
    throw new Error('base failed')
  })
  expect(f.render).toThrow('base failed')
  expect(helper.visible).toBe(true)
  f.dispose()
  helper.geometry.dispose()
  helper.material.dispose()
})

it('没有 2D 缓冲上下文时不做额外场景绘制', () => {
  const renderer = createHeadlessRenderer()
  const compositor = new PanelCompositor(renderer, null)
  compositor.render(
    new THREE.Scene(),
    new THREE.Group(),
    new THREE.PerspectiveCamera(),
  )
  expect(renderer.renders).toHaveLength(1)
  compositor.dispose()
  expect(compositor.canvas.width).toBe(0)
})

it('释放合成器不会把调用方已隐藏的前景重新显示', () => {
  const f = fixture()
  const helper = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial({ depthTest: false }),
  )
  f.scene.add(helper)
  f.render()
  helper.visible = false
  f.dispose()
  expect(helper.visible).toBe(false)
  helper.geometry.dispose()
  helper.material.dispose()
})

it('选中包围框使用原对象的世界变换，不复制失去 box 引用的辅助器', () => {
  const f = fixture()
  const box = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  )
  const helper = new THREE.Box3Helper(box)
  const material = helper.material
  if (!(material instanceof THREE.Material)) throw new Error('缺少包围框材质')
  material.depthTest = false
  f.scene.add(helper)
  const render = f.renderer.render.bind(f.renderer)
  vi.spyOn(f.renderer, 'render').mockImplementation((scene, camera) => {
    scene.updateMatrixWorld()
    render(scene, camera)
  })
  expect(f.render).not.toThrow()
  const copy = f.renderer.renders.at(-1)?.scene.children[0]
  expect(copy?.matrixWorld.equals(helper.matrixWorld)).toBe(true)
  f.render()
  expect(f.renderer.renders.at(-1)?.scene.children[0]).toBe(copy)
  helper.visible = false
  f.render()
  expect(copy?.parent).toBeNull()
  f.dispose()
  helper.geometry.dispose()
  material.dispose()
})
