/**
 * @fileoverview ① 区外壳：参数 chips 取的是运行时冻结的那份 config、
 * 告警只有会导致错误结论的那几条才占一整行、版面超了要收起来。
 *
 * ⚠ schema 夹具照抄后端真正导出的那一份（`registry.specs()` 的
 * `config_schema`）：手写一份漂了的，chips 上的中文名与枚举文案会整片退化成
 * 英文键名，而用例照绿。
 */
import { DtHelpTip, DtNotice, DtTag } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StepSummary from '@/pages/Modeling/Canvas/components/StepSummary.vue'
import {
  MAX_CHIPS,
  STEP_ALERTS,
  stepChipsOf,
} from '@/pages/Modeling/Canvas/scripts/stepSummary'

// clip_outlier 的 config_schema，逐字来自后端
const CLIP_SCHEMA = {
  $defs: {
    NoBoundAction: { enum: ['error', 'skip'], type: 'string' },
    OutlierMethod: { enum: ['zscore', 'iqr'], type: 'string' },
  },
  additionalProperties: false,
  description: '离群裁剪的参数。',
  properties: {
    method: {
      $ref: '#/$defs/OutlierMethod',
      default: 'zscore',
      description: 'zscore=按均值加减若干倍标准差；iqr=按四分位距向外扩若干倍',
      title: '怎么定界',
    },
    threshold: {
      default: 3.0,
      description: 'zscore 是几倍标准差，iqr 是几倍四分位距',
      exclusiveMinimum: 0.0,
      title: '倍数',
      type: 'number',
    },
    columns: {
      description: '留空表示除目标列外的全部数值列',
      items: { type: 'string' },
      title: '处理哪些列',
      type: 'array',
      'x-dt-widget': 'column',
    },
    on_no_bound: {
      $ref: '#/$defs/NoBoundAction',
      default: 'error',
      description: 'error=报错；skip=这一列原样放过不裁',
      title: '定不出界时',
    },
  },
  title: 'ClipOutlierConfig',
  type: 'object',
}

const CLIP_CONFIG = {
  method: 'iqr',
  threshold: 3.0,
  columns: ['温度', '湿度'],
  on_no_bound: 'skip',
}

function summaryOf(props: Record<string, unknown>) {
  return mount(StepSummary, { props })
}

function chipTexts(wrapper: ReturnType<typeof summaryOf>): string[] {
  return wrapper.findAllComponents(DtTag).map((one) => one.text())
}

describe('参数 chips', () => {
  it('中文名与枚举文案都取自 schema，不印英文键名', () => {
    const wrapper = summaryOf({
      config: CLIP_CONFIG,
      schema: CLIP_SCHEMA,
    })

    expect(chipTexts(wrapper)).toEqual([
      '怎么定界 按四分位距向外扩若干倍',
      '倍数 3',
      '处理哪些列 温度、湿度',
      '定不出界时 这一列原样放过不裁',
    ])
  })

  it('改过的参数与默认值分开染：默认那几个淡着摆', () => {
    const tags = summaryOf({
      config: CLIP_CONFIG,
      schema: CLIP_SCHEMA,
    }).findAllComponents(DtTag)

    // method 与 on_no_bound 被改过，threshold 与 columns 是默认
    expect(tags.map((one) => one.props('intent'))).toEqual([
      'primary',
      'neutral',
      'primary',
      'primary',
    ])
  })

  it('取不出名字的键照印不吞掉：那多半是老运行留下的参数', () => {
    const wrapper = summaryOf({
      config: { legacy_knob: 7 },
      schema: CLIP_SCHEMA,
    })

    expect(chipTexts(wrapper)).toEqual(['legacy_knob 7'])
  })

  it('一份参数都没有时那一排不摆', () => {
    expect(
      summaryOf({ gist: '这一步没有参数' }).findAllComponents(DtTag),
    ).toHaveLength(0)
  })
})

