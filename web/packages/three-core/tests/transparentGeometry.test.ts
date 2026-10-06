/** @fileoverview 半透明三角形排序保留顶点、共享原件与绘制回调。 */
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { TransparentGeometry } from '../src/transparentGeometry'

function geometry(indexed = true): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry()
  result.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-1, -1, -2, 1, -1, -2, 0, 1, -2, -1, -1, -8, 1, -1, -8, 0, 1, -8],
      3,
    ),
  )
  if (indexed) result.setIndex([0, 1, 2, 3, 4, 5])
  return result
}

function render(
  mesh: THREE.Mesh,
  camera = new THREE.PerspectiveCamera(),
): void {
  mesh.updateMatrixWorld()
  camera.updateMatrixWorld()
  const material = Array.isArray(mesh.material)
    ? mesh.material[0]
    : mesh.material
  if (material === undefined) throw new Error('测试网格没有材质')
  mesh.onBeforeRender(
    THREE.WebGLRenderer.prototype,
    new THREE.Scene(),
    camera,
    mesh.geometry,
    material,
    new THREE.Group(),
  )
}

describe('透明三角形排序', () => {
  it('从远到近重排索引，不改顶点且不污染共享几何', () => {
    const original = geometry()
    const mesh = new THREE.Mesh(original)
    const other = new THREE.Mesh(original)
    const sorter = new TransparentGeometry(mesh)

    render(mesh)

    expect(mesh.geometry).not.toBe(original)
    expect(mesh.geometry.index?.array).toEqual(
      new Uint16Array([3, 4, 5, 0, 1, 2]),
    )
    expect(mesh.geometry.getAttribute('position').array).toEqual(
      original.getAttribute('position').array,
    )
    expect(other.geometry).toBe(original)
    expect(original.index?.array).toEqual(new Uint16Array([0, 1, 2, 3, 4, 5]))
    sorter.dispose()
    expect(mesh.geometry).toBe(original)
  })

  it('非索引几何生成顺序索引后排序，不移动属性', () => {
    const original = geometry(false)
    const mesh = new THREE.Mesh(original)
    const sorter = new TransparentGeometry(mesh)

    render(mesh)

    expect(mesh.geometry.index?.array).toEqual(
      new Uint16Array([3, 4, 5, 0, 1, 2]),
    )
    expect(original.index).toBeNull()
    sorter.dispose()
  })

  it('相机旋转与模型旋转都按当帧视向重新排序', () => {
    const mesh = new THREE.Mesh(geometry())
    const sorter = new TransparentGeometry(mesh)
    const camera = new THREE.PerspectiveCamera()
    render(mesh, camera)

    camera.rotation.y = Math.PI
    render(mesh, camera)
    expect(mesh.geometry.index?.array).toEqual(
      new Uint16Array([0, 1, 2, 3, 4, 5]),
    )

    mesh.rotation.y = Math.PI
    render(mesh, camera)
    expect(mesh.geometry.index?.array).toEqual(
      new Uint16Array([3, 4, 5, 0, 1, 2]),
    )
    sorter.dispose()
  })

  it('视向与属性未变时跳过索引上传，相机纯平移也跳过', () => {
    const mesh = new THREE.Mesh(geometry())
    const sorter = new TransparentGeometry(mesh)
    const camera = new THREE.PerspectiveCamera()
    render(mesh, camera)
    const version = mesh.geometry.index?.version
    render(mesh, camera)
    camera.position.set(12, 5, 10)
    render(mesh, camera)

    expect(mesh.geometry.index?.version).toBe(version)
    sorter.dispose()
  })

  it('位置属性版本改变时重新计算三角形中心', () => {
    const mesh = new THREE.Mesh(geometry())
    const sorter = new TransparentGeometry(mesh)
    render(mesh)
    const position = mesh.geometry.getAttribute('position')
    for (let vertex = 0; vertex < 3; vertex += 1) position.setZ(vertex, -20)
    position.needsUpdate = true

    render(mesh)

    expect(mesh.geometry.index?.array).toEqual(
      new Uint16Array([0, 1, 2, 3, 4, 5]),
    )
    sorter.dispose()
  })

  it('深克隆交错属性且识别交错缓冲区的更新版本', () => {
    const original = geometry()
    const position = original.getAttribute('position')
    original.setAttribute(
      'position',
      new THREE.InterleavedBufferAttribute(
        new THREE.InterleavedBuffer(new Float32Array(position.array), 3),
        3,
        0,
      ),
    )
    const mesh = new THREE.Mesh(original)
    const sorter = new TransparentGeometry(mesh)
    render(mesh)
    const cloned = mesh.geometry.getAttribute('position')
    expect(cloned.array).not.toBe(original.getAttribute('position').array)
    for (let vertex = 0; vertex < 3; vertex += 1) cloned.setZ(vertex, -20)
    cloned.needsUpdate = true

    render(mesh)

    expect(mesh.geometry.index?.array).toEqual(
      new Uint16Array([0, 1, 2, 3, 4, 5]),
    )
    expect(original.getAttribute('position').getZ(0)).toBe(-2)
    sorter.dispose()
  })

  it('单材质忽略几何面组，在完整绘制范围内排序', () => {
    const original = geometry()
    original.addGroup(0, 3, 0)
    original.addGroup(3, 3, 1)
    const mesh = new THREE.Mesh(original, new THREE.MeshBasicMaterial())
    const sorter = new TransparentGeometry(mesh)

    render(mesh)

    expect(mesh.geometry.index?.array).toEqual(
      new Uint16Array([3, 4, 5, 0, 1, 2]),
    )
    expect(mesh.geometry.groups).toEqual(original.groups)
    sorter.dispose()
  })

  it('多材质只在各面组内排序，保留材质归属和绘制范围', () => {
    const original = geometry()
    original.addGroup(0, 3, 0)
    original.addGroup(3, 3, 1)
    const mesh = new THREE.Mesh(original, [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
    ])
    const sorter = new TransparentGeometry(mesh)

    render(mesh)

    expect(mesh.geometry.index?.array).toEqual(
      new Uint16Array([0, 1, 2, 3, 4, 5]),
    )
    expect(mesh.geometry.groups).toEqual(original.groups)
    expect(mesh.geometry.drawRange).toEqual(original.drawRange)
    sorter.dispose()
  })

  it('多个材质组分别由远到近，不把远三角形移入其他材质组', () => {
    const original = geometry().setIndex([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5])
    original.addGroup(0, 6, 0)
    original.addGroup(6, 6, 1)
    const mesh = new THREE.Mesh(original, [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
    ])
    const sorter = new TransparentGeometry(mesh)

    render(mesh)

    expect(mesh.geometry.index?.array).toEqual(
      new Uint16Array([3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1, 2]),
    )
    expect(mesh.geometry.groups).toEqual(original.groups)
    sorter.dispose()
  })

  it('部分绘制范围之外的三角形不移入可见范围', () => {
    const original = geometry()
    original.setDrawRange(0, 3)
    const mesh = new THREE.Mesh(original)
    const sorter = new TransparentGeometry(mesh)

    render(mesh)

    expect(mesh.geometry.index?.array).toEqual(
      new Uint16Array([0, 1, 2, 3, 4, 5]),
    )
    expect(mesh.geometry.drawRange).toEqual({ start: 0, count: 3 })
    sorter.dispose()
  })

  it('调用旧回调时保持网格this与全部渲染参数，释放后恢复回调', () => {
    const mesh = new THREE.Mesh(geometry(), new THREE.MeshBasicMaterial())
    const previous = vi.fn(function (this: THREE.Mesh) {
      expect(this).toBe(mesh)
    })
    mesh.onBeforeRender = previous
    const sorter = new TransparentGeometry(mesh)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    const group = new THREE.Group()
    mesh.onBeforeRender(
      THREE.WebGLRenderer.prototype,
      scene,
      camera,
      mesh.geometry,
      mesh.material,
      group,
    )

    expect(previous).toHaveBeenCalledExactlyOnceWith(
      THREE.WebGLRenderer.prototype,
      scene,
      camera,
      mesh.geometry,
      mesh.material,
      group,
    )
    sorter.dispose()
    expect(mesh).toHaveProperty('onBeforeRender', previous)
  })

  it('释放克隆一次且先还原几何，不释放共享原件', () => {
    const original = geometry()
    const mesh = new THREE.Mesh(original)
    const sorter = new TransparentGeometry(mesh)
    const release = vi.spyOn(mesh.geometry, 'dispose')
    const originalRelease = vi.spyOn(original, 'dispose')
    mesh.geometry.addEventListener('dispose', () =>
      expect(mesh.geometry).toBe(original),
    )

    sorter.dispose()
    sorter.dispose()

    expect(release).toHaveBeenCalledOnce()
    expect(originalRelease).not.toHaveBeenCalled()
  })

  it('相同深度保留原三角形顺序，属性替换也能重新计算', () => {
    const mesh = new THREE.Mesh(geometry())
    const sorter = new TransparentGeometry(mesh)
    render(mesh)
    const position = mesh.geometry.getAttribute('position')
    const replacement = new THREE.Float32BufferAttribute(
      new Float32Array(position.array),
      3,
    )
    for (let vertex = 0; vertex < 6; vertex += 1) replacement.setZ(vertex, -2)
    mesh.geometry.setAttribute('position', replacement)

    render(mesh)

    expect(mesh.geometry.index?.array).toEqual(
      new Uint16Array([0, 1, 2, 3, 4, 5]),
    )
    sorter.dispose()
  })

  it('顶点附加属性逐项深克隆，不改法线与纹理数据', () => {
    const original = geometry()
    original.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(new Float32Array(18).fill(1), 3),
    )
    original.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(new Float32Array(12).fill(0.5), 2),
    )
    original.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Float32Array(18).fill(0.7), 3),
    )
    const mesh = new THREE.Mesh(original)
    const sorter = new TransparentGeometry(mesh)

    render(mesh)

    for (const name of ['position', 'normal', 'uv', 'color']) {
      expect(mesh.geometry.getAttribute(name).array).toEqual(
        original.getAttribute(name).array,
      )
      expect(mesh.geometry.getAttribute(name).array).not.toBe(
        original.getAttribute(name).array,
      )
    }
    sorter.dispose()
  })

  it('外部更换几何或回调时不覆盖外部的新资源', () => {
    const mesh = new THREE.Mesh(geometry())
    const sorter = new TransparentGeometry(mesh)
    const replacement = geometry()
    mesh.geometry = replacement
    render(mesh)
    const callback = vi.fn()
    mesh.onBeforeRender = callback

    sorter.dispose()

    expect(mesh.geometry).toBe(replacement)
    expect(mesh).toHaveProperty('onBeforeRender', callback)
  })
})

