/**
 * @fileoverview 接线：概率侧那四块各自落到自己的画法上（三条曲线走散点的 curve
 * 态、阈值网格走滑杆），以及拖动滑杆时矩阵与四个指标卡跟着走。
 *
 * ⚠ 夹具照抄后端真跑出来的 payload（概率 [0.9, 0.8, 0.4, 0.1]、真实 [1, 0, 1, 0]
 * 那四行，以及多分类 / 缺概率列 / 只有一类 / 全同概率四种退化），不是手编的形状。
 * ⚠ 掉回横条画法既不报错也不白屏，只会变成六十根条子——只有点名问「是不是这个
 * 件」才拦得住。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import BarList from '@/pages/Modeling/Canvas/components/BarList.vue'
import ReportBlocks from '@/pages/Modeling/Canvas/components/ReportBlocks.vue'
import ScatterPlot from '@/pages/Modeling/Canvas/components/ScatterPlot.vue'
import ThresholdSlider from '@/pages/Modeling/Canvas/components/ThresholdSlider.vue'
import type { ReportBlock } from '@/pages/Modeling/Canvas/scripts/reportBlocks'
import { reportOf } from '@/pages/Modeling/Canvas/scripts/reportBlocks'

function blocksOf(raw: Record<string, unknown>[]): ReportBlock[] {
  return reportOf({ blocks: raw }).blocks
}

const ROC = {
  kind: 'breakdown',
  zone: 'charts',
  port: 'metrics',
  title: 'ROC 曲线',
  tier: 1,
  payload: {
    label: '横轴假正率、纵轴真正率；对角线是随机基准',
    unit: '',
    score_kind: '',
    baseline: null,
    items: [
      { name: '全判负类', threshold: null, fpr: 0.0, tpr: 0.0, value: 0.0 },
      { name: '0.900', threshold: 0.9, fpr: 0.0, tpr: 0.5, value: 0.5 },
      { name: '0.800', threshold: 0.8, fpr: 0.5, tpr: 0.5, value: 0.5 },
      { name: '0.400', threshold: 0.4, fpr: 0.5, tpr: 1.0, value: 1.0 },
      { name: '0.100', threshold: 0.1, fpr: 1.0, tpr: 1.0, value: 1.0 },
    ],
    is_primary: true,
  },
}

const PR = {
  kind: 'breakdown',
  zone: 'charts',
  port: 'metrics',
  title: 'PR 曲线',
  tier: 1,
  payload: {
    label: '横轴召回率、纵轴精确率；基线是正类占比，类不平衡时它比 ROC 诚实',
    unit: '',
    score_kind: '',
    baseline: 0.5,
    items: [
      { name: '0.900', threshold: 0.9, recall: 0.5, precision: 1.0, value: 1.0 },
      { name: '0.800', threshold: 0.8, recall: 0.5, precision: 0.5, value: 0.5 },
      { name: '0.100', threshold: 0.1, recall: 1.0, precision: 0.5, value: 0.5 },
    ],
    is_primary: true,
  },
}

const CALIBRATION = {
  kind: 'breakdown',
  zone: 'charts',
  port: 'metrics',
  title: '校准曲线',
  tier: 1,
  payload: {
    label: '横轴平均预测概率、纵轴实际正类率；对角线是完美校准',
    unit: '',
    score_kind: '',
    baseline: null,
    items: [
      {
        name: '0.1–0.2',
        value: 0.0,
        predicted: 0.1,
        actual: 0.0,
        count: 1,
        is_sparse: true,
        low: 0.1,
        high: 0.2,
      },
      {
        name: '0.9–1.0',
        value: 1.0,
        predicted: 0.9,
        actual: 1.0,
        count: 1,
        is_sparse: true,
        low: 0.9,
        high: 1.0,
      },
    ],
    is_primary: false,
  },
}

const GRID = {
  kind: 'breakdown',
  zone: 'charts',
  port: 'metrics',
  title: '阈值网格',
  tier: 2,
  payload: {
    label: '每个阈值上的 TP / FP / TN / FN 与 F1；竖线是打分时判成正类的最低概率',
    unit: '',
    score_kind: '',
    baseline: 0.8,
    items: [
      { name: '0.900', threshold: 0.9, tp: 1, fp: 0, tn: 2, fn: 1, value: 2 / 3 },
      { name: '0.800', threshold: 0.8, tp: 1, fp: 1, tn: 1, fn: 1, value: 0.5 },
      { name: '0.400', threshold: 0.4, tp: 2, fp: 1, tn: 1, fn: 0, value: 0.8 },
      { name: '0.100', threshold: 0.1, tp: 2, fp: 2, tn: 0, fn: 0, value: 2 / 3 },
    ],
    is_primary: false,
  },
}

// 多分类真实产出：曲线一张都没有，第一区上挂一条告警
const MULTICLASS_SCOPE = {
  kind: 'rows',
  zone: 'step',
  port: 'metrics',
  title: '评估口径',
  tier: 0,
  payload: {
    before: 4,
    after: 4,
    dropped: 0,
    dropped_blank: 0,
    ratio_configured: null,
    ratio_actual: null,
    funnel: [
      { name: '测试行数', value: 4, unit: '行', note: '' },
      { name: '类目数', value: 3, unit: '类', note: '' },
    ],
    by_column: [],
    notes: [
      {
        level: 'alert',
        text: '多分类不产概率列，ROC / PR / 校准曲线与阈值网格都要二分类。下面四个指标是单一阈值上的一张切片',
      },
    ],
  },
}

const NO_PROBA_SCOPE = {
  ...MULTICLASS_SCOPE,
  payload: {
    ...MULTICLASS_SCOPE.payload,
    notes: [
      {
        level: 'alert',
        text: '这份打分结果里没有可用的每行概率（y_proba 列缺失或有空值），ROC / PR / 校准曲线与阈值网格都画不出来。下面四个指标是单一阈值上的一张切片',
      },
    ],
  },
}

/** 另一份网格：四档一样多，但打分时站在最高那一档上。 */
const OTHER_GRID = {
  ...GRID.payload,
  baseline: 0.9,
  items: [
    { name: '0.300', threshold: 0.3, tp: 2, fp: 2, tn: 0, fn: 0, value: 2 / 3 },
    { name: '0.500', threshold: 0.5, tp: 2, fp: 1, tn: 1, fn: 0, value: 0.8 },
    { name: '0.700', threshold: 0.7, tp: 1, fp: 1, tn: 1, fn: 1, value: 0.5 },
    { name: '0.900', threshold: 0.9, tp: 1, fp: 0, tn: 2, fn: 1, value: 2 / 3 },
  ],
}

