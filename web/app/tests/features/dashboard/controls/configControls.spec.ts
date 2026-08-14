/**
 * @fileoverview 契约：每一档配置控件读得出当前值、抛得出 `update(值, 是不是连续输入)`，
 * 递归字段到顶降级成 JSON 编辑，且 JSON 解不出来时**不写回**只挂错误——
 * 静默丢弃用户的输入等于「我改了但没反应」。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ConfigField } from '@dt/contracts'
import { __resetConfigControls } from '@dt/modules'
import { DtSelect } from '@dt/ui'

import { installConfigControls } from '@/features/dashboard/configControls'
import ConfigFieldControl from '@/features/dashboard/controls/ConfigFieldControl.vue'

function field(
  over: Partial<ConfigField> & Pick<ConfigField, 'type'>,
): ConfigField {
  return { key: 'demo', label: '演示', ...over }
}

function mountField(target: ConfigField, value: unknown, depth = 0) {
  return mount(ConfigFieldControl, { props: { field: target, value, depth } })
}

/** 最后一次抛出的 `update`。 */
function lastUpdate(wrapper: ReturnType<typeof mountField>): unknown[] {
  const events = wrapper.emitted('update') ?? []
  return events.at(-1) ?? []
}

beforeEach(() => {
  __resetConfigControls()
  installConfigControls()
})

describe('文本与颜色', () => {
  it('文本读当前值，打字算连续输入', async () => {
    const wrapper = mountField(field({ type: 'string' }), '旧')

    expect(
      (wrapper.find('.dt-input__el').element as HTMLInputElement).value,
    ).toBe('旧')
    await wrapper.find('.dt-input__el').setValue('新')

    expect(lastUpdate(wrapper)).toEqual(['新', true])
  })

  it('值不是字符串时回落成空串，而不是把面板打不开', () => {
    const wrapper = mountField(field({ type: 'string' }), { oops: true })

    expect(
      (wrapper.find('.dt-input__el').element as HTMLInputElement).value,
    ).toBe('')
  })

  it('颜色也是连续输入', async () => {
    const wrapper = mountField(field({ type: 'color' }), '#101010')

    await wrapper.find('.dt-input__el').setValue('#202020')

    expect(lastUpdate(wrapper)).toEqual(['#202020', true])
  })
})

describe('数字与滑杆', () => {
  it('数字读当前值并按连续输入抛出', async () => {
    const wrapper = mountField(
      field({ type: 'number', min: 0, max: 100, step: 1 }),
      12,
    )

    await wrapper.find('.dt-number__el').setValue('34')

    expect(lastUpdate(wrapper)).toEqual([34, true])
  })

  it('非有限数按没配过处理，不显示成 NaN', () => {
    const wrapper = mountField(field({ type: 'number' }), Number.NaN)

    expect(
      (wrapper.find('.dt-number__el').element as HTMLInputElement).value,
    ).toBe('')
  })

  it('滑杆缺省落在下限上', () => {
    const wrapper = mountField(field({ type: 'range', min: 5, max: 50 }), null)

    expect(wrapper.find('input[type="range"]').attributes('value')).toBe('5')
  })
})

describe('开关与枚举', () => {
  it('开关是离散动作，不参与合并', async () => {
    const wrapper = mountField(field({ type: 'boolean' }), false)

    await wrapper.find('button[role="switch"]').trigger('click')

    expect(lastUpdate(wrapper)).toEqual([true, false])
  })

  it('只认真正的布尔，字符串 true 一律按关', () => {
    const wrapper = mountField(field({ type: 'boolean' }), 'true')

    expect(
      wrapper.find('button[role="switch"]').attributes('aria-checked'),
    ).toBe('false')
  })

  it('枚举写回原始取值而不是它的字符串键', async () => {
    const wrapper = mountField(
      field({
        type: 'enum',
        options: [
          { value: 1, label: '运行' },
          { value: 0, label: '停机' },
        ],
      }),
      1,
    )
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', '0')
    await wrapper.vm.$nextTick()

    expect(lastUpdate(wrapper)).toEqual([0, false])
  })
})

describe('对象与数组', () => {
  it('对象按 fields 摊出子表单，改子键写回整块', async () => {
    const wrapper = mountField(
      field({
        type: 'object',
        fields: [{ key: 'pad', label: '内边距', type: 'number' }],
      }),
      { pad: 4 },
    )

    await wrapper.find('.dt-number__el').setValue('9')

    expect(lastUpdate(wrapper)).toEqual([{ pad: 9 }, true])
  })

  it('对象没声明 fields 时降级成 JSON 编辑，而不是画成空白', () => {
    const wrapper = mountField(field({ type: 'object' }), { any: 1 })

    expect(wrapper.find('textarea').exists()).toBe(true)
  })

  it('JSON 解不出来时不写回，只挂一条错误', async () => {
    const wrapper = mountField(field({ type: 'object' }), { any: 1 })

    await wrapper.find('textarea').setValue('{ 坏掉的 json')

    expect(wrapper.emitted('update')).toBeUndefined()
    expect(wrapper.text()).toContain('不是合法的 JSON')
  })

  it('JSON 清空即取消这一项的配置', async () => {
    const wrapper = mountField(field({ type: 'object' }), { any: 1 })

    await wrapper.find('textarea').setValue('   ')

    expect(lastUpdate(wrapper)).toEqual([undefined, false])
  })

  it('数组按 itemSchema 摊行，增删行是离散动作', async () => {
    const target = field({
      type: 'array',
      itemSchema: [{ key: 'label', label: '名称', type: 'string' }],
      itemLabelKey: 'label',
    })
    const wrapper = mountField(target, [{ label: '一' }])
    const add = wrapper
      .findAll('button')
      .find((item) => item.text().includes('新增一行'))

    await add?.trigger('click')

    expect(lastUpdate(wrapper)).toEqual([[{ label: '一' }, {}], false])
  })

  it('数组行标题取 itemLabelKey 指的子字段', () => {
    const wrapper = mountField(
      field({
        type: 'array',
        itemSchema: [{ key: 'label', label: '名称', type: 'string' }],
        itemLabelKey: 'label',
      }),
      [{ label: '甲' }],
    )

    expect(wrapper.text()).toContain('甲')
  })

  it('数组没声明行内字段时说清楚，而不是给一个空框', () => {
    const wrapper = mountField(field({ type: 'array' }), [])

    expect(wrapper.text()).toContain('没声明行内字段')
  })

  it('删一行写回去的是少了那一行的整表', async () => {
    const wrapper = mountField(
      field({
        type: 'array',
        itemSchema: [{ key: 'label', label: '名称', type: 'string' }],
      }),
      [{ label: '一' }, { label: '二' }],
    )
    const remove = wrapper
      .findAll('button')
      .filter((item) => item.attributes('aria-label') === '删除这一行')

    await remove[0]?.trigger('click')

    expect(lastUpdate(wrapper)).toEqual([[{ label: '二' }], false])
  })
})

describe('递归深度', () => {
  it('到顶之后带子结构的字段降级成 JSON 编辑', () => {
    const wrapper = mountField(
      field({
        type: 'object',
        fields: [{ key: 'pad', label: '内边距', type: 'number' }],
      }),
      { pad: 1 },
      3,
    )

    expect(wrapper.find('textarea').exists()).toBe(true)
  })

  it('到顶但没有子结构的字段照常渲染自己的控件', () => {
    const wrapper = mountField(field({ type: 'string' }), '值', 9)

    expect(wrapper.find('.dt-input__el').exists()).toBe(true)
  })
})