describe('chips 的取料', () => {
  it('开关印成开/关，不印 true/false', () => {
    const chips = stepChipsOf({ keep_blank: true, drop_blank: false }, {})

    expect(chips.map((one) => one.value)).toEqual(['开', '关'])
  })

  it('列名多于三项时只报个数，不把整行挤散', () => {
    const many = ['温度', '湿度', '负荷', '功率', '电压']
    const chips = stepChipsOf({ columns: many }, {})

    expect(chips[0]?.value).toBe('5 项')
  })

  it('极长的列名收省略号', () => {
    const long = '这是一个特别长的中文列名长到必须收省略号才摆得下的那一种'
    const chips = stepChipsOf({ columns: [long] }, {})

    expect(chips[0]?.value).toBe(
      '这是一个特别长的中文列名长到必须收省略号才摆得下…',
    )
  })

  it('数字数组照样列得出来，不印 [object Object]', () => {
    expect(stepChipsOf({ lags: [1, 3, 7] }, {}).at(0)?.value).toBe('1、3、7')
  })

  it('算不出来的数整条丢掉，不印一个 NaN', () => {
    expect(stepChipsOf({ ratio: Number.NaN, window: 3 }, {})).toHaveLength(1)
  })

  it('空串、空数组与 null 整条丢掉：摆一个「目标列 —」是句废话', () => {
    const chips = stepChipsOf(
      { target: '', columns: [], seed: null, window: 3 },
      {},
    )

    expect(chips.map((one) => one.key)).toEqual(['window'])
  })

  it('嵌套对象不成 chip：一个字典塞进小标签里读不出来', () => {
    expect(stepChipsOf({ plan: { ratio: 0.2 } }, {})).toEqual([])
  })

  it('schema 声明过的排在前，schema 里没有的排在后', () => {
    const chips = stepChipsOf({ legacy_knob: 7, threshold: 2 }, CLIP_SCHEMA)

    expect(chips.map((one) => one.key)).toEqual(['threshold', 'legacy_knob'])
  })
})

describe('两级告警', () => {
  it('会算错结论的那几条占一整行，且自己铺了底与边', () => {
    const wrapper = summaryOf({ operator: 'rolling_feature' })
    const rows = wrapper.findAll('.dt-ml-step__alert')

    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('滚动窗口的分母逐行不同')
    expect(wrapper.findComponent(DtNotice).props('intent')).toBe('warning')
  })

  it('四个点名的算子之外一条整行告警都不摆', () => {
    expect(
      summaryOf({ operator: 'standardize' }).findAll('.dt-ml-step__alert'),
    ).toHaveLength(0)
  })

  it('每个算子的整行告警都不超过两条：再多就会连真要紧的那条一起被略过', () => {
    for (const [code, lines] of Object.entries(STEP_ALERTS)) {
      expect(lines.length, code).toBeLessThanOrEqual(2)
    }
  })

  it('其余口径说明合进一个小问号，不占整行', () => {
    const wrapper = summaryOf({
      gist: '滤掉了 4,144 行',
      hints: ['分位数走线性插值', '空值不参与分位'],
    })

    expect(wrapper.findComponent(DtHelpTip).props('text')).toBe(
      '分位数走线性插值；空值不参与分位',
    )
    expect(wrapper.findAll('.dt-ml-step__alert')).toHaveLength(0)
  })

  it('一条口径说明都没有时不摆那个小问号', () => {
    expect(
      summaryOf({ gist: '滤掉了 4,144 行' }).findComponent(DtHelpTip).exists(),
    ).toBe(false)
  })
})

describe('版面预算', () => {
  const MANY = Object.fromEntries(
    Array.from({ length: MAX_CHIPS + 3 }, (_, at) => [`参数${at}`, at + 1]),
  )

  it('chips 超过上限时先只摆前几个，按钮上写清还有几项', () => {
    const wrapper = summaryOf({ config: MANY })

    expect(wrapper.findAllComponents(DtTag)).toHaveLength(MAX_CHIPS)
    expect(wrapper.find('.dt-ml-step__fold').text()).toBe(
      '展开全部（还有 3 项参数）',
    )
  })

  it('展开之后剩下那几个也摆出来，按钮改成收起', async () => {
    const wrapper = summaryOf({ config: MANY })
    await wrapper.find('.dt-ml-step__fold').trigger('click')

    expect(wrapper.findAllComponents(DtTag)).toHaveLength(MAX_CHIPS + 3)
    expect(wrapper.find('.dt-ml-step__fold').text()).toBe('收起')
    expect(wrapper.find('.dt-ml-step__gist--clamped').exists()).toBe(false)
  })

  it('一句话很长时同样给按钮，且收起时限在三行内', () => {
    const wrapper = summaryOf({ gist: '很长的一句话'.repeat(20) })

    expect(wrapper.find('.dt-ml-step__fold').exists()).toBe(true)
    expect(wrapper.find('.dt-ml-step__gist--clamped').exists()).toBe(true)
  })

  it('短句加少量参数时不摆那个按钮', () => {
    const wrapper = summaryOf({
      gist: '滤掉了 4,144 行',
      config: { window: 3 },
    })

    expect(wrapper.find('.dt-ml-step__fold').exists()).toBe(false)
  })

  it('行/列/格子的账走插槽，摆在参数与告警之间', () => {
    const wrapper = mount(StepSummary, {
      props: { operator: 'lag_feature' },
      slots: { default: '<p class="probe">12,480 行 → 8,336 行</p>' },
    })

    expect(wrapper.find('.probe').text()).toBe('12,480 行 → 8,336 行')
  })
})