/** 全同概率：网格只剩一档，ROC 只剩两个点。 */
const FLAT_GRID = {
  ...GRID,
  payload: {
    ...GRID.payload,
    baseline: 0.5,
    items: [
      { name: '0.500', threshold: 0.5, tp: 2, fp: 2, tn: 0, fn: 0, value: 2 / 3 },
    ],
  },
}

function slider(payload: Record<string, unknown> = GRID.payload) {
  return mount(ThresholdSlider, { props: { payload } })
}

describe('概率侧那四块各自的画法', () => {
  const wrapper = mount(ReportBlocks, {
    props: { blocks: blocksOf([ROC, PR, CALIBRATION, GRID]) },
  })

  it('三条曲线都走散点元件，一根横条都不剩', () => {
    expect(wrapper.findAllComponents(ScatterPlot)).toHaveLength(3)
    expect(wrapper.findComponent(BarList).exists()).toBe(false)
  })

  it('阈值网格走滑杆，不是六十根条子', () => {
    expect(wrapper.findComponent(ThresholdSlider).exists()).toBe(true)
  })

  it('ROC 与 PR 摆在主体位，校准与网格落进辅图格', () => {
    expect(wrapper.find('[data-lane="lead"]').text()).toContain('ROC 曲线')
    expect(wrapper.find('[data-lane="lead"]').text()).toContain('PR 曲线')
    expect(wrapper.find('[data-lane="aux"]').text()).toContain('校准曲线')
    expect(wrapper.find('[data-lane="aux"]').text()).toContain('阈值网格')
  })

  it('横条那行结论不许跟到曲线上——那句话说的是最高的一档', () => {
    expect(wrapper.text()).not.toContain('最高「')
  })
})

