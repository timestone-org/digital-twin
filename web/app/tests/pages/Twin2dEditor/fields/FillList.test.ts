/**
 * @fileoverview 契约：多层填充的五档画法各有各的取值，换档取的是看得见的初值，
 * 图片层缺了引用当场标红。
 *
 * ⚠ 图片层没有素材引用会被归一化整层丢掉：不标红的话，用户配好一层图片、存一次
 * 再读回来那一层凭空消失，且零报错。
 * ⚠ 渐变换过去要自带色标：一个色标都没有的渐变画出来是空的，看着像换档没生效。
 */
import type { DtSelectOption } from '@dt/contracts'
import { TWIN_2D_BACKGROUND_FITS, TWIN_2D_FILL_KINDS } from '@dt/twin2d'
import type { Twin2dFill } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FillList from '@/pages/Twin2dEditor/components/fields/FillList.vue'

const SOLID: Twin2dFill = {
  kind: 'solid',
  id: 'f1',
  color: 'currentColor',
  opacity: 1,
}

const LINEAR: Twin2dFill = {
  kind: 'linear',
  id: 'f1',
  angle: 180,
  stops: [
    { id: 'st1', color: 'red', at: 0 },
    { id: 'st2', color: 'transparent', at: 1 },
  ],
  opacity: 1,
}

const IMAGE: Twin2dFill = {
  kind: 'image',
  id: 'f1',
  ref: '',
  fit: 'cover',
  opacity: 1,
}

function mountList(rows: readonly Twin2dFill[]) {
  return mount(FillList, { props: { modelValue: rows, hint: '还没有填充' } })
}

type Wrapper = ReturnType<typeof mountList>

function lastWrite(wrapper: Wrapper): readonly Twin2dFill[] {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回填充表')
  return events[events.length - 1]?.[0] as readonly Twin2dFill[]
}

/** 按可见标签取那一个下拉——同一行里可能有两个，按序号取会跟着版式一起漂。 */
function selectBy(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('label') === label)
  if (found === undefined) throw new Error(`没有标着「${label}」的下拉`)
  return found
}

