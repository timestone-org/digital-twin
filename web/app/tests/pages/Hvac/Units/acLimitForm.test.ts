/**
 * @fileoverview 锁住达标范围的取值规则：空 ≠ 0、覆盖式载荷要带上每一个可配指标、
 * 上下限比大小不经 Number。
 *
 * ⚠ 「空」这一条是这块最容易静默错的：把留空当成 0 会给一台空调配上
 * 「下限 0℃」这种谁都不会注意到、但会让判定全变的范围。
 */
import { describe, expect, it } from 'vitest'
import type { AcDataset, AcMetric, AcMetricLimit } from '@dt/contracts'

import {
  buildLimitRows,
  compareDecimal,
  implausibleWarnings,
  toLimitPayload,
  validateRows,
} from '@/pages/Hvac/Units/acLimitForm'
import type { LimitRow } from '@/pages/Hvac/Units/acLimitForm'

function metric(over: Partial<AcMetric> & { key: string }): AcMetric {
  return {
    name: over.key,
    unit: '℃',
    group: 'temperature',
    is_limitable: false,
    is_charted_by_default: false,
    ...over,
  }
}

function dataset(key: string, metrics: AcMetric[]): AcDataset {
  return { key, name: key, description: '', metrics }
}

function row(over: Partial<LimitRow> = {}): LimitRow {
  return {
    metric: 'workshop_temp_avg',
    name: '车间温度平均值',
    unit: '℃',
    group: 'temperature',
    lower: '',
    upper: '',
    ...over,
  }
}

describe('compareDecimal', () => {
  it.each([
    ['20.15', '20.15', 0],
    ['20.15', '20.2', -1],
    ['20.2', '20.15', 1],
    ['100', '99', 1],
    ['9', '100', -1],
    ['20.5', '20.45', 1],
    ['-1', '1', -1],
    ['1', '-1', 1],
    ['-2', '-1', -1],
    ['-1', '-2', 1],
    ['007', '7', 0],
    ['20', '20.0', 0],
    ['20.10', '20.1', 0],
  ])('%s 与 %s 比得出 %i', (left, right, expected) => {
    expect(compareDecimal(left, right)).toBe(expected)
  })

  it('负零与零一样大，不会把 -0 判成更小', () => {
    expect(compareDecimal('-0', '0')).toBe(0)
    expect(compareDecimal('-0.0', '0')).toBe(0)
  })

  it('位数超出双精度也比得准——这正是不走 Number 的理由', () => {
    const left = '1.00000000000000001'
    const right = '1.00000000000000002'
    expect(Number(left) === Number(right)).toBe(true)
    expect(compareDecimal(left, right)).toBe(-1)
  })
})

describe('buildLimitRows', () => {
  const catalog = [
    dataset('raw_minute', [
      metric({
        key: 'workshop_temp_avg',
        name: '车间温度',
        is_limitable: true,
      }),
      metric({ key: 'fresh_air_temp', name: '新风温度' }),
      metric({
        key: 'workshop_humidity_avg',
        name: '车间湿度',
        unit: '%',
        is_limitable: true,
      }),
    ]),
  ]

  it('只收 is_limitable 的指标，不在前端写死是哪两个', () => {
    expect(buildLimitRows(catalog, []).map((item) => item.metric)).toEqual([
      'workshop_temp_avg',
      'workshop_humidity_avg',
    ])
  })

  it('铺上已有取值，并带出量纲供界面显示', () => {
    const existing: AcMetricLimit[] = [
      { metric: 'workshop_temp_avg', lower_limit: '20.15', upper_limit: '24' },
    ]
    const [first, second] = buildLimitRows(catalog, existing)
    expect(first).toEqual({
      metric: 'workshop_temp_avg',
      name: '车间温度',
      unit: '℃',
      group: 'temperature',
      lower: '20.15',
      upper: '24',
    })
    expect(second?.unit).toBe('%')
  })

  it('后端给 null 的一侧铺成空串，不是 0', () => {
    const existing: AcMetricLimit[] = [
      { metric: 'workshop_temp_avg', lower_limit: null, upper_limit: '24' },
    ]
    expect(buildLimitRows(catalog, existing)[0]?.lower).toBe('')
  })

  it('跨数据集去重收集——达标范围按指标存，与数据集无关', () => {
    const shared = metric({ key: 'workshop_temp_avg', is_limitable: true })
    const rows = buildLimitRows(
      [
        dataset('raw_minute', [shared]),
        dataset('hourly', [
          shared,
          metric({ key: 'other', is_limitable: true }),
        ]),
      ],
      [],
    )
    expect(rows.map((item) => item.metric)).toEqual([
      'workshop_temp_avg',
      'other',
    ])
  })

  it('没有可配指标时给空数组', () => {
    expect(buildLimitRows([dataset('raw_minute', [])], [])).toEqual([])
  })
})