describe('三条曲线的参考几何各不相同', () => {
  it('ROC 画对角线，两条轴名各就各位', () => {
    const one = mount(ReportBlocks, { props: { blocks: blocksOf([ROC]) } })

    expect(one.find('.dt-ml-scatter__ideal').exists()).toBe(true)
    expect(one.find('.dt-ml-scatter__axis-name').text()).toBe('假正率')
    expect(one.find('.dt-ml-scatter__yaxis-name').text()).toBe('真正率')
  })

  // ⚠ PR 的基准是「全押正类」那条横线，给它画对角线等于凭空立一个判据
  it('PR 不画对角线，改画正类占比那条横线', () => {
    const one = mount(ReportBlocks, { props: { blocks: blocksOf([PR]) } })

    expect(one.find('.dt-ml-scatter__ideal').exists()).toBe(false)
    expect(one.find('.dt-ml-scatter__rule--reference').exists()).toBe(true)
    expect(one.find('.dt-ml-scatter__rules text').text()).toBe('正类占比 0.5')
  })

  it('校准曲线把不足十行的那几箱画成空心，并在图下说一句', () => {
    const one = mount(ReportBlocks, {
      props: { blocks: blocksOf([CALIBRATION]) },
    })

    expect(one.find('.dt-ml-scatter__hollow').exists()).toBe(true)
    expect(one.text()).toContain('2 个箱里有 2 个不足十行')
  })

  it('曲线两轴都是 0–1 的比率，图下那行照实写着', () => {
    const one = mount(ReportBlocks, { props: { blocks: blocksOf([ROC]) } })

    expect(one.find('.dt-ml-scatter__summary').text()).toBe(
      '共 5 个点；两轴都是 0 ~ 1 的比率，对角线是基准',
    )
  })

  // ⚠ ROC 的点数按构造恰好是上限那么多（网格 59 档 + 一个锚点），后端一个点都
  // 没截；照搬横条那句顶格告警的话，这一屏上它 100% 出现且 100% 是假的
  it('顶到上限的 ROC 不报截断，那是后端排好的档数', () => {
    const full = {
      ...ROC,
      payload: {
        ...ROC.payload,
        items: Array.from({ length: 60 }, (_, seat) => ({
          name: `${seat}`,
          threshold: seat / 60,
          fpr: seat / 60,
          tpr: seat / 60,
          value: 0,
        })),
      },
    }
    const one = mount(ReportBlocks, { props: { blocks: blocksOf([full]) } })

    expect(one.text()).not.toContain('项数顶到了上限')
  })
})

// 只有一类：ROC 与 PR 两块后端根本不产，能算的那两样照旧出
const ONE_SIDED_STATS = {
  kind: 'breakdown',
  zone: 'stats',
  port: 'metrics',
  title: '概率评估',
  tier: 0,
  payload: {
    label: 'AUC = 全部不同概率值上按梯形法算的 ROC 下面积，0.5 等于瞎猜',
    unit: '',
    score_kind: '',
    baseline: null,
    items: [
      { name: 'AUC', key: 'auc', value: null, unit: '', score_kind: '' },
      {
        name: 'AP',
        key: 'average_precision',
        value: null,
        unit: '',
        score_kind: '',
      },
      {
        name: '正类「1」占比',
        key: 'positive_rate',
        value: 1.0,
        unit: '',
        score_kind: '',
      },
    ],
    notes: [
      {
        level: 'alert',
        text: '测试集里只有一类（或正类一次都没出现），AUC 与 AP 都无定义，ROC 与 PR 曲线也画不出来',
      },
    ],
  },
}

const ONE_SIDED_GRID = {
  ...GRID,
  payload: {
    ...GRID.payload,
    baseline: 0.1,
    items: [
      { name: '0.900', threshold: 0.9, tp: 1, fp: 0, tn: 0, fn: 3, value: 0.4 },
      { name: '0.100', threshold: 0.1, tp: 4, fp: 0, tn: 0, fn: 0, value: 1 },
    ],
  },
}

