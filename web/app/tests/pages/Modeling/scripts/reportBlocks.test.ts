/**
 * @fileoverview 讲解的读取器：读不出来的照实退化，不猜也不补 0。
 *
 * ⚠ 块的内部形状没有 openapi 保护，后端改个键名这边只会静默少一块，
 * 所以每种块的缺字段与坏字段都要有一条。
 */
import { describe, expect, it } from 'vitest'

import {
  axisOf,
  binsOf,
  breakdownOf,
  cellsOf,
  columnsOf,
  fitsOf,
  isBlockKind,
  recordOf,
  reportOf,
  rowsOf,
  structureOf,
} from '@/pages/Modeling/Canvas/scripts/reportBlocks'

describe('整包讲解', () => {
  it('没记讲解的运行读成零个块，不是抛错', () => {
    expect(reportOf(null)).toEqual({ blocks: [], dropped: [], note: '' })
    expect(reportOf(undefined).blocks).toEqual([])
  })

  it('块的七个字段照读，降档留痕也读出来', () => {
    const report = reportOf({
      blocks: [
        {
          kind: 'rows',
          zone: 'charts',
          port: 'train',
          title: '行数账',
          tier: 2,
          payload: { before: 3, is_primary: true },
        },
      ],
      dropped: ['载荷热力'],
      note: '讲解太长',
    })

    expect(report.blocks[0]).toEqual({
      kind: 'rows',
      zone: 'charts',
      port: 'train',
      title: '行数账',
      tier: 2,
      isPrimary: true,
      payload: { before: 3, is_primary: true },
    })
    expect(report.dropped).toEqual(['载荷热力'])
    expect(report.note).toBe('讲解太长')
  })

  // ⚠ 「没标」与「标了不是主体」要分得开：折成同一个值之后，后端漏标一张图与
  // 明写它是辅图在前端就再也查不出区别，而规格 §4.3 的缺省恰恰不是 true
  it('主次没标时是 null，标了 false 时就是 false', () => {
    const marks = reportOf({
      blocks: [
        { kind: 'bins', zone: 'charts', payload: {} },
        { kind: 'bins', zone: 'charts', payload: { is_primary: false } },
        { kind: 'bins', zone: 'charts', payload: { is_primary: true } },
      ],
    }).blocks.map((block) => block.isPrimary)

    expect(marks).toEqual([null, false, true])
  })

  // ⚠ 认不出的种类留成原样交给兜底画法：改写成 unknown 就没法照实说是哪一种
  it('认不出的分区摆进第一区，种类原样留着', () => {
    const block = reportOf({
      blocks: [{ kind: '将来某种', zone: '将来某区' }],
    }).blocks[0]

    expect(block?.zone).toBe('step')
    expect(block?.kind).toBe('将来某种')
    expect(block?.payload).toEqual({})
  })

  it('整包不是对象时读成零个块', () => {
    expect(reportOf(recordOf('坏了')).blocks).toEqual([])
    expect(recordOf([1, 2])).toEqual({})
  })

  it('八种种类认得出，别的认不出', () => {
    expect(isBlockKind('structure')).toBe(true)
    expect(isBlockKind('structures')).toBe(false)
  })
})

describe('行数账', () => {
  it('缺字段的记成 0，比例缺了记成 null 不是 0', () => {
    const counts = rowsOf({ before: 12 })

    expect(counts.before).toBe(12)
    expect(counts.after).toBe(0)
    expect(counts.ratioConfigured).toBeNull()
    expect(counts.funnel).toEqual([])
  })

  it('配的比例与实际达成的比例分开读', () => {
    const counts = rowsOf({
      ratio_configured: 0.2,
      ratio_actual: 0.31,
      dropped_blank: 7,
      funnel: [{ label: '窗口命中' }],
      by_column: [{ key: 'temp' }],
    })

    expect(counts.ratioConfigured).toBe(0.2)
    expect(counts.ratioActual).toBe(0.31)
    expect(counts.droppedBlank).toBe(7)
    expect(counts.funnel[0]).toEqual({ label: '窗口命中' })
    expect(counts.byColumn).toHaveLength(1)
  })
})

describe('列的去向', () => {
  it('多出来的与少掉的分开读，理由照抄', () => {
    const change = columnsOf({
      added: ['pc1', 'pc2'],
      removed: ['湿度'],
      kept: 6,
      dtype_before: [{ key: 'temp', dtype: 'text' }],
      reason: '空值率超阈值',
    })

    expect(change.added).toEqual(['pc1', 'pc2'])
    expect(change.removed).toEqual(['湿度'])
    expect(change.kept).toBe(6)
    expect(change.dtypeBefore).toHaveLength(1)
    expect(change.reason).toBe('空值率超阈值')
  })

  it('列名不是字符串时读成空串，不把整块丢掉', () => {
    expect(columnsOf({ added: [1] }).added).toEqual([''])
  })
})

