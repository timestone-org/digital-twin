/**
 * @fileoverview 结果视图上三处**会说谎**的行为：权重条的基准、触顶的方向、列角色表。
 *
 * 都不是「不够好看」：条子按错基准会把一排真系数画成「谁都不重要」，触顶文案指
 * 反了会让用户往错的一头缩时间范围（设计规格 D-5 / D-6）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ResultView from '@/pages/Modeling/Canvas/components/ResultView.vue'

const TINY_MODEL = {
  model: {
    kind: 'model',
    algo: 'linear',
    task: 'regression',
    hyper_params: {},
    feature_keys: ['power', 'temp'],
    target_key: 'y',
    serving_channel: 'json',
    fitted: { coef: { power: 0.0012, temp: -0.0003 }, intercept: 0 },
  },
}

function columnOf(key: string, role: string) {
  return {
    key,
    name: key,
    dtype: 'string',
    role,
    unit: '',
    null_ratio: 0,
    n_unique: 2,
    min: null,
    max: null,
    mean: null,
    p50: null,
  }
}

const TRUNCATED = {
  frame: {
    kind: 'frame',
    shape: { rows: 500, cols: 1 },
    columns: [columnOf('note', 'ignored')],
    index_name: 'ts',
    index_head: [],
    head: [],
    rows_truncated: false,
    cols_truncated: false,
    provenance: {
      table_codes: ['energy_log'],
      since: '2026-01-01T00:00:00Z',
      until: null,
      is_truncated: true,
    },
  },
}

describe('权重条的基准', () => {
  // ⚠ 基准钉死成 1 的话，未标准化量纲上的小系数整排缩成看不见的一丝
  it('系数都远小于 1 时，最大的那根仍旧占满半边', () => {
    const wrapper = mount(ResultView, { props: { payload: TINY_MODEL } })

    const widths = wrapper
      .findAll('.dt-ml-model__bar')
      .map((bar) => bar.attributes('style') ?? '')
    expect(widths[0]).toContain('width: 50%')
  })

  it('其余各根按与最大值的比例收，不是一律贴边', () => {
    const wrapper = mount(ResultView, { props: { payload: TINY_MODEL } })

    const second = wrapper.findAll('.dt-ml-model__bar')[1]?.attributes('style')
    expect(second).toContain('width: 12.5%')
  })

  it('系数全是 0 时不除以 0，条子收成 0 宽', () => {
    const zeroed = {
      model: {
        ...TINY_MODEL.model,
        fitted: { coef: { power: 0, temp: 0 }, intercept: 0 },
      },
    }
    const wrapper = mount(ResultView, { props: { payload: zeroed } })

    const widths = wrapper
      .findAll('.dt-ml-model__bar')
      .map((bar) => bar.attributes('style') ?? '')
    expect(widths.every((style) => style.includes('width: 0%'))).toBe(true)
  })
})

describe('取数触顶的方向', () => {
  // ⚠ 取数是反扫取最新的 limit 行（`dataset/services/record_read.py::scan_window`），
  // 触顶时丢的是**更早**那批。指反了的话用户会往错的一头缩时间范围
  it('说清丢的是更早那批、留下的是最新那批', () => {
    const text = mount(ResultView, { props: { payload: TRUNCATED } }).text()

    expect(text).toContain('最新')
    expect(text).toContain('更早')
    expect(text).not.toContain('靠后')
  })
})

describe('列角色表', () => {
  it('后端真会产出的 ignored 认得出来，不是一个空徽标', () => {
    const text = mount(ResultView, { props: { payload: TRUNCATED } }).text()

    expect(text).toContain('不参与建模')
  })
})
