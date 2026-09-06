/**
 * @fileoverview `fits` 块的画法：参数列自适应展开、训练行与总行数的对照、
 * 跳过理由、表下逐列的算式，以及一整排退化分支。
 *
 * ⚠ 夹具照抄后端真实产出（`operators/fitreport.py` / `featureblocks.py` /
 * `pcablocks.py` 跑出来的 payload）：手编一份形状漂了的，用例全绿而界面全错。
 */
import { DtEmpty, DtTooltip } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FitsBlock from '@/pages/Modeling/Canvas/components/FitsBlock.vue'
import type { ReportBlock } from '@/pages/Modeling/Canvas/scripts/reportBlocks'

function blockOf(payload: Record<string, unknown>, title = '逐列填充') {
  const block: ReportBlock = {
    kind: 'fits',
    zone: 'table',
    port: 'frame',
    title,
    tier: 1,
    isPrimary: null,
    payload,
  }
  return mount(FitsBlock, { props: { block } })
}

// fill_missing：strategy=mean，对半切分，温度列 8 行里 3 个空
const FILL = {
  method: 'mean',
  train_rows: 4,
  total_rows: 8,
  by_column: [
    {
      key: '温度',
      params: { fill: 3.0, filled: 3, null_ratio_before: 0.375, fit_rows: 2 },
      skipped_reason: '',
    },
  ],
}

// clip_outlier：zscore k=1，全帧极值超出训练段
const CLIP = {
  method: 'zscore',
  train_rows: 4,
  total_rows: 8,
  by_column: [
    {
      key: '温度',
      params: {
        k: 1.0,
        mean: 2.5,
        sd: 1.118033988749895,
        q1: null,
        q3: null,
        low: 1.381966011250105,
        high: 3.618033988749895,
        clipped_low: 1,
        clipped_high: 5,
        untouched: 2,
        fit_rows: 4,
        train_low: 1.0,
        train_high: 4.0,
        all_low: 1.0,
        all_high: 60.0,
        beyond_train: true,
      },
      skipped_reason: '',
    },
  ],
}

// standardize：zscore，center/scale 学在训练行上
const SCALE = {
  method: 'zscore',
  train_rows: 4,
  total_rows: 8,
  by_column: [
    {
      key: '温度',
      params: {
        center: 2.5,
        scale: 1.118033988749895,
        fit_rows: 4,
        before_min: 1.0,
        after_min: -1.3416407864998738,
      },
      skipped_reason: '',
    },
  ],
}

// pca：两条轴，第二条的第二项是负权重
const PCA = {
  method: 'pca',
  train_rows: 4,
  total_rows: 8,
  by_column: [
    {
      key: 'pc1',
      params: {
        explained: 0.8,
        cumulative: 0.8,
        terms: [
          { key: '温度', weight: 0.707107, center: 2.5 },
          { key: '湿度', weight: 0.707107, center: 2.5 },
        ],
        terms_total: 2,
      },
      skipped_reason: '',
    },
    {
      key: 'pc2',
      params: {
        explained: 0.2,
        cumulative: 1.0,
        terms: [
          { key: '湿度', weight: 0.707107, center: 2.5 },
          { key: '温度', weight: -0.707107, center: 2.5 },
        ],
        terms_total: 2,
      },
      skipped_reason: '',
    },
  ],
}

// one_hot：keep_top 砍掉一个类目，块上挂着一条口径说明
const MISS_NOTE =
  '一个类目都没命中的行分两种：未见过的类目（含被 keep_top 砍掉的那几个）' +
  '与本来就是空。两种都落全零，但前者要调类目上限、后者要先填缺失'

const ONE_HOT = {
  method: 'keep_top',
  train_rows: 8,
  total_rows: 8,
  by_column: [
    {
      key: '班次',
      params: {
        categories: 3,
        kept: 2,
        cut: 1,
        hit_rows: 6,
        unseen_rows: 1,
        blank_rows: 1,
        unseen_ratio: 0.125,
        blank_ratio: 0.125,
      },
      skipped_reason: '',
    },
  ],
}

function headers(wrapper: ReturnType<typeof blockOf>): string[] {
  return wrapper.findAll('th').map((one) => one.text())
}

function cells(wrapper: ReturnType<typeof blockOf>): string[] {
  return wrapper.findAll('td').map((one) => one.text())
}

