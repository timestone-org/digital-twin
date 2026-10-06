/**
 * @fileoverview 配置透明静态网格的三角形索引排序与几何资源归属。
 * 范围与透明混合限制见 web/docs/TWIN_MATERIAL_RENDERING.md。
 */
import * as THREE from 'three'

const MAX_SORTED_TRIANGLES = 20_000

interface SortRange {
  start: number
  count: number
}

interface Triangle {
  a: number
  b: number
  c: number
  order: number
  center: THREE.Vector3
  depth: number
}

interface TriangleRange {
  start: number
  triangles: Triangle[]
}

type PositionAttribute =
  THREE.BufferAttribute | THREE.InterleavedBufferAttribute

function isDeformed(mesh: THREE.Mesh): boolean {
  return (
    mesh instanceof THREE.SkinnedMesh ||
    mesh instanceof THREE.InstancedMesh ||
    mesh instanceof THREE.BatchedMesh ||
    (mesh.morphTargetInfluences?.length ?? 0) > 0 ||
    Object.values(mesh.geometry.morphAttributes).some(
      (attributes) => (attributes?.length ?? 0) > 0,
    )
  )
}

function validIndices(mesh: THREE.Mesh, position: PositionAttribute): boolean {
  const index = mesh.geometry.index
  if (index === null) return true
  if (index.itemSize !== 1 || index.normalized || !isIndexArray(index.array))
    return false
  for (let offset = 0; offset < index.count; offset += 1) {
    const vertex = index.getX(offset)
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.count)
      return false
  }
  return true
}

function isIndexArray(array: THREE.TypedArray): boolean {
  return (
    array instanceof Uint8Array ||
    array instanceof Uint16Array ||
    array instanceof Uint32Array
  )
}

function validPosition(
  position: PositionAttribute | undefined,
): position is PositionAttribute {
  return (
    position !== undefined &&
    position.itemSize >= 3 &&
    Number.isInteger(position.count) &&
    position.count > 0
  )
}

function validRange(range: SortRange): boolean {
  return (
    Number.isInteger(range.start) &&
    range.start >= 0 &&
    (Number.isInteger(range.count) || range.count === Infinity) &&
    range.count >= 0
  )
}

function drawRanges(mesh: THREE.Mesh, count: number): SortRange[] | null {
  const { geometry } = mesh
  const draw = geometry.drawRange
  if (!validRange(draw)) return null
  const groups =
    Array.isArray(mesh.material) && geometry.groups.length > 0
      ? geometry.groups
      : [{ start: 0, count }]
  const ranges: SortRange[] = []
  for (const group of groups) {
    if (!validRange(group)) return null
    const start = Math.max(draw.start, group.start)
    const end = Math.min(
      count,
      draw.start + draw.count,
      group.start + group.count,
    )
    if (end <= start) continue
    if (start % 3 !== 0 || end % 3 !== 0) return null
    ranges.push({ start, count: end - start })
  }
  ranges.sort((left, right) => left.start - right.start)
  return rangesOverlap(ranges) ? null : ranges
}

function rangesOverlap(ranges: readonly SortRange[]): boolean {
  for (let offset = 1; offset < ranges.length; offset += 1) {
    const previous = ranges[offset - 1]
    const current = ranges[offset]
    if (
      previous !== undefined &&
      current !== undefined &&
      previous.start + previous.count > current.start
    )
      return true
  }
  return false
}

function trianglesOf(
  index: THREE.BufferAttribute,
  range: SortRange,
): TriangleRange {
  const triangles: Triangle[] = []
  for (
    let offset = range.start;
    offset < range.start + range.count;
    offset += 3
  ) {
    triangles.push({
      a: index.getX(offset),
      b: index.getX(offset + 1),
      c: index.getX(offset + 2),
      order: offset,
      center: new THREE.Vector3(),
      depth: 0,
    })
  }
  return { start: range.start, triangles }
}

function positionVersion(position: PositionAttribute): number {
  return position instanceof THREE.InterleavedBufferAttribute
    ? position.data.version
    : position.version
}

