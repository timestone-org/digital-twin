/** @fileoverview 配置分区、草稿、多选和上下游关系的用户交互。 */
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { DtInput, DtSelect, DtTextarea, useToast } from '@dt/ui'
import Inspector from '../../../../src/pages/Tools/Hierarchy/components/HierarchyInspector.vue'
import Relations from '../../../../src/pages/Tools/Hierarchy/components/HierarchyRelations.vue'
import Toolbar from '../../../../src/pages/Tools/Hierarchy/components/HierarchyToolbar.vue'
import { useHierarchyDocument } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchyDocument'
import { blank } from '../../../../src/pages/Tools/Hierarchy/scripts/mutations'
import { required } from '../../../../src/pages/Tools/Hierarchy/scripts/required'
import { harness } from '../../../../src/testing/hierarchyHarness'

afterEach(() => {
  vi.restoreAllMocks()
  useToast().clear()
})

function setup() {
  const parent = harness(useHierarchyDocument)
  const editor = parent.state
  editor.install(blank('配置验收'))
  editor.add('meter', { x: 0, y: 0 })
  editor.add('meter', { x: 300, y: 200 })
  editor.add('junction', { x: 600, y: 200 })
  const nodes = required(editor.document.value).nodes
  return {
    parent,
    editor,
    first: required(nodes[0]),
    second: required(nodes[1]),
    junction: required(nodes[2]),
  }
}
function button(wrapper: ReturnType<typeof mount>, text: string) {
  return required(
    wrapper.findAll('button').find((item) => item.text() === text),
  )
}

it('节点必填项和重复编号在表单中提示，修正后提示消失', async () => {
  const { parent, editor, first, second } = setup()
  editor.select([first.id])
  const wrapper = mount(Inspector, { props: { editor, readonly: false } })
  const code = required(
    wrapper
      .findAllComponents(DtInput)
      .find((item) => item.props('label') === '节点编号'),
  )
  await code.get('input').setValue('')
  await wrapper.get('textarea').setValue(' ')
  expect(wrapper.text()).toContain('请填写节点编号')
  expect(wrapper.text()).toContain('请填写节点名称')
  await code.get('input').setValue(second.code)
  expect(wrapper.text()).toContain('此编号已被其他节点使用')
  await code.get('input').setValue('M001')
  await wrapper.get('textarea').setValue('锅炉计量')
  expect(wrapper.text()).not.toContain('请填写')
  expect(wrapper.text()).not.toContain('此编号已被其他节点使用')
  wrapper.unmount()
  parent.wrapper.unmount()
})

it('跨节点切换保留草稿，放弃修改只清除草稿并保留已提交的连线', async () => {
  const { parent, editor, first, second } = setup()
  editor.select([first.id])
  const wrapper = mount(Inspector, { props: { editor, readonly: false } })
  await wrapper.get('textarea').setValue('草稿一')
  editor.select([second.id])
  await flushPromises()
  await wrapper.get('textarea').setValue('草稿二')
  editor.connect(first.id, second.id)
  await flushPromises()
  expect(wrapper.text()).toContain('2 个节点有待应用修改')
  await button(wrapper, '图纸设置').trigger('click')
  expect(wrapper.text()).toContain('2 个节点有待应用修改')
  await button(wrapper, '放弃修改').trigger('click')
  expect(wrapper.text()).not.toContain('待应用修改')
  expect(editor.document.value?.nodes.map((item) => item.name)).toEqual([
    '新计量节点',
    '新计量节点',
    '新汇流点',
  ])
  expect(editor.document.value?.edges).toHaveLength(1)
  wrapper.unmount()
  parent.wrapper.unmount()
})

it('未选择、多选与汇流点提供对应配置，预览自动进入图纸设置', async () => {
  const { parent, editor, first, second, junction } = setup()
  editor.select([])
  const wrapper = mount(Inspector, { props: { editor, readonly: false } })
  expect(wrapper.text()).toContain('选择节点，开始配置')
  editor.select([first.id, second.id])
  await flushPromises()
  expect(wrapper.text()).toContain('已选择 2 个节点')
  expect(wrapper.findComponent(DtTextarea).exists()).toBe(false)
  await button(wrapper, '上下游').trigger('click')
  expect(wrapper.text()).toContain('请选择单个节点')
  editor.select([junction.id])
  await button(wrapper, '节点属性').trigger('click')
  expect(wrapper.text()).toContain('不占逻辑层级')
  expect(wrapper.text()).not.toContain('圆内下栏')
  await wrapper.setProps({ mode: 'drawing' })
  expect(wrapper.text()).toContain('常用图纸宽度')
  wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', first.id)
  expect(wrapper.emitted('focus')).toEqual([[first.id]])
  editor.select([first.id])
  await flushPromises()
  expect(wrapper.find('textarea').exists()).toBe(true)
  wrapper.unmount()
  parent.wrapper.unmount()
})

