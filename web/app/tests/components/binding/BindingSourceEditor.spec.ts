/**
 * @fileoverview 契约：一条绑定按来源种类要填的那几项。
 * ⚠ 常量的 `0` / `false` / `''` 都是合法取值：清空输入写的是 `null`（= 没配过），
 * 把 falsy 当成「没配」会让一整屏的零值消失。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type {
  BindingPayload,
  BindingSourceKind,
  BindingSpec,
  CollectAggregate,
} from '@dt/contracts'
import { BINDING_SOURCE_KINDS } from '@dt/contracts'
import { DtSelect } from '@dt/ui'

import BindingSourceEditor from '@/components/binding/BindingSourceEditor.vue'
import { TREND_BUCKET_AUTO } from '@/features/trend/trendBucket'

function binding(over: Partial<BindingPayload> = {}): BindingPayload {
  return {
    id: 'b1',
    nodeId: 'n1',
    fieldKey: 'value',
    sourceKind: 'static',
    nodeKey: null,
    staticValueJson: null,
    computeJson: null,
    detailJson: null,
    transformJson: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

function spec(dataType: BindingSpec['dataType']): BindingSpec {
  return { key: 'value', label: '数值', dataType }
}

function mountEditor(
  current: BindingPayload,
  dataType: BindingSpec['dataType'] = 'string',
  siblingKeys: string[] = [],
) {
  return mount(BindingSourceEditor, {
    props: { spec: spec(dataType), binding: current, siblingKeys },
  })
}

/** 最后一次写回去的绑定。 */
function written(wrapper: ReturnType<typeof mountEditor>): BindingPayload {
  const events = wrapper.emitted('write') ?? []
  return (events.at(-1)?.[0] ?? binding()) as BindingPayload
}

describe('实时点位', () => {
  it('还没挑点时说清楚，挑点键抛 pick', async () => {
    const wrapper = mountEditor(binding({ sourceKind: 'opcua' }))

    expect(wrapper.text()).toContain('还没挑点位')
    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('挑点位'))
      ?.trigger('click')

    expect(wrapper.emitted('pick')).toHaveLength(1)
  })

  it('挑过点之后把点位身份显示出来', () => {
    const wrapper = mountEditor(
      binding({ sourceKind: 'opcua', nodeKey: 's1:temp' }),
    )

    expect(wrapper.text()).toContain('s1:temp')
  })
})

describe('常量', () => {
  it('数值槽用数字输入，写回去的是数', async () => {
    const wrapper = mountEditor(binding(), 'number')

    await wrapper.find('.dt-number__el').setValue('12')

    expect(written(wrapper).staticValueJson).toBe(12)
  })

  it('清空数值写回 null，而不是 0', async () => {
    const wrapper = mountEditor(binding({ staticValueJson: 12 }), 'number')

    await wrapper.find('.dt-number__el').setValue('')

    expect(written(wrapper).staticValueJson).toBeNull()
  })

  it('布尔槽用开关，关掉写回 false 而不是没配', async () => {
    const wrapper = mountEditor(binding({ staticValueJson: true }), 'boolean')

    await wrapper.find('button[role="switch"]').trigger('click')

    expect(written(wrapper).staticValueJson).toBe(false)
  })

  it('文本槽写回字符串，空串也是合法取值', async () => {
    const wrapper = mountEditor(binding({ staticValueJson: '甲' }))

    await wrapper.find('.dt-input__el').setValue('')

    expect(written(wrapper).staticValueJson).toBe('')
  })
})