describe('逐列拟合表', () => {
  it('参数列按数据自适应展开，不是写死的一张表', () => {
    expect(headers(blockOf(FILL))).toEqual([
      '列',
      '填充值',
      '填了几格',
      '填前空值率',
      '拟合样本数',
    ])
    expect(headers(blockOf(ONE_HOT))).toEqual([
      '列',
      '类目数',
      '留下',
      '砍掉',
      '命中行',
      '未见过类目的行',
      '空值行',
      '未见过占比',
      '空值占比',
    ])
  })

  it('比率按百分数印、计数按原样印', () => {
    expect(cells(blockOf(FILL))).toEqual(['温度', '3', '3', '37.5%', '2'])
  })

  it('布尔印成是否，读不出来的数印成「—」而不是 0', () => {
    const shown = cells(blockOf(CLIP))

    expect(shown[0]).toBe('温度')
    // q1 / q3 是 null：zscore 这一档根本没算四分位
    expect(shown[4]).toBe('—')
    expect(shown[5]).toBe('—')
    expect(shown[16]).toBe('是')
  })

  it('列名超过 12rem 收省略号，全名挂在 tooltip 上', () => {
    const long = '这是一个特别长的中文列名用来验证省略号与浮层是不是都在'
    const wrapper = blockOf({
      ...FILL,
      by_column: [{ key: long, params: { fill: 1 }, skipped_reason: '' }],
    })

    expect(wrapper.findComponent(DtTooltip).props('content')).toBe(long)
    expect(wrapper.find('.dt-ml-fits__label').text()).toBe(long)
  })

  it('嵌套的参数不成列：整个数组塞进单元格既读不出来也会撑垮表', () => {
    expect(headers(blockOf(PCA))).toEqual([
      '列',
      '解释方差',
      '累计解释',
      '项数',
    ])
  })

  it('列多了让表自己横滚，不把每一列压到读不出来', () => {
    // 12rem 列名 + 16 个参数列 × 8rem
    expect(blockOf(CLIP).find('table.dt-table').attributes('style')).toContain(
      'min-width: 140rem',
    )
  })
})

describe('跳过理由', () => {
  const SKIPPED = {
    ...FILL,
    by_column: [
      { key: '温度', params: { fill: 3 }, skipped_reason: '' },
      {
        key: '湿度',
        params: { fill: null },
        skipped_reason: '整列都是空值，没有可用来学的行',
      },
    ],
  }

  it('有列跳过时才摆理由那一列，并照实印原因', () => {
    const wrapper = blockOf(SKIPPED)

    expect(headers(wrapper)).toContain('没处理的原因')
    expect(cells(wrapper)).toEqual([
      '温度',
      '3',
      '—',
      '湿度',
      '—',
      '整列都是空值，没有可用来学的行',
    ])
  })

  it('一列都没跳过时不摆那一列', () => {
    expect(headers(blockOf(FILL))).not.toContain('没处理的原因')
  })
})

// logistic_regression：系数、这一列的 σ、几率比 e^β（`linearreport.py::_odds_item`）
const ODDS = {
  method: 'logit',
  train_rows: 48,
  total_rows: 60,
  by_column: [
    {
      key: '负荷',
      params: { coef: 2.1207, sigma: 1.4142, odds_ratio: 8.3362 },
      skipped_reason: '',
    },
  ],
}

describe('几率比不是比率', () => {
  it('e^β 按倍数印，不许乘 100 印成百分数', () => {
    const shown = cells(blockOf(ODDS, '系数与几率比'))

    expect(shown).toEqual(['负荷', '2.1207', '1.4142', '8.3362'])
    expect(shown.join()).not.toContain('%')
  })

  it('表上那个数与算式里的那个数逐字相同', () => {
    const wrapper = blockOf(ODDS, '系数与几率比')

    expect(wrapper.find('.dt-ml-fits__fx-row').text()).toContain('e^β=8.3362')
    expect(cells(wrapper).at(-1)).toBe('8.3362')
  })

  it('真的是 0–1 比率的那几个键照旧印成百分数', () => {
    expect(cells(blockOf(FILL))[3]).toBe('37.5%')
    expect(cells(blockOf(ONE_HOT)).slice(-2)).toEqual(['12.5%', '12.5%'])
  })
})