function centerOf(triangle: Triangle, position: PositionAttribute): void {
  const { a, b, c } = triangle
  triangle.center.set(
    (position.getX(a) + position.getX(b) + position.getX(c)) / 3,
    (position.getY(a) + position.getY(b) + position.getY(c)) / 3,
    (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3,
  )
}

function sortRange(
  range: TriangleRange,
  index: THREE.BufferAttribute,
  direction: THREE.Vector3,
): boolean {
  for (const triangle of range.triangles)
    triangle.depth = direction.dot(triangle.center)
  range.triangles.sort(
    (left, right) => left.depth - right.depth || left.order - right.order,
  )
  let changed = false
  for (const [offset, triangle] of range.triangles.entries()) {
    const start = range.start + offset * 3
    changed = writeTriangle(index, start, triangle) || changed
  }
  return changed
}

function writeTriangle(
  index: THREE.BufferAttribute,
  start: number,
  triangle: Triangle,
): boolean {
  if (
    index.getX(start) === triangle.a &&
    index.getX(start + 1) === triangle.b &&
    index.getX(start + 2) === triangle.c
  )
    return false
  index.setX(start, triangle.a)
  index.setX(start + 1, triangle.b)
  index.setX(start + 2, triangle.c)
  return true
}

function sortRanges(
  ranges: readonly TriangleRange[],
  index: THREE.BufferAttribute,
  direction: THREE.Vector3,
  position: PositionAttribute | null,
): boolean {
  let changed = false
  for (const range of ranges) {
    if (position !== null)
      for (const triangle of range.triangles) centerOf(triangle, position)
    changed = sortRange(range, index, direction) || changed
  }
  return changed
}

function beforeRenderOf(owner: {
  onBeforeRender: THREE.Mesh['onBeforeRender']
}): THREE.Mesh['onBeforeRender'] {
  return owner.onBeforeRender
}

export class TransparentGeometry {
  private readonly original: THREE.BufferGeometry
  private readonly previous: THREE.Mesh['onBeforeRender']
  private readonly cloned: THREE.BufferGeometry | null
  private readonly ranges: TriangleRange[] = []
  private readonly modelView = new THREE.Matrix4()
  private readonly direction = new THREE.Vector3()
  private readonly lastDirection = new THREE.Vector3(NaN, NaN, NaN)
  private lastPosition: PositionAttribute | null = null
  private lastVersion = -1
  private disposed = false
  private readonly beforeRender: THREE.Mesh['onBeforeRender'] = (
    ...parameters
  ) => {
    this.previous.call(this.mesh, ...parameters)
    this.sort(parameters[2])
  }

  static supports(mesh: THREE.Mesh): boolean {
    if (isDeformed(mesh)) return false
    const position = mesh.geometry.getAttribute('position')
    if (!validPosition(position)) return false
    const count = mesh.geometry.index?.count ?? position.count
    if (count % 3 !== 0 || count / 3 > MAX_SORTED_TRIANGLES || count === 0)
      return false
    return validIndices(mesh, position) && drawRanges(mesh, count) !== null
  }

  constructor(private readonly mesh: THREE.Mesh) {
    this.original = mesh.geometry
    this.previous = beforeRenderOf(mesh)
    this.cloned = TransparentGeometry.supports(mesh)
      ? mesh.geometry.clone()
      : null
    if (this.cloned === null) return
    const position = this.cloned.getAttribute('position')
    if (this.cloned.index === null)
      this.cloned.setIndex(
        Array.from({ length: position.count }, (_, offset) => offset),
      )
    const index = this.cloned.index
    if (index === null) return
    const ranges = drawRanges(mesh, index.count) ?? []
    this.ranges.push(...ranges.map((range) => trianglesOf(index, range)))
    mesh.geometry = this.cloned
    mesh.onBeforeRender = this.beforeRender
  }

  private sort(camera: THREE.Camera): void {
    const geometry = this.activeGeometry()
    if (geometry === null) return
    const position = geometry.getAttribute('position')
    const index = geometry.index
    if (position === undefined || index === null) return
    this.modelView.multiplyMatrices(
      camera.matrixWorldInverse,
      this.mesh.matrixWorld,
    )
    const elements = this.modelView.elements
    this.direction.set(elements[2], elements[6], elements[10])
    const version = positionVersion(position)
    const positionChanged =
      this.lastPosition !== position || this.lastVersion !== version
    if (!positionChanged && this.lastDirection.equals(this.direction)) return
    const changed = sortRanges(
      this.ranges,
      index,
      this.direction,
      positionChanged ? position : null,
    )
    // ⚠ BindingStates 在 onBeforeRender 之后上传 index，置版本即可在当前绘制生效。
    if (changed) index.needsUpdate = true
    this.lastPosition = position
    this.lastVersion = version
    this.lastDirection.copy(this.direction)
  }

  private activeGeometry(): THREE.BufferGeometry | null {
    return this.disposed || this.mesh.geometry !== this.cloned
      ? null
      : this.cloned
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.mesh.geometry === this.cloned) this.mesh.geometry = this.original
    if (this.mesh.onBeforeRender === this.beforeRender)
      this.mesh.onBeforeRender = this.previous
    this.cloned?.dispose()
    this.ranges.length = 0
  }
}
