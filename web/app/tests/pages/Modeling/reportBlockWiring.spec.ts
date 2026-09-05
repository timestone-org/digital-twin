/**
 * @fileoverview 派发表接线：八种块各自落到自己的画法上，对比图再分主体位与辅图格。
 *
 * ⚠ 夹具照抄后端 24 个算子真跑出来的 payload（`tests/contract/
 * test_modeling_report_coverage.py` 那份最小输入），不是手编的形状：手编的与真
 * 块一漂，用例全绿而界面全错。
 * ⚠ 「掉回兜底画法」不会报错也不会白屏，只会变成一堵折叠 JSON 的墙——只有点名
 * 问「是不是这个件」才拦得住。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AxisBlock from '@/pages/Modeling/Canvas/components/AxisBlock.vue'
import BinsBlock from '@/pages/Modeling/Canvas/components/BinsBlock.vue'
import BreakdownBlock from '@/pages/Modeling/Canvas/components/BreakdownBlock.vue'
import CellsBlock from '@/pages/Modeling/Canvas/components/CellsBlock.vue'
import ColumnsBlock from '@/pages/Modeling/Canvas/components/ColumnsBlock.vue'
import FitsBlock from '@/pages/Modeling/Canvas/components/FitsBlock.vue'
import ReportBlocks from '@/pages/Modeling/Canvas/components/ReportBlocks.vue'
import RowsBlock from '@/pages/Modeling/Canvas/components/RowsBlock.vue'
import StructureBlock from '@/pages/Modeling/Canvas/components/StructureBlock.vue'
import UnknownBlock from '@/pages/Modeling/Canvas/components/UnknownBlock.vue'
import type { ReportBlock } from '@/pages/Modeling/Canvas/scripts/reportBlocks'
import { reportOf } from '@/pages/Modeling/Canvas/scripts/reportBlocks'

/** 一份讲解走一遍真读取器：`is_primary` 是在那里读成块上字段的。 */
function blocksOf(raw: Record<string, unknown>[]): ReportBlock[] {
  return reportOf({ blocks: raw }).blocks
}

// `drop_missing` 真实产出
const ROWS = {
  kind: 'rows',
  zone: 'step',
  port: 'frame',
  title: '丢缺失',
  tier: 0,
  payload: {
    before: 48,
    after: 48,
    dropped: 0,
    dropped_blank: 0,
    ratio_configured: null,
    ratio_actual: 1.0,
    funnel: [
      { name: '进来', value: 48, unit: '行', note: '' },
      { name: '被判缺失', value: 0, unit: '行', note: '判据列里有一个空就丢这行' },
      { name: '留下', value: 48, unit: '行', note: '' },
    ],
    by_column: [],
  },
}

// `time_feature` 真实产出
const COLUMNS = {
  kind: 'columns',
  zone: 'step',
  port: 'frame',
  title: '新增列',
  tier: 1,
  payload: {
    added: ['ts_hour'],
    removed: [],
    kept: 5,
    dtype_before: [],
    reason: '按业务时区 UTC+08:00 从每一行的时刻造了 1 列',
  },
}

// `standardize` 真实产出：口径说明挂在 `cells` 块上
const CELLS = {
  kind: 'cells',
  zone: 'step',
  port: 'frame',
  title: '换了多少个数',
  tier: 0,
  payload: {
    by_column: [
      { key: '温度', changed: 48, low: null, high: null, samples: [20.0, 20.7] },
    ],
    notes: [
      {
        level: 'hint',
        text: 'μ 只在训练行上学、列统计却在整帧上算，所以缩放之后界面上这一列的均值不会正好是 0',
      },
    ],
  },
}

// `standardize` 真实产出
const FITS = {
  kind: 'fits',
  zone: 'table',
  port: 'frame',
  title: '逐列尺度',
  tier: 1,
  payload: {
    method: 'zscore',
    train_rows: 48,
    total_rows: 48,
    by_column: [
      {
        key: '温度',
        params: { center: 23.9375, scale: 2.5465356368996686, fit_rows: 48 },
        skipped_reason: '',
      },
    ],
  },
}

