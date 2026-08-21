/**
 * @fileoverview 契约：能量流路径编辑当场说出「不足两点画不出线」。
 *
 * 渲染层对不足两点的流是整条不画，不提示的话用户看到的是「配了一条流、画面上
 * 什么都没有」。另锁住：同一个锚点允许重复出现，悬空 id 要报出来而不是静默跳过。
 */
import type { TwinAnchor } from '@dt/twin-config'
import { ALWAYS_VISIBLE } from '@dt/twin-config'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AnchorPathField from '@/pages/TwinEditor/components/fields/AnchorPathField.vue'

function anchorOf(id: string, name: string): TwinAnchor {
  return {
    id,
    name,
    position: [0, 0, 0],
    label: '',
    unit: '',
    decimals: null,
    visibility: ALWAYS_VISIBLE,
  }
}

const ANCHORS: TwinAnchor[] = [
  anchorOf('a1', '进水口'),
  anchorOf('a2', '出水口'),
  anchorOf('a3', ''),
]

function mountField(modelValue: string[], anchors: TwinAnchor[] = ANCHORS) {
  return mount(AnchorPathField, { props: { modelValue, anchors } })
}

type Wrapper = ReturnType<typeof mountField>

function written(wrapper: Wrapper): string[] {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.[0]) throw new Error('没有写回路径')
  return events[0][0] as string[]
}

function rowButton(wrapper: Wrapper, label: string, index: number) {
  const found = wrapper.findAll(`button[aria-label="${label}"]`)[index]
  if (!found) throw new Error(`未找到第 ${index} 个「${label}」`)
  return found
}

async function clickAdd(wrapper: Wrapper): Promise<void> {
  const add = wrapper.findAll('button').find((item) => item.text() === '添加')
  if (!add) throw new Error('未找到添加按钮')
  await add.trigger('click')
}

describe('不足两点', () => {
  it('一个点也没有时当场提示画不出来', () => {
    const wrapper = mountField([])

    expect(wrapper.text()).toContain('画不出来')
  })

  it('只有一个点时同样提示', () => {
    const wrapper = mountField(['a1'])

    expect(wrapper.text()).toContain('画不出来')
  })

  it('两个点就不再提示', () => {
    const wrapper = mountField(['a1', 'a2'])

    expect(wrapper.text()).not.toContain('画不出来')
  })

  it('悬空的那一段不算可解析的点', () => {
    const wrapper = mountField(['a1', 'ghost'])

    expect(wrapper.text()).toContain('找不到锚点 ghost')
    expect(wrapper.text()).toContain('画不出来')
  })
})

describe('增删与调序', () => {
  it('添加把下拉里选中的锚点接在末尾', async () => {
    const wrapper = mountField(['a2'])
    await clickAdd(wrapper)

    expect(written(wrapper)).toEqual(['a2', 'a1'])
  })

  it('同一个锚点可以重复出现（往返、回环靠它）', async () => {
    const wrapper = mountField(['a1', 'a2'])
    const select = wrapper.findComponent(DtSelect)
    await select.setValue('a1')
    await clickAdd(wrapper)

    expect(written(wrapper)).toEqual(['a1', 'a2', 'a1'])
  })

  it('上移换的是顺序', async () => {
    const wrapper = mountField(['a1', 'a2'])
    await rowButton(wrapper, '上移路径点', 1).trigger('click')

    expect(written(wrapper)).toEqual(['a2', 'a1'])
  })

  it('移除只去掉那一站，重复项不会被一起删掉', async () => {
    const wrapper = mountField(['a1', 'a2', 'a1'])
    await rowButton(wrapper, '移除路径点', 0).trigger('click')

    expect(written(wrapper)).toEqual(['a2', 'a1'])
  })

  it('首站不能上移、末站不能下移', () => {
    const wrapper = mountField(['a1', 'a2'])

    expect(
      rowButton(wrapper, '上移路径点', 0).attributes('disabled'),
    ).toBeDefined()
    expect(
      rowButton(wrapper, '下移路径点', 1).attributes('disabled'),
    ).toBeDefined()
  })

  it('整份换新数组，不就地改 props', async () => {
    const path = ['a1', 'a2']
    const wrapper = mountField(path)
    await rowButton(wrapper, '移除路径点', 0).trigger('click')

    expect(path).toEqual(['a1', 'a2'])
  })
})

describe('锚点的显示名', () => {
  it('没名字的锚点退回「锚点 N」，不显示裸 id', () => {
    const wrapper = mountField(['a3'])

    expect(wrapper.text()).toContain('锚点 3')
    expect(wrapper.text()).not.toContain('a3')
  })

  it('场景里一个锚点都没有时给一句能看的空态', () => {
    const wrapper = mountField([], [])

    // 面板寸土寸金：空态走行内单行档，不带图标
    const empty = wrapper.get('.dt-empty--inline')
    expect(empty.text()).toContain('还没有锚点')
    expect(empty.find('svg').exists()).toBe(false)
  })
})
