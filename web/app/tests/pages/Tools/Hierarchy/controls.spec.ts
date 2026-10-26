/** @fileoverview 编辑器控件、键盘与拖拽事件的真实组件接线。 */
import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { DtInput, DtNumberInput, DtSelect, DtTextarea, useToast } from '@dt/ui'
import Canvas from '../../../../src/pages/Tools/Hierarchy/components/HierarchyCanvas.vue'
import Toolbar from '../../../../src/pages/Tools/Hierarchy/components/HierarchyToolbar.vue'
import Inspector from '../../../../src/pages/Tools/Hierarchy/components/HierarchyInspector.vue'
import { useHierarchyDocument } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchyDocument'
import { blank } from '../../../../src/pages/Tools/Hierarchy/scripts/mutations'
import { required } from '../../../../src/pages/Tools/Hierarchy/scripts/required'
import { harness } from '../../../../src/testing/hierarchyHarness'

afterEach(() => {
  vi.restoreAllMocks()
  useToast().clear()
})
function setup() {
  const parent = harness(useHierarchyDocument),
    editor = parent.state
  editor.install(blank('控件验收'))
  editor.add('meter', { x: 0, y: 0 })
  editor.add('meter', { x: 400, y: 300 })
  return { parent, editor }
}
function button(wrapper: ReturnType<typeof mount>, text: string) {
  const found = wrapper.findAll('button').find((node) => node.text() === text)
  if (!found) throw new Error(`没有按钮 ${text}`)
  return found
}
it('画布缩放、定位、键盘、拖入与端口事件更新真实文档', async () => {
  const { parent, editor } = setup()
  const canvas = mount(Canvas, {
    props: { editor, readonly: false },
    attachTo: document.body,
    global: { stubs: { teleport: true } },
  })
  const frame = canvas.get('.hierarchy-canvas')
  vi.spyOn(frame.element, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 800, 600),
  )
  Object.defineProperty(frame.element, 'setPointerCapture', { value: vi.fn() })
  Object.defineProperty(frame.element, 'releasePointerCapture', {
    value: vi.fn(),
  })
  await canvas.get('[aria-label="缩小画布"]').trigger('click')
  await canvas.get('[aria-label="放大画布"]').trigger('click')
  await frame.trigger('wheel', { deltaY: 100, clientX: 200, clientY: 200 })
  expect(editor.document.value?.viewport.zoom).toBeLessThan(1)
  const first = required(editor.document.value?.nodes[0]),
    second = required(editor.document.value?.nodes[1])
  canvas.vm.focus(first.id)
  expect(editor.selectedIds.value).toEqual([first.id])
  await button(canvas, '定位选中').trigger('click')
  await button(canvas, '适应全部').trigger('click')
  await button(canvas, '画布辅助').trigger('click')
  await canvas.findAll('input[type="checkbox"]')[0]?.setValue(false)
  await canvas.findAll('input[type="checkbox"]')[1]?.setValue(false)
  await frame.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
  expect(required(editor.document.value?.nodes[0]).position.x).toBe(10)
  await frame.trigger('keydown', { key: 'z', ctrlKey: true })
  await frame.trigger('keydown', { key: 'y', ctrlKey: true })
  await frame.trigger('keydown', { key: 's', ctrlKey: true })
  expect(canvas.emitted('save')).toHaveLength(1)
  await frame.trigger('drop', {
    dataTransfer: { getData: () => 'junction' },
    clientX: 500,
    clientY: 400,
  })
  expect(editor.document.value?.nodes).toHaveLength(3)
  await frame.trigger('keydown', { key: 'Delete' })
  expect(editor.document.value?.nodes).toHaveLength(2)
  await canvas
    .get(`[aria-label="${first.code} 输出端口"]`)
    .trigger('pointerdown', {
      button: 0,
      pointerId: 1,
      clientX: 104,
      clientY: 148,
    })
  await frame.trigger('pointermove', {
    pointerId: 1,
    clientX: 504,
    clientY: 300,
  })
  await canvas
    .get(`[aria-label="${second.code} 输入端口"]`)
    .trigger('pointerdown', {
      button: 0,
      pointerId: 1,
      clientX: 504,
      clientY: 300,
    })
  expect(editor.document.value?.edges).toHaveLength(1)
  await frame.trigger('pointerup', { pointerId: 1, clientX: 504, clientY: 300 })
  await frame.trigger('pointercancel')
  await frame.trigger('keydown', { key: 'Escape' })
  await canvas.get('.hierarchy-node').trigger('pointerdown', {
    button: 0,
    pointerId: 1,
    clientX: 50,
    clientY: 30,
  })
  await frame.trigger('pointercancel')
  canvas.unmount()
  parent.wrapper.unmount()
})
it('工具栏保留两类节点、全部对齐、拖出和导出格式事件', async () => {
  const { parent, editor } = setup()
  editor.select(required(editor.document.value).nodes.map((node) => node.id))
  const toolbar = mount(Toolbar, {
    props: { editor, readonly: false, busy: false, mode: 'edit' },
    global: { stubs: { teleport: true } },
  })
  for (const kind of ['计量节点', '汇流点']) {
    const transfer = { setData: vi.fn() }
    await button(toolbar, kind).trigger('dragstart', { dataTransfer: transfer })
    expect(transfer.setData).toHaveBeenCalled()
    await button(toolbar, kind).trigger('click')
  }
  expect(toolbar.emitted('add')).toEqual([['meter'], ['junction']])
  await button(toolbar, '对齐与分布').trigger('click')
  await button(toolbar, '右对齐').trigger('click')
  expect(required(editor.document.value?.nodes[0]).position.x).toBe(400)
  await button(toolbar, '导出').trigger('click')
  await button(toolbar, 'JSON · 完整项目配置').trigger('click')
  expect(toolbar.emitted('export')).toEqual([['json']])
  await button(toolbar, '项目列表').trigger('click')
  await button(toolbar, '配置面板').trigger('click')
  expect(toolbar.emitted('projects')).toHaveLength(1)
  expect(toolbar.emitted('inspector')).toHaveLength(1)
  await toolbar.setProps({ mode: 'drawing' })
  await button(toolbar, '返回编辑').trigger('click')
  expect(toolbar.emitted('edit')).toHaveLength(1)
  toolbar.unmount()
  parent.wrapper.unmount()
})
it('属性面板的文本、顺序和图纸宽度全部接入文档', async () => {
  const { parent, editor } = setup()
  editor.select([required(editor.document.value?.nodes[0]).id])
  const inspector = mount(Inspector, { props: { editor, readonly: false } })
  const changes: Record<string, string> = {
    节点编号: 'M001',
    圆内下栏: '0.5级',
  }
  for (const input of inspector.findAllComponents(DtInput)) {
    const value = changes[required(input.props('label'))]
    if (value !== undefined) input.vm.$emit('update:modelValue', value)
  }
  const order = inspector
    .findAllComponents(DtNumberInput)
    .find((input) => input.props('label') === '分支内顺序')
  required(order).vm.$emit('update:modelValue', 9)
  inspector.getComponent(DtTextarea).vm.$emit('update:modelValue', '锅炉\n计量')
  await inspector.vm.$nextTick()
  await button(inspector, '应用修改').trigger('click')
  editor.applyDrafts()
  expect(required(editor.document.value?.nodes[0])).toMatchObject({
    code: 'M001',
    name: '锅炉\n计量',
    parameter: '0.5级',
    order: 9,
  })
  await button(inspector, '图纸设置').trigger('click')
  inspector.getComponent(DtInput).vm.$emit('update:modelValue', '新标题')
  expect(editor.document.value?.title).toBe('新标题')
  const paper = inspector
    .findAllComponents(DtNumberInput)
    .find((input) => input.props('label') === '图纸宽度')
  required(paper).vm.$emit('update:modelValue', 2400)
  expect(editor.document.value?.paper.width).toBe(2400)
  const width = inspector
    .findAllComponents(DtSelect)
    .find((input) => input.props('label') === '常用图纸宽度')
  required(width).vm.$emit('update:modelValue', '3200')
  expect(editor.document.value?.paper.width).toBe(3200)
  required(inspector.findAllComponents(DtSelect)[0]).vm.$emit(
    'update:modelValue',
    required(editor.document.value?.nodes[0]).id,
  )
  expect(inspector.emitted('focus')).toHaveLength(1)
  inspector.unmount()
  parent.wrapper.unmount()
})

it('键盘可连接端口并选中连接后删除', async () => {
  const { parent, editor } = setup()
  const canvas = mount(Canvas, { props: { editor, readonly: false } })
  const first = required(editor.document.value?.nodes[0])
  const second = required(editor.document.value?.nodes[1])
  await canvas
    .get(`[aria-label="${first.code} 输出端口"]`)
    .trigger('keydown', { key: 'Enter' })
  await canvas
    .get(`[aria-label="${second.code} 输入端口"]`)
    .trigger('keydown', { key: 'Enter' })
  expect(editor.document.value?.edges).toHaveLength(1)
  await canvas.get('g[role="button"]').trigger('keydown', { key: 'Enter' })
  await canvas.get('.hierarchy-canvas').trigger('keydown', { key: 'Delete' })
  expect(editor.document.value?.edges).toHaveLength(0)
  canvas.unmount()
  parent.wrapper.unmount()
})
