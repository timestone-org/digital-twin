/**
 * @fileoverview 契约：弹窗里那块 3D 只装一个部件、把祖先变换烘进克隆件、
 * 释放时**不碰**与主场景共用的几何与材质。
 *
 * ⚠ 走 `disposeSceneGraph` 会把主场景正在用的几何与材质一并释放，表现是大屏上
 * 那个部件整块消失——而这里已经关掉了，没有任何线索指回来。
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { TwinFocusView } from '@dt/twin-config'

import {
  createPartPreview,
  dropNestedObjects,
  fitDistance,
} from '../src/partPreview'
import { createHeadlessRenderer } from '../src/testing/createHeadlessRenderer'

interface FakeModel {
  root: THREE.Object3D
  pump: THREE.Mesh
  material: THREE.Material
}

// ⚠ 必须显式收窄再回：`instanceof` 就地收窄出来的是 `Mesh<any, any, any>`，
// 三个 any 会一路漏到调用方，把材质与几何的类型检查全部关掉
function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh
}

/** 根 → 挪开的一层 → 泵体网格；祖先带位移，好看出烘没烘进去。 */
function buildModel(): FakeModel {
  const root = new THREE.Group()
  const shifted = new THREE.Group()
  shifted.position.set(10, 0, 0)
  const material = new THREE.MeshStandardMaterial({ color: '#ff0000' })
  const pump: THREE.Mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    material,
  )
  pump.name = 'pump'
  shifted.add(pump)
  root.add(shifted)
  root.updateMatrixWorld(true)
  return { root, pump, material }
}

function setup(autoRotate = false) {
  const model = buildModel()
  const container = document.createElement('div')
  const renderer = createHeadlessRenderer()
  const preview = createPartPreview({
    container,
    objects: [model.pump],
    autoRotate,
    renderer: () => renderer,
  })
  if (preview === null) throw new Error('预览没造出来')
  return { ...model, container, renderer, preview }
}

function setupView(view: TwinFocusView | null, allowPan = false) {
  const model = buildModel()
  const renderer = createHeadlessRenderer()
  const preview = createPartPreview({
    container: document.createElement('div'),
    objects: [model.pump],
    autoRotate: false,
    view,
    allowPan,
    renderer: () => renderer,
  })
  if (preview === null) throw new Error('预览没造出来')
  preview.measure(600, 400)
  preview.frame(0)
  const camera = renderer.renders[0]?.camera
  if (!(camera instanceof THREE.PerspectiveCamera))
    throw new Error('没有透视相机')
  return { ...model, preview, renderer, camera }
}