it('从表单添加上下游，过滤已有连接，移除后可撤销并定位相邻节点', async () => {
  const { parent, editor, first, second, junction } = setup()
  editor.select([first.id])
  const wrapper = mount(Relations, { props: { editor, readonly: false } })
  expect(button(wrapper, '建立连接').attributes('disabled')).toBeDefined()
  wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', second.id)
  await flushPromises()
  await button(wrapper, '建立连接').trigger('click')
  expect(editor.document.value?.edges).toEqual([
    expect.objectContaining({ source: first.id, target: second.id }),
  ])
  expect(wrapper.getComponent(DtSelect).props('options')).toEqual([
    { value: junction.id, label: `${junction.code} · ${junction.name}` },
  ])
  await button(wrapper, `${second.code} · ${second.name}`).trigger('click')
  expect(wrapper.emitted('focus')).toEqual([[second.id]])
  await button(wrapper, '添加上游').trigger('click')
  wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', junction.id)
  await flushPromises()
  await button(wrapper, '建立连接').trigger('click')
  expect(editor.document.value?.edges).toEqual([
    expect.objectContaining({ source: first.id, target: second.id }),
    expect.objectContaining({ source: junction.id, target: first.id }),
  ])
  await wrapper
    .get(`[aria-label="移除与 ${second.code} 的连接"]`)
    .trigger('click')
  expect(editor.document.value?.edges).toHaveLength(1)
  expect(editor.selectedIds.value).toEqual([first.id])
  editor.undo()
  expect(editor.document.value?.edges).toHaveLength(2)
  wrapper.unmount()
  parent.wrapper.unmount()
})

it('表单连接沿用循环校验，选择变化清除尚未建立的目标', async () => {
  const { parent, editor, first, second } = setup()
  editor.connect(first.id, second.id)
  editor.select([second.id])
  const wrapper = mount(Relations, { props: { editor, readonly: false } })
  wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', first.id)
  await flushPromises()
  await button(wrapper, '建立连接').trigger('click')
  expect(editor.document.value?.edges).toHaveLength(1)
  expect(
    useToast().toasts.value.some((item) => item.message.includes('循环')),
  ).toBe(true)
  editor.select([first.id])
  await flushPromises()
  expect(wrapper.getComponent(DtSelect).props('modelValue')).toBe('')
  expect(button(wrapper, '建立连接').attributes('disabled')).toBeDefined()
  wrapper.unmount()
  parent.wrapper.unmount()
})

it('选中连线显示两端，移除只删连接且只读账号没有写入入口', async () => {
  const { parent, editor, first, second } = setup()
  editor.connect(first.id, second.id)
  editor.selectEdge(required(editor.document.value?.edges[0]).id)
  const wrapper = mount(Inspector, { props: { editor, readonly: true } })
  expect(wrapper.text()).toContain('已选择连接')
  expect(wrapper.text()).not.toContain('移除这条连接')
  await wrapper.setProps({ readonly: false })
  await button(wrapper, '移除这条连接').trigger('click')
  expect(editor.document.value?.edges).toHaveLength(0)
  expect(editor.document.value?.nodes).toHaveLength(3)
  expect(wrapper.text()).toContain('查看节点之间的关系')
  editor.select([first.id])
  await wrapper.setProps({ readonly: true })
  expect(wrapper.text()).not.toContain('建立连接')
  await button(wrapper, '节点属性').trigger('click')
  expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
  wrapper.unmount()
  parent.wrapper.unmount()
})

it('工具栏按选择数量启用对齐与分布，全部导出格式与帮助可访问', async () => {
  const { parent, editor, first, second, junction } = setup()
  editor.select([first.id])
  const wrapper = mount(Toolbar, {
    props: {
      editor,
      readonly: false,
      busy: false,
      mode: 'edit',
      panels: { projects: false, inspector: true },
    },
    global: { stubs: { teleport: true } },
  })
  expect(button(wrapper, '对齐与分布').attributes('disabled')).toBeDefined()
  expect(
    wrapper.get('[aria-label="项目列表"]').attributes('aria-pressed'),
  ).toBe('false')
  editor.select([first.id, second.id])
  await flushPromises()
  await button(wrapper, '对齐与分布').trigger('click')
  expect(button(wrapper, '水平等距').attributes('disabled')).toBeDefined()
  editor.select([first.id, second.id, junction.id])
  await flushPromises()
  await button(wrapper, '水平等距').trigger('click')
  expect(editor.document.value?.nodes.map((item) => item.position.x)).toEqual([
    0, 300, 600,
  ])
  for (const label of [
    'SVG · 可编辑矢量图',
    'PNG · 高清图片',
    'PDF · 矢量打印',
    'JSON · 完整项目配置',
    'Excel · 批量编辑配置',
  ]) {
    await button(wrapper, '导出').trigger('click')
    await button(wrapper, label).trigger('click')
  }
  expect(wrapper.emitted('export')).toEqual([
    ['svg'],
    ['png'],
    ['pdf'],
    ['json'],
    ['xlsx'],
  ])
  await button(wrapper, '操作指南').trigger('click')
  expect(wrapper.text()).toContain('快速上手')
  await wrapper.setProps({ busy: true })
  expect(button(wrapper, '计量节点').attributes('disabled')).toBeDefined()
  await wrapper.setProps({ busy: false, readonly: true })
  expect(wrapper.text()).not.toContain('整理画布')
  expect(wrapper.text()).toContain('只读模式')
  wrapper.unmount()
  parent.wrapper.unmount()
})
