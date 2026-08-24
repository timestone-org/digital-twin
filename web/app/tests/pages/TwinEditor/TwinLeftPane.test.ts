/**
 * @fileoverview 契约：左栏两个页签各画各的，事件（含六个文件夹事件）一路透传
 * 上去，钻取节点的删除并到通用的 remove 上（带 kind），renamingFolderId 递进
 * 大纲让新夹立刻进入就地重命名。
 * ⚠ 模板里的事件名写错时 typecheck 与 lint 双双放行，父组件只是收不到——
 * 每条透传都要有「子组件抛了、父组件收到了什么」的断言。
 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import { DtSegmented } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import TwinLeftPane from '@/pages/TwinEditor/components/TwinLeftPane.vue'
import TwinOutline from '@/pages/TwinEditor/components/TwinOutline.vue'

function configOf(): TwinConfig {
  return normalizeTwinConfig({
    anchors: [{ id: 'a1', name: '进口' }],
    hierNodes: [{ id: 'plant', name: '厂区' }],
    folders: [{ id: 'f1', kind: 'anchors', name: '温度组', itemIds: [] }],
  })
}

function render(renamingFolderId: string | null = null) {
  return mount(TwinLeftPane, {
    props: {
      config: configOf(),
      selection: null,
      flaggedIds: new Set<string>(),
      renamingFolderId,
    },
  })
}

type Wrapper = ReturnType<typeof render>

async function switchTab(wrapper: Wrapper, value: string): Promise<void> {
  wrapper.getComponent(DtSegmented).vm.$emit('update:modelValue', value)
  await nextTick()
}

async function toHierTab(wrapper: Wrapper): Promise<void> {
  await switchTab(wrapper, 'hier')
}

describe('左栏页签', () => {
  it('缺省停在大纲', () => {
    const wrapper = render()

    expect(wrapper.find('[data-test="twin-outline"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="twin-hierarchy"]').exists()).toBe(false)
  })

  it('切到层级页签只画钻取树', async () => {
    const wrapper = render()

    await toHierTab(wrapper)

    expect(wrapper.find('[data-test="twin-hierarchy"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="twin-outline"]').exists()).toBe(false)
  })

  it('页签值不认识时回落大纲，不留一栏空白', async () => {
    const wrapper = render()

    await switchTab(wrapper, '?')

    expect(wrapper.find('[data-test="twin-outline"]').exists()).toBe(true)
  })

  // variant 写错时 typecheck 放行、只是长相回落 control，这里锁 tabs 档真的生效
  it('页签用 tabs 档的分段控件', () => {
    expect(render().find('.dt-segmented--tabs').exists()).toBe(true)
  })
})

describe('事件透传', () => {
  it('大纲的选中一路传上去', async () => {
    const wrapper = render()

    await wrapper.get('[data-test="row-select"]').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([
      { kind: 'anchors', id: 'a1' },
    ])
  })

  it('层级页签的新建根节点传成 addHier(null)', async () => {
    const wrapper = render()
    await toHierTab(wrapper)

    await wrapper.get('[data-test="hier-add-root"]').trigger('click')

    expect(wrapper.emitted('addHier')?.[0]).toEqual([null])
  })

  it('钻取节点的删除并到通用 remove 上，带上 kind', async () => {
    const wrapper = render()
    await toHierTab(wrapper)

    // plant 是叶子：直接删，不经确认框
    await wrapper.get('[data-test="hier-remove"]').trigger('click')

    expect(wrapper.emitted('remove')?.[0]).toEqual([
      { kind: 'hierNodes', id: 'plant' },
    ])
  })

  // 重命名由 null → 夹 id 的变化沿拉起；挂载时带着旧值不误开输入框
  it('挂载时带着 renamingFolderId 不拉起重命名', () => {
    expect(render('f1').find('[data-test="folder-rename"]').exists()).toBe(
      false,
    )
  })

  it('renamingFolderId 从 null 变成夹 id 时大纲进入就地重命名', async () => {
    const wrapper = render()

    await wrapper.setProps({ renamingFolderId: 'f1' })

    expect(wrapper.find('[data-test="folder-rename"]').exists()).toBe(true)
  })

  it('大纲的增删改移显隐与批量建各自透传', () => {
    const wrapper = render()
    const outline = wrapper.getComponent(TwinOutline)

    outline.vm.$emit('add', 'anchors')
    outline.vm.$emit('bulkAdd')
    outline.vm.$emit('remove', { kind: 'anchors', id: 'a1' })
    outline.vm.$emit('duplicate', { kind: 'anchors', id: 'a1' })
    outline.vm.$emit('move', { kind: 'anchors', id: 'a1', delta: 1 })
    outline.vm.$emit('toggleEditorVisible', { kind: 'anchors', id: 'a1' })

    expect(wrapper.emitted('add')).toEqual([['anchors']])
    expect(wrapper.emitted('bulkAdd')).toHaveLength(1)
    expect(wrapper.emitted('remove')).toEqual([[{ kind: 'anchors', id: 'a1' }]])
    expect(wrapper.emitted('duplicate')).toEqual([
      [{ kind: 'anchors', id: 'a1' }],
    ])
    expect(wrapper.emitted('move')).toEqual([
      [{ kind: 'anchors', id: 'a1', delta: 1 }],
    ])
    expect(wrapper.emitted('toggleEditorVisible')).toEqual([
      [{ kind: 'anchors', id: 'a1' }],
    ])
  })

  it('六个文件夹事件一路透传上去', () => {
    const wrapper = render()
    const outline = wrapper.getComponent(TwinOutline)

    outline.vm.$emit('addFolder', 'anchors')
    outline.vm.$emit('renameFolder', { id: 'f1', name: '新名' })
    outline.vm.$emit('removeFolder', 'f1')
    outline.vm.$emit('moveIntoFolder', { folderId: 'f1', id: 'a1' })
    outline.vm.$emit('removeFromFolder', 'a1')
    outline.vm.$emit('createFolderWithItem', { kind: 'anchors', id: 'a1' })

    expect(wrapper.emitted('addFolder')).toEqual([['anchors']])
    expect(wrapper.emitted('renameFolder')).toEqual([
      [{ id: 'f1', name: '新名' }],
    ])
    expect(wrapper.emitted('removeFolder')).toEqual([['f1']])
    expect(wrapper.emitted('moveIntoFolder')).toEqual([
      [{ folderId: 'f1', id: 'a1' }],
    ])
    expect(wrapper.emitted('removeFromFolder')).toEqual([['a1']])
    expect(wrapper.emitted('createFolderWithItem')).toEqual([
      [{ kind: 'anchors', id: 'a1' }],
    ])
  })
})
