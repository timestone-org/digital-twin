/**
 * @fileoverview `axis` 块的画法：实际覆盖与断档、请求区间与实际区间并排、
 * 切分两段的先后、每折的前向链、窗口示意，以及全部退化分支。
 *
 * ⚠ 夹具照抄后端单测的真实产出（`test_modeling_source_report.py`、
 * `test_modeling_split_report.py`、`test_modeling_window_report.py`、
 * `test_modeling_diagnostics_report.py`）：形状漂了会用例全绿而界面全错。
 * ⚠ 时刻用本地时构造再转成 UTC 文本：断言的字面量才不随跑用例的机器时区变。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AxisBlock from '@/pages/Modeling/Canvas/components/AxisBlock.vue'
import type { ReportBlock } from '@/pages/Modeling/Canvas/scripts/reportBlocks'

function blockOf(
  payload: Record<string, unknown>,
  title = '时间覆盖',
): ReportBlock {
  return {
    kind: 'axis',
    zone: 'charts',
    port: 'frame',
    title,
    tier: 2,
    isPrimary: null,
    payload,
  }
}

/** 本地时的某一天零点，毫秒。 */
function at(year: number, month: number, day: number, hour = 0): number {
  return new Date(year, month - 1, day, hour).getTime()
}

/** 后端给的是 UTC RFC3339 文本。 */
function moment(ms: number): string {
  return new Date(ms).toISOString()
}

const HOUR = 3_600_000

/** `ledger_source` 的真实产出：占用率、断档、以及单独一段的请求区间。 */
const SOURCE = blockOf({
  bucket_ms: null,
  tz_offset_minutes: 480,
  actual_since: moment(at(2026, 8, 12)),
  actual_until: moment(at(2026, 9, 1)),
  occupancy: [1, 0.5, 0.5, 1],
  gaps: [],
  segments: [
    {
      since: at(2026, 1, 1),
      until: at(2026, 9, 1),
      label: '请求区间',
      tone: 'requested',
    },
  ],
})

/** `resample` 的真实产出：桶宽 + 时区 + 占用率 + 断档。 */
const RESAMPLE = blockOf(
  {
    bucket_ms: 900_000,
    tz_offset_minutes: 480,
    actual_since: moment(at(2026, 1, 1)),
    actual_until: moment(at(2026, 1, 5)),
    occupancy: [1, 1, 0, 1],
    gaps: [{ since: at(2026, 1, 2), until: at(2026, 1, 3), missing: 96 }],
    segments: [],
  },
  '桶占用与断档',
)

/** `split_dataset` 的真实产出：两段带 `since_text`/`rows` 的时间跨度。 */
function splitOf(tone: string, testSince: number): ReportBlock {
  return blockOf(
    {
      bucket_ms: null,
      tz_offset_minutes: 480,
      actual_since: moment(at(2026, 8, 5, 8)),
      actual_until: moment(at(2026, 8, 5, 17)),
      occupancy: [1, 1],
      gaps: [],
      segments: [
        {
          label: '训练集',
          tone: tone === 'shuffled' ? 'shuffled' : 'primary',
          since: at(2026, 8, 5, 8),
          until: at(2026, 8, 5, 14),
          since_text: moment(at(2026, 8, 5, 8)),
          until_text: moment(at(2026, 8, 5, 14)),
          rows: 7,
        },
        {
          label: '测试集',
          tone: tone === 'shuffled' ? 'shuffled' : 'secondary',
          since: testSince,
          until: at(2026, 8, 5, 17),
          since_text: moment(testSince),
          until_text: moment(at(2026, 8, 5, 17)),
          rows: 3,
        },
      ],
    },
    '两段的时间跨度',
  )
}

/** `cross_validate` 的真实产出：每折按**行序**给训练段与测试段，且不带 scale。 */
function foldsOf(count: number, leaking = false): ReportBlock {
  return blockOf(
    {
      bucket_ms: null,
      tz_offset_minutes: 0,
      actual_since: null,
      actual_until: null,
      occupancy: [],
      gaps: [],
      segments: Array.from({ length: count }, (_, seat) => ({
        name: `第 ${seat + 1} 折`,
        since: 0,
        until: (seat + 1) * 10,
        test_since: leaking ? 0 : (seat + 1) * 10,
        test_until: (seat + 2) * 10,
        train_rows: (seat + 1) * 10,
        test_rows: 10,
      })),
      is_primary: false,
    },
    '折布局',
  )
}

