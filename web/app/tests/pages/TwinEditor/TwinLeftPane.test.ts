/**
 * @fileoverview 契约：左栏两个页签各画各的，事件一路透传上去，
 * 钻取节点的删除并到通用的 remove 上（带 kind），不另开一条路。
 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import { DtSegmented } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import TwinLeftPane from '@/pages/TwinEditor/components/TwinLeftPane.vue'

function configOf(): TwinConfig {
  return normalizeTwinConfig({
    anchors: [{ id: 'a1', name: '进口' }],
    hierNodes: [{ id: 'plant', name: '厂区' }],
  })
}

function render() {
  return mount(TwinLeftPane, {
    props: {
      config: configOf(),
      selection: null,
      flaggedIds: new Set<string>(),
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

    await wrapper.get('[data-test="hier-remove"]').trigger('click')
    await wrapper.get('[data-test="hier-remove-yes"]').trigger('click')

    expect(wrapper.emitted('remove')?.[0]).toEqual([
      { kind: 'hierNodes', id: 'plant' },
    ])
  })
})
