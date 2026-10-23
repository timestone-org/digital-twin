/** @fileoverview 结果摘要的业务列隔离、模型状态与评估派发回归。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ResultView from '@/pages/Modeling/Canvas/components/ResultView.vue'

function column(key: string) {
  return {
    key,
    name: key,
    dtype: 'string',
    role: 'feature',
    unit: '',
    null_ratio: 0,
    n_unique: 1,
    min: null,
    max: null,
    mean: null,
    p50: null,
  }
}

describe('结果数据列与显示键隔离', () => {
  it('名为 index 和 id 的业务列不覆盖时间索引与行身份', () => {
    const wrapper = mount(ResultView, {
      props: {
        payload: {
          frame: {
            kind: 'frame',
            shape: { rows: 1, cols: 2 },
            columns: [column('index'), column('id')],
            index_name: 'ts',
            index_head: [Date.parse('2026-10-22T00:00:00Z')],
            head: [['业务索引', '设备标识']],
            rows_truncated: false,
            cols_truncated: false,
          },
        },
      },
    })
    const cells = wrapper.findAll('table').at(-1)?.findAll('tbody td')
    expect(cells?.[0]?.text()).toContain('2026')
    expect(cells?.slice(1).map((cell) => cell.text())).toEqual([
      '业务索引',
      '设备标识',
    ])
  })
})

describe('模型生成与发布状态', () => {
  it('空拟合结果不能同时声称模型可以上线', () => {
    const wrapper = mount(ResultView, {
      props: {
        payload: {
          model: {
            kind: 'model',
            algo: 'linear_regression',
            task: 'regression',
            feature_keys: ['功率'],
            target_key: '能耗',
            hyper_params: {},
            fitted: {},
            serving_channel: 'json',
          },
        },
      },
    })
    expect(wrapper.text()).toContain('还没有训练出模型')
    expect(wrapper.text()).not.toContain('可上线')
  })
})

describe('评估结果按算子身份派发', () => {
  it('异常检测概况显示样本数与比例，不误当特征重要性', () => {
    const wrapper = mount(ResultView, {
      props: {
        code: 'anomaly_distance',
        payload: {
          metrics: {
            kind: 'metrics',
            task: 'anomaly_detection',
            metrics: { test_rows: 20, threshold: 1, anomaly_rate: 0.05 },
          },
        },
      },
    })
    expect(wrapper.find('.dt-ml-metrics__list').exists()).toBe(true)
    expect(wrapper.text()).toContain('验证样本数')
    expect(wrapper.text()).toContain('异常比例')
    expect(wrapper.find('.dt-ml-importance').exists()).toBe(false)
  })

  it('对称矩阵优先使用已保存的正类配置，不反查成无法识别', () => {
    const wrapper = mount(ResultView, {
      props: {
        code: 'classification_metrics',
        config: { positive_label: 0 },
        payload: {
          metrics: {
            kind: 'metrics',
            task: 'classification',
            metrics: { precision: 1, recall: 1, f1: 1, accuracy: 1 },
            labels: ['0', '1'],
            matrix: [
              [5, 0],
              [0, 5],
            ],
          },
        },
      },
    })
    expect(wrapper.text()).toContain('正类：0')
    expect(wrapper.text()).not.toContain('认不出哪一类是正类')
  })

  it('重要性列恰好名为 mape 时仍保留列名和无量纲的数值', () => {
    const wrapper = mount(ResultView, {
      props: {
        code: 'feature_importance',
        payload: {
          metrics: {
            kind: 'metrics',
            task: 'regression',
            metrics: { mape: 0.12 },
          },
        },
      },
    })
    expect(wrapper.find('.dt-ml-metrics__list').exists()).toBe(false)
    expect(wrapper.find('.dt-ml-bars__label').text()).toBe('mape')
    expect(wrapper.find('.dt-ml-bars__num').text()).toBe('0.12')
    expect(wrapper.text()).not.toContain('0.12%')
  })
})

function truncatedFrame() {
  return {
    frame: {
      kind: 'frame',
      shape: { rows: 144, cols: 1 },
      columns: [column('用量')],
      index_name: 'ts',
      index_head: [],
      head: [['42']],
      rows_truncated: true,
      cols_truncated: false,
    },
  }
}

describe('摘要与全量结果的边界', () => {
  it('预览预算削减不误报为讲解块丢失', () => {
    const wrapper = mount(ResultView, {
      props: {
        payload: truncatedFrame(),
        isPreviewTruncated: true,
        report: {
          blocks: [
            {
              kind: 'rows',
              zone: 'step',
              port: '',
              title: '处理记录',
              tier: 0,
              payload: { before: 144, after: 144, dropped: 0 },
            },
          ],
        },
      },
    })
    expect(wrapper.text()).toContain('结果摘要达到保存上限')
    expect(wrapper.text()).not.toContain('有几块没能存下来')
  })

  it('未留全量的末端结果不把用户指向不存在的下游', () => {
    const wrapper = mount(ResultView, { props: { payload: truncatedFrame() } })
    expect(wrapper.text()).toContain('本次运行未保留全量结果')
    expect(wrapper.text()).toContain('留全量结果')
    expect(wrapper.text()).not.toContain('完整结果在下游算子里')
  })

  it('已有导出文件时直接提示下载，不要求重新运行', () => {
    const wrapper = mount(ResultView, {
      props: {
        payload: truncatedFrame(),
        exportedPorts: ['frame'],
        runId: 'run',
        nodeId: 'node',
      },
    })
    expect(wrapper.text()).toContain('已保留的全量结果')
    expect(wrapper.text()).not.toContain('本次运行未保留全量结果')
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.text() === '下载全量结果'),
    ).toBe(true)
  })
})