/** `lag_feature` 的真实产出：按行序量的窗口示意，payload 自带 scale。 */
const LAG = blockOf(
  {
    bucket_ms: null,
    tz_offset_minutes: 0,
    actual_since: null,
    actual_until: null,
    occupancy: [],
    gaps: [],
    segments: [
      { label: '当前行', tone: 'primary', since: 2, until: 3, lag: 0 },
      {
        label: '滞后 1 期取的那一行',
        tone: 'secondary',
        since: 1,
        until: 2,
        lag: 1,
      },
      {
        label: '滞后 2 期取的那一行',
        tone: 'secondary',
        since: 0,
        until: 1,
        lag: 2,
      },
    ],
    is_primary: true,
    scale: 'index',
  },
  '窗口示意',
)

function factsOf(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('.dt-ml-axis__fact').map((one) => one.text())
}

/** 行名：短名后面跟着一份全名的 `title`，全名才是要断言的那个。 */
function namesOf(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('.dt-ml-band__name title').map((one) => one.text())
}

describe('取数的时间覆盖', () => {
  it('实际覆盖与请求区间并排两行，触顶时看得出实际起点晚了多少', () => {
    const wrapper = mount(AxisBlock, { props: { block: SOURCE } })

    expect(namesOf(wrapper)).toEqual(['实际覆盖', '请求区间'])
    expect(factsOf(wrapper)).toContain(
      '请求的是 2026-01-01 00:00 ~ 2026-09-01 00:00，实际起点比请求的晚了 223 天。',
    )
  })

  it('实际起点没晚于请求时不多写一句「晚了 0 天」', () => {
    const full = {
      ...SOURCE.payload,
      actual_since: moment(at(2026, 1, 1)),
    }
    const wrapper = mount(AxisBlock, { props: { block: blockOf(full) } })

    expect(factsOf(wrapper)).toContain(
      '请求的是 2026-01-01 00:00 ~ 2026-09-01 00:00。',
    )
  })

  it('时刻按本机时区显示，并注明后端给的是 UTC', () => {
    const wrapper = mount(AxisBlock, { props: { block: SOURCE } })

    expect(factsOf(wrapper)).toContain(
      '实际覆盖 2026-08-12 00:00 ~ 2026-09-01 00:00（本机时区显示，后端给的是 UTC）。',
    )
  })

  it('业务时区照实印出来，不与本机时区混为一谈', () => {
    const wrapper = mount(AxisBlock, { props: { block: SOURCE } })

    expect(factsOf(wrapper)).toContain('业务时区 UTC+08:00。')
  })

  it('没有断档时明说没有，并给出平均占用率', () => {
    const wrapper = mount(AxisBlock, { props: { block: SOURCE } })

    expect(factsOf(wrapper)).toContain('整段没有断档。')
    expect(factsOf(wrapper)).toContain('平均占用率 75%（按中位采集间隔折算）。')
  })

  it('块的标题照实印出来', () => {
    const wrapper = mount(AxisBlock, { props: { block: SOURCE } })

    expect(wrapper.find('.dt-ml-axis__title').text()).toBe('时间覆盖')
  })
})

describe('重采样的桶与断档', () => {
  it('桶宽换算成人看得懂的说法，毫秒原值一并留着', () => {
    const wrapper = mount(AxisBlock, { props: { block: RESAMPLE } })

    expect(factsOf(wrapper)).toContain(
      '每 15 分钟一个桶（900,000 毫秒），按业务时区 UTC+08:00 切。',
    )
  })

  it('断档从覆盖段里挖掉，画成交叉散列的一段', () => {
    const wrapper = mount(AxisBlock, { props: { block: RESAMPLE } })

    expect(wrapper.findAll('.dt-ml-band__bar--primary')).toHaveLength(2)
    expect(wrapper.findAll('.dt-ml-band__bar--gap')).toHaveLength(1)
  })

  it('断档的段数与缺的行数一起说清', () => {
    const wrapper = mount(AxisBlock, { props: { block: RESAMPLE } })

    expect(factsOf(wrapper)).toContain('1 段断档，合计缺 96 行。')
  })

  it('断档触到上限时说清可能还有没画出来的', () => {
    const many = {
      ...RESAMPLE.payload,
      gaps: Array.from({ length: 20 }, (_, seat) => ({
        since: at(2026, 1, 2) + seat * HOUR,
        until: at(2026, 1, 2) + seat * HOUR + HOUR / 2,
        missing: 2,
      })),
    }
    const wrapper = mount(AxisBlock, { props: { block: blockOf(many) } })

    expect(wrapper.find('.dt-ml-axis__limit').text()).toBe(
      '断档最多列 20 段，这一块已经列满，可能还有没画出来的断档。',
    )
  })
})