describe('只有一类时，算得出来的那两样照旧摆', () => {
  const wrapper = mount(ReportBlocks, {
    props: { blocks: blocksOf([ONE_SIDED_STATS, CALIBRATION, ONE_SIDED_GRID]) },
  })

  // ⚠ 「这两个数算不出来」与「这一屏没有概率」是两回事：前者仍该给校准与网格
  it('AUC 与 AP 印「无定义」而不是 0，那句为什么也摆出来', () => {
    expect(wrapper.text()).toContain('无定义')
    expect(wrapper.text()).toContain('AUC 与 AP 都无定义')
    expect(wrapper.text()).not.toContain('AUC0')
  })

  it('ROC 与 PR 一张都不摆，校准与滑杆照旧', () => {
    expect(wrapper.text()).not.toContain('ROC 曲线')
    expect(wrapper.findAllComponents(ScatterPlot)).toHaveLength(1)
    expect(wrapper.findComponent(ThresholdSlider).exists()).toBe(true)
  })

  it('一个负类都没有那一档，精确率满而准确率跟着召回率走', () => {
    expect(wrapper.text()).toContain('阈值 0.100：共 4 行，判对 4 行')
  })
})

describe('概率列不存在时这一整块不渲染', () => {
  it.each([
    ['多分类', MULTICLASS_SCOPE, '多分类不产概率列'],
    ['缺概率列', NO_PROBA_SCOPE, '没有可用的每行概率'],
  ])('%s 时一张曲线都不摆，只留那一句说明', (_name, block, text) => {
    const one = mount(ReportBlocks, { props: { blocks: blocksOf([block]) } })

    expect(one.findComponent(ScatterPlot).exists()).toBe(false)
    expect(one.findComponent(ThresholdSlider).exists()).toBe(false)
    expect(one.text()).toContain(text)
  })
})