describe('五档画法', () => {
  it('五档一档不少', () => {
    const options: readonly DtSelectOption[] = selectBy(
      mountList([SOLID]),
      '画法',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_FILL_KINDS,
    ])
  })

  // ⚠ 一个色标都没有的渐变画出来是空的，看着像换档没生效
  it('换成渐变时自带两档色标', () => {
    const wrapper = mountList([SOLID])

    selectBy(wrapper, '画法').vm.$emit('update:modelValue', 'linear')
    const row = lastWrite(wrapper)[0]

    expect(row?.kind).toBe('linear')
    expect(row?.kind === 'linear' ? row.stops : []).toHaveLength(2)
  })

  it('换成条纹时缝隙是正数', () => {
    const wrapper = mountList([SOLID])

    selectBy(wrapper, '画法').vm.$emit('update:modelValue', 'repeat')
    const row = lastWrite(wrapper)[0]

    expect(row?.kind === 'repeat' ? row.gap : 0).toBeGreaterThan(0)
  })

  // ⚠ 图片档换过去是没有引用的，这一层此刻还落不了盘，所以必须当场标红
  it('换成图片档时引用是空的且当场标红', async () => {
    const wrapper = mountList([SOLID])

    selectBy(wrapper, '画法').vm.$emit('update:modelValue', 'image')
    await wrapper.setProps({ modelValue: lastWrite(wrapper) })

    expect(lastWrite(wrapper)[0]).toMatchObject({ kind: 'image', ref: '' })
    expect(wrapper.text()).toContain('整层丢掉')
  })

  it('换档时不透明度留着', () => {
    const wrapper = mountList([{ ...SOLID, opacity: 0.3 }])

    selectBy(wrapper, '画法').vm.$emit('update:modelValue', 'radial')

    expect(lastWrite(wrapper)[0]?.opacity).toBe(0.3)
  })

  it('换成同一档与认不出的档位都不写回', () => {
    const wrapper = mountList([SOLID])

    selectBy(wrapper, '画法').vm.$emit('update:modelValue', 'solid')
    selectBy(wrapper, '画法').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('各档取值', () => {
  it('纯色档的颜色经消毒', async () => {
    const wrapper = mountList([SOLID])

    await wrapper
      .find('[data-test="fill-row-f1"] .dt-color__text input')
      .setValue('url(a.png)')

    expect(lastWrite(wrapper)[0]).toEqual({ ...SOLID, color: 'currentColor' })
  })

  it('线性渐变的角度写回', async () => {
    const wrapper = mountList([LINEAR])

    await wrapper.find('[data-test="fill-angle-f1"]').setValue('90')

    expect(lastWrite(wrapper)[0]?.kind === 'linear').toBe(true)
    expect(lastWrite(wrapper)[0]).toMatchObject({ angle: 90 })
  })

  it('径向渐变的圆心与半径夹在 0 到 1 之间', async () => {
    const wrapper = mountList([
      {
        kind: 'radial',
        id: 'f1',
        cx: 0.5,
        cy: 0.5,
        r: 0.5,
        stops: [],
        opacity: 1,
      },
    ])

    await wrapper.find('[data-test="fill-cx-f1"]').setValue('9')
    expect(lastWrite(wrapper)[0]).toMatchObject({ cx: 1 })

    await wrapper.find('[data-test="fill-cy-f1"]').setValue('-1')
    expect(lastWrite(wrapper)[0]).toMatchObject({ cy: 0 })

    await wrapper.find('[data-test="fill-r-f1"]').setValue('0.8')
    expect(lastWrite(wrapper)[0]).toMatchObject({ r: 0.8 })
  })

  it('条纹档的三格几何各写各的', async () => {
    const wrapper = mountList([
      {
        kind: 'repeat',
        id: 'f1',
        angle: 45,
        color: 'currentColor',
        width: 1,
        gap: 4,
        opacity: 1,
      },
    ])

    await wrapper.find('[data-test="fill-repeat-gap-f1"]').setValue('9')
    expect(lastWrite(wrapper)[0]).toMatchObject({ gap: 9 })

    await wrapper.find('[data-test="fill-repeat-angle-f1"]').setValue('90')
    expect(lastWrite(wrapper)[0]).toMatchObject({ angle: 90 })

    await wrapper.find('[data-test="fill-repeat-width-f1"]').setValue('3')
    expect(lastWrite(wrapper)[0]).toMatchObject({ width: 3 })

    await wrapper
      .find('[data-test="fill-row-f1"] .dt-color__text input')
      .setValue('red')
    expect(lastWrite(wrapper)[0]).toMatchObject({ color: 'red' })
  })

  it('不透明度写回', async () => {
    const wrapper = mountList([SOLID])

    await wrapper.find('[data-test="fill-opacity-f1"]').setValue('0.25')

    expect(lastWrite(wrapper)[0]?.opacity).toBe(0.25)
  })
})

describe('图片档', () => {
  // ⚠ 不标红的话这一层会在存盘时凭空消失
  it('缺了引用当场标红，写明后果', () => {
    const wrapper = mountList([IMAGE])

    expect(wrapper.text()).toContain('整层丢掉')
  })

  it('填了引用就不再标红', () => {
    const wrapper = mountList([{ ...IMAGE, ref: 'asset:abc' }])

    expect(wrapper.text()).not.toContain('整层丢掉')
  })

  it('四档铺法一档不少', () => {
    const options: readonly DtSelectOption[] = selectBy(
      mountList([IMAGE]),
      '铺法',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_BACKGROUND_FITS,
    ])
  })

  it('选一档铺法写回那一档', () => {
    const wrapper = mountList([IMAGE])

    selectBy(wrapper, '铺法').vm.$emit('update:modelValue', 'tile')

    expect(lastWrite(wrapper)[0]).toMatchObject({ fit: 'tile' })
  })

  it('认不出的铺法不写回', () => {
    const wrapper = mountList([IMAGE])

    selectBy(wrapper, '铺法').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('引用写回', async () => {
    const wrapper = mountList([IMAGE])

    await wrapper.find('[data-test="fill-ref-f1"]').setValue('asset:abc')

    expect(lastWrite(wrapper)[0]).toMatchObject({ ref: 'asset:abc' })
  })
})

describe('色标子表', () => {
  it('每档色标一行，颜色与位置各一格', () => {
    const wrapper = mountList([LINEAR])

    expect(wrapper.findAll('[data-test^="fill-stop-st"]')).toHaveLength(2)
  })

  it('改一档色标的位置', async () => {
    const wrapper = mountList([LINEAR])

    await wrapper.find('[data-test="fill-stop-at-st2"]').setValue('0.6')

    expect(lastWrite(wrapper)[0]).toMatchObject({
      stops: [
        { id: 'st1', color: 'red', at: 0 },
        { id: 'st2', color: 'transparent', at: 0.6 },
      ],
    })
  })

  it('改一档色标的颜色，同层其余色标不动', async () => {
    const wrapper = mountList([LINEAR])

    await wrapper
      .find('[data-test="fill-stop-st1"] .dt-color__text input')
      .setValue('blue')

    expect(lastWrite(wrapper)[0]).toMatchObject({
      stops: [
        { id: 'st1', color: 'blue', at: 0 },
        { id: 'st2', color: 'transparent', at: 1 },
      ],
    })
  })

  it('新增一档色标追加在末尾', async () => {
    const wrapper = mountList([LINEAR])

    await wrapper.find('[data-test="fill-stop-add-f1"]').trigger('click')
    const row = lastWrite(wrapper)[0]

    expect(row?.kind === 'linear' ? row.stops : []).toHaveLength(3)
  })

  it('删一档色标只删那一档', async () => {
    const wrapper = mountList([LINEAR])

    await wrapper.find('[data-test="fill-stop-remove-st1"]').trigger('click')
    const row = lastWrite(wrapper)[0]

    expect(
      (row?.kind === 'linear' ? row.stops : []).map((stop) => stop.id),
    ).toEqual(['st2'])
  })

  it('纯色档不摆色标子表', () => {
    const wrapper = mountList([SOLID])

    expect(wrapper.find('[data-test="fill-stop-add-f1"]').exists()).toBe(false)
  })
})

describe('增删与调序', () => {
  it('空表时只给说明与新增键', () => {
    const wrapper = mountList([])

    expect(wrapper.text()).toContain('还没有填充')
    expect(wrapper.find('[data-test="fill-add"]').exists()).toBe(true)
  })

  it('新增一层是纯色档且 id 不重名', async () => {
    const wrapper = mountList([SOLID])

    await wrapper.find('[data-test="fill-add"]').trigger('click')
    const rows = lastWrite(wrapper)

    expect(rows).toHaveLength(2)
    expect(rows[1]?.kind).toBe('solid')
    expect(rows[1]?.id).not.toBe('f1')
  })

  it('删除只删被点名的那一层', async () => {
    const wrapper = mountList([SOLID, { ...SOLID, id: 'f2' }])

    await wrapper.find('[data-test="fill-remove-f1"]').trigger('click')

    expect(lastWrite(wrapper).map((row) => row.id)).toEqual(['f2'])
  })

  it('上下各挪一格，首尾禁用', async () => {
    const wrapper = mountList([SOLID, { ...SOLID, id: 'f2' }])

    await wrapper.find('[data-test="fill-up-f2"]').trigger('click')
    expect(lastWrite(wrapper).map((row) => row.id)).toEqual(['f2', 'f1'])

    expect(
      wrapper.find('[data-test="fill-up-f1"]').attributes('disabled'),
    ).toBeDefined()
    expect(
      wrapper.find('[data-test="fill-down-f2"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('焦点离开时抛 blur', async () => {
    const wrapper = mountList([SOLID])

    await wrapper.find('.flex').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
