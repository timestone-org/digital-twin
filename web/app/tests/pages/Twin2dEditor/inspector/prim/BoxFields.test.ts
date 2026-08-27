/**
 * @fileoverview 契约：盒那一档的排布六项、填充、边框、圆角、阴影、背板模糊、裁剪与
 * 光标都改得到，基类那十五项一并摆在最前，子树不在这一面上改。
 *
 * ⚠ 子树的增删与调序要拦深度与成环，那是 primOps 三支的事；摆在这里会出现两条互不
 * 知情的写路径。
 */
import { normalizePrims } from '@dt/twin2d'
import type { Twin2dBoxPrim, Twin2dPrim } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BoxFields from '@/pages/Twin2dEditor/components/inspector/prim/BoxFields.vue'

function boxPrim(over: Readonly<Record<string, unknown>> = {}): Twin2dBoxPrim {
  const one = normalizePrims([{ id: 'p1', kind: 'box', ...over }], 0)[0]
  if (one === undefined || one.kind !== 'box') throw new Error('样例盒没造出来')
  return one
}

function mountFields(modelValue: Twin2dBoxPrim = boxPrim()) {
  return mount(BoxFields, { props: { modelValue } })
}

type Wrapper = ReturnType<typeof mountFields>

function lastWrite(wrapper: Wrapper): Twin2dBoxPrim {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回盒')
  const one = events[events.length - 1]?.[0] as Twin2dPrim
  if (one.kind !== 'box') throw new Error('写回的不是盒')
  return one
}

/** 按 data-test 取那一个下拉。 */
function selectAt(wrapper: Wrapper, test: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((one) => one.attributes('data-test') === test)
  if (found === undefined) throw new Error(`没有 ${test} 这个下拉`)
  return found
}

describe('排布', () => {
  it('排流三档写回', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'box-flow').vm.$emit('update:modelValue', 'col')

    expect(lastWrite(wrapper).layout.flow).toBe('col')
  })

  it('两条对齐各写各的', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'box-align').vm.$emit('update:modelValue', 'center')
    expect(lastWrite(wrapper).layout.align).toBe('center')

    selectAt(wrapper, 'box-justify').vm.$emit('update:modelValue', 'between')
    expect(lastWrite(wrapper).layout.justify).toBe('between')
  })

  it('认不出的档位一概不写回', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'box-flow').vm.$emit('update:modelValue', 'nope')
    selectAt(wrapper, 'box-align').vm.$emit('update:modelValue', 'nope')
    selectAt(wrapper, 'box-justify').vm.$emit('update:modelValue', 'nope')
    selectAt(wrapper, 'box-cursor').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('间距不许为负', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="box-gap"]').setValue('-4')

    expect(lastWrite(wrapper).layout.gap).toBe(0)
  })

  it('换行是一个开关', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="box-wrap"] input').setValue(true)

    expect(lastWrite(wrapper).layout.wrap).toBe(true)
  })

  // ⚠ 次序是 t / r / b / l，调换两项在方形上看不出来
  it('四向内边距按上右下左各写各的', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="box-pad-1"]').setValue('6')

    expect(lastWrite(wrapper).layout.pad).toEqual([0, 6, 0, 0])
  })
})

describe('外观', () => {
  it('填充表整份换', async () => {
    const wrapper = mountFields()

    await wrapper
      .find('[data-test="box-fills"] [data-test="fill-add"]')
      .trigger('click')

    expect(lastWrite(wrapper).fills).toHaveLength(1)
  })

  it('边框那一格写回边框', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="border-width"]').setValue('2')

    expect(lastWrite(wrapper).border.width).toBe(2)
  })

  it('圆角那一格写回圆角', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'radius-form').vm.$emit('update:modelValue', 'pill')

    expect(lastWrite(wrapper).radius).toBe('pill')
  })

  it('阴影表整份换', async () => {
    const wrapper = mountFields()

    await wrapper
      .find('[data-test="box-shadows"] [data-test="shadow-add"]')
      .trigger('click')

    expect(lastWrite(wrapper).shadows).toHaveLength(1)
  })
})

describe('其它', () => {
  it('背板模糊不许为负', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="box-blur"]').setValue('-2')

    expect(lastWrite(wrapper).backdropBlur).toBe(0)
  })

  // ⚠ 自己这一层不透时背板模糊一点变化都没有，而每一格取值单看都对
  it('填充不透且配了模糊时给一句说明', () => {
    const opaque = boxPrim({
      backdropBlur: 6,
      fills: [{ kind: 'solid', id: 'f1', color: 'red', opacity: 1 }],
    })

    expect(mountFields(opaque).text()).toContain('透得出东西')
    expect(mountFields().text()).not.toContain('透得出东西')
  })

  it('裁剪是一个开关', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="box-clip"] input').setValue(true)

    expect(lastWrite(wrapper).clip).toBe(true)
  })

  it('光标三档写回', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'box-cursor').vm.$emit('update:modelValue', 'pointer')

    expect(lastWrite(wrapper).cursor).toBe('pointer')
  })
})

describe('基类与子树', () => {
  it('基类那一段的改动连着盒自己的字段一起交出去', async () => {
    const wrapper = mountFields(boxPrim({ clip: true }))

    await wrapper.find('[data-test="base-z"]').setValue('3')

    const next = lastWrite(wrapper)
    expect(next.z).toBe(3)
    expect(next.clip).toBe(true)
  })

  // ⚠ 子树只在图元树那边动，这一面上不许有入口
  it('子树原样带回，这一面上没有它的入口', async () => {
    const nested = boxPrim({ children: [{ id: 'c1', kind: 'txt' }] })
    const wrapper = mountFields(nested)

    await wrapper.find('[data-test="box-clip"] input').setValue(true)

    expect(lastWrite(wrapper).children).toHaveLength(1)
    expect(wrapper.find('[data-test="box-children"]').exists()).toBe(false)
  })
})

describe('合并撤销的出口', () => {
  it('失焦转出一次 blur', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="box-gap"]').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