describe('阈值滑杆', () => {
  it('默认停在打分时用的那一档，不是最左也不是最中间', () => {
    const wrapper = slider()

    expect(wrapper.find('input[type="range"]').element).toHaveProperty(
      'value',
      '2',
    )
    expect(wrapper.text()).toContain('拖到第 3 档：阈值 0.800')
    expect(wrapper.text()).toContain('竖线是打分时用的那个阈值，0.800')
  })

  it('滑杆是原生 range，键盘能操作，读屏读得出阈值而不是档号', () => {
    const input = slider().find('input[type="range"]')

    expect(input.attributes('min')).toBe('0')
    expect(input.attributes('max')).toBe('3')
    expect(input.attributes('step')).toBe('1')
    expect(input.attributes('aria-valuetext')).toBe('拖到第 3 档：阈值 0.800')
  })

  it('拖到最左：矩阵四格与四个指标一起跟着走', async () => {
    const wrapper = slider()
    await wrapper.find('input[type="range"]').setValue(0)
    const cells = wrapper.findAll('.dt-ml-matrix__cell--hit, .dt-ml-matrix__cell--miss')

    expect(wrapper.text()).toContain('阈值 0.100：共 4 行，判对 2 行')
    expect(cells.map((cell) => cell.text())).toEqual(['2', '0', '2', '0'])
    expect(wrapper.text()).toContain('低了 0.7')
  })

  it('拖到最右：只判中一行，精确率满而召回率掉一半', async () => {
    const wrapper = slider()
    await wrapper.find('input[type="range"]').setValue(3)

    expect(wrapper.text()).toContain('阈值 0.900：共 4 行，判对 3 行')
    expect(wrapper.text()).toContain('高了 0.1')
  })

  it.each([
    [0, '准确率', '0.5'],
    [0, '召回率', '1'],
    [3, '精确率', '1'],
    [3, '准确率', '0.75'],
  ])('拖到第 %s 档时「%s」印的是 %s', async (seat, label, text) => {
    const wrapper = slider()
    await wrapper.find('input[type="range"]').setValue(seat)
    const cards = wrapper.findAll('.dt-ml-stats__grid li')
    const found = cards.find((card) => card.text().startsWith(label))

    expect(found?.find('.dt-digits__text').text()).toBe(text)
  })

  // ⚠ 手不放开的话，上一份网格的第 1 档会在新的一份上指到另一个阈值上，而屏幕
  // 上看着一切正常——它只是不再是这次打分站的那一档了
  // ⚠ 同一个语义不能在一屏上有两种冷暖：② 区那四张卡也是不染色的
  it('四个指标卡不套阈值染色，也不摆档位词', () => {
    const wrapper = slider()

    expect(wrapper.find('.dt-ml-stats__grid .dt-tag').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('一般')
  })

  it('轨道底下写着网格两端那两档，顺带说清往右推是什么意思', () => {
    const text = slider().find('.dt-ml-threshold__ends').text()

    expect(text).toContain('最低 0.100')
    expect(text).toContain('最高 0.900')
    expect(text).toContain('往右推门槛更高')
  })

  it('换了一份网格就把手放开，重新停回打分时那一档', async () => {
    const wrapper = slider()
    await wrapper.find('input[type="range"]').setValue(0)
    expect(wrapper.text()).toContain('拖到第 1 档：阈值 0.100')

    await wrapper.setProps({ payload: OTHER_GRID })

    expect(wrapper.text()).toContain('拖到第 4 档：阈值 0.900')
  })

  // ⚠ 竖线是「离打分时那一档有多远」的唯一参照物：没有它，滑杆上就只剩一个
  // 拇指，读不出这一档是往上调了还是往下调了
  it('轨道上那条竖线站在打分时那一档的位置上', () => {
    const mark = slider().find('.dt-ml-threshold__mark')
    const wide = slider(OTHER_GRID).find('.dt-ml-threshold__mark')

    expect(mark.attributes('style')).toBe('left: 66.67%;')
    expect(wide.attributes('style')).toBe('left: 100.00%;')
  })

  // ⚠ 竖线跟着拇指走的话，两者永远重合，「离打分时那一档有多远」就无从读起
  it('拖动时竖线不跟着走，它标的是打分时那一档', async () => {
    const wrapper = slider()
    await wrapper.find('input[type="range"]').setValue(0)

    expect(wrapper.find('.dt-ml-threshold__mark').attributes('style')).toBe(
      'left: 66.67%;',
    )
  })

  it('全同概率时 ROC 只剩两个点，仍画得出来', () => {
    const flat = {
      ...ROC,
      payload: {
        ...ROC.payload,
        items: [
          { name: '全判负类', threshold: null, fpr: 0, tpr: 0, value: 0 },
          { name: '0.500', threshold: 0.5, fpr: 1, tpr: 1, value: 1 },
        ],
      },
    }
    const one = mount(ReportBlocks, { props: { blocks: blocksOf([flat]) } })

    expect(one.find('.dt-ml-scatter__summary').text()).toContain('共 2 个点')
    expect(one.find('.dt-ml-scatter__blank').exists()).toBe(false)
  })

  it('全同概率时只有一档，滑杆推不动也不出错', () => {
    const wrapper = slider(FLAT_GRID.payload)

    expect(wrapper.find('input[type="range"]').attributes('max')).toBe('0')
    expect(wrapper.text()).toContain('阈值 0.500：共 4 行，判对 2 行')
  })

  it('一档阈值都没有时整块不摆，不留一个空滑杆', () => {
    const wrapper = slider({ ...GRID.payload, items: [] })

    expect(wrapper.find('input[type="range"]').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  // ⚠ 查表是同步的，这个件因此一个监听都不该挂：挂了而不清理，弹窗开几十次就
  // 会攒下几十个活着的回调
  it('挂载与拖动都不往 window / document 上挂监听，卸载后也不留痕', async () => {
    const onWindow = vi.spyOn(window, 'addEventListener')
    const onDocument = vi.spyOn(document, 'addEventListener')
    const wrapper = mount(ThresholdSlider, {
      props: { payload: GRID.payload },
      attachTo: document.body,
    })
    await wrapper.find('input[type="range"]').setValue(1)
    wrapper.unmount()

    expect(onWindow).not.toHaveBeenCalled()
    expect(onDocument).not.toHaveBeenCalled()
    expect(document.body.innerHTML).toBe('')
    onWindow.mockRestore()
    onDocument.mockRestore()
  })
})
