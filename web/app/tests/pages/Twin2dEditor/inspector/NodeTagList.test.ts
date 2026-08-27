/**
 * @fileoverview 契约：节点的 `tags` 是自由字符串键值对——**不做白名单**（做了就等于
 * 把子类重新钉死成枚举），值逐键写回并成一帧撤销，键是身份不许就地改。
 *
 * ⚠ 值逐键写回时不许 trim：trim 了再回填 DOM，空格键就永远打不出来。
 * ⚠ 键与值都截到 `TWIN_2D_MAX_TAG_LENGTH`：超出的那截在归一化那一步会被无声砍掉，
 * 面板上先砍才看得见。
 */
import { TWIN_2D_MAX_TAG_LENGTH } from '@dt/twin2d'
import { DtButton } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NodeTagList from '@/pages/Twin2dEditor/components/inspector/NodeTagList.vue'

function mountList(tags: Readonly<Record<string, string>> = {}) {
  return mount(NodeTagList, { props: { modelValue: tags } })
}

type Wrapper = ReturnType<typeof mountList>

/** 最后一次写回的标签表与合并键。 */
function lastUpdate(
  wrapper: Wrapper,
): [Readonly<Record<string, string>>, string | null] {
  const events = wrapper.emitted('update')
  if (!events?.length) throw new Error('没有写回标签')
  const last = events[events.length - 1]
  return [
    last?.[0] as Readonly<Record<string, string>>,
    last?.[1] as string | null,
  ]
}

describe('改与删', () => {
  it('没有标签时给一行空态', () => {
    expect(mountList().find('[data-test="tag-empty"]').exists()).toBe(true)
  })

  it('在册的键逐条摆出来', () => {
    const wrapper = mountList({ subtype: 'solar', line: 'A' })

    expect(wrapper.find('[data-test="tag-row-subtype"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="tag-row-line"]').exists()).toBe(true)
  })

  it('改值逐键并成一帧，键钉在这一条标签上', async () => {
    const wrapper = mountList({ subtype: 'sol' })

    await wrapper.find('input[data-test="tag-value-subtype"]').setValue('solar')

    expect(lastUpdate(wrapper)).toEqual([{ subtype: 'solar' }, 'tag:subtype'])
  })

  // ⚠ trim 了再回填 DOM，空格键就永远打不出来
  it('改值不 trim', async () => {
    const wrapper = mountList({ line: 'A' })

    await wrapper.find('input[data-test="tag-value-line"]').setValue('A ')

    expect(lastUpdate(wrapper)[0]).toEqual({ line: 'A ' })
  })

  it('值截到长度上限', async () => {
    const wrapper = mountList({ line: '' })

    await wrapper
      .find('input[data-test="tag-value-line"]')
      .setValue('x'.repeat(TWIN_2D_MAX_TAG_LENGTH + 5))

    expect(lastUpdate(wrapper)[0]['line']).toHaveLength(TWIN_2D_MAX_TAG_LENGTH)
  })

  it('删一条只删那一条，其余顺序不变', async () => {
    const wrapper = mountList({ subtype: 'solar', line: 'A', zone: 'B' })

    await wrapper.find('[data-test="tag-remove-line"]').trigger('click')

    const [next, mergeKey] = lastUpdate(wrapper)
    expect(Object.keys(next)).toEqual(['subtype', 'zone'])
    expect(mergeKey).toBeNull()
  })

  it('焦点离开就断段', async () => {
    const wrapper = mountList({ line: 'A' })

    await wrapper.find('[data-test="tag-row-line"]').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})

describe('新增一条', () => {
  it('键空着时加不了', async () => {
    const wrapper = mountList()

    await wrapper.find('input[data-test="tag-new-value"]').setValue('solar')

    expect(
      wrapper.find('[data-test="tag-add"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('键与在册的重名时加不了', async () => {
    const wrapper = mountList({ subtype: 'solar' })

    await wrapper.find('input[data-test="tag-new-key"]').setValue('subtype')

    expect(
      wrapper.find('[data-test="tag-add"]').attributes('disabled'),
    ).toBeDefined()
  })

  // ⚠ `'toString' in obj` 对任何对象都为真：拿它判重名会让这个键永远加不进去
  it('键叫 toString 也加得进去', async () => {
    const wrapper = mountList()

    await wrapper.find('input[data-test="tag-new-key"]').setValue('toString')
    await wrapper.find('[data-test="tag-add"]').trigger('click')

    expect(lastUpdate(wrapper)[0]).toEqual({ toString: '' })
  })

  it('键落地时 trim 并截到长度上限', async () => {
    const wrapper = mountList()

    await wrapper
      .find('input[data-test="tag-new-key"]')
      .setValue(`  ${'k'.repeat(TWIN_2D_MAX_TAG_LENGTH + 3)}  `)
    await wrapper.find('input[data-test="tag-new-value"]').setValue('v')
    await wrapper.find('[data-test="tag-add"]').trigger('click')

    const keys = Object.keys(lastUpdate(wrapper)[0])
    expect(keys).toEqual(['k'.repeat(TWIN_2D_MAX_TAG_LENGTH)])
  })

  // ⚠ 原生 disabled 只挡用户点击，程序派发的 click 照样会走到处理函数里
  it('加不了的时候程序派发一次点击也不写回', () => {
    const wrapper = mountList()
    const add = wrapper
      .findAllComponents(DtButton)
      .find((item) => item.attributes('data-test') === 'tag-add')
    if (add === undefined) throw new Error('没有新增键')

    add.vm.$emit('click', new MouseEvent('click'))

    expect(wrapper.emitted('update')).toBeUndefined()
  })

  it('加完清空那两个框', async () => {
    const wrapper = mountList()

    await wrapper.find('input[data-test="tag-new-key"]').setValue('zone')
    await wrapper.find('input[data-test="tag-new-value"]').setValue('B')
    await wrapper.find('[data-test="tag-add"]').trigger('click')

    const keyBox = wrapper.find<HTMLInputElement>(
      'input[data-test="tag-new-key"]',
    )
    expect(keyBox.element.value).toBe('')
  })

  it('新增落成一步一帧，不并进任何一段', async () => {
    const wrapper = mountList({ subtype: 'solar' })

    await wrapper.find('input[data-test="tag-new-key"]').setValue('zone')
    await wrapper.find('[data-test="tag-add"]').trigger('click')

    expect(lastUpdate(wrapper)).toEqual([{ subtype: 'solar', zone: '' }, null])
  })
})