describe('块标题与表名', () => {
  it('标题只印一遍：表自己的名字说的是另一件事', () => {
    const wrapper = blockOf(FILL, '系数与可比贡献')
    const title = wrapper.find('.dt-ml-fits__title').text()
    const caption = wrapper.find('caption').text()

    expect(title).toBe('系数与可比贡献')
    expect(caption).not.toBe(title)
    expect(wrapper.text().split('系数与可比贡献').length - 1).toBe(1)
  })
})

describe('图下那行结论', () => {
  function summaryOf(payload: Record<string, unknown>): string {
    return blockOf(payload).find('.dt-ml-fits__summary').text()
  }

  it('训练行与总行数一起印，且给出训练行占比', () => {
    expect(summaryOf(FILL)).toBe(
      '拟合方法：mean；在 4 个训练行上学、8 行全帧照这一份处理（训练行占 50%）；' +
        '1 列全部学出了参数',
    )
  })

  it('两个数相等反而可疑：照实说这一步之前没有切分', () => {
    expect(summaryOf(ONE_HOT)).toContain(
      '训练行 8 行与总行数相同：这一步之前没有切分，统计量是在整帧上学的',
    )
  })

  it('总行数是 0 时说算不出占比，不印 0%', () => {
    const text = summaryOf({ ...FILL, train_rows: 0, total_rows: 0 })

    expect(text).toContain('在 0 个训练行上学；总行数没有记下，算不出占比')
    expect(text).not.toContain('0%')
  })

  it('跳过的列数进结论', () => {
    const text = summaryOf({
      ...FILL,
      by_column: [
        { key: '温度', params: { fill: 3 }, skipped_reason: '' },
        { key: '湿度', params: {}, skipped_reason: '整列都是空值' },
      ],
    })

    expect(text).toContain('2 列里 1 列没学出参数，理由逐列写在表上')
  })

  it('触到 60 列上限时说清只列了前多少列', () => {
    const many = Array.from({ length: 60 }, (_, at) => ({
      key: `列${at}`,
      params: { fill: at },
      skipped_reason: '',
    }))

    expect(summaryOf({ ...FILL, by_column: many })).toContain(
      '只列了前 60 列——已经到上限，更靠后的列没有列出来',
    )
  })

  it('方法名没记下时那一句整段不印，不印一个空的「拟合方法：」', () => {
    expect(summaryOf({ ...FILL, method: '' })).not.toContain('拟合方法')
  })
})

describe('表下逐列的算式', () => {
  function formulaTexts(payload: Record<string, unknown>): string[] {
    return blockOf(payload)
      .findAll('.dt-ml-fits__fx-row')
      .map((one) => one.text())
  }

  it('填充值那一条写明它只作用在原值为空的行上', () => {
    expect(formulaTexts(FILL)).toEqual(['温度=3（原值为空的那些行）'])
  })

  it('定界那一条是两头夹回去的原式', () => {
    expect(formulaTexts(CLIP)).toEqual(['温度=min(max(温度,1.382),3.618)'])
  })

  it('尺度那一条是分式，分子分母各自成段', () => {
    const wrapper = blockOf(SCALE)

    expect(wrapper.find('.dt-fx__frac').exists()).toBe(true)
    expect(formulaTexts(SCALE)).toEqual(['温度′=(温度−2.5)1.118'])
  })

  it('主成分一列一行，负权重走减号而不是「+ -0.7071」', () => {
    expect(formulaTexts(PCA)).toEqual([
      'pc1=0.7071·(温度−2.5)+0.7071·(湿度−2.5)',
      'pc2=0.7071·(湿度−2.5)−0.7071·(温度−2.5)',
    ])
  })

  it('载荷被截断时式子尾巴上挂一个警示项，说清还剩几项', () => {
    const cut = {
      ...PCA,
      by_column: [
        {
          key: 'pc1',
          params: {
            terms: [{ key: '温度', weight: 0.5, center: 0 }],
            terms_total: 21,
          },
          skipped_reason: '',
        },
      ],
    }
    const wrapper = blockOf(cut)

    expect(wrapper.find('.dt-fx__t--warn').text()).toBe('另有 20 项没列出')
  })

  it('系数表那一条印成 β(列名)，跳过的那一列不占一行', () => {
    // linear_regression 的系数块：σ=0 的列拿不出可比贡献，照实跳过
    const coef = {
      method: 'ols',
      train_rows: 400,
      total_rows: 500,
      by_column: [
        {
          key: '温度',
          params: { coef: 3.21, sigma: 1.2, contribution: 3.852 },
          skipped_reason: '',
        },
        {
          key: '常数列',
          params: { coef: 0.5, sigma: 0, contribution: null },
          skipped_reason: '这一列没有起伏，可比贡献无从谈起',
        },
      ],
    }

    expect(formulaTexts(coef)).toEqual(['β(温度)=3.21', 'β(常数列)=0.5'])
  })

  it('几率比接在系数后面：logit 那一路要的是 e^β 那个读法', () => {
    const odds = {
      method: 'logit',
      train_rows: 400,
      total_rows: 500,
      by_column: [
        {
          key: '温度',
          params: { coef: 3.21, sigma: 1.2, odds_ratio: 24.7783 },
          skipped_reason: '',
        },
      ],
    }

    expect(formulaTexts(odds)).toEqual(['β(温度)=3.21,e^β=24.7783'])
  })

  it('凑不出公式的块下面一段都不摆', () => {
    expect(blockOf(ONE_HOT).find('.dt-ml-fits__fx').exists()).toBe(false)
  })

  it('跨度是 0 时不画那条分式：除数为零的式子是假数', () => {
    const flat = {
      ...SCALE,
      by_column: [
        { key: '温度', params: { center: 2.5, scale: 0 }, skipped_reason: '' },
      ],
    }

    expect(formulaTexts(flat)).toEqual([])
  })
})

