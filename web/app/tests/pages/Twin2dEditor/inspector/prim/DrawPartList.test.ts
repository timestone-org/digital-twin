/**
 * @fileoverview 契约：手绘的几笔可增删调序，一笔都不剩时当场标红，新一笔落地就看得见。
 *
 * ⚠ 一笔都没有的手绘档会被整个落回「不画图标」，图标凭空消失且零报错。
 * ⚠ 新一笔照归一化缺省来的话是 0 宽的形状，加一笔等于什么都没发生。
 */
import type { Twin2dDrawPart } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DrawPartList from '@/pages/Twin2dEditor/components/inspector/prim/DrawPartList.vue'

function part(over: Partial<Twin2dDrawPart> = {}): Twin2dDrawPart {
  return {
    shape: { kind: 'line', x1: 0, y1: 24, x2: 48, y2: 24 },
    fill: { kind: 'none' },
    strokes: [],
    ...over,
  }
}

function mountList(rows: readonly Twin2dDrawPart[] = [part()], span = 48) {
  return mount(DrawPartList, { props: { modelValue: rows, span } })
}

type Wrapper = ReturnType<typeof mountList>

function lastWrite(wrapper: Wrapper): readonly Twin2dDrawPart[] {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回手绘')
  return events[events.length - 1]?.[0] as readonly Twin2dDrawPart[]
}

describe('增删', () => {
  // ⚠ 空表的手绘档整个落回「不画图标」
  it('一笔都没有时当场标红', () => {
    const wrapper = mountList([])

    expect(wrapper.find('[data-test="draw-empty"]').exists()).toBe(true)
  })

  it('有一笔时不标红', () => {
    expect(mountList().find('[data-test="draw-empty"]').exists()).toBe(false)
  })

  it('新一笔照着画幅铺开且带一遍描边', async () => {
    const wrapper = mountList([], 64)

    await wrapper.find('[data-test="draw-add"]').trigger('click')
    const one = lastWrite(wrapper)[0]

    expect(one?.shape).toMatchObject({ kind: 'line', x2: 64 })
    expect(one?.strokes[0]?.width).toBeGreaterThan(0)
  })

  it('不给画幅时按内置图标那一档铺开', async () => {
    const wrapper = mount(DrawPartList, { props: { modelValue: [] } })

    await wrapper.find('[data-test="draw-add"]').trigger('click')
    const events = wrapper.emitted('update:modelValue')
    const rows = events?.[0]?.[0] as readonly Twin2dDrawPart[]

    expect(rows[0]?.shape).toMatchObject({ kind: 'line', x2: 48 })
  })

  it('删掉的是被点名的那一笔', async () => {
    const wrapper = mountList([
      part(),
      part({ fill: { kind: 'color', color: 'red' } }),
    ])

    await wrapper.find('[data-test="draw-remove-0"]').trigger('click')

    expect(lastWrite(wrapper)).toHaveLength(1)
    expect(lastWrite(wrapper)[0]?.fill).toEqual({ kind: 'color', color: 'red' })
  })
})

describe('调序', () => {
  it('上移与相邻那一笔对调', async () => {
    const wrapper = mountList([
      part(),
      part({ fill: { kind: 'color', color: 'red' } }),
    ])

    await wrapper.find('[data-test="draw-up-1"]').trigger('click')

    expect(lastWrite(wrapper)[0]?.fill).toEqual({ kind: 'color', color: 'red' })
  })

  it('下移与相邻那一笔对调', async () => {
    const wrapper = mountList([
      part(),
      part({ fill: { kind: 'color', color: 'red' } }),
    ])

    await wrapper.find('[data-test="draw-down-0"]').trigger('click')

    expect(lastWrite(wrapper)[0]?.fill).toEqual({ kind: 'color', color: 'red' })
  })

  it('第一笔上移与最后一笔下移都禁用', () => {
    const wrapper = mountList([part(), part()])

    expect(
      wrapper.find('[data-test="draw-up-0"]').attributes('disabled'),
    ).toBeDefined()
    expect(
      wrapper.find('[data-test="draw-down-1"]').attributes('disabled'),
    ).toBeDefined()
  })
})

describe('改一笔', () => {
  it('几何写回那一笔', async () => {
    const wrapper = mountList()

    await wrapper
      .find('[data-test="draw-part-0"] [data-test="geometry-x2"]')
      .setValue('30')

    expect(lastWrite(wrapper)[0]?.shape).toMatchObject({ x2: 30 })
  })

  it('填充写回那一笔', async () => {
    const wrapper = mountList([part({ fill: { kind: 'color', color: 'red' } })])

    await wrapper
      .find('[data-test="draw-part-0"] .dt-color__text input')
      .setValue('url(a.png)')

    expect(lastWrite(wrapper)[0]?.fill).toEqual({
      kind: 'color',
      color: 'currentColor',
    })
  })

  it('描边写回那一笔', async () => {
    const wrapper = mountList()

    await wrapper
      .find('[data-test="draw-part-0"] [data-test="stroke-add"]')
      .trigger('click')

    expect(lastWrite(wrapper)[0]?.strokes).toHaveLength(1)
  })

  it('坐标是 viewBox 像素这件事写在面上', () => {
    expect(mountList().text()).toContain('viewBox 像素')
  })
})

describe('合并撤销的出口', () => {
  it('失焦转出一次 blur', async () => {
    const wrapper = mountList()

    await wrapper.find('[data-test="geometry-x2"]').trigger('focusout')

    expect((wrapper.emitted('blur') ?? []).length).toBeGreaterThan(0)
  })
})
