/** @fileoverview 节点卡片完整文本与不同高度节点的视口居中。 */
import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import Canvas from '../../../../src/pages/Tools/Hierarchy/components/HierarchyCanvas.vue'
import NodeCard from '../../../../src/pages/Tools/Hierarchy/components/HierarchyNode.vue'
import { blank } from '../../../../src/pages/Tools/Hierarchy/scripts/mutations'
import { useHierarchyDocument } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchyDocument'
import { editorSize } from '../../../../src/pages/Tools/Hierarchy/scripts/geometry'
import { required } from '../../../../src/pages/Tools/Hierarchy/scripts/required'
import { harness } from '../../../../src/testing/hierarchyHarness'

afterEach(() => vi.restoreAllMocks())

it('计量节点保留省略字段的完整编号、参数和多行名称', () => {
  const node = {
    id: 'meter',
    kind: 'meter',
    code: '供热管网蒸汽计量装置编号'.repeat(3),
    parameter: '压差补偿参数'.repeat(6),
    name: '第一段蒸汽主管路进汽计量\n第二段蒸汽主管路出汽计量',
    position: { x: 0, y: 0 },
    order: 1,
  } as const
  const wrapper = mount(NodeCard, {
    props: { node, selected: false, readonly: true },
  })
  expect(wrapper.get('.node-code.truncate').attributes('title')).toBe(node.code)
  expect(wrapper.get('.node-parameter.truncate').attributes('title')).toBe(
    node.parameter,
  )
  const name = wrapper.get('.node-name')
  expect(name.attributes('title')).toBe(node.name)
  expect(name.get('.line-clamp-2').text()).toBe(node.name)
  wrapper.unmount()
})

it.each(['meter', 'junction'] as const)(
  '添加和查找 %s 时按实际节点高度居中',
  (kind) => {
    const parent = harness(useHierarchyDocument)
    const editor = parent.state
    editor.install(blank('节点定位'))
    const canvas = mount(Canvas, { props: { editor, readonly: false } })
    const frame = new DOMRect(10, 20, 800, 600)
    vi.spyOn(
      canvas.get('.hierarchy-canvas').element,
      'getBoundingClientRect',
    ).mockReturnValue(frame)
    canvas.vm.add(kind)
    const doc = required(editor.document.value)
    const node = required(doc.nodes[0])
    const size = editorSize(node)
    const centerX = node.position.x + size.width / 2
    const centerY = node.position.y + size.height / 2
    expect(centerX * doc.viewport.zoom + doc.viewport.x).toBe(frame.width / 2)
    expect(centerY * doc.viewport.zoom + doc.viewport.y).toBe(frame.height / 2)
    canvas.vm.focus(node.id)
    const view = required(editor.document.value).viewport
    expect(centerX + view.x).toBe(frame.width / 2)
    expect(centerY + view.y).toBe(frame.height / 2)
    canvas.unmount()
    parent.wrapper.unmount()
  },
)
