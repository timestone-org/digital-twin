/** @fileoverview 画布拖动、多选、端口连线与视口几何契约。 */
import { ref, shallowRef } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useToast } from '@dt/ui'
import { useHierarchyDocument } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchyDocument'
import { useCanvasPointer } from '../../../../src/pages/Tools/Hierarchy/scripts/useCanvasPointer'
import { blank } from '../../../../src/pages/Tools/Hierarchy/scripts/mutations'
import {
  canvasPoint,
  edgePath,
  fitViewport,
} from '../../../../src/pages/Tools/Hierarchy/scripts/canvasGeometry'
import { required } from '../../../../src/pages/Tools/Hierarchy/scripts/required'
import { harness } from '../../../../src/testing/hierarchyHarness'
afterEach(() => {
  useToast().clear()
  vi.restoreAllMocks()
})
const event = (x: number, y: number, options: PointerEventInit = {}) =>
  new PointerEvent('pointerdown', {
    clientX: x,
    clientY: y,
    pointerId: 1,
    button: 0,
    ...options,
  })
function setup(edit = true) {
  return harness(() => {
    const editor = useHierarchyDocument()
    const document = blank('拖动测试')
    document.viewport = { x: 0, y: 0, zoom: 1 }
    document.nodes = ['a', 'b', 'c'].map((id, index) => ({
      id,
      kind: 'meter',
      code: id,
      name: '计量',
      parameter: '1.0级',
      order: index,
      position: { x: index === 1 ? 300 : 0, y: index === 2 ? 300 : 0 },
    }))
    editor.install(document)
    const frame = documentElement()
    return {
      editor,
      frame,
      pointer: useCanvasPointer(shallowRef(editor), ref(frame), () => edit),
    }
  })
}
function documentElement() {
  const frame = document.createElement('div')
  document.body.append(frame)
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 800, 600),
  )
  frame.setPointerCapture = vi.fn()
  frame.releasePointerCapture = vi.fn()
  return frame
}
it('拖动只在结束时提交一次，并支持多选和辅助线', () => {
  const {
    state: { editor, pointer, frame },
    wrapper,
  } = setup()
  const first = required(editor.document.value?.nodes[0]),
    second = required(editor.document.value?.nodes[1])
  pointer.nodeDown(first, event(20, 20))
  pointer.move(event(65, 47))
  expect(first.position).toEqual({ x: 0, y: 0 })
  pointer.finish(event(65, 47))
  expect(required(editor.document.value?.nodes[0]).position).toEqual({
    x: 50,
    y: 30,
  })
  expect(editor.past.value).toHaveLength(1)
  pointer.nodeDown(second, event(320, 20, { shiftKey: true }))
  expect(editor.selectedIds.value).toEqual(['a', 'b'])
  pointer.move(event(321, 320))
  expect(pointer.guides.value.length).toBeGreaterThan(0)
  pointer.finish(event(321, 320))
  pointer.nodeDown(second, event(320, 20, { shiftKey: true }))
  expect(editor.selectedIds.value).toEqual(['a'])
  pointer.snap.value = false
  pointer.showGuides.value = false
  pointer.nodeDown(required(editor.document.value?.nodes[0]), event(60, 40))
  pointer.move(event(61, 42))
  pointer.cancel()
  expect(pointer.guides.value).toEqual([])
  frame.remove()
  wrapper.unmount()
})
it('框选和平移独立于节点编辑，支持点击及拖拽连线', () => {
  const {
    state: { editor, pointer, frame },
    wrapper,
  } = setup()
  pointer.backgroundDown(event(0, 0, { shiftKey: true }))
  pointer.move(event(600, 600))
  expect(pointer.selectionBox.value?.width).toBe(600)
  pointer.finish(event(600, 600))
  expect(editor.selectedIds.value).toEqual(['a', 'b', 'c'])
  pointer.backgroundDown(event(10, 10))
  pointer.move(event(70, 40))
  pointer.finish(event(70, 40))
  expect(editor.document.value?.viewport).toEqual({ x: 60, y: 30, zoom: 1 })
  pointer.portDown('a', 'out', event(104, 148))
  pointer.move(event(404, 300))
  expect(pointer.connection.value).toBe('a')
  pointer.portDown('b', 'in', event(404, 300))
  expect(
    editor.document.value?.edges.map((edge) => [edge.source, edge.target]),
  ).toEqual([['a', 'b']])
  const port = document.createElement('button')
  port.dataset['port'] = 'in'
  port.dataset['nodeId'] = 'c'
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(port)
  pointer.portDown('b', 'out', event(404, 148))
  pointer.finish(event(104, 300))
  expect(editor.document.value?.edges).toHaveLength(2)
  pointer.backgroundDown(event(0, 0, { button: 2 }))
  pointer.nodeDown(
    required(editor.document.value?.nodes[0]),
    event(0, 0, { button: 2 }),
  )
  pointer.cancel()
  frame.remove()
  wrapper.unmount()
})
it('只读不能移动和连接，坐标换算与适应全部有明确边界', () => {
  const {
    state: { editor, pointer, frame },
    wrapper,
  } = setup(false)
  pointer.nodeDown(required(editor.document.value?.nodes[0]), event(0, 0))
  pointer.move(event(100, 100))
  pointer.finish(event(100, 100))
  pointer.portDown('a', 'out', event(0, 0))
  expect(editor.document.value?.edges).toEqual([])
  expect(required(editor.document.value?.nodes[0]).position).toEqual({
    x: 0,
    y: 0,
  })
  expect(
    canvasPoint({ clientX: 110, clientY: 100 }, new DOMRect(10, 20, 800, 600), {
      x: 0,
      y: 0,
      zoom: 2,
    }),
  ).toEqual({ x: 50, y: 40 })
  expect(fitViewport([], 800, 600)).toEqual({ x: 50, y: 40, zoom: 1 })
  expect(
    fitViewport(required(editor.document.value).nodes, 800, 600).zoom,
  ).toBe(1)
  expect(
    edgePath(
      required(editor.document.value?.nodes[0]),
      required(editor.document.value?.nodes[2]),
    ),
  ).toBe('M104 148 V224 H104 V300')
  frame.remove()
  wrapper.unmount()
})