describe('派生', () => {
  it('挑运算符时保留已选的输入', async () => {
    const wrapper = mountEditor(
      binding({
        sourceKind: 'computed',
        computeJson: { op: 'sum', inputs: ['a'] },
      }),
      'number',
      ['a', 'b'],
    )

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'avg')
    await wrapper.vm.$nextTick()

    expect(written(wrapper).computeJson).toEqual({ op: 'avg', inputs: ['a'] })
  })

  it('认不出的运算符不写回去', async () => {
    const wrapper = mountEditor(
      binding({
        sourceKind: 'computed',
        computeJson: { op: 'sum', inputs: [] },
      }),
      'number',
    )

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'nope')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('write')).toBeUndefined()
  })

  it('勾一个同级槽把它加进输入，取消勾选就移出去', async () => {
    const wrapper = mountEditor(
      binding({
        sourceKind: 'computed',
        computeJson: { op: 'sum', inputs: [] },
      }),
      'number',
      ['a', 'b'],
    )
    const boxes = wrapper.findAll('input[type="checkbox"]')

    await boxes[0]?.setValue(true)
    expect(written(wrapper).computeJson?.inputs).toEqual(['a'])

    await wrapper.setProps({
      binding: binding({
        sourceKind: 'computed',
        computeJson: { op: 'sum', inputs: ['a'] },
      }),
    })
    await wrapper.findAll('input[type="checkbox"]')[0]?.setValue(false)

    expect(written(wrapper).computeJson?.inputs).toEqual([])
  })
})

describe('历史序列', () => {
  it('改相对窗时把点位身份一起带上，不把它丢掉', async () => {
    const wrapper = mountEditor(
      binding({
        sourceKind: 'archive',
        detailJson: { nodeKey: 's1:temp', range: { lastWindow: '1h' } },
      }),
    )

    await wrapper.find('.dt-input__el').setValue('7d')

    expect(written(wrapper).detailJson).toEqual({
      nodeKey: 's1:temp',
      range: { lastWindow: '7d' },
    })
  })

  it('还没挑点时挑点键照样抛 pick', async () => {
    const wrapper = mountEditor(binding({ sourceKind: 'archive' }))

    expect(wrapper.text()).toContain('还没挑点位')
    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('挑点位'))
      ?.trigger('click')

    expect(wrapper.emitted('pick')).toHaveLength(1)
  })
})

/**
 * 分桶取数口径：取点间隔（桶宽）与折算（聚合档位）。
 * ⚠ 档位不是装饰：温度看 avg、电量这类累积量看 max，拿平均去读一条累积曲线
 * 会画出一条压扁了的假线，而数值本身完全合法——错了在图上看不出来。
 */