describe('区段的上限', () => {
  it('区段触到上限时说清可能还有没画出来的段', () => {
    const many = blockOf({
      bucket_ms: null,
      tz_offset_minutes: 480,
      actual_since: null,
      actual_until: null,
      occupancy: [],
      gaps: [],
      segments: Array.from({ length: 20 }, (_, seat) => ({
        name: `第 ${seat + 1} 折`,
        since: 0,
        until: (seat + 1) * 10,
        test_since: (seat + 1) * 10,
        test_until: (seat + 2) * 10,
      })),
    })
    const wrapper = mount(AxisBlock, { props: { block: many } })

    expect(wrapper.find('.dt-ml-axis__limit').text()).toBe(
      '区段最多列 20 段，这一块已经列满，可能还有没画出来的段。',
    )
  })
})

describe('切分两段的先后', () => {
  it('测试段整段在训练段之后时明说，并点名最早的那一行', () => {
    const wrapper = mount(AxisBlock, {
      props: { block: splitOf('ordered', at(2026, 8, 5, 15)) },
    })

    expect(factsOf(wrapper)).toContain(
      '测试段整段在训练段之后，最早的一行是 2026-08-05 15:00（本机时区）。',
    )
  })

  it('两段重叠时不含糊，直接说重叠', () => {
    const wrapper = mount(AxisBlock, {
      props: { block: splitOf('ordered', at(2026, 8, 5, 10)) },
    })

    expect(factsOf(wrapper)).toContain(
      '测试段与训练段在时间上重叠，最早的一行 2026-08-05 10:00 落在训练段里。',
    )
  })

  it('随机打乱切的两段照实说交错，不假装有先后', () => {
    const wrapper = mount(AxisBlock, {
      props: { block: splitOf('shuffled', at(2026, 8, 5, 9)) },
    })

    expect(factsOf(wrapper)).toContain(
      '两段是随机打乱切出来的，时间上互相交错。',
    )
  })

  it('两段摆在同一行里，重叠与否一眼看得见', () => {
    const wrapper = mount(AxisBlock, {
      props: { block: splitOf('ordered', at(2026, 8, 5, 15)) },
    })

    expect(namesOf(wrapper)).toEqual(['实际覆盖', '区段'])
  })
})

describe('折布局与窗口示意', () => {
  it('每折一行，训练段与测试段各一条', () => {
    const wrapper = mount(AxisBlock, { props: { block: foldsOf(4) } })

    expect(namesOf(wrapper)).toEqual([
      '第 1 折',
      '第 2 折',
      '第 3 折',
      '第 4 折',
    ])
    expect(wrapper.findAll('.dt-ml-band__bar--secondary')).toHaveLength(4)
  })

  it('折的横轴量的是行序：payload 没带 scale 也不许当成 1970 年的毫秒', () => {
    const wrapper = mount(AxisBlock, { props: { block: foldsOf(4) } })
    const ticks = wrapper
      .findAll('.dt-ml-band__xlabels text')
      .map((one) => one.text())

    expect(ticks.join(' ')).not.toContain('1970')
    expect(ticks).toContain('20')
  })

  it('每折都拿之前的行训时说清是前向链', () => {
    const wrapper = mount(AxisBlock, { props: { block: foldsOf(4) } })

    expect(factsOf(wrapper)).toContain(
      '4 折都是拿测试段之前的行训的（前向链）。',
    )
  })

  it('测试段落进自己的训练段时点破分数偏高', () => {
    const wrapper = mount(AxisBlock, { props: { block: foldsOf(3, true) } })

    expect(factsOf(wrapper)).toContain(
      '3 折里有测试段落在自己的训练段里，那一折的分数偏高。',
    )
  })

  it('窗口示意按行序画一行，不印时区也不印覆盖', () => {
    const wrapper = mount(AxisBlock, { props: { block: LAG } })

    expect(namesOf(wrapper)).toEqual(['窗口'])
    expect(factsOf(wrapper)).toEqual([])
  })
})