describe('改过的格', () => {
  it('原值样例里数与文本都留着，别的记成 null', () => {
    const changes = cellsOf({
      by_column: [
        { key: 'temp', changed: 3, low: -1, high: 2, samples: ['--', 5, {}] },
      ],
    })

    expect(changes[0]?.samples).toEqual(['--', 5, null])
    expect(changes[0]?.changed).toBe(3)
    expect(changes[0]?.low).toBe(-1)
  })

  it('没有上下界时留 null，不写成 0', () => {
    expect(cellsOf({ by_column: [{ key: 'a' }] })[0]?.high).toBeNull()
  })
})

describe('拟合出来的东西', () => {
  // ⚠ 训练行数与总行数不一样才是对的：统计量只在将来会进训练集的行上学
  it('训练行数与总行数分开读', () => {
    const fits = fitsOf({
      method: 'zscore',
      train_rows: 800,
      total_rows: 1000,
      by_column: [{ key: 'temp', params: { mean: 1 } }],
    })

    expect(fits.trainRows).toBe(800)
    expect(fits.totalRows).toBe(1000)
    expect(fits.method).toBe('zscore')
    expect(fits.byColumn).toHaveLength(1)
  })
})

describe('分布与参考线', () => {
  it('桶高里读不出来的那几个丢掉', () => {
    const bins = binsOf({
      by_column: [{ key: 'temp', bins: [1, 'x', 3, null] }],
    })

    expect(bins[0]?.bins).toEqual([1, 3])
  })

  // ⚠ 位置读不出来的参考线丢掉：画在 0 处会被读成「阈值就是 0」
  it('没有位置的参考线丢掉，有位置的连意图一起留', () => {
    const bins = binsOf({
      by_column: [
        {
          key: 'temp',
          marks: [
            { label: '缺位置' },
            { at: 3, label: '上界', intent: 'danger' },
          ],
        },
      ],
    })

    expect(bins[0]?.marks).toEqual([{ at: 3, label: '上界', intent: 'danger' }])
  })

  it('落在轴外的那一撮没有就是 null，不是 0 根', () => {
    expect(binsOf({ by_column: [{ key: 'a' }] })[0]?.offAxis).toBeNull()
    expect(
      binsOf({ by_column: [{ key: 'a', off_axis: { label: '空值' } }] })[0]
        ?.offAxis,
    ).toEqual({ label: '空值', count: 0 })
  })
})

describe('时间轴', () => {
  // ⚠ 实际起止不是请求起止：触顶时两者差得很远
  it('实际起止读出来，空串当没有', () => {
    const axis = axisOf({
      bucket_ms: 60000,
      tz_offset_minutes: 480,
      actual_since: '2026-08-12T03:00:00Z',
      actual_until: '',
      occupancy: [0.5, 'x'],
      gaps: [{ since: 'a' }],
      segments: [],
    })

    expect(axis.actualSince).toBe('2026-08-12T03:00:00Z')
    expect(axis.actualUntil).toBeNull()
    expect(axis.tzOffsetMinutes).toBe(480)
    expect(axis.occupancy).toEqual([0.5])
    expect(axis.gaps).toHaveLength(1)
  })

  it('没有桶宽就是 null——那一步没有按时间聚过', () => {
    expect(axisOf({}).bucketMs).toBeNull()
  })

  it('起止都是空串时两头都当没有', () => {
    const axis = axisOf({ actual_since: '', actual_until: '' })

    expect(axis.actualSince).toBeNull()
    expect(axis.actualUntil).toBeNull()
  })

  it('两头都有时原样留着', () => {
    const axis = axisOf({
      actual_since: '2026-08-12T03:00:00Z',
      actual_until: '2026-09-01T00:00:00Z',
    })

    expect(axis.actualUntil).toBe('2026-09-01T00:00:00Z')
  })
})

describe('按项的一组数', () => {
  // ⚠ 算不出来的那一项显示成 0 是假数
  it('算不出来的项留 null，口径与基线照读', () => {
    const breakdown = breakdownOf({
      label: '置换重要性',
      unit: '',
      score_kind: '',
      baseline: 0.82,
      items: [
        { name: '温度', value: 0.12, spread: 0.01 },
        { name: '湿度', value: null },
      ],
    })

    expect(breakdown.baseline).toBe(0.82)
    expect(breakdown.items[1]).toEqual({
      name: '湿度',
      value: null,
      spread: null,
    })
  })
})

describe('模型内部', () => {
  it('六样各自可缺，缺的那几样是空的不是坏的', () => {
    const structure = structureOf({})

    expect(structure.tree).toBeNull()
    expect(structure.importances).toEqual([])
    expect(structure.loadings).toEqual([])
  })

  // ⚠ 缺一个坐标的点丢掉：补 0 会在曲线上多出一个不存在的拐点
  it('部分依赖曲线里缺坐标的点丢掉', () => {
    const structure = structureOf({
      pdp: [{ key: 'temp', points: [[1, 2], [3], [4, 5]] }],
      loadings: [[0.1, 'x'], 'bad'],
      explained: [0.6, 0.3],
      tree: { depth: 3, nodes: [] },
    })

    expect(structure.pdp[0]?.points).toEqual([
      [1, 2],
      [4, 5],
    ])
    expect(structure.loadings).toEqual([[0.1], []])
    expect(structure.explained).toEqual([0.6, 0.3])
    expect(structure.tree).toEqual({ depth: 3, nodes: [] })
  })
})
