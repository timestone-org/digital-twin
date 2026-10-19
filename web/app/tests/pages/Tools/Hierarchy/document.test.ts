/** @fileoverview 文档编辑、草稿、选择、撤销和几何操作。 */
import { afterEach, expect, it, vi } from 'vitest'
import { useToast } from '@dt/ui'
import { useHierarchyDocument } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchyDocument'
import { blank } from '../../../../src/pages/Tools/Hierarchy/scripts/mutations'
import { required } from '../../../../src/pages/Tools/Hierarchy/scripts/required'
import { harness } from '../../../../src/testing/hierarchyHarness'
afterEach(() => {
  useToast().clear()
  vi.restoreAllMocks()
})
it('编辑、连线、属性草稿、撤销与级联断线保持内容', () => {
  const { state: editor, wrapper } = harness(useHierarchyDocument)
  editor.install(blank('测试'))
  editor.add('meter', { x: 10, y: 20 })
  const first = required(editor.selected.value).id
  editor.add('junction', { x: 500, y: 400 })
  const middle = required(editor.selected.value).id
  editor.add('meter', { x: 800, y: 700 })
  const last = required(editor.selected.value).id
  editor.connect(first, middle)
  editor.connect(middle, last)
  editor.select([first])
  editor.patchDraft({
    code: 'M001',
    parameter: '0.5级',
    name: '蒸汽计量',
    order: 3,
  })
  editor.select([last])
  expect(editor.hasDrafts.value).toBe(true)
  editor.applyDrafts()
  expect(
    required(editor.document.value).nodes.find((node) => node.id === first)
      ?.parameter,
  ).toBe('0.5级')
  editor.select([first, last])
  editor.align('left')
  expect(
    required(editor.document.value).nodes.find((node) => node.id === last)
      ?.position.x,
  ).toBe(10)
  editor.nudge(1, 10)
  expect(
    required(editor.document.value).nodes.find((node) => node.id === first)
      ?.position.x,
  ).toBe(11)
  editor.undo()
  expect(
    required(editor.document.value).nodes.find((node) => node.id === first)
      ?.position.x,
  ).toBe(10)
  editor.undo(true)
  expect(
    required(editor.document.value).nodes.find((node) => node.id === first)
      ?.position.x,
  ).toBe(11)
  editor.select([middle])
  editor.remove()
  expect(required(editor.document.value).edges).toHaveLength(0)
  editor.undo()
  expect(required(editor.document.value).edges).toHaveLength(2)
  editor.selectEdge(required(editor.document.value?.edges[0]).id)
  editor.remove()
  expect(required(editor.document.value).edges).toHaveLength(1)
  wrapper.unmount()
})
it('无项目动作无副作用，非法关系保留现有文档并提示', () => {
  const { state: editor, wrapper } = harness(useHierarchyDocument)
  editor.add('meter', { x: 0, y: 0 })
  editor.connect('a', 'b')
  editor.remove()
  editor.move([])
  editor.undo()
  editor.applyDrafts()
  editor.patchDraft({ code: 'x' })
  expect(editor.document.value).toBeNull()
  editor.install(blank('测试'))
  editor.add('meter', { x: 0, y: 0 })
  const id = required(editor.selected.value).id
  editor.connect(id, id)
  expect(required(editor.document.value).edges).toHaveLength(0)
  expect(useToast().toasts.value.at(-1)?.message).toContain('自身')
  editor.patchDraft({ code: '' })
  expect(() => editor.applyDrafts()).toThrow(/不能为空/)
  editor.undo(true)
  expect(editor.hasDrafts.value).toBe(true)
  wrapper.unmount()
})

it('纯 HTTP 环境缺少 randomUUID 时仍能创建节点与连线', () => {
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    throw new Error('仅安全上下文可用')
  })
  const { state: editor, wrapper } = harness(useHierarchyDocument)
  editor.install(blank('HTTP 项目'))
  editor.add('meter', { x: 0, y: 0 })
  const source = required(editor.selected.value).id
  editor.add('meter', { x: 0, y: 300 })
  const target = required(editor.selected.value).id
  editor.connect(source, target)
  expect(editor.document.value?.edges).toHaveLength(1)
  wrapper.unmount()
})