describe('退化分支', () => {
  it('payload 整个是空的：一项都没有就照实说，不印一个假的 UTC+00:00', () => {
    const wrapper = mount(AxisBlock, { props: { block: blockOf({}) } })

    expect(factsOf(wrapper)).toEqual(['这一步没有说明时间轴上的任何一项。'])
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('只有时区与起止的时区口径块不画带，两句话照旧说全', () => {
    const zoned = blockOf(
      {
        bucket_ms: null,
        tz_offset_minutes: -330,
        actual_since: moment(at(2026, 3, 1)),
        actual_until: moment(at(2026, 3, 2)),
        occupancy: [],
        gaps: [],
        segments: [],
      },
      '时区口径',
    )
    const wrapper = mount(AxisBlock, { props: { block: zoned } })

    expect(wrapper.find('svg').exists()).toBe(false)
    expect(factsOf(wrapper)).toEqual([
      '业务时区 UTC-05:30。',
      '实际覆盖 2026-03-01 00:00 ~ 2026-03-02 00:00（本机时区显示，后端给的是 UTC）。',
    ])
  })

  it('起止读不出来时照实说没说明，不拿 0 当 1970 年画上去', () => {
    const broken = blockOf({
      bucket_ms: null,
      tz_offset_minutes: 480,
      actual_since: '不是一个时刻',
      actual_until: null,
      occupancy: [0, 0],
      gaps: [],
      segments: [],
    })
    const wrapper = mount(AxisBlock, { props: { block: broken } })

    expect(factsOf(wrapper)).toContain('这一步没有说明实际覆盖到哪一段。')
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('占用率全零时不谎报覆盖：占用率照实写成 0%', () => {
    const idle = blockOf({
      bucket_ms: null,
      tz_offset_minutes: 480,
      actual_since: moment(at(2026, 3, 1)),
      actual_until: moment(at(2026, 3, 2)),
      occupancy: [0, 0, 0],
      gaps: [],
      segments: [],
    })
    const wrapper = mount(AxisBlock, { props: { block: idle } })

    expect(factsOf(wrapper)).toContain('平均占用率 0%（按中位采集间隔折算）。')
  })

  it('段里缺了起止的那一条丢掉，不画成零宽的一根', () => {
    const partial = blockOf({
      bucket_ms: null,
      tz_offset_minutes: 480,
      actual_since: null,
      actual_until: null,
      occupancy: [],
      gaps: [],
      segments: [
        { label: '好的一段', tone: 'primary', since: 0, until: 5 },
        { label: '缺起点', tone: 'primary', until: 9 },
      ],
      scale: 'index',
    })
    const wrapper = mount(AxisBlock, { props: { block: partial } })

    expect(wrapper.findAll('.dt-ml-band__bar--primary')).toHaveLength(1)
  })

  it('只有一折时也照画，并按行序说清前向链', () => {
    const wrapper = mount(AxisBlock, { props: { block: foldsOf(1) } })

    expect(wrapper.findAll('.dt-ml-band__name')).toHaveLength(1)
    expect(factsOf(wrapper)).toContain(
      '1 折都是拿测试段之前的行训的（前向链）。',
    )
  })

  it('极长的折名收成省略号，全名挂在带上的 title 里', () => {
    const long = '第一折很长很长的名字很长很长的名字'
    const named = blockOf({
      bucket_ms: null,
      tz_offset_minutes: 0,
      occupancy: [],
      gaps: [],
      segments: [
        { name: long, since: 0, until: 10, test_since: 10, test_until: 20 },
      ],
    })
    const wrapper = mount(AxisBlock, { props: { block: named } })

    expect(wrapper.find('.dt-ml-band__name').text()).toContain('…')
    expect(wrapper.find('.dt-ml-band__name title').text()).toBe(long)
  })
})