describe('排序范围', () => {
  it.each([
    [
      '非整数位置数量',
      () =>
        new THREE.Mesh(
          new THREE.BufferGeometry()
            .setAttribute(
              'position',
              new THREE.Float32BufferAttribute(new Float32Array(5), 3),
            )
            .setIndex([0, 0, 0]),
        ),
    ],
    [
      '归一化索引',
      () =>
        new THREE.Mesh(
          geometry().setIndex(
            new THREE.Uint16BufferAttribute([0, 1, 2], 1, true),
          ),
        ),
    ],
    ['位置缺失', () => new THREE.Mesh(new THREE.BufferGeometry())],
    [
      '空位置',
      () =>
        new THREE.Mesh(
          new THREE.BufferGeometry().setAttribute(
            'position',
            new THREE.Float32BufferAttribute([], 3),
          ),
        ),
    ],
    [
      '位置分量不足',
      () =>
        new THREE.Mesh(
          new THREE.BufferGeometry().setAttribute(
            'position',
            new THREE.Float32BufferAttribute([0, 0, 1, 1, 2, 2], 2),
          ),
        ),
    ],
    [
      '顶点不完整',
      () =>
        new THREE.Mesh(
          new THREE.BufferGeometry().setAttribute(
            'position',
            new THREE.Float32BufferAttribute(new Float32Array(15), 3),
          ),
        ),
    ],
    ['索引不完整', () => new THREE.Mesh(geometry().setIndex([0, 1]))],
    ['索引越界', () => new THREE.Mesh(geometry().setIndex([0, 1, 6]))],
    [
      '浮点索引',
      () =>
        new THREE.Mesh(
          geometry().setIndex(new THREE.Float32BufferAttribute([0, 0.5, 2], 1)),
        ),
    ],
    [
      '索引尺寸错误',
      () =>
        new THREE.Mesh(
          geometry().setIndex(
            new THREE.Uint16BufferAttribute([0, 1, 2, 3, 4, 5], 2),
          ),
        ),
    ],
    ['蒙皮', () => new THREE.SkinnedMesh(geometry())],
    [
      '实例',
      () =>
        new THREE.InstancedMesh(geometry(), new THREE.MeshBasicMaterial(), 1),
    ],
    ['批次实例', () => new THREE.BatchedMesh(1, 20, 60)],
    [
      '形变',
      () => {
        const result = geometry()
        result.morphAttributes.position = [
          new THREE.Float32BufferAttribute(new Float32Array(18), 3),
        ]
        return new THREE.Mesh(result)
      },
    ],
    [
      '形变权重',
      () => {
        const mesh = new THREE.Mesh(geometry())
        mesh.morphTargetInfluences = [1]
        return mesh
      },
    ],
    [
      '超出两万三角形',
      () =>
        new THREE.Mesh(
          new THREE.BufferGeometry().setAttribute(
            'position',
            new THREE.Float32BufferAttribute(new Float32Array(20_001 * 9), 3),
          ),
        ),
    ],
    [
      '绘制范围不完整',
      () => {
        const result = geometry()
        result.setDrawRange(1, 3)
        return new THREE.Mesh(result)
      },
    ],
    [
      '绘制范围负数',
      () => {
        const result = geometry()
        result.setDrawRange(-3, 3)
        return new THREE.Mesh(result)
      },
    ],
    [
      '材质组重叠',
      () => {
        const result = geometry()
        result.addGroup(0, 6, 0)
        result.addGroup(3, 3, 1)
        return new THREE.Mesh(result, [
          new THREE.MeshBasicMaterial(),
          new THREE.MeshBasicMaterial(),
        ])
      },
    ],
    [
      '材质组负数',
      () => {
        const result = geometry()
        result.addGroup(-3, 3, 0)
        return new THREE.Mesh(result, [new THREE.MeshBasicMaterial()])
      },
    ],
  ])('%s 保持原几何与渲染回调', (_name, create) => {
    const mesh = create()
    const original = mesh.geometry
    const before = vi.fn()
    mesh.onBeforeRender = before

    expect(TransparentGeometry.supports(mesh)).toBe(false)
    const sorter = new TransparentGeometry(mesh)
    expect(mesh.geometry).toBe(original)
    expect(mesh).toHaveProperty('onBeforeRender', before)
    sorter.dispose()
    expect(mesh.geometry).toBe(original)
  })

  it('恰好两万完整静态三角形可以排序', () => {
    const result = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(20_000 * 9), 3),
    )

    expect(TransparentGeometry.supports(new THREE.Mesh(result))).toBe(true)
  })

  it('材质组与部分绘制范围取交集，非绘制三角形保留', () => {
    const original = geometry()
    original.addGroup(0, 6, 0)
    original.addGroup(6, 0, 1)
    original.setDrawRange(3, Infinity)
    const mesh = new THREE.Mesh(original, [new THREE.MeshBasicMaterial()])
    const sorter = new TransparentGeometry(mesh)

    render(mesh)

    expect(mesh.geometry.index?.array).toEqual(
      new Uint16Array([0, 1, 2, 3, 4, 5]),
    )
    expect(mesh.geometry.groups).toEqual(original.groups)
    expect(mesh.geometry.drawRange).toEqual(original.drawRange)
    sorter.dispose()
  })
})