// `drop_missing` 真实产出：这一族的两端恰是 0 与 1，画的是空值率
const BINS = {
  kind: 'bins',
  zone: 'charts',
  port: 'frame',
  title: '判据列的空值率',
  tier: 1,
  payload: {
    by_column: [
      { key: '温度', bins: [0.0], low: 0.0, high: 1.0, marks: [], off_axis: null },
    ],
    is_primary: true,
    notes: [{ level: 'hint', text: '空的格一格都没有' }],
  },
}

// `time_feature` 真实产出：这一句是 alert 档，整条摆出来
const AXIS_STEP = {
  kind: 'axis',
  zone: 'step',
  port: 'frame',
  title: '时区口径',
  tier: 0,
  payload: {
    bucket_ms: null,
    tz_offset_minutes: 480,
    actual_since: '1970-01-01T00:00:00+00:00',
    actual_until: '1970-01-02T23:00:00+00:00',
    occupancy: [],
    gaps: [],
    segments: [],
    notes: [
      {
        level: 'alert',
        text: '小时 / 星期 / 月份都按业务时区 UTC+08:00 算，不按 UTC：口径差一个时区，这几列整体偏几个小时，而每个数看着都在正常范围里',
      },
    ],
  },
}

// `cross_validate` 真实产出：图区两张，逐折分是主体、折布局是辅图
const BREAKDOWN = {
  kind: 'breakdown',
  zone: 'charts',
  port: 'metrics',
  title: '逐折分数',
  tier: 1,
  payload: {
    label: '每折的分：回归是 R²、分类是准确率',
    unit: '',
    score_kind: 'r2',
    baseline: 1.0,
    items: [
      { name: '第 1 折', value: 1.0 },
      { name: '第 2 折', value: 0.62 },
    ],
    is_primary: true,
  },
}

const AXIS_AUX = {
  kind: 'axis',
  zone: 'charts',
  port: 'metrics',
  title: '折布局',
  tier: 1,
  payload: {
    bucket_ms: null,
    tz_offset_minutes: 0,
    actual_since: null,
    actual_until: null,
    occupancy: [],
    gaps: [],
    segments: [
      {
        name: '第 1 折',
        since: 0,
        until: 12,
        test_since: 12,
        test_until: 24,
        train_rows: 12,
        test_rows: 12,
      },
    ],
    is_primary: false,
  },
}

// `pca` 真实产出
const STRUCTURE = {
  kind: 'structure',
  zone: 'charts',
  port: 'frame',
  title: '解释方差与载荷',
  tier: 2,
  payload: {
    importances: [],
    ranges: [],
    tree: null,
    pdp: [],
    loadings: [
      [0.001706, 0.315203, 0.949023],
      [0.845153, -0.50773, 0.167115],
    ],
    explained: [0.998972, 0.001028],
    is_primary: true,
    loading_rows: ['pc1', 'pc2'],
    loading_columns: ['温度', '负荷', '能耗'],
    cumulative: [0.998972, 1.0],
    is_loadings_cut: false,
  },
}

const ALL = [
  ROWS,
  COLUMNS,
  CELLS,
  FITS,
  BINS,
  AXIS_STEP,
  BREAKDOWN,
  AXIS_AUX,
  STRUCTURE,
]

const VIEWS = [
  ['rows', RowsBlock],
  ['columns', ColumnsBlock],
  ['cells', CellsBlock],
  ['fits', FitsBlock],
  ['bins', BinsBlock],
  ['axis', AxisBlock],
  ['breakdown', BreakdownBlock],
  ['structure', StructureBlock],
] as const

