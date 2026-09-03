/**
 * @fileoverview 结果视图：按 kind 派发、截断要说出来、空值不显示成空白。
 *
 * ⚠ 桩必须按**真实线形**建：后端给的摘要是按端口建键的
 * （`{frame: {kind: 'frame', …}}`），摊平一层的桩会让 `previewOf` 与视图各自
 * 自洽地全绿，而真跑起来每一步都显示「没有可展示的结果」。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ResultView from '@/pages/Modeling/Canvas/components/ResultView.vue'

const MODEL_BODY = {
  kind: 'model',
  algo: 'linear',
  task: 'regression',
  hyper_params: { use_intercept: true },
  feature_keys: ['power', 'temp'],
  target_key: 'y',
  serving_channel: 'json',
  fitted: { coef: { power: 2, temp: -0.5 }, intercept: 1 },
}
const MODEL = { model: MODEL_BODY }

const FRAME_BODY = {
  kind: 'frame',
  shape: { rows: 500, cols: 2 },
  columns: [
    {
      key: 'power',
      name: '功率',
      dtype: 'number',
      role: 'feature',
      unit: 'kW',
      null_ratio: 0.5,
      n_unique: 3,
      min: 1,
      max: 9,
      mean: 5,
      p50: 4,
    },
  ],
  index_name: '时刻',
  index_head: ['2026-01-01T00:00:00Z'],
  head: [[null]],
  rows_truncated: true,
  cols_truncated: false,
}
const FRAME = { frame: FRAME_BODY }

describe('结果视图按 kind 派发', () => {
  it('帧：形状与截断都写在页面上', () => {
    const wrapper = mount(ResultView, { props: { payload: FRAME } })

    expect(wrapper.text()).toContain('500 行 × 2 列')
    expect(wrapper.text()).toContain('只显示了开头这几行')
  })

  it('帧：空值显示成「—」而不是一格空白', () => {
    const wrapper = mount(ResultView, { props: { payload: FRAME } })

    expect(wrapper.text()).toContain('—')
  })

  it('模型：没训练出来的要明说下游用不了', () => {
    const wrapper = mount(ResultView, {
      props: { payload: { model: { ...MODEL_BODY, fitted: {} } } },
    })

    expect(wrapper.text()).toContain('还没有训练出模型')
  })

  it('评估：指标名换成中文口径，散点也画出来', () => {
    const wrapper = mount(ResultView, {
      props: {
        payload: {
          metrics: {
            kind: 'metrics',
            task: 'regression',
            metrics: { r2: 0.9 },
            pairs: [
              [1, 1.1],
              [2, 1.9],
            ],
            pairs_truncated: false,
          },
        },
      },
    })

    expect(wrapper.text()).toContain('R²')
    expect(wrapper.findAll('circle')).toHaveLength(2)
  })

  it('评估：真值全都一样时不会因为除以 0 画出 NaN', () => {
    const wrapper = mount(ResultView, {
      props: {
        payload: {
          metrics: {
            kind: 'metrics',
            task: 'regression',
            metrics: {},
            pairs: [
              [5, 5],
              [5, 5],
            ],
            pairs_truncated: false,
          },
        },
      },
    })

    const cx = wrapper.findAll('circle').map((c) => c.attributes('cx'))
    expect(
      cx.every((value) => value !== undefined && !value.includes('NaN')),
    ).toBe(true)
  })

  it('认不出的 kind 给一句照实的说明，不是一片空白', () => {
    const wrapper = mount(ResultView, {
      props: { payload: { out: { kind: '将来某种', note: '这一步没有摘要' } } },
    })

    expect(wrapper.text()).toContain('这一步没有摘要')
  })
})

describe('模型结果', () => {
  // ⚠ `fitted` 是拟合参数字典不是布尔，按布尔读的话每个训好的模型都会喊没训出来
  it('训好了就不喊「还没训练出来」', () => {
    const wrapper = mount(ResultView, { props: { payload: MODEL } })

    expect(wrapper.text()).not.toContain('还没有训练出模型')
  })

  it('系数按绝对值从大到小排，截距单独写出来', () => {
    const wrapper = mount(ResultView, { props: { payload: MODEL } })

    const names = wrapper.findAll('.dt-ml-model__name').map((el) => el.text())
    expect(names).toEqual(['power', 'temp'])
    expect(wrapper.text()).toContain('截距 1')
  })

  it('负权重画在零线另一边，色也不一样', () => {
    const wrapper = mount(ResultView, { props: { payload: MODEL } })

    const bars = wrapper.findAll('.dt-ml-model__bar')
    expect(bars[0]?.classes()).not.toContain('dt-ml-model__bar--minus')
    expect(bars[1]?.classes()).toContain('dt-ml-model__bar--minus')
  })

  it('可服务性说清楚能不能配到台账里去', () => {
    expect(mount(ResultView, { props: { payload: MODEL } }).text()).toContain(
      '可上线',
    )
    expect(
      mount(ResultView, {
        props: {
          payload: { model: { ...MODEL_BODY, serving_channel: 'binary' } },
        },
      }).text(),
    ).toContain('不可上线')
  })

  // ⚠ 「摘要被截断」与「没训出来」是两回事，混作一处会冤枉一个跑成功的模型
  it('摘要被截掉拟合参数时说的是被截断，不是没训出来', () => {
    const trimmed: Record<string, unknown> = { ...MODEL_BODY }
    delete trimmed['fitted']

    const wrapper = mount(ResultView, {
      props: { payload: { model: trimmed } },
    })

    expect(wrapper.text()).toContain('没有一起带回来')
    expect(wrapper.text()).not.toContain('还没有训练出模型')
  })
})

describe('评估结果', () => {
  const METRICS_BODY = {
    kind: 'metrics',
    task: 'regression',
    metrics: { r2: 0.95, mape: 8, mae: 3, rmse: null },
    pairs: [[1, 1.1]],
    pairs_truncated: false,
    residual_bins: [
      [-2, -1, 3],
      [-1, 0, 9],
      [0, 1, 4],
    ],
  }
  const METRICS = { metrics: METRICS_BODY }

  it('残差直方图按桶画出来', () => {
    const wrapper = mount(ResultView, { props: { payload: METRICS } })

    expect(wrapper.findAll('.dt-ml-residual__bar')).toHaveLength(3)
  })

  it('残差跨过 0 时把零线画出来', () => {
    const wrapper = mount(ResultView, { props: { payload: METRICS } })

    expect(wrapper.find('.dt-ml-residual__zero').exists()).toBe(true)
  })

  it('残差全在一侧时不画零线，免得画到框外去', () => {
    const wrapper = mount(ResultView, {
      props: {
        payload: { metrics: { ...METRICS_BODY, residual_bins: [[1, 2, 5]] } },
      },
    })

    expect(wrapper.find('.dt-ml-residual__zero').exists()).toBe(false)
  })

  // ⚠ 无定义写成 0 会被读成「一点都不准」
  it('无定义的指标写「无定义」，不写 0', () => {
    const wrapper = mount(ResultView, { props: { payload: METRICS } })

    expect(wrapper.text()).toContain('无定义')
  })

  it('MAPE 按百分数显示，阈值也按百分数判', () => {
    const wrapper = mount(ResultView, { props: { payload: METRICS } })

    expect(wrapper.text()).toContain('8%')
  })
})

describe('取数溯源', () => {
  const SOURCED = {
    frame: {
      ...FRAME_BODY,
      provenance: {
        table_codes: ['energy_log'],
        since: '2026-01-01T00:00:00Z',
        until: null,
        is_truncated: true,
      },
    },
  }

  it('台账编码与时间范围写在最上面', () => {
    const wrapper = mount(ResultView, { props: { payload: SOURCED } })

    expect(wrapper.text()).toContain('energy_log')
    expect(wrapper.text()).toContain('此刻')
  })

  // ⚠ 取数触顶是「数据根本没进来」，与「摘要只带回前几行」不是一回事
  it('取数触顶时给一条告警，说清是数据没进来', () => {
    const wrapper = mount(ResultView, { props: { payload: SOURCED } })

    expect(wrapper.text()).toContain('根本没有取进来')
  })

  it('列角色印在列名旁边', () => {
    const wrapper = mount(ResultView, { props: { payload: SOURCED } })

    expect(wrapper.text()).toContain('特征列')
  })
})

// ⚠ 这一组钉的是「摘要按端口建键」这条线形本身。二期把整包当成一份摊平的摘要
// 去读 `kind`，于是每一步都显示成「没有可展示的结果」，而全套用例是绿的——
// 因为桩也摊平了一层。
describe('摘要按端口建键', () => {
  it('取数那一路包在 frame 端口里，照样把形状读出来', () => {
    const wrapper = mount(ResultView, { props: { payload: FRAME } })

    expect(wrapper.text()).toContain('500 行 × 2 列')
    expect(wrapper.text()).not.toContain('这一步没有可展示的结果')
  })

  it('多路输出逐路摆开，小标题用算子声明的端口标签', () => {
    const wrapper = mount(ResultView, {
      props: {
        payload: { train: FRAME_BODY, test: FRAME_BODY },
        labels: { train: '训练集', test: '测试集' },
      },
    })

    expect(wrapper.text()).toContain('训练集')
    expect(wrapper.text()).toContain('测试集')
    expect(wrapper.findAll('.dt-ml-result__port')).toHaveLength(2)
  })

  it('只有一路时不摆小标题——那只是重复卡片名', () => {
    const wrapper = mount(ResultView, {
      props: { payload: FRAME, labels: { frame: '输出' } },
    })

    expect(wrapper.findAll('.dt-ml-result__port')).toHaveLength(0)
  })

  it('一路输出都没有时照实说一句，不是一片空白', () => {
    const wrapper = mount(ResultView, { props: { payload: {} } })

    expect(wrapper.text()).toContain('这一步没有可展示的结果')
  })
})