describe('分桶取数口径', () => {
  /** 分桶取数口径的三项加相对窗，缺席即没配过。 */
  interface Bucketing {
    interval?: string
    aggregate?: CollectAggregate
    timezone?: string
    lastWindow?: string
  }

  /** 点位历史那一支，带上已经配好的分桶口径。 */
  function archive(over: Bucketing = {}): BindingPayload {
    const { lastWindow = '24h', ...bucketing } = over
    return binding({
      sourceKind: 'archive',
      detailJson: { nodeKey: 's1:t1', range: { lastWindow }, ...bucketing },
    })
  }

  it('只有点位历史那一档摆出这两项', () => {
    const withPair = BINDING_SOURCE_KINDS.filter((kind) => {
      const text = mountEditor(binding({ sourceKind: kind })).text()
      return text.includes('取点间隔') || text.includes('折算')
    })

    expect(withPair).toEqual(['archive'])
  })

  it('没配过时桶宽停在自动档、聚合档停在跟服务端缺省走', () => {
    const wrapper = mountEditor(archive())

    expect(wrapper.text()).toContain('自动（10 分钟）')
    expect(wrapper.text()).toContain('默认（平均值）')
  })

  it('挑一档桶宽写进取数说明，已配的聚合档一起带上', async () => {
    const wrapper = mountEditor(archive({ aggregate: 'max' }))

    wrapper.findAllComponents(DtSelect)[0]?.vm.$emit('update:modelValue', '15m')
    await wrapper.vm.$nextTick()

    expect(written(wrapper).detailJson).toEqual({
      nodeKey: 's1:t1',
      range: { lastWindow: '24h' },
      interval: '15m',
      aggregate: 'max',
    })
  })

  it('挑自动档写成没有这个键，而不是存一个 auto 进去', async () => {
    const wrapper = mountEditor(archive({ interval: '15m' }))

    wrapper
      .findAllComponents(DtSelect)[0]
      ?.vm.$emit('update:modelValue', TREND_BUCKET_AUTO)
    await wrapper.vm.$nextTick()

    expect(written(wrapper).detailJson).toEqual({
      nodeKey: 's1:t1',
      range: { lastWindow: '24h' },
    })
  })

  it('挑一档聚合写进取数说明，已配的桶宽一起带上', async () => {
    const wrapper = mountEditor(archive({ interval: '15m' }))

    wrapper.findAllComponents(DtSelect)[1]?.vm.$emit('update:modelValue', 'sum')
    await wrapper.vm.$nextTick()

    expect(written(wrapper).detailJson).toEqual({
      nodeKey: 's1:t1',
      range: { lastWindow: '24h' },
      interval: '15m',
      aggregate: 'sum',
    })
  })

  it('挑「默认」写成没有这个键；认不出的档位同样不写', async () => {
    const wrapper = mountEditor(archive({ aggregate: 'max' }))
    const selects = wrapper.findAllComponents(DtSelect)

    selects[1]?.vm.$emit('update:modelValue', '')
    await wrapper.vm.$nextTick()
    expect(written(wrapper).detailJson).toEqual({
      nodeKey: 's1:t1',
      range: { lastWindow: '24h' },
    })

    selects[1]?.vm.$emit('update:modelValue', 'avgg')
    await wrapper.vm.$nextTick()
    expect(written(wrapper).detailJson).toEqual({
      nodeKey: 's1:t1',
      range: { lastWindow: '24h' },
    })
  })

  it('改相对窗时把桶宽与聚合档一起带回去', async () => {
    // ⚠ 漏了的表现是「改一下相对窗，桶宽和聚合档自己变回默认」——存得下、
    // 没有报错，只是曲线安静地换了口径
    const wrapper = mountEditor(archive({ interval: '15m', aggregate: 'max' }))

    await wrapper.find('.dt-input__el').setValue('7d')

    expect(written(wrapper).detailJson).toEqual({
      nodeKey: 's1:t1',
      range: { lastWindow: '7d' },
      interval: '15m',
      aggregate: 'max',
    })
  })

  it('日界对齐的时区没有输入框，但配过就一路带着走', async () => {
    // ⚠ 面板上只摆桶宽与聚合两项；时区由取数适配器与模块侧写入，重写取数说明
    // 时把它抹掉的话，跨零点的样本会静静落到错误的那一天
    const wrapper = mountEditor(archive({ timezone: 'Asia/Shanghai' }))

    expect(wrapper.text()).not.toContain('时区')
    await wrapper.find('.dt-input__el').setValue('7d')

    expect(written(wrapper).detailJson).toEqual({
      nodeKey: 's1:t1',
      range: { lastWindow: '7d' },
      timezone: 'Asia/Shanghai',
    })
  })

  it('桶宽档位跟着相对窗走，而不是一张固定的表', async () => {
    // ⚠ 一次聚合每个点位最多回 200 桶：24 小时最细只到 10 分钟一格，缩到
    // 1 小时才轮得到 30 秒一格。不把相对窗透进去的话，档位表永远是同一张
    const wrapper = mountEditor(archive())
    expect(wrapper.text()).toContain('自动（10 分钟）')

    await wrapper.setProps({ binding: archive({ lastWindow: '1h' }) })

    expect(wrapper.text()).toContain('自动（30 秒）')
  })
})

/**
 * ⚠ 这一段守的是「加第五种来源时这里必须跟着改」。分支用 `v-else` 兜底的话，
 * 新来源会安静地画成上一种的表单——用户填得完也存得下，只是存的是另一种来源
 * 的字段，而 typecheck 与 lint 双双放行。
 */
describe('来源逐档显式', () => {
  it('每一种登记过的来源都画得出自己的表单', () => {
    const blank = BINDING_SOURCE_KINDS.filter((kind) => {
      const wrapper = mountEditor(binding({ sourceKind: kind }))
      const text = wrapper.text()
      const hasControl = wrapper.findAll('input, button, select').length > 0
      return !hasControl && text.trim() === ''
    })

    expect(blank).toEqual([])
  })

  it('没登记过的来源响亮报错，而不是画成别的来源', () => {
    // 服务端只收登记过的四种，能走到这里的只有「本仓加了第五种却漏改本组件」
    const wrapper = mountEditor(
      binding({ sourceKind: 'mqtt' as BindingSourceKind }),
    )

    expect(wrapper.text()).toContain('没有认出的绑定来源')
  })
})
