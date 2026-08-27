/**
 * @fileoverview 契约：多层阴影的增删改与调序，新层落地就看得见，颜色一律经消毒。
 *
 * ⚠ 新层若照归一化缺省来（全 0），加一层等于什么都没发生，用户只会以为按钮坏了。
 * ⚠ 每层的 id 是 v-for 的 key 也是去重依据，新层不许与已有的重名。
 */
import type { Twin2dShadow } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ShadowList from '@/pages/Twin2dEditor/components/fields/ShadowList.vue'

function shadow(over: Partial<Twin2dShadow> = {}): Twin2dShadow {
  return {
    id: 's1',
    inset: false,
    x: 0,
    y: 0,
    blur: 0,
    spread: 0,
    color: 'currentColor',
    ...over,
  }
}

function mountList(rows: readonly Twin2dShadow[]) {
  return mount(ShadowList, { props: { modelValue: rows, hint: '还没有阴影' } })
}

type Wrapper = ReturnType<typeof mountList>

function lastWrite(wrapper: Wrapper): readonly Twin2dShadow[] {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回阴影表')
  return events[events.length - 1]?.[0] as readonly Twin2dShadow[]
}

describe('增删', () => {
  it('空表时只给说明与新增键', () => {
    const wrapper = mountList([])

    expect(wrapper.text()).toContain('还没有阴影')
    expect(wrapper.find('[data-test="shadow-add"]').exists()).toBe(true)
  })

  // ⚠ 全 0 的阴影加了等于没加
  it('新增一层落在末尾且落地就看得见', async () => {
    const wrapper = mountList([shadow()])

    await wrapper.find('[data-test="shadow-add"]').trigger('click')
    const rows = lastWrite(wrapper)

    expect(rows).toHaveLength(2)
    expect(rows[1]?.y).toBeGreaterThan(0)
    expect(rows[1]?.blur).toBeGreaterThan(0)
  })

  it('新层的 id 不与已有的重名', async () => {
    const wrapper = mountList([shadow({ id: 'shadow-aaaaaa' })])

    await wrapper.find('[data-test="shadow-add"]').trigger('click')
    const rows = lastWrite(wrapper)

    expect(rows[1]?.id).not.toBe('shadow-aaaaaa')
    expect(rows[1]?.id).not.toBe('')
  })

  it('删除只删被点名的那一层', async () => {
    const wrapper = mountList([shadow(), shadow({ id: 's2' })])

    await wrapper.find('[data-test="shadow-remove-s1"]').trigger('click')

    expect(lastWrite(wrapper).map((row) => row.id)).toEqual(['s2'])
  })
})

describe('改值', () => {
  it('内外阴影是一个开关，只改被点名的那一层', async () => {
    const wrapper = mountList([shadow(), shadow({ id: 's2' })])

    await wrapper.find('[data-test="shadow-inset-s2"] input').setValue(true)
    const rows = lastWrite(wrapper)

    expect(rows[1]?.inset).toBe(true)
    expect(rows[0]?.inset).toBe(false)
  })

  it('四格几何各写各的', async () => {
    const wrapper = mountList([shadow()])

    await wrapper.find('[data-test="shadow-x-s1"]').setValue('4')
    expect(lastWrite(wrapper)[0]?.x).toBe(4)

    await wrapper.find('[data-test="shadow-spread-s1"]').setValue('-2')
    expect(lastWrite(wrapper)[0]?.spread).toBe(-2)
  })

  // ⚠ 负模糊在 CSS 里是非法声明、整条被忽略，看着像「阴影没生效」
  it('模糊夹在非负', async () => {
    const wrapper = mountList([shadow({ blur: 6 })])

    await wrapper.find('[data-test="shadow-blur-s1"]').setValue('-3')

    expect(lastWrite(wrapper)[0]?.blur).toBe(0)
  })

  it('颜色经消毒，外链回落到取自身文字色', async () => {
    const wrapper = mountList([shadow()])

    await wrapper
      .find('[data-test="shadow-row-s1"] .dt-color__text input')
      .setValue('url(a.png)')

    expect(lastWrite(wrapper)[0]?.color).toBe('currentColor')
  })
})

describe('调序', () => {
  it('上移与相邻那层对调', async () => {
    const wrapper = mountList([shadow(), shadow({ id: 's2' })])

    await wrapper.find('[data-test="shadow-up-s2"]').trigger('click')

    expect(lastWrite(wrapper).map((row) => row.id)).toEqual(['s2', 's1'])
  })

  it('下移与相邻那层对调', async () => {
    const wrapper = mountList([shadow(), shadow({ id: 's2' })])

    await wrapper.find('[data-test="shadow-down-s1"]').trigger('click')

    expect(lastWrite(wrapper).map((row) => row.id)).toEqual(['s2', 's1'])
  })

  it('首层上移与末层下移都禁用', () => {
    const wrapper = mountList([shadow(), shadow({ id: 's2' })])

    expect(
      wrapper.find('[data-test="shadow-up-s1"]').attributes('disabled'),
    ).toBeDefined()
    expect(
      wrapper.find('[data-test="shadow-down-s2"]').attributes('disabled'),
    ).toBeDefined()
  })
})

describe('合并撤销的出口', () => {
  it('颜色格失焦时把 blur 转出来', async () => {
    const wrapper = mountList([shadow()])

    await wrapper
      .find('[data-test="shadow-row-s1"] .dt-t2-color')
      .trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