describe('独立模型取景', () => {
  it.each([false, true])('右键平移只在允许编辑位置时生效 %s', (allowPan) => {
    const { preview, renderer } = setupView(
      {
        position: [13, 4, 12],
        target: [11, 1, -2],
        fov: 67,
      },
      allowPan,
    )
    const canvas = renderer.domElement
    Object.defineProperty(canvas, 'clientHeight', { value: 400 })
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'mouse',
        button: 2,
        clientX: 100,
        clientY: 100,
      }),
    )
    canvas.ownerDocument.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        button: 2,
        clientX: 150,
        clientY: 100,
      }),
    )
    canvas.ownerDocument.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 1,
        pointerType: 'mouse',
        button: 2,
        clientX: 150,
        clientY: 100,
      }),
    )
    preview.frame(0)

    const moved = new THREE.Vector3(...preview.snapshot().target).distanceTo(
      new THREE.Vector3(11, 1, -2),
    )
    if (allowPan) expect(moved).toBeGreaterThan(0)
    else expect(moved).toBeLessThan(1e-6)
    preview.frameDefault()
    expect(preview.snapshot().target).toEqual([10, 0, 0])
    preview.dispose()
  })

  it('独立预览快照把机位与注视点转换回世界坐标', () => {
    const { preview, camera } = setupView({
      position: [13, 4, 12],
      target: [11, 1, -2],
      fov: 67,
    })
    camera.position.set(6, 7, 8)
    preview.frame(0)

    const view = preview.snapshot()

    expect(
      new THREE.Vector3(...view.position).distanceTo(
        new THREE.Vector3(16, 7, 8),
      ),
    ).toBeLessThan(1e-6)
    expect(view.target).toEqual([11, 1, -2])
    expect(view.fov).toBe(67)
    const reopened = setupView(view)
    expect(reopened.camera.position.distanceTo(camera.position)).toBeLessThan(
      1e-6,
    )
    preview.dispose()
    reopened.preview.dispose()
  })

  it('滚轮调节后保存当前缩放，恢复默认重新框住部件', () => {
    const { preview, renderer, camera } = setupView({
      position: [13, 4, 12],
      target: [11, 1, -2],
      fov: 67,
    })
    const before = camera.position.distanceTo(new THREE.Vector3(1, 1, -2))
    renderer.domElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
    preview.frame(0)

    const view = preview.snapshot()
    expect(
      new THREE.Vector3(...view.position).distanceTo(
        new THREE.Vector3(...view.target),
      ),
    ).toBeLessThan(before)
    preview.frameDefault()
    preview.frame(0)

    expect(preview.snapshot().target).toEqual([10, 0, 0])
    expect(camera.fov).toBe(45)
    expect(camera.position.x / camera.position.z).toBeCloseTo(1)
    preview.dispose()
  })

  it('没保存独立机位时保留默认的自动取景', () => {
    const { preview, camera } = setupView(null)

    expect(camera.fov).toBe(45)
    expect(camera.position.x / camera.position.z).toBeCloseTo(1)
    expect(camera.position.y / camera.position.z).toBeCloseTo(0.7)
    preview.dispose()
  })

  it('世界机位与注视点一起减去部件中心，视野跟随配置', () => {
    const { preview, camera, pump } = setupView({
      position: [13, 4, 12],
      target: [11, 1, -2],
      fov: 67,
    })

    expect(
      camera.position.distanceTo(new THREE.Vector3(3, 4, 12)),
    ).toBeLessThan(1e-6)
    expect(
      camera
        .getWorldDirection(new THREE.Vector3())
        .distanceTo(new THREE.Vector3(-2, -3, -14).normalize()),
    ).toBeLessThan(1e-6)
    expect(camera.fov).toBe(67)
    expect(pump.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([
      10, 0, 0,
    ])
    preview.dispose()
  })

  it('已配置机位换舞台尺寸后仍保留取景', () => {
    const { preview, camera } = setupView({
      position: [13, 4, 12],
      target: [11, 1, -2],
      fov: 67,
    })
    const before = camera.position.clone()

    preview.measure(1400, 350)
    preview.frame(0)

    expect(camera.position.distanceTo(before)).toBeLessThan(1e-6)
    expect(camera.aspect).toBe(4)
    preview.dispose()
  })

  it('远处保存的机位不会把整个部件裁掉', () => {
    const { preview, camera } = setupView({
      position: [10, 0, 100000],
      target: [10, 0, 0],
      fov: 45,
    })

    expect(camera.far).toBeGreaterThan(100002)
    expect(new THREE.Vector3(0, 0, -1).project(camera).z).toBeLessThan(1)
    preview.dispose()
  })

  it('用户继续拉远镜头时剪裁面跟着扩大', () => {
    const { preview, camera } = setupView({
      position: [10, 0, 100000],
      target: [10, 0, 0],
      fov: 45,
    })

    preview.releaseFraming()
    camera.position.multiplyScalar(3)
    preview.frame(0)

    expect(camera.far).toBeGreaterThan(300002)
    expect(new THREE.Vector3(0, 0, -1).project(camera).z).toBeLessThan(1)
    preview.dispose()
  })

  it.each([
    { position: [1, 2, 3], target: [1, 2, 3], fov: 45 },
    { position: [Number.NaN, 2, 3], target: [0, 0, 0], fov: 45 },
    { position: [1, 2, 3], target: [0, Number.POSITIVE_INFINITY, 0], fov: 45 },
    { position: [1, 2, 3], target: [0, 0, 0], fov: 0 },
    { position: [1, 2, 3], target: [0, 0, 0], fov: 180 },
    { position: [1, 2, 3], target: [0, 0, 0], fov: Number.NaN },
  ] satisfies TwinFocusView[])('不可用的直接取景 %j 回退默认机位', (view) => {
    const { preview, camera } = setupView(view)

    expect(camera.fov).toBe(45)
    expect(camera.position.x).toBeGreaterThan(0)
    expect(camera.position.y).toBeGreaterThan(0)
    expect(camera.position.z).toBeGreaterThan(0)
    expect(camera.position.toArray().every(Number.isFinite)).toBe(true)
    preview.dispose()
  })
})