describe('退化', () => {
  it('payload 整包读不出来时摆空态，不摆一张空表', () => {
    const wrapper = blockOf({})

    expect(wrapper.findComponent(DtEmpty).props('title')).toBe(
      '这一步没有可核对的拟合参数',
    )
    expect(wrapper.find('table.dt-table').exists()).toBe(false)
  })

  it('by_column 是空数组时同样摆空态', () => {
    expect(
      blockOf({ ...FILL, by_column: [] })
        .findComponent(DtEmpty)
        .exists(),
    ).toBe(true)
  })

  it('params 全是 null 时格子全是「—」，一个 0 都不补', () => {
    const nulls = {
      ...FILL,
      by_column: [
        {
          key: '温度',
          params: { fill: null, filled: null, null_ratio_before: null },
          skipped_reason: '',
        },
      ],
    }

    expect(cells(blockOf(nulls))).toEqual(['温度', '—', '—', '—'])
  })

  it('params 整个读不出来时只剩列名那一列', () => {
    const broken = {
      ...FILL,
      by_column: [{ key: '温度', params: 'not-a-record', skipped_reason: '' }],
    }

    expect(headers(blockOf(broken))).toEqual(['列'])
    expect(cells(blockOf(broken))).toEqual(['温度'])
  })

  it('块上挂着的口径说明逐条印出来', () => {
    const wrapper = blockOf({
      ...ONE_HOT,
      notes: [{ level: 'hint', text: MISS_NOTE }],
    })

    expect(
      wrapper.findAll('.dt-ml-fits__notes li').map((one) => one.text()),
    ).toEqual([MISS_NOTE])
  })

  it('写成纯字符串的那一句照收，不静静丢掉', () => {
    const wrapper = blockOf({ ...ONE_HOT, notes: [MISS_NOTE] })

    expect(
      wrapper.findAll('.dt-ml-fits__notes li').map((one) => one.text()),
    ).toEqual([MISS_NOTE])
  })

  it('会读出错误结论的那一句自己带底与边，排在口径说明前面', () => {
    const wrapper = blockOf({
      ...ONE_HOT,
      notes: [
        { level: 'hint', text: MISS_NOTE },
        { level: 'alert', text: '这一列的类目被砍掉了一个' },
      ],
    })
    const listed = wrapper.findAll('.dt-ml-fits__notes li')

    expect(listed.map((one) => one.text())).toEqual([
      '这一列的类目被砍掉了一个',
      MISS_NOTE,
    ])
    expect(listed[0]?.classes()).toContain('dt-ml-fits__note--alert')
  })

  it('没有口径说明时那一段不摆', () => {
    expect(blockOf(ONE_HOT).find('.dt-ml-fits__notes').exists()).toBe(false)
  })

  it('块的标题印在最上面，认得出这是哪一张表', () => {
    expect(blockOf(FILL, '逐列定界').find('.dt-ml-fits__title').text()).toBe(
      '逐列定界',
    )
  })
})