describe('八种块各自落到自己的画法上', () => {
  const wrapper = mount(ReportBlocks, { props: { blocks: blocksOf(ALL) } })

  it.each(VIEWS)('%s 那一块交给它自己的件', (_kind, view) => {
    expect(wrapper.findComponent(view).exists()).toBe(true)
  })

  // ⚠ 兜底画法一出现就是一堵折叠 JSON 的墙，而它既不报错也不白屏
  it('一块都没有掉回兜底的折叠原文', () => {
    expect(wrapper.findComponent(UnknownBlock).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('还没有专门的画法')
  })

  it('九块真 payload 全摆出来，一块都没被静默丢掉', () => {
    expect(wrapper.findAll('[data-lane] > *')).toHaveLength(ALL.length)
  })
})

describe('对比图分主体位与辅图格', () => {
  const wrapper = mount(ReportBlocks, {
    props: { blocks: blocksOf([BREAKDOWN, AXIS_AUX, BINS, STRUCTURE]) },
  })

  it('明写了是主体图的三张独占主体那一排', () => {
    const lead = wrapper.findAll('[data-lane="lead"] > *')

    expect(lead).toHaveLength(3)
    expect(wrapper.find('[data-lane="lead"]').text()).toContain('逐折分数')
  })

  it('标了不是主体的那一张落进辅图格', () => {
    const aux = wrapper.find('[data-lane="aux"]')

    expect(wrapper.findAll('[data-lane="aux"] > *')).toHaveLength(1)
    expect(aux.text()).toContain('折布局')
  })

  // ⚠ 缺省不是「是主体」：把没标的一律顶上去，同一条降档梯子在不同算子上会摆
  // 出不同的版面（规格 §4.3）
  it('一个字没标的图不顶到主体位，落进辅图格', () => {
    const bare = { ...BINS, payload: { by_column: [] } }
    const one = mount(ReportBlocks, { props: { blocks: blocksOf([bare]) } })

    expect(one.find('[data-lane="lead"]').exists()).toBe(false)
    expect(one.find('[data-lane="aux"]').exists()).toBe(true)
  })

  it('别的区不分两排，一排摆完', () => {
    const one = mount(ReportBlocks, { props: { blocks: blocksOf([ROWS]) } })

    expect(one.find('[data-lane="flat"]').exists()).toBe(true)
    expect(one.find('[data-lane="lead"]').exists()).toBe(false)
  })
})

describe('块上挂的那几句话', () => {
  // ⚠ 这一句是 alert 档：读错了时区，那几列整体偏几个小时而每个数都在正常范围里
  it('时间轴块上的告警整条摆出来', () => {
    const wrapper = mount(ReportBlocks, {
      props: { blocks: blocksOf([AXIS_STEP]) },
    })

    expect(wrapper.text()).toContain('按业务时区 UTC+08:00 算，不按 UTC')
  })

  it('分布块上的口径说明也摆出来', () => {
    const wrapper = mount(ReportBlocks, { props: { blocks: blocksOf([BINS]) } })

    expect(wrapper.text()).toContain('空的格一格都没有')
  })
})

describe('降档留痕摆在块流里', () => {
  it('丢掉的块照标题点名，摆在块之后而不是整屏顶上', () => {
    const wrapper = mount(ReportBlocks, {
      props: { blocks: blocksOf([ROWS]), dropped: ['载荷热力', '前后叠图'] },
    })
    const marks = wrapper.findAll('[data-zone], .dt-ml-blocks__gone')

    expect(marks).toHaveLength(2)
    expect(marks[0]?.attributes('data-zone')).toBe('step')
    expect(marks[1]?.text()).toContain('载荷热力')
    expect(marks[1]?.text()).toContain('本来还有几块')
  })

  it('降到最后一档时后端那句说明也印出来', () => {
    const wrapper = mount(ReportBlocks, {
      props: { blocks: [], note: '这一步的讲解太大，只留下了每一步都有的那几行' },
    })

    expect(wrapper.text()).toContain('只留下了每一步都有的那几行')
  })

  it('没有留痕时那一格整个不摆，不留一个空框', () => {
    const wrapper = mount(ReportBlocks, { props: { blocks: blocksOf([ROWS]) } })

    expect(wrapper.find('.dt-ml-blocks__gone').exists()).toBe(false)
  })
})