describe('装配', () => {
  it('半透明部件预览独占墙面排序几何，关闭时保留主场景资源', () => {
    const { pump, material } = buildModel()
    material.transparent = true
    material.opacity = 0.75
    material.depthWrite = false
    material.forceSinglePass = true
    const renderer = createHeadlessRenderer()
    const preview = createPartPreview({
      container: document.createElement('div'),
      objects: [pump],
      autoRotate: true,
      renderer: () => renderer,
    })
    if (preview === null) throw new Error('预览没造出来')
    preview.measure(300, 200)
    preview.frame(0)
    const clone = renderer.renders[0]?.scene.getObjectByName('pump')
    if (clone === undefined || !isMesh(clone)) throw new Error('没有部件克隆')
    expect(clone.geometry).not.toBe(pump.geometry)
    expect(clone.material).toBe(material)
    expect(clone.onBeforeRender === pump.onBeforeRender).toBe(false)
    let sharedDisposed = 0
    let cloneDisposed = 0
    pump.geometry.addEventListener('dispose', () => {
      sharedDisposed += 1
    })
    clone.geometry.addEventListener('dispose', () => {
      cloneDisposed += 1
    })

    preview.dispose()

    expect(sharedDisposed).toBe(0)
    expect(cloneDisposed).toBe(1)
  })

  it('画布挂进宿主并铺满', () => {
    const { container, renderer } = setup()

    expect(container.contains(renderer.domElement)).toBe(true)
    expect(renderer.domElement.style.position).toBe('absolute')
  })

  it('只装点名的那一个部件，别的东西一概不进来', () => {
    const { preview, renderer } = setup()
    preview.measure(300, 200)
    preview.frame(0)

    const scene = renderer.renders[0]?.scene
    let meshes = 0
    scene?.traverse((node) => {
      if (isMesh(node)) meshes += 1
    })
    expect(meshes).toBe(1)
  })

  // ⚠ `clone()` 只带自己那一层的变换：不烘祖先的话，挂在别处的部件会以模型
  //   原点为准摆放，看着像「模型跑到画面外去了」
  it('祖先的变换烘进克隆件，摆位与场上一致', () => {
    const { preview, renderer } = setup()
    preview.measure(300, 200)
    preview.frame(0)

    const scene = renderer.renders[0]?.scene
    const clone = scene?.getObjectByName('pump')
    expect(clone).toBeDefined()
    expect(clone?.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(0)
  })

  it('几何与材质与场上那份共用，不另复制一遍', () => {
    const { preview, renderer, material } = setup()
    preview.measure(300, 200)
    preview.frame(0)

    const clone = renderer.renders[0]?.scene.getObjectByName('pump')
    expect(clone !== undefined && isMesh(clone)).toBe(true)
    if (clone !== undefined && isMesh(clone)) {
      expect(clone.material).toBe(material)
    }
  })

  it('一个对象都没有时也不炸', () => {
    const container = document.createElement('div')
    const preview = createPartPreview({
      container,
      objects: [],
      autoRotate: false,
      renderer: () => createHeadlessRenderer(),
    })

    expect(preview).not.toBeNull()
    expect(() => preview?.frame(0.016)).not.toThrow()
  })

  it('环境造不出渲染器时给 null，不留半份', () => {
    const preview = createPartPreview({
      container: document.createElement('div'),
      objects: [],
      autoRotate: false,
      renderer: () => null,
    })

    expect(preview).toBeNull()
  })
})

describe('每帧', () => {
  /** 装部件的那个组：场景里含着 `pump` 的那一支。 */
  function stageOf(scene: THREE.Object3D | undefined): THREE.Object3D {
    const found = scene?.children.find(
      (child) => child.getObjectByName('pump') !== undefined,
    )
    if (found === undefined) throw new Error('场景里没有装部件的那个组')
    return found
  }

  it('自转开着时逐帧转一点', () => {
    const { preview, renderer } = setup(true)
    preview.measure(300, 200)
    preview.frame(0)
    const before = stageOf(renderer.renders[0]?.scene).rotation.y

    preview.frame(1)

    expect(stageOf(renderer.renders[1]?.scene).rotation.y).not.toBe(before)
  })

  it('自转关着时一动不动', () => {
    const { preview, renderer } = setup(false)
    preview.measure(300, 200)
    preview.frame(1)
    preview.frame(1)

    const scene = renderer.renders[1]?.scene
    let spun = 0
    scene?.traverse((node) => {
      if (node.rotation.y !== 0) spun += 1
    })
    expect(spun).toBe(0)
  })

  // ⚠ 宿主被折叠时 height 是 0，aspect 变 Infinity 会让投影矩阵整片 NaN
  it('尺寸为零时不让投影矩阵变 NaN', () => {
    const { preview, renderer } = setup()

    preview.measure(0, 0)

    expect(renderer.sizes[0]).toEqual({ width: 1, height: 1 })
  })
})

describe('释放', () => {
  it('画布摘掉、上下文主动丢掉', () => {
    const { preview, container, renderer } = setup()

    preview.dispose()

    expect(container.childElementCount).toBe(0)
    expect(renderer.disposeCount).toBe(1)
    expect(renderer.forceContextLossCount).toBe(1)
  })

  // ⚠ 共用的几何与材质在这里被释放的话，大屏上那个部件会整块消失
  it('共用的几何与材质一个都不释放', () => {
    const { preview, pump, material } = setup()
    const geometry = pump.geometry
    let disposed = 0
    geometry.addEventListener('dispose', () => {
      disposed += 1
    })
    material.addEventListener('dispose', () => {
      disposed += 1
    })

    preview.dispose()

    expect(disposed).toBe(0)
  })
})

describe('父件带着后代一起摆进来', () => {
  // ⚠ 不去重就是同一块几何重叠着画两遍，表面互相穿插闪烁——看着像模型坏了
  it('祖先已经在清单里的丢掉', () => {
    const parent = new THREE.Group()
    const child = new THREE.Mesh()
    const deep = new THREE.Mesh()
    child.add(deep)
    parent.add(child)

    expect(dropNestedObjects([parent, child, deep])).toEqual([parent])
  })

  it('重复列到的同一个对象只留一份', () => {
    const mesh = new THREE.Mesh()

    expect(dropNestedObjects([mesh, mesh])).toEqual([mesh])
  })

  it('互不相干的兄弟一个都不丢，次序照旧', () => {
    const root = new THREE.Group()
    const left = new THREE.Mesh()
    const right = new THREE.Mesh()
    root.add(left, right)

    expect(dropNestedObjects([left, right])).toEqual([left, right])
  })
})

describe('换宽高比时的取景', () => {
  /**
   * 一台长条形机组：20 长、2 高、4 深。
   * ⚠ 不能拿立方体验这一条：立方体的取景距离由**高度**那一支定，宽高比再怎么变
   * 都是同一个数，用例会绿得毫无意义。
   */
  function longPart() {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(20, 2, 4),
      new THREE.MeshStandardMaterial(),
    )
    const renderer = createHeadlessRenderer()
    const preview = createPartPreview({
      container: document.createElement('div'),
      objects: [mesh],
      autoRotate: false,
      renderer: () => renderer,
    })
    if (preview === null) throw new Error('预览没造出来')
    return { preview, renderer }
  }

  /** 这一帧画出去的相机机位；渲染记账里记的就是那台真相机。 */
  function eyeAfter(
    preview: ReturnType<typeof setup>['preview'],
    renderer: ReturnType<typeof setup>['renderer'],
    width: number,
    height: number,
  ): THREE.Vector3 {
    preview.measure(width, height)
    preview.frame(0)
    const last = renderer.renders[renderer.renders.length - 1]
    if (last === undefined) throw new Error('没有画过一帧')
    return last.camera.position.clone()
  }

  // 舞台变宽了就该凑近，否则放大弹窗只是把黑边一起放大
  it('还没人碰过镜头时，舞台一变就重新取景', () => {
    const { preview, renderer } = longPart()

    const square = eyeAfter(preview, renderer, 400, 400)
    const wide = eyeAfter(preview, renderer, 1200, 400)

    expect(wide.length()).toBeLessThan(square.length())
  })

  // ⚠ 换宽高比时把用户正看的角度拽走，比画面小得多更让人火大
  it('用户接管镜头之后就不再动它', () => {
    const { preview, renderer } = longPart()
    const before = eyeAfter(preview, renderer, 400, 400)

    preview.releaseFraming()
    const after = eyeAfter(preview, renderer, 1200, 400)

    // 不逐位比：`controls.update()` 每帧把机位在球坐标上来回换一趟，末位会飘
    expect(after.distanceTo(before)).toBeLessThan(1e-6)
  })
})