describe('validateRows', () => {
  it('两侧都留空是合法的——那表示上下都不限制', () => {
    expect(validateRows([row()])).toBeNull()
  })

  it('只填一侧也合法', () => {
    expect(validateRows([row({ lower: '20' })])).toBeNull()
  })

  it('上下限相等放行', () => {
    expect(validateRows([row({ lower: '20', upper: '20' })])).toBeNull()
  })

  it('下限大于上限时说清是哪个指标', () => {
    const found = validateRows([row({ lower: '25', upper: '24' })])
    expect(found).toContain('车间温度平均值')
    expect(found).toContain('下限不能大于上限')
  })

  it.each(['abc', '1e3', '1,000', '２０', '20.', ''])(
    '不是十进制字面量（%s）就拦下',
    (text) => {
      const found = validateRows([row({ lower: text })])
      expect(found === null).toBe(text === '')
    },
  )

  it('负数是合法取值', () => {
    expect(validateRows([row({ lower: '-10.5', upper: '-1' })])).toBeNull()
  })

  it('多行时报第一条不合格的', () => {
    const found = validateRows([
      row(),
      row({ metric: 'h', name: '车间湿度', lower: '80', upper: '60' }),
    ])
    expect(found).toContain('车间湿度')
  })
})

describe('toLimitPayload', () => {
  it('留空的一侧送 null，不是 0 也不是空串', () => {
    expect(toLimitPayload([row({ upper: '24' })])).toEqual([
      { metric: 'workshop_temp_avg', lower_limit: null, upper_limit: '24' },
    ])
  })

  it('两侧都清空的指标仍要出现在载荷里，由后端删掉它', () => {
    expect(toLimitPayload([row()])).toEqual([
      { metric: 'workshop_temp_avg', lower_limit: null, upper_limit: null },
    ])
  })

  it('取值原样是字符串，不做数字化', () => {
    const [first] = toLimitPayload([row({ lower: ' 20.150 ' })])
    expect(first?.lower_limit).toBe('20.150')
  })
})

describe('implausibleWarnings', () => {
  const temp = (lower: string, upper: string): LimitRow =>
    row({
      name: '车间温度平均值',
      group: 'temperature',
      unit: '℃',
      lower,
      upper,
    })
  const humidity = (lower: string, upper: string): LimitRow =>
    row({
      metric: 'workshop_humidity_avg',
      name: '车间湿度平均值',
      group: 'humidity',
      unit: '%',
      lower,
      upper,
    })

  it('现场那次填反：温 23~53 / 湿 27~63 必须出提醒', () => {
    const found = implausibleWarnings([temp('23', '53'), humidity('27', '63')])
    expect(found).not.toHaveLength(0)
    expect(found.join(' ')).toContain('车间温度平均值')
    expect(found.join(' ')).toContain('填反')
  })

  it('填对的那份一句提醒都不出：温 23~27 / 湿 53~63', () => {
    expect(
      implausibleWarnings([temp('23', '27'), humidity('53', '63')]),
    ).toEqual([])
  })

  it('⚠ 上下限校验对这种填反完全无能为力——两对各自都是有序的', () => {
    const transposed = [temp('23', '53'), humidity('27', '63')]
    expect(validateRows(transposed)).toBeNull()
    expect(implausibleWarnings(transposed)).not.toHaveLength(0)
  })

  it('温度高过常识上界要说一声', () => {
    expect(implausibleWarnings([temp('', '53')])[0]).toContain('上限 53℃')
  })

  it('湿度低过常识下界同样要说一声', () => {
    expect(implausibleWarnings([humidity('27', '')])[0]).toContain('下限 27%')
  })

  it('留空的一侧不参与判断——空是不限制，不是 0', () => {
    expect(implausibleWarnings([temp('', '')])).toEqual([])
  })

  it('还没输完的半截取值不判，免得边打字边报警', () => {
    expect(implausibleWarnings([temp('2', '-')])).toEqual([])
  })

  it('没有常识区间的分组不判，比如频率', () => {
    const fan = row({
      group: 'frequency',
      unit: 'Hz',
      lower: '0',
      upper: '999',
    })
    expect(implausibleWarnings([fan])).toEqual([])
  })

  it('零下的温度是合理取值，不该被当成异常', () => {
    expect(implausibleWarnings([temp('-10', '5')])).toEqual([])
  })
})