describe('取景距离', () => {
  /** 一台长条形机组：长 20、高 2、深 4。 */
  function unitBox(): THREE.Box3 {
    return new THREE.Box3(
      new THREE.Vector3(-10, -1, -2),
      new THREE.Vector3(10, 1, 2),
    )
  }

  function cameraAt(aspect: number): THREE.PerspectiveCamera {
    return new THREE.PerspectiveCamera(45, aspect, 0.1, 100)
  }

  // ⚠ 舞台宽了却按方形取景的话，放大弹窗只是把黑边一起放大
  it('舞台越宽，相机凑得越近', () => {
    const box = unitBox()

    expect(fitDistance(cameraAt(2.4), box)).toBeLessThan(
      fitDistance(cameraAt(1), box),
    )
  })

  // ⚠ 自转绕的是竖轴：按盒宽贴边取景的话，长轴转到正对镜头那一刻两头会被裁掉
  it('横着摆与竖着摆的同一个部件，取景距离相同', () => {
    const lying = new THREE.Box3(
      new THREE.Vector3(-10, -1, -2),
      new THREE.Vector3(10, 1, 2),
    )
    const turned = new THREE.Box3(
      new THREE.Vector3(-2, -1, -10),
      new THREE.Vector3(2, 1, 10),
    )

    expect(fitDistance(cameraAt(1.6), lying)).toBeCloseTo(
      fitDistance(cameraAt(1.6), turned),
      6,
    )
  })

  // 高个子部件在窄舞台上由高度定距离，不该被宽度那一支盖掉
  it('又高又窄的部件按高度取景', () => {
    const tower = new THREE.Box3(
      new THREE.Vector3(-0.5, -20, -0.5),
      new THREE.Vector3(0.5, 20, 0.5),
    )
    const halfFov = THREE.MathUtils.degToRad(45) / 2

    expect(fitDistance(cameraAt(2), tower)).toBeGreaterThan(
      20 / Math.tan(halfFov),
    )
  })
})
